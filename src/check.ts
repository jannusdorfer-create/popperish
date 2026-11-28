// The one runnable check for src/map.ts: `npm run check` (node strips the types; no test framework).
import {existsSync, readFileSync} from 'node:fs';
import {strict as assert} from 'node:assert';
import {clashEdges, decodeShare, encodeShare, exact, greedy, isProper, kempe1879, kempePlain, obstruction, packColors, prepMap, randomMap, replay, timeForPage, colorsAt, unpackColors, type RawMap, type Solve, type Trace, type FMap} from './map.ts';
import {Staircase, Z, findZeros, gram, piK, primesUpTo, smoothCount, staircaseMiss, trueSteps, turing} from './zeta-sim.ts';
import {poisson, wigner} from './zeta-draw.ts';
import {COSH_IN, Crowd, FACTS, FlatCrowd, GENS, STEP, boostTo, eye, fix, hdist, inv, locate, mul, paving, ringOf} from './escher-sim.ts';
import {Run, lowest, poseGap, stopStep, tallyOrder, type Data as FallData} from './fall-sim.ts';
import {GuideRun, MAZE_PATHS, MAZE_ROUTES, MAZE_SHORTEST, Tero, dropOat, fillRings, gridSize, landMask, lightMask, mazeNet, mazeWorld, paintLight, reachable, scatter, snapFree, tokyoWorld, type RunData, type SlimeData} from './slime-sim.ts';
import {BALL_R, DT, GAP, STEP32, TUNNEL_KMH, WALK, WALL, crowd, dropTicks, dropTicksClosed, headline, medianCrowd, mulberry32, realFall, swimState, throwBall, throwMany, tunnelFrac, twinsFormula, ulp32, walkSpeed} from './npc-sim.ts';

const data = (f: string) => JSON.parse(readFileSync(new URL(`../public/data/${f}.json`, import.meta.url), 'utf8'));
const maps: Record<string, FMap> = {};
for (const f of ['us_states', 'europe', 'world', 'benelux', 'kempe_fail']) maps[f] = prepMap(data(f) as RawMap);
const traces = data('traces') as Record<string, Trace>;
const ms = (f: () => void) => {
  const t = performance.now();
  f();
  return Math.round(performance.now() - t);
};

/** A finished solve replays to a proper coloring; a stuck one is proper so far; the timed trace ends on the same colors. */
const verify = (m: FMap, s: Solve, label: string) => {
  const c = replay(s.trace.events, m.n);
  if (s.result.kind === 'solved') assert.ok(isProper(m, c, true), `${label}: not a proper full coloring`);
  else if (s.result.kind !== 'clash') assert.ok(isProper(m, c), `${label}: improper before it stopped`);
  const tt = timeForPage(s.trace, m), st = colorsAt(tt, tt.end + 5);
  assert.deepEqual(Array.from(st.to), Array.from(c), `${label}: timed trace ends elsewhere`);
  return c;
};

// real maps: greedy, exact, Kempe
for (const [name, m] of Object.entries(maps)) {
  for (const k of [4, 5]) {
    let s!: Solve;
    const t = ms(() => (s = exact(m, k)));
    assert.equal(s.result.kind, 'solved', `${name} exact ${k}: ${s.result.msg}`);
    verify(m, s, `${name} exact ${k}`);
    verify(m, greedy(m, k), `${name} greedy ${k}`);
    if (k === 4) console.log(`${name}: exact 4 in ${t} ms, ${s.trace.events.length} events; greedy 4: ${greedy(m, 4).result.kind}`);
  }
  const g3 = greedy(m, 3);
  assert.equal(g3.result.kind, 'stuck', `${name} greedy 3 should get stuck`);
  verify(m, g3, `${name} greedy 3`);
  const e3 = exact(m, 3), full3 = exact(m, 3, 200000, false);
  assert.equal(e3.result.kind, 'impossible', `${name} exact 3: ${e3.result.msg}`);
  assert.equal(full3.result.kind, 'impossible', `${name} full exact 3: ${full3.result.msg}`);
  if (name !== 'kempe_fail') {
    const kp = kempePlain(m);
    verify(m, kp, `${name} kempe`);
    console.log(`${name}: kempe ${kp.result.kind}; 3 inks: ${e3.result.msg}`);
  }
}

// the engine's traces: same events from our ports, and the trap really ends in Heawood's clash
const us = maps.us_states;
assert.deepEqual(greedy(us, 3).trace.events, traces.greedy_states_3.events, 'greedy_states_3 differs from the engine');
const g4 = greedy(us, 4).trace.events;
assert.deepEqual(g4, traces.greedy_states_4.events.slice(0, g4.length), 'greedy_states_4 differs from the engine before the stuck');
assert.deepEqual(kempePlain(us).trace.events, traces.kempe_states.events, 'kempe_states differs from the engine');
assert.equal(us.regions[obstruction(us)!.hub].id, 'NV', 'the US obstruction should be Nevada');
const kf = maps.kempe_fail, fail = replay(traces.kempe_fail.events, kf.n);
assert.deepEqual(clashEdges(kf, fail), [[1, 4]], 'kempe_fail should end with regions 1 and 4 on one ink');
assert.ok(isProper(kf, replay(traces.kempe_fix.events, kf.n), true), 'kempe_fix should end proper');

