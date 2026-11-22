// The one runnable check for src/map.ts: `npm run check` (node strips the types; no test framework).
import {readFileSync} from 'node:fs';
import {strict as assert} from 'node:assert';
import {clashEdges, decodeShare, encodeShare, exact, greedy, isProper, kempe1879, kempePlain, obstruction, packColors, prepMap, randomMap, replay, timeForPage, colorsAt, unpackColors, type RawMap, type Solve, type Trace, type FMap} from './map.ts';

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

console.log('check ok');