// random maps: valid triangulations, proper colorings, and Kempe's 1879 procedure tells the engine's story
// (facts.json: it never failed on 8-15 regions; on 256-600 it failed on 198,298 of 198,440)
const kempeRuns = (lo: number, hi: number, count: number) => {
  let clash = 0;
  for (let i = 0; i < count; i++) {
    const n = lo + ((i * 7919) % (hi - lo + 1)), m = prepMap(randomMap(n, 1000 + i));
    assert.equal(m.edges.length, 3 * m.n - 6, `random ${n}: not a triangulation`);
    const e = exact(m, 4);
    assert.ok(e.result.kind === 'solved' && e.trace.events.length < 5 * m.n, `random ${n}: exact search thrashed (${e.trace.events.length} events)`);
    const s = kempe1879(m), c = verify(m, s, `random ${n} kempe`);
    if (s.result.kind === 'clash') {
      clash++;
      const last = s.trace.events[s.trace.events.length - 1];
      assert.ok(last.op === 'clash' && c[last.r[0]] === c[last.r[1]], `random ${n}: clash event without a clash`);
    }
  }
  return clash;
};
const t0 = performance.now(), small = kempeRuns(12, 15, 300), big = kempeRuns(256, 600, 30);
console.log(`kempe1879: ${small}/300 small maps clash, ${big}/30 big maps clash (${Math.round(performance.now() - t0)} ms)`);
assert.equal(small, 0, 'Kempe should never clash on 12-15 regions');
assert.ok(big >= 27, 'Kempe should clash on almost every big map');
for (const n of [12, 40, 150, 600]) {
  const m = prepMap(randomMap(n, 7));
  let s!: Solve;
  const t = ms(() => (s = exact(m, 4)));
  assert.equal(s.result.kind, 'solved', `random ${n} exact 4: ${s.result.msg}`);
  verify(m, s, `random ${n} exact`);
  verify(m, greedy(m, 4), `random ${n} greedy`);
  console.log(`random ${n}: generate ${ms(() => randomMap(n, 8))} ms, exact 4 ${t} ms; 3 inks: ${exact(m, 3).result.kind}`);
}
assert.deepEqual(randomMap(150, 42), randomMap(150, 42), 'random maps must be deterministic');

// share links round-trip
for (let n = 1; n < 60; n++) {
  const c = Int8Array.from({length: n}, (_, i) => ((i * 37 + n) % 6) - 1);
  assert.deepEqual(unpackColors(packColors(c), n), c, `pack ${n}`);
}
assert.deepEqual(unpackColors(packColors(new Int8Array(9).fill(-1)), 9), new Int8Array(9).fill(-1));
for (const s of [
  {map: 'random', inks: 3, n: 600, seed: 98765, mode: 'solve', paint: '', solver: 'kempe', t: 12.25},
  {map: 'us', inks: 4, n: 150, seed: 1, mode: 'paint', paint: packColors(replay(traces.kempe_states.events, us.n)), solver: 'greedy', t: 0},
] as const)
  assert.deepEqual(decodeShare(encodeShare(s)), s, `share ${s.map}`);
assert.equal(decodeShare('m=nope&k=9&n=5&v=evil&t=-3').map, 'us', 'bad links fall back');

// ------------------------------------------------------------------ Be the NPC (npc-sim.ts): the numbers the page quotes
// Same rules as sims/npc/engine.py; facts.json is what the video says, so the page must agree with it (when the repo has it).
const rng = mulberry32(20261124);
assert.equal(dropTicks(2), 38, 'a 2 m drop lands on tick 38');
assert.equal(dropTicksClosed(2), 38);
assert.ok(Math.abs(realFall(2) - 0.6386) < 5e-5, 'real fall from 2 m is 0.6386 s');
for (let i = 0; i < 2000; i++) {
  const h = 0.5 + 2.5 * rng();
  assert.equal(dropTicks(h), dropTicksClosed(h), `drop ${h}: loop and closed form differ`);
}
assert.equal(new Set(Array.from({length: 4000}, (_, i) => dropTicks(0.5 + (2.5 * i) / 3999))).size, 29, 'a million heights land on only 29 different ticks');

assert.ok(Math.abs(GAP - 0.273) < 1e-12 && Math.abs(WALL + 2 * BALL_R - GAP) < 1e-12);
assert.equal(Math.round(TUNNEL_KMH), 59, 'tunnelling starts at 59 km/h');
assert.equal(tunnelFrac(58 / 3.6), 0);
assert.ok(tunnelFrac(60 / 3.6) > 0);
assert.ok(Math.abs(tunnelFrac(100 / 3.6) - 0.41) < 0.001 && Math.abs(tunnelFrac(150 / 3.6) - 0.607) < 0.001);
for (const kmh of [30, 58]) assert.equal(throwMany(kmh / 3.6, 20000, rng), 0, `${kmh} km/h never gets through`);
for (const kmh of [60, 100, 150]) {
  const got = throwMany(kmh / 3.6, 10000, rng) / 10000, want = tunnelFrac(kmh / 3.6);
  assert.ok(Math.abs(got - want) < 0.02, `${kmh} km/h: ${got} vs formula ${want}`);
}
// one explicit throw agrees with the counting version: phase 0 at 150 km/h puts a tick exactly on the wall's near side
for (const [kmh, ph] of [[30, 0.5], [100, 0.1], [150, 0.9]] as const) {
  const t = throwBall(kmh / 3.6, ph), step = kmh / 3.6 * DT, x0 = -ph * step, k = Math.ceil((-BALL_R - x0) / step);
  assert.equal(t.hit < 0, x0 + k * step > WALL + BALL_R, `throw ${kmh} km/h phase ${ph}`);
}

assert.equal(STEP32, Math.fround(1.4 / 60), 'her per-tick step is the float32 of 1.4/60');
assert.equal(ulp32(131072), 2 ** -6);
assert.equal(ulp32(131071), 2 ** -7);
assert.ok(Math.abs(ulp32(1000) * 1000 - 0.061) < 0.001 && Math.abs(ulp32(10000) * 1000 - 0.977) < 0.001 && Math.abs(ulp32(100000) * 1000 - 7.81) < 0.01, 'float steps at 1, 10, 100 km');
for (const d of [1, 100, 1000, 100000]) assert.equal(swimState(walkSpeed(d)), 'fine', `${d} m from the middle should walk fine`);
assert.equal(swimState(walkSpeed(2 ** 17 - 5000)), 'fine', 'just under 131,072 m is still fine');
assert.equal(swimState(walkSpeed(2 ** 17)), 'wrong', 'from 131,072 m the walk is wrong');
assert.equal(walkSpeed(300000), 1.875, '300 km: 1.875 m/s');
assert.equal(swimState(walkSpeed(2 ** 19 - 5000)), 'wrong', 'just under 524,288 m she still moves, wrongly');
assert.equal(walkSpeed(2 ** 19 - 5000) > 0, true);
for (const d of [2 ** 19, 600000, 1e6]) assert.equal(walkSpeed(d), 0, `${d} m: frozen`);
assert.ok(Math.abs(walkSpeed(1) - WALK) < 1e-3);

assert.ok(medianCrowd(1000, 1000, rng) >= 36 && medianCrowd(1000, 1000, rng) <= 40, '1,000 crowds of 1,000 looks: median about 38');
const c = crowd(500, rng);
assert.equal(c.looks[c.first], c.looks[c.count - 1], 'a crowd stops on a repeated look');
assert.equal(new Set(c.looks).size, c.count - 1, 'and there was no repeat before it');
const head = headline();
assert.deepEqual({...head, twinsMedian1000: 0}, {dropTick: 38, tunnelKmh: 59, wrongFromM: 131072, frozenFromM: 524288, twinsMedian1000: 0});
assert.equal(head.twinsMedian1000, 38, 'half of crowds from 1,000 looks have a twin by person 38');
assert.ok(Math.abs(medianCrowd(100000, 2000, rng) - 371) <= 0.04 * 371, '100,000 looks: median about 371');
for (const n of [100, 1000, 100000]) assert.ok(Math.abs(medianCrowd(n, 3000, rng) - (twinsFormula(n) + 0.5)) < 0.05 * twinsFormula(n) + 1.5, `median for ${n} looks vs 1.1774 sqrt(N)`);

const factsFile = new URL('../../sims/npc/facts.json', import.meta.url);
if (existsSync(factsFile)) {
  const f = JSON.parse(readFileSync(factsFile, 'utf8')) as Record<string, {value: number}>;
  assert.equal(f.drop_2m_ticks.value, dropTicks(2));
  assert.equal(f.drop_2m_real_s.value, Number(realFall(2).toFixed(4)));
  assert.equal(f.tunnel_speed_kmh.value, Math.round(TUNNEL_KMH * 10) / 10);
  assert.equal(f.tunnel_speed_ms.value, Number(((GAP / DT)).toFixed(2)));
  assert.equal(f.tunnel_frac_100kmh.value, Number(tunnelFrac(100 / 3.6).toFixed(3)));
  assert.equal(f.walk_wrong_from_m.value, head.wrongFromM);
  assert.equal(f.walk_frozen_from_m.value, head.frozenFromM);
  assert.equal(f.walk_speed_300km.value, Number(walkSpeed(300000).toFixed(3)));
  assert.equal(f.walk_speed_ms.value, WALK);
  for (const [k, d] of [['float_step_1km_mm', 1000], ['float_step_10km_mm', 10000], ['float_step_100km_mm', 100000]] as const)
    assert.ok(Math.abs(f[k].value - ulp32(d) * 1000) < 0.005, k);
  assert.equal(f.twins_1000_median.value, head.twinsMedian1000);
  console.log('npc: page numbers match sims/npc/facts.json');
}

// ------------------------------------------------------------------ Hunt the zeros (zeta-sim.ts): the numbers the page quotes
// public/data/zeta.json is our engine's output (scripts/zeta_data.py); sims/zeta/facts.json is what the video says. Both must agree with the live maths.
const zeta = data('zeta');
const zs100 = findZeros(0, 100);
assert.ok(Math.abs(zs100[0] - 14.134725) < 1e-6, `first zero is ${zs100[0]}`);
assert.equal(zs100.length, 29, 'there are 29 zeros up to t = 100');
assert.ok(Math.abs(Z(0) + 1.4603545088) < 1e-9, 'Z(0) = zeta(1/2)');
assert.ok(Math.abs(smoothCount(100) - 29) < 0.1, 'the smooth count at 100 is about 29');
assert.ok(Math.abs(gram(0) - 17.8455995405) < 1e-8 && Math.abs(gram(-1) - 9.6669080561) < 1e-8, 'Gram points g0 and g-1');
const live = findZeros(0, 605);
assert.equal(live.length, zeta.zeros.filter((z: number) => z < 605).length, 'the same number of zeros up to t = 605 as our engine');
live.forEach((z, i) => assert.ok(Math.abs(z - zeta.zeros[i]) < 1e-6, `zero ${i + 1}: live ${z} vs our engine ${zeta.zeros[i]}`));
const lehmer = findZeros(7004.9, 7005.2);
assert.equal(lehmer.length, 2, 'Lehmer pair: two zeros between 7004.9 and 7005.2');
const zf = zeta.facts, lp = zf.lehmer_pair;
assert.ok(Math.abs(lehmer[0] - lp.t1) < 1e-6 && Math.abs(lehmer[1] - lp.t2) < 1e-6, 'Lehmer pair found live matches facts.json');
assert.ok(Math.abs(lehmer[1] - lehmer[0] - lp.gap) < 1e-6);
for (const [a, b] of [[0, 100], [7000, 7010], [1400, 1450], [50000, 50030], [99990, 100030]]) {
  const t = turing(a, b);
  assert.ok(t.ok, `Turing-style count on ${a}..${b}: found ${t.found}, formula ${t.expected}`);
}
// the stored near-miss pictures: the peak between the two zeros is the number facts.json quotes, and live double precision stays well below it
for (const [k, peak] of [['lehmer', zf.lehmer_pair_peak_absZ], ['closest', zf.closest_pair_peak_absZ]] as const) {
  const p = zeta[k], t0 = Number(p.zoom.t0);
  let top = 0, off = 0;
  p.zoom.dt.forEach((dt: number, i: number) => {
    const t = t0 + dt;
    if (t > Number(p.t1) && t < Number(p.t2)) top = Math.max(top, Math.abs(p.zoom.z[i]));
    off = Math.max(off, Math.abs(Z(t) - p.zoom.z[i]));
  });
  assert.ok(Math.abs(top - peak) / peak < 0.01, `${k}: stored peak ${top} vs facts ${peak}`);
  assert.ok(off < peak / 10, `${k}: live Z is off by ${off}, not far below the peak ${peak}`);
}
// the closest-pair numbers on the page are facts.json's
const factsZeta = new URL('../../sims/zeta/facts.json', import.meta.url);
if (existsSync(factsZeta)) {
  const f = JSON.parse(readFileSync(factsZeta, 'utf8')) as Record<string, {value: unknown}>;
  for (const k of Object.keys(zeta.facts)) assert.deepEqual(zeta.facts[k], f[k].value, `zeta.json ${k} differs from facts.json`);
  const cp = f.closest_pair.value as {n: number; t1: string; t2: string; normalized_gap: number; gap: number};
  assert.deepEqual([zeta.closest.n, zeta.closest.t1, zeta.closest.t2, zeta.closest.normGap], [cp.n, cp.t1, cp.t2, cp.normalized_gap]);
  assert.equal(cp.n, 41820581);
  assert.ok(Math.abs(Number(cp.t2) - Number(cp.t1) - cp.gap) < 1e-9, 'closest pair gap');
  assert.equal(Math.round(zeta.facts.lehmer_pair_peak_absZ / zeta.facts.closest_pair_peak_absZ / 100) * 100, 1600, 'about 1,600 times flatter than Lehmer');
  assert.equal(Math.round(1 / cp.normalized_gap / 100) * 100, 800, 'about one eight-hundredth of a usual gap');
  console.log('zeta: page numbers match sims/zeta/facts.json');
}
// spacing curves on the page are the analytic ones
zeta.spacing.wigner.forEach((v: number, i: number) => assert.ok(Math.abs(v - wigner((i + 0.5) * zeta.spacing.binStep)) < 6e-4, `wigner bin ${i}`));
zeta.spacing.poisson.forEach((v: number, i: number) => assert.ok(Math.abs(v - poisson((i + 0.5) * zeta.spacing.binStep)) < 6e-4, `poisson bin ${i}`));
// the explicit formula: the page's curve is the engine's (when the repo has the kit data), and more waves sharpen it
const gam = live.slice(0, 300), primes = primesUpTo(100), st = new Staircase(100, 0.05, gam), steps = trueSteps(st.xs, primes);
const misses = [0, 1, 10, 50, 300].map((k) => staircaseMiss(st.at(k), steps, st.xs.length));
console.log('staircase miss for 0, 1, 10, 50, 300 waves:', misses.map((m) => m.toFixed(3)).join(' '));
misses.slice(1).forEach((m, i) => assert.ok(m < misses[i], 'more waves must fit the staircase better'));
assert.ok(st.at(10)[105] - st.at(10)[95] > 0.7, 'ten waves put most of a step at 7');
assert.ok(Math.abs(piK(50, 100, gam) - st.at(100)[960]) < 1e-5, 'running sum equals the direct sum');
const kit = new URL('../../video/public/kit/zeta/staircase.json', import.meta.url);
if (existsSync(kit)) {
  const k = JSON.parse(readFileSync(kit, 'utf8')) as {x: number[]; pi_K: Record<string, number[]>};
  for (const K of [0, 10, 100]) for (let i = 0; i < k.x.length; i += 97) assert.ok(Math.abs(piK(k.x[i], K, gam) - k.pi_K[String(K)][i]) < 1e-4, `pi_${K}(${k.x[i]}) differs from the video's curve`);
  console.log('zeta: staircase curves match the video kit');
}

// ------------------------------------------------------------------ Get lost (escher-sim.ts): the port of sims/escher/engine.py
// The generators are Lorentz, one step long, and stepping out over edge 0 and back is the identity (as the engine's selfcheck).
const O3 = Float64Array.of(0, 0, 1), close = (a: ArrayLike<number>, b: ArrayLike<number>, tol = 1e-9) => Array.from(a).every((v, i) => Math.abs(v - b[i]) < tol);
for (const g of GENS) {
  assert.ok(close(mul(inv(g), g), eye()), 'generator is not Lorentz');
  assert.ok(Math.abs(hdist(O3, [g[2], g[5], g[8]]) - STEP) < 1e-12, 'neighbour is not one step away');
}
assert.ok(close(mul(GENS[0], GENS[0]), eye()), 'out over edge 0 and back is not the identity');
assert.ok(Math.abs(STEP - 1.0905) < 5e-5, 'step length differs from the engine');
const pv = paving(10);
assert.deepEqual(pv.counts.slice(0, 4), [1, 7, 21, 56], 'the first rings are 7, 21, 56');
assert.deepEqual(pv.counts, FACTS.rings, 'ring counts out to 10 differ from the engine');
for (let i = 0; i < pv.n && pv.ring[i] <= 6; i++) assert.equal(ringOf(pv.frames.subarray(i * 9 + 0, i * 9 + 9).filter((_, j) => j % 3 === 2)), pv.ring[i], 'fold count differs from the BFS ring');
// locate() walks to the stone holding a point; fix() keeps a long product on the Lorentz group
const far = pv.frames.subarray(pv.n * 9 - 9, pv.n * 9);
{
  const L = locate(eye(), [far[2], far[5], far[8]]);
  assert.ok(close([L[2], L[5], L[8]], [far[2], far[5], far[8]], 1e-6 * far[8]), 'locate does not find a ring-10 stone');
}
// the page's follow camera: after every step the view recentres on her (a pure boost), so her frame stays a turn about the origin
let Lw = eye();
const rw = mulberry32(3);
for (let i = 0; i < 5000; i++) {
  const n = mul(Lw, GENS[Math.floor(rw() * 7)]);
  Lw = fix(mul(inv(boostTo([n[2], n[5], n[8]])), n));
}
assert.ok(close(mul(inv(Lw), Lw), eye(), 1e-9) && Math.abs(Lw[8] - 1) < 1e-9, 'after 5,000 recentred steps her frame drifted');
// a seeded run of 20,000 walkers lands within about a point of the engine's 29.43 % from a million
{
  const c = new Crowd(20000), r = mulberry32(20261126);
  while (c.wandering) c.step(r);
  const home = (100 * c.homeCount) / c.n, step2 = (100 * Array.from(c.home).filter((t) => t === 2).length) / c.n;
  assert.ok(Math.abs(home - FACTS.homePct) < 1, `20,000 walkers: ${home.toFixed(2)}% home vs ${FACTS.homePct}%`);
  assert.ok(Math.abs(step2 - FACTS.homeStep2Pct) < 1, `home on step 2: ${step2.toFixed(2)}% vs ${FACTS.homeStep2Pct}%`);
  assert.ok(Array.from(c.home).every((t) => t !== 1), 'nobody is home after one step');
  assert.ok(c.m.every((v, i) => i % 9 !== 8 || c.home[(i / 9) | 0] === 0 || v < COSH_IN), 'home walkers stand on the home stone');
  const f = new FlatCrowd(20000), rf = mulberry32(1921);
  for (let t = 0; t < FACTS.flatSteps; t++) f.step(rf);
  const flat = (100 * f.homeCount) / f.n;
  assert.ok(Math.abs(flat - FACTS.flatHomePct) < 1.2, `flat floor: ${flat.toFixed(2)}% home vs ${FACTS.flatHomePct}%`);
  console.log(`escher: rings ${pv.counts.slice(1, 4).join(', ')} ... ${pv.counts[10]}; 20,000 walkers ${home.toFixed(2)}% home (${step2.toFixed(2)}% on step 2), flat floor ${flat.toFixed(2)}%`);
}
const factsEscher = new URL('../../sims/escher/facts.json', import.meta.url);
if (existsSync(factsEscher)) {
  const f = JSON.parse(readFileSync(factsEscher, 'utf8'));
  assert.deepEqual(
    [f.walkers, f.hyper.ever_home_pct, f.hyper.home_on_step_2_pct, f.hyper.last_return_step, f.flat.steps, f.flat.home_within_steps_pct, f.stones_at_step_k.hyper, f.stones_at_step_k.flat, f.stones_within_10.hyper],
    [FACTS.walkers, FACTS.homePct, FACTS.homeStep2Pct, FACTS.lastReturn, FACTS.flatSteps, FACTS.flatHomePct, FACTS.rings, FACTS.flatRings, FACTS.within10],
    'escher-sim FACTS differ from sims/escher/facts.json',
  );
  assert.equal(f.step_in_curvature_radii, Number(STEP.toFixed(4)));
  console.log('escher: page numbers match sims/escher/facts.json');
}

// ------------------------------------------------------------------ Trip Karl (fall-sim.ts): playback of our engine's runs
// public/data/fall/ is written by scripts/fall_data.py from the video kit and sims/fall; the page only plays it back, so the check is
// that the poses decode to the outcomes the index (and the facts) claim, and that Karl's shapes stand on the stair and lie on the floor.
{
  const dir = new URL('../public/data/fall/', import.meta.url);
  const FD = JSON.parse(readFileSync(new URL('fall.json', dir), 'utf8')) as FallData, Ff = FD.facts;
  const pack = (f: string) => {
    const b = readFileSync(new URL(f, dir));
    return new Int16Array(b.buffer, b.byteOffset, b.byteLength / 2);
  };
  const trip = pack(FD.files.trip), hill = pack(FD.files.hill), flat = pack(FD.files.flat), P = FD.bodies.indexOf('pelvis'), st = FD.stairs;
  assert.equal(FD.bodies.length, 16);
  let split = 0;
  for (const r of FD.trip) {
    const a = new Run(trip, r, FD), b = new Run(trip, r.twin, FD);
    assert.equal(stopStep(a.last()[P * 7 + 2], st.going, st.risers), r.stop, `trip run ${r.run}: pelvis does not rest on its stop step`);
    assert.equal(stopStep(b.last()[P * 7 + 2], st.going, st.risers), r.twin.stop, `trip run ${r.run} twin: pelvis does not rest on its stop step`);
    assert.ok(Math.abs(r.twin.speed - r.speed - FD.twinDelta) < 1e-11, `trip run ${r.run}: twin is not ${FD.twinDelta} m/s faster`);
    assert.ok(Math.abs(lowest(FD, a.at(0)) - st.top_height) < 0.03, `trip run ${r.run}: Karl does not start on the top landing`);
    assert.ok(r.speed >= Ff.trip.speedLo && r.speed <= Ff.trip.speedHi);
    if (r.stop !== r.twin.stop) split++;
  }
  // easing between frames lands exactly on the stored frames
  {
    const r = new Run(trip, FD.trip[0], FD), f3 = r.at(3 / FD.fps), f35 = r.at(3.5 / FD.fps), f4 = r.at(4 / FD.fps);
    assert.ok(Math.abs(f35[P * 7 + 1] - (f3[P * 7 + 1] + f4[P * 7 + 1]) / 2) < 1e-6, 'pose easing is not halfway between frames');
  }
  assert.ok(FD.trip.some((r) => r.hero), 'the video run is on the slider');
  const counts = Ff.trip.stopCounts, total = Object.values(counts).reduce((x, y) => x + y, 0);
  assert.equal(total, Ff.trip.runs, 'stop counts add up to the runs');
  assert.equal(+Object.entries(counts).sort((x, y) => y[1] - x[1])[0][0], Ff.trip.mostCommon);
  const order = tallyOrder(counts, mulberry32(5));
  assert.deepEqual(Object.fromEntries(Object.keys(counts).map((k) => [k, order.filter((s) => s === +k).length])), counts, 'the tally does not end on the facts counts');
  // flat floor: ten shoves end in one pose, lying on the floor
  const flats = FD.flat.map((e) => new Run(flat, e, FD).last());
  for (const f of flats) assert.ok(Math.abs(lowest(FD, f)) < 0.015, 'a flat run does not lie on the floor');
  const spread = Math.max(...flats.map((f) => poseGap(f, flats[0])));
  assert.ok(spread * 100 <= Ff.flat.spreadCm.max + 0.2, `flat runs spread ${(spread * 100).toFixed(3)} cm at rest`);
  // hill: the twins end the facts' distance apart (pelvis rest points), the runs that stayed up stayed on the plateau
  const ta = new Run(hill, FD.hillTwins.a, FD).last(), tb = new Run(hill, FD.hillTwins.b, FD).last();
  const gap = Math.hypot(ta[P * 7] - tb[P * 7], ta[P * 7 + 1] - tb[P * 7 + 1], ta[P * 7 + 2] - tb[P * 7 + 2]);
  assert.equal(Math.round(gap * 10) / 10, Ff.hill.twinsGap, `hill twins rest ${gap.toFixed(2)} m apart`);
  assert.ok(Math.abs(FD.hillTwins.b.speed - FD.hillTwins.a.speed - FD.hillTwins.delta) < 1e-12);
  for (const r of FD.hill) {
    const z = new Run(hill, r, FD).last()[P * 7 + 2];
    assert.ok(r.where === 'top' ? z < 0.5 : z > 0, `hill run ${r.run} (${r.where}) rests at z ${z.toFixed(2)}`);
  }
  console.log(`fall: ${FD.trip.length} slider runs, ${split} twins a millionth faster stop on another tread; flat spread ${(spread * 1000).toFixed(2)} mm; hill twins ${gap.toFixed(2)} m apart`);
  const factsFall = new URL('../../sims/fall/facts.json', import.meta.url), factsOut = new URL('../../sims/fall/facts_outdoor.json', import.meta.url);
  if (existsSync(factsFall) && existsSync(factsOut)) {
    const f = JSON.parse(readFileSync(factsFall, 'utf8')), o = JSON.parse(readFileSync(factsOut, 'utf8')), E = f.E_trip, H = o.hill;
    assert.deepEqual(
      [Ff.trip.runs, Ff.trip.stopCounts, Ff.trip.stopPct, Ff.trip.mostCommon, Ff.trip.bottomPct, Ff.trip.speedLo, Ff.trip.speedHi],
      [E.runs, E.stop_step_counts, E.stop_step_pct, E.most_common_stop_step, E.pct_reach_bottom_landing, E.variation.speed_lo, E.variation.speed_hi],
      'fall.json trip facts differ from sims/fall/facts.json',
    );
    assert.deepEqual(Ff.tripTwins.byPrecision, f.H_trip_twins.by_speed_precision_m_per_s);
    assert.equal(Ff.tripTwins.alpha, f.H_trip_twins.uncertainty_exponent_alpha);
    assert.deepEqual([Ff.flat.runs, Ff.flat.firstContact, Ff.flat.spreadCm, Ff.flat.pushJitter], [f.A_flat.runs, f.A_flat.time_to_first_ground_contact_s, f.A_flat.final_pose_spread_cm, f.push.run_to_run_difference_m_per_s]);
    assert.equal(Ff.flat.twins1e6End10cm, f.C_D_twins_flat.by_push_precision_m_per_s['1e-06'].pct_pairs_end_10cm_apart);
    assert.deepEqual([Ff.stairs.risers, Ff.dummy.massKg, Ff.dummy.heightM], [f.stairs.risers, f.dummy.total_mass_kg, f.dummy.height_m]);
    assert.deepEqual(
      [Ff.hill.runs, Ff.hill.slopeDeg, Ff.hill.slopeLength, Ff.hill.overPct, Ff.hill.where, Ff.hill.dist, Ff.hill.byPrecision, Ff.hill.alpha, Ff.hill.twinsPairs],
      [H.results.runs, H.terrain.slope_deg, H.terrain.slope_length_m, H.results.pct_went_over_rim, H.results.where_stops_pct, H.results.distance_down_slope_m, H.twins.by_speed_precision_m_per_s, H.twins.uncertainty_exponent_alpha, H.twins.pairs],
      'fall.json hill facts differ from sims/fall/facts_outdoor.json',
    );
    assert.ok(o.kit_choices.hill_twins.why.includes(`(${Ff.hill.twinsGap} m)`));
    console.log('fall: page numbers match sims/fall/facts.json and facts_outdoor.json');
  }
}

// ------------------------------------------------------------------ Grow a railway (slime-sim.ts): the worlds the swarm lives in
// public/data/slime/slime.json is written by scripts/slime_data.py; the swarm itself is GPU code, so the check covers what feeds it:
// the map and mountain rasters, the oat flakes, the maze, and the tube rule that decides which maze routes stay.
{
  const SD = JSON.parse(readFileSync(new URL('../public/data/slime/slime.json', import.meta.url), 'utf8')) as SlimeData, Sf = SD.facts;
  // even-odd fill: a 10 x 10 square with a 4 x 4 hole in it is 84 cells
  const sq = (x: number, y: number, n: number) => [x, y, x + n, y, x + n, y + n, x, y + n];
  const cut = fillRings([sq(2, 2, 10), sq(5, 5, 4)], 16, 16);
  assert.equal(cut.reduce((a, b) => a + b, 0), 84, 'ring fill with a hole');
  // the mountain mask decodes to the full raster and covers a sensible share
  assert.equal(SD.mtn.rle.reduce((a, b) => a + b, 0), SD.mtn.w * SD.mtn.h, 'mountain runs add up to the raster');
  const lit = lightMask(SD.mtn, SD.mtn.w, SD.mtn.h).reduce((a, b) => a + b, 0) / (SD.mtn.w * SD.mtn.h);
  assert.ok(lit > 0.1 && lit < 0.3, `lit mountains cover ${lit.toFixed(2)} of the dish`);
  // Tokyo mode: land minus lit mountains is open, sea is closed, every one of the 36 oats sits on open ground the slime can reach from Tokyo
  const {w: TW, h: TH} = gridSize(SD.arena, 480), tw = tokyoWorld(SD, TW, TH), land = landMask(SD, TW, TH);
  const open = tw.blocked.reduce((a, b) => a + (b ? 0 : 1), 0) / tw.blocked.length;
  assert.ok(open > 0.4 && open < 0.65, `open ground is ${open.toFixed(2)} of the dish`);
  assert.equal(tw.oats.length, Sf.cities, 'one oat flake per city');
  assert.equal(tw.blocked[(TH - 2) * TW + TW - 2], 1, 'the far south-east corner is sea');
  const reach = reachable(tw.blocked, TW, TH, tw.start);
  tw.oats.forEach((o, i) => {
    assert.equal(tw.blocked[Math.floor(o.y) * TW + Math.floor(o.x)], 0, `${tw.names[i]} oat is on off-limits ground`);
    assert.equal(reach[Math.floor(o.y) * TW + Math.floor(o.x)], 1, `${tw.names[i]} cannot be reached from Tokyo`);
  });
  assert.equal(tw.names[0], 'Tokyo', 'oats are laid from Tokyo outward');
  assert.ok(land[Math.floor(tw.start.y) * TW + Math.floor(tw.start.x)] === 1, 'Tokyo is on land');
  const d2 = tw.oats.map((o) => Math.hypot(o.x - tw.start.x, o.y - tw.start.y));
  assert.ok(d2.every((d, i) => i === 0 || d >= d2[i - 1]), 'oats are ordered by distance from Tokyo');
  assert.equal(SD.rail.length, 57, 'the rail graph has 57 segments');
  assert.ok(SD.rail.every((r) => r[0] >= SD.arena[0] && r[2] <= SD.arena[2] && r[1] >= SD.arena[1] && r[3] <= SD.arena[3]), 'rail inside the dish');
  // free mode: oats drop on open cells only, light can be painted and kept off the oats' cells
  const fb = new Uint8Array(40 * 40);
  assert.ok(paintLight(fb, 40, 40, 20, 20, 5) && fb[20 * 40 + 20] === 1);
  assert.equal(dropOat(fb, 40, 40, 20.5, 20.5), null, 'no oat on light');
  assert.deepEqual(dropOat(fb, 40, 40, 2.5, 2.5), {x: 2.5, y: 2.5});
  assert.ok(!paintLight(fb, 40, 40, 20, 20, 5), 'painting the same patch twice changes nothing');
  const sn = snapFree(fb, 40, 40, 20.5, 20.5, 10)!;
  assert.ok(fb[Math.floor(sn.y) * 40 + Math.floor(sn.x)] === 0 && Math.hypot(sn.x - 20.5, sn.y - 20.5) < 7, 'a free cell just outside the lit patch');
  // the maze: oats at both ends, joined by corridors, four routes with the shortest first
  const MW = 480, MH = 549, mz = mazeWorld(MW, MH), net = mazeNet(MW, MH), mr = reachable(mz.blocked, MW, MH, mz.oats[0]);
  assert.equal(mr[Math.floor(mz.oats[1].y) * MW + Math.floor(mz.oats[1].x)], 1, 'the maze oats are connected');
  const plen = (names: string[]) => names.reduce((a, n) => a + net.edges.filter((e) => e.tag === n).reduce((x, e) => x + e.len, 0), 0);
  const lens = Object.fromEntries(Object.entries(MAZE_ROUTES).map(([k, v]) => [k, plen(v)]));
  assert.equal(Object.keys(lens).length, Sf.maze.routes, 'four routes');
  assert.equal(Object.entries(lens).sort((a, b) => a[1] - b[1])[0][0], MAZE_SHORTEST, 'alpha1+beta1 is the shortest route');
  const ratio = Math.max(...Object.values(lens)) / lens[MAZE_SHORTEST];
  assert.ok(Math.abs(ratio - Sf.maze.ratio) < 0.12, `longest route is ${ratio.toFixed(2)} times the shortest, facts say ${Sf.maze.ratio}`);
  assert.ok(Object.keys(MAZE_PATHS).length === 13);
  // the tube rule keeps the shortest route and thins every dead end and every other route, from 20 random starts like the facts
  let steps = 0;
  for (let seed = 0; seed < Sf.maze.seeds; seed++) {
    const T = new Tero(net, 0.25, mulberry32(100 + seed));
    for (let i = 0; i < 400; i++) T.step(0.1);
    steps = 400;
    const keep = new Set(MAZE_ROUTES[MAZE_SHORTEST]);
    net.edges.forEach((e, i) => assert.ok(keep.has(e.tag) ? T.D[i] > 0.9 : T.D[i] < 0.01, `seed ${seed}: ${e.tag} ends at width ${T.D[i].toFixed(3)}`));
  }
  // the engine run the swarm follows: widths play back from a full mesh to a network that touches every city, and thin out on the way
  const RD = JSON.parse(readFileSync(new URL('../public/data/slime/tokyo-run.json', import.meta.url), 'utf8')) as RunData, gr = new GuideRun(RD);
  const alive = (u: number) => gr.at(u).reduce((a, w) => a + (w > 0.002 ? 1 : 0), 0);
  assert.ok(alive(0) > 1000 && alive(1) > 300 && alive(1) < 450 && alive(0.5) < alive(0) && alive(1) <= alive(0.5), `run edges alive: ${alive(0)}, ${alive(0.5)}, ${alive(1)}`);
  assert.equal(RD.cities.length, Sf.cities, 'every city is a node of the run');
  const last = gr.at(1), touched = new Set<number>();
  last.forEach((w, i) => w > 0.002 && (touched.add(RD.edges[2 * i]), touched.add(RD.edges[2 * i + 1])));
  assert.ok(RD.cities.every((c) => touched.has(c)), 'the final network touches every city');
  const sc = scatter(mz.blocked, MW, 500, mulberry32(3));
  assert.ok(sc.every((p) => !mz.blocked[Math.floor(p.y) * MW + Math.floor(p.x)]), 'maze agents start in corridors');
  console.log(`slime: ${tw.oats.length} oats all reachable, open ground ${(open * 100).toFixed(0)}%, maze ${Sf.maze.seeds} of ${Sf.maze.seeds} starts keep the shortest route in ${steps} steps`);
  const factsFile = new URL('../../sims/slime/facts.json', import.meta.url);
  if (existsSync(factsFile)) {
    const f = JSON.parse(readFileSync(factsFile, 'utf8')), b = f.beat_rail, m = f.maze;
    assert.deepEqual(
      [Sf.runs, Sf.connected, Sf.cities, Sf.dishCm, Sf.hours, Sf.slime, Sf.rail, Sf.mst, Sf.beat, Sf.maze],
      [f.runs.n, f.runs.connected, f.rail.cities, f.literature.arena_width_cm, f.literature.experiment_hours, {cost: f.slime.TL_MST.median, ft: f.slime.FT.median}, {cost: f.rail.TL_MST, ft: f.rail.FT, km: f.rail.TL_km}, {km: f.mst.TL_km}, {cost: b.count.TL_MST, trips: b.count.MD_MST, ft: b.count.FT, all: b.count.all, alpha: b.alpha_better}, {seeds: m.tero_seeds, won: m.shortest_won, routes: Object.keys(m.route_length_px).length, ratio: m.longest_over_shortest}],
      'slime.json facts differ from sims/slime/facts.json',
    );
    console.log('slime: page numbers match sims/slime/facts.json');
  }
}

console.log('check ok');
