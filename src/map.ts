// Four-color map logic for the site: pure, no DOM, so the page and src/check.ts share it.
// Trace replay and timing (prepMap, isProper, replay, timeTrace, colorsAt, stepAt, spreadEase) are copied from the video kit
// video/src/motion/fourcolor.tsx; the solvers are small ports of sims/fourcolor/analysis.py and kempe.py; map files follow
// sims/fourcolor/CONTRACT.md (metres, XZ plane, north = -Z, polys as rings).

/** The contract's inks: 0 vermilion, 1 ochre, 2 prussian blue, 3 sap green, 4 plum (the fifth). -1 = bare paper. */
export const INKS = ['#D4462E', '#E3AE38', '#2F5F8E', '#5B8E4C', '#7D3C86'];
export const INK_NAMES = ['vermilion', 'ochre', 'prussian blue', 'sap green', 'plum'];

export type XZ = [number, number];
export type Region = {id: string; name: string; polys: XZ[][][]; label: XZ; area: number};
/** rot: counter-clockwise neighbor lists (only generated random maps have them; Kempe's 1879 procedure needs them). */
export type RawMap = {name: string; width: number; bbox: [number, number, number, number]; regions: Region[]; edges: [number, number][]; rot?: number[][]};
export type FMap = RawMap & {n: number; index: Record<string, number>; adj: number[][]; rmax: Float32Array};
export type TraceEvent =
  | {op: 'paint'; r: number; c: number}
  | {op: 'stuck'; r: number; need?: number}
  | {op: 'unpaint'; r: number}
  | {op: 'remove'; r: number}
  | {op: 'restore'; r: number}
  | {op: 'swap'; chain: number[]; a: number; b: number}
  | {op: 'clash'; r: [number, number]}
  | {op: 'mark'; r: number[]; tag?: string};
export type Trace = {map: string; palette: number; note?: string; events: TraceEvent[]};
export type Result = {kind: 'solved' | 'stuck' | 'clash' | 'hard' | 'impossible' | 'gaveup'; msg: string};
export type Solve = {trace: Trace; result: Result};

export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const easeIO = (x: number) => {
  const u = clamp(x);
  return u * u * u * (u * (u * 6 - 15) + 10);
};
const sstep = (a: number, b: number, x: number) => {
  const u = clamp((x - a) / (b - a));
  return u * u * (3 - 2 * u);
};

/** Neighbor lists, id index and label radii for a raw map file. */
export const prepMap = (m: RawMap): FMap => {
  const n = m.regions.length, adj: number[][] = Array.from({length: n}, () => []), index: Record<string, number> = {}, rmax = new Float32Array(n);
  m.regions.forEach((r, i) => {
    index[r.id] = i;
    let d = 0;
    for (const p of r.polys) for (const ring of p) for (const q of ring) d = Math.max(d, Math.hypot(q[0] - r.label[0], q[1] - r.label[1]));
    rmax[i] = Math.max(d, 1e-4);
  });
  for (const [i, j] of m.edges) {
    adj[i].push(j);
    adj[j].push(i);
  }
  return {...m, n, index, adj, rmax};
};

/** True when no edge joins two equal colors (uncolored -1 regions are ignored unless full). */
export const isProper = (m: FMap, colors: ArrayLike<number>, full = false) => {
  for (const [i, j] of m.edges) if (colors[i] >= 0 && colors[i] === colors[j]) return false;
  if (full) for (let i = 0; i < m.n; i++) if (colors[i] < 0) return false;
  return true;
};
/** Map edges whose two regions wear the same ink. */
export const clashEdges = (m: FMap, colors: ArrayLike<number>) => m.edges.filter(([i, j]) => colors[i] >= 0 && colors[i] === colors[j]);

/** The colors after the first `upto` events of a trace (swaps flip a <-> b on the chain). */
export const replay = (events: TraceEvent[], n: number, upto = events.length) => {
  const c = new Int8Array(n).fill(-1);
  for (let e = 0; e < Math.min(upto, events.length); e++) {
    const ev = events[e];
    if (ev.op === 'paint') c[ev.r] = ev.c;
    else if (ev.op === 'unpaint') c[ev.r] = -1;
    else if (ev.op === 'swap') for (const r of ev.chain) c[r] = c[r] === ev.a ? ev.b : c[r] === ev.b ? ev.a : c[r];
  }
  return c;
};

// ================================================================== timed traces (every state a pure function of t)

export const OP_WEIGHT: Record<TraceEvent['op'], number> = {paint: 1, unpaint: 1, remove: 1.5, restore: 1.5, stuck: 3, swap: 5, clash: 5, mark: 2.5};
/** Seconds a stain takes to dry (wet and dark -> lighter). */
export const DRY = 1.6;
type Change = {t0: number; dur: number; from: number; to: number};
type LiftCh = {t0: number; dur: number; up: boolean};
export type TraceOpts = {sps?: number; spread?: number; weights?: Partial<Record<TraceEvent['op'], number>>};
export type TimedTrace = {
  map: FMap;
  events: TraceEvent[];
  slots: [number, number][];
  end: number;
  init: Int8Array;
  ch: Change[][];
  lifts: LiftCh[][];
  stucks: {r: number; need: number; t0: number; until: number}[];
  swaps: {chain: number[]; a: number; b: number; t0: number; t1: number}[];
  clashes: {r: [number, number]; t0: number}[];
  marks: {r: number[]; tag: string; t0: number; until: number}[];
};

/** Time a trace on its map from t = 0: each event gets a slot; colors, stains and lifts become pure functions of t. */
export const timeTrace = (trace: Trace, map: FMap, o: TraceOpts = {}): TimedTrace => {
  const ev = trace.events, n = map.n, W = {...OP_WEIGHT, ...(o.weights ?? {})};
  const unit = 1 / (o.sps ?? 4);
  const spread = o.spread ?? clamp(4 * unit, 0.22, 0.7);
  const slots: [number, number][] = [];
  const raw: {t0: number; to: number}[][] = Array.from({length: n}, () => []);
  const rawL: {t0: number; up: boolean}[][] = Array.from({length: n}, () => []);
  const stucks: TimedTrace['stucks'] = [], swaps: TimedTrace['swaps'] = [], clashes: TimedTrace['clashes'] = [], marks: TimedTrace['marks'] = [];
  const init = new Int8Array(n).fill(-1), cur = Int8Array.from(init);
  let t = 0;
  for (const x of ev) {
    const w = (W[x.op] ?? 1) * unit;
    slots.push([t, t + w]);
    if (x.op === 'paint') (raw[x.r].push({t0: t, to: x.c}), (cur[x.r] = x.c));
    else if (x.op === 'unpaint') (raw[x.r].push({t0: t, to: -1}), (cur[x.r] = -1));
    else if (x.op === 'remove' || x.op === 'restore') rawL[x.r].push({t0: t, up: x.op === 'remove'});
    // a mark stays up until the next moment worth seeing replaces it
    if ((x.op === 'stuck' || x.op === 'swap' || x.op === 'clash' || x.op === 'mark') && marks.length && marks[marks.length - 1].until === Infinity) marks[marks.length - 1].until = t;
    if (x.op === 'stuck') stucks.push({r: x.r, need: x.need ?? -1, t0: t, until: Infinity});
    else if (x.op === 'swap') {
      // the flip ripples along the chain in its listed order over the first 70% of the slot
      x.chain.forEach((r, j) => {
        const to = cur[r] === x.a ? x.b : cur[r] === x.b ? x.a : cur[r];
        raw[r].push({t0: t + (x.chain.length > 1 ? (j / (x.chain.length - 1)) * 0.7 * w : 0), to});
        cur[r] = to;
      });
      swaps.push({chain: x.chain, a: x.a, b: x.b, t0: t, t1: t + w});
    } else if (x.op === 'clash') clashes.push({r: x.r, t0: t});
    else if (x.op === 'mark') marks.push({r: x.r, tag: x.tag ?? '', t0: t, until: Infinity});
    t += w;
  }
  // a stain never outlasts the gap to its region's next change, so a change always starts from a finished one
  const ch: Change[][] = raw.map((list, i) => {
    const out: Change[] = [];
    list.sort((a, b) => a.t0 - b.t0);
    list.forEach((c, k) => {
      const next = list[k + 1]?.t0 ?? Infinity;
      out.push({t0: c.t0, dur: Math.max(1e-4, Math.min(spread, next - c.t0)), from: out[k - 1]?.to ?? init[i], to: c.to});
    });
    return out;
  });
  const lifts: LiftCh[][] = rawL.map((list) => list.map((c, k) => ({t0: c.t0, up: c.up, dur: Math.max(1e-4, Math.min(Math.max(0.3, 2 * unit), (list[k + 1]?.t0 ?? Infinity) - c.t0))})));
  for (const s of stucks) s.until = ch[s.r].find((c) => c.t0 > s.t0)?.t0 ?? Infinity;
  return {map, events: ev, slots, end: t, init, ch, lifts, stucks, swaps, clashes, marks};
};

/** Everything the map shows at one moment: per region the stain (to spreads over from, k 0..1), how dry it is, the lift
 *  (Kempe's removed regions), plus the stuck region, the active Kempe chain, the clash and the current mark. */
export type InkState = {
  n: number;
  from: Int8Array;
  to: Int8Array;
  k: Float32Array;
  dry: Float32Array;
  lift: Float32Array;
  stuck: {r: number; need: number; k: number} | null;
  chain: {regions: number[]; a: number; b: number; k: number} | null;
  clash: {r: [number, number]; k: number} | null;
  mark: {r: number[]; tag: string; k: number} | null;
};
/** Stain spread: fast at first, slowing to rest like ink soaking into paper. */
export const spreadEase = (u: number) => {
  const x = clamp(u);
  return 1 - (1 - x) * (1 - x);
};
const lastAt = <T extends {t0: number}>(list: T[], t: number) => {
  let lo = 0, hi = list.length - 1, r = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (list[m].t0 <= t) (r = m), (lo = m + 1);
    else hi = m - 1;
  }
  return r;
};
export const blankState = (n: number): InkState => ({n, from: new Int8Array(n).fill(-1), to: new Int8Array(n).fill(-1), k: new Float32Array(n).fill(1), dry: new Float32Array(n).fill(1), lift: new Float32Array(n), stuck: null, chain: null, clash: null, mark: null});

/** The map at time t. Pure and continuous in t. */
export const colorsAt = (tt: TimedTrace, t: number): InkState => {
  const n = tt.map.n, S = blankState(n);
  for (let i = 0; i < n; i++) {
    const list = tt.ch[i], j = lastAt(list, t);
    if (j < 0) S.from[i] = S.to[i] = tt.init[i];
    else {
      const c = list[j];
      S.from[i] = c.from;
      S.to[i] = c.to;
      S.k[i] = spreadEase((t - c.t0) / c.dur);
      S.dry[i] = sstep(0, 1, (t - c.t0 - c.dur) / DRY);
    }
    const L = tt.lifts[i], q = lastAt(L, t);
    if (q >= 0) {
      const u = easeIO(clamp((t - L[q].t0) / L[q].dur));
      S.lift[i] = L[q].up ? u : 1 - u;
    }
  }
  // fade out at `until`; Infinity = never (sstep(Infinity, Infinity + d) would be NaN)
  const out = (until: number, d: number) => (until === Infinity ? 1 : 1 - sstep(until, until + d, t));
  let best = 0;
  for (const s of tt.stucks) {
    const k = sstep(s.t0, s.t0 + 0.35, t) * out(s.until, 0.5);
    if (k > best) (best = k), (S.stuck = {r: s.r, need: s.need, k});
  }
  best = 0;
  for (const w of tt.swaps) {
    const k = sstep(w.t0 - 0.25, w.t0 + 0.15, t) * (1 - sstep(w.t1 + 0.3, w.t1 + 0.9, t));
    if (k > best) (best = k), (S.chain = {regions: w.chain, a: w.a, b: w.b, k});
  }
  for (const c of tt.clashes) if (t >= c.t0 - 0.01) S.clash = {r: c.r, k: sstep(c.t0, c.t0 + 0.8, t)};
  best = 0;
  for (const m of tt.marks) {
    const k = sstep(m.t0, m.t0 + 0.3, t) * out(m.until, 0.4);
    if (k > best) (best = k), (S.mark = {r: m.r, tag: m.tag, k});
  }
  return S;
};

/** Index of the event playing at t (-1 before the first). */
export const eventAt = (tt: TimedTrace, t: number) => {
  let lo = 0, hi = tt.slots.length - 1, r = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (tt.slots[m][0] <= t) (r = m), (lo = m + 1);
    else hi = m - 1;
  }
  return r;
};

/** Slot weights for the page: plain steps share ~18 s; stuck, swap and mark moments get real seconds, squeezed into ~12 s in
 *  all on long traces; the clash (always the last event) keeps its full slot. */
export const timeForPage = (trace: Trace, map: FMap) => {
  const want: Partial<Record<TraceEvent['op'], number>> = {stuck: 1.2, swap: 0.9, mark: 0.7};
  let base = 0, special = 0;
  for (const e of trace.events) {
    base += e.op === 'paint' || e.op === 'unpaint' ? 1 : e.op === 'remove' || e.op === 'restore' ? 0.5 : 0;
    special += want[e.op] ?? 0;
  }
  const sps = clamp(base / 18, 3, 400), squeeze = Math.min(1, 12 / Math.max(special, 1e-9));
  const w = (op: 'stuck' | 'swap' | 'mark', min: number) => Math.max(min, want[op]! * squeeze * sps);
  return timeTrace(trace, map, {sps, weights: {remove: 0.5, restore: 0.5, stuck: w('stuck', 1.5), swap: w('swap', 2), mark: w('mark', 1.5), clash: Math.max(4, 1.5 * sps)}});
};

// ================================================================== solvers

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const nm = (m: FMap, i: number) => m.regions[i].name;
const names = (m: FMap, rs: number[]) => {
  const a = rs.map((i) => nm(m, i));
  return a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
};
const inksUsed = (c: ArrayLike<number>) => new Set(Array.from(c).filter((x) => x >= 0)).size;
const solve = (m: FMap, palette: number, events: TraceEvent[], kind: Result['kind'], msg: string): Solve => ({trace: {map: m.name, palette, events}, result: {kind, msg}});

/** West to east by label point (ties north to south): the engine's sweep. */
export const sweepOrder = (m: FMap) => m.regions.map((_, i) => i).sort((a, b) => m.regions[a].label[0] - m.regions[b].label[0] || m.regions[a].label[1] - m.regions[b].label[1]);

/** Greedy: west to east, each region the first ink its painted neighbors leave free; stops where no ink is left. */
export const greedy = (m: FMap, k: number): Solve => {
  const col = new Int8Array(m.n).fill(-1), ev: TraceEvent[] = [];
  let painted = 0;
  for (const v of sweepOrder(m)) {
    const used = new Set(m.adj[v].map((u) => col[u]));
    let c = 0;
    while (c < k && used.has(c)) c++;
    if (c === k) {
      const nb = m.adj[v].filter((u) => col[u] >= 0).sort((a, b) => a - b);
      ev.push({op: 'stuck', r: v, need: k}, {op: 'mark', r: nb, tag: `neighbors use all ${k} inks`});
      return solve(m, k, ev, 'stuck', `Greedy is stuck at ${nm(m, v)} after ${painted} regions: ${names(m, nb)} already use all ${k} inks.`);
    }
    col[v] = c;
    painted++;
    ev.push({op: 'paint', r: v, c});
  }
  return solve(m, k, ev, 'solved', `Greedy painted all ${m.n} regions with ${inksUsed(col)} inks.`);
};

/** The regions of one two-ink chain: everything reachable from start through regions inked a or b. */
const chainOf = (adj: ArrayLike<Iterable<number>>, col: Int8Array, start: number, a: number, b: number) => {
  const seen = new Set([start]), st = [start];
  while (st.length) for (const y of adj[st.pop()!]) if (!seen.has(y) && (col[y] === a || col[y] === b)) (seen.add(y), st.push(y));
  return seen;
};
const flip = (col: Int8Array, rs: Iterable<number>, a: number, b: number) => {
  for (const x of rs) col[x] = col[x] === a ? b : col[x] === b ? a : col[x];
};
const sorted = (s: Iterable<number>) => [...s].sort((a, b) => a - b);

/** Kempe on a real map (no rotation system; analysis.py kempe_plain): lift off the westernmost region with five or fewer
 *  neighbors still on the board, again and again, then put them back in reverse order. A free ink: paint it. Otherwise
 *  one chain swap that frees an ink. If no single swap works, that is the case his double swap was for: stop and say so. */
export const kempePlain = (m: FMap): Solve => {
  const cur = m.adj.map((a) => new Set(a)), present = new Set(m.regions.map((_, i) => i)), stack: [number, number[]][] = [], ev: TraceEvent[] = [];
  const x = (i: number) => m.regions[i].label[0];
  const westMin = (a: number, b: number) => (x(a) < x(b) || (x(a) === x(b) && a < b) ? a : b);
  while (present.size) {
    let v = -1, low = -1;
    for (const i of present) {
      if (cur[i].size <= 5) v = v < 0 ? i : westMin(v, i);
      if (low < 0 || cur[i].size < cur[low].size || (cur[i].size === cur[low].size && westMin(low, i) === i)) low = i;
    }
    if (v < 0) v = low; // ponytail: only a non-planar map (exclaves glued) can lack a <= 5 region; then take the fewest
    for (const u of cur[v]) cur[u].delete(v);
    stack.push([v, [...cur[v]]]);
    present.delete(v);
    ev.push({op: 'remove', r: v});
  }
  const col = new Int8Array(m.n).fill(-1);
  let swaps = 0;
  while (stack.length) {
    const [v, nb] = stack.pop()!;
    ev.push({op: 'restore', r: v});
    const used = new Set(nb.map((u) => col[u]));
    const free = [0, 1, 2, 3].find((c) => !used.has(c));
    if (free !== undefined) {
      col[v] = free;
      ev.push({op: 'paint', r: v, c: free});
      continue;
    }
    let done = false;
    for (const a of sorted(used)) {
      for (let b = 0; b < 4 && !done; b++) {
        if (b === a) continue;
        const ch = new Set<number>();
        for (const u of nb) if (col[u] === a) for (const y of chainOf(m.adj, col, u, a, b)) ch.add(y);
        if (nb.some((u) => col[u] === b && ch.has(u))) continue;
        ev.push({op: 'mark', r: sorted(nb), tag: 'neighbors use all four inks'});
        flip(col, ch, a, b);
        ev.push({op: 'swap', chain: sorted(ch), a, b});
        col[v] = a;
        ev.push({op: 'paint', r: v, c: a});
        swaps++;
        done = true;
      }
      if (done) break;
    }
    if (!done) {
      ev.push({op: 'mark', r: sorted(nb), tag: 'no single chain swap frees an ink'}, {op: 'stuck', r: v, need: 4});
      return solve(m, 4, ev, 'hard', `At ${nm(m, v)} no single chain swap frees an ink. This is the case Kempe's double swap was for.`);
    }
  }
  return solve(m, 4, ev, 'solved', `Kempe's method finished with four inks${swaps ? `, after ${swaps} chain swap${swaps > 1 ? 's' : ''}` : ''}.`);
};

/** Kempe's 1879 procedure on a plane triangulation (kempe.py kempe1879, rule 'mindeg', apex 'first'): remove the region with
 *  the fewest neighbors and re-triangulate the hole with a fan, until nothing is left; put them back in reverse order. Four
 *  neighbors on four inks: one chain swap. Five: two single tries, then his double swap, both chains found before either
 *  flips. Each flip alone is valid; together they can leave two neighbors on one ink (Heawood, 1890). We stop there. */
export const kempe1879 = (m: FMap): Solve => {
  if (!m.rot) throw new Error('kempe1879 needs a rotation system');
  const N = m.rot.length, rot = m.rot.map((r) => r.slice()), adj = rot.map((r) => new Set(r)), col = new Int8Array(N).fill(-1);
  const present = new Uint8Array(N).fill(1), stack: {v: number; u: number[]; saved: number[][]; chords: [number, number][]}[] = [], ev: TraceEvent[] = [];
  for (let left = N; left > 0; left--) {
    let v = -1;
    for (let i = 0; i < N; i++) if (present[i] && (v < 0 || rot[i].length < rot[v].length)) v = i;
    const u = rot[v], d = u.length, saved = u.map((x) => rot[x].slice());
    let chords: [number, number][] = [];
    if (d >= 4) {
      let a = 0;
      for (; a < d; a++) {
        chords = [];
        for (let k = 2; k < d - 1; k++) chords.push([u[a], u[(a + k) % d]]);
        if (chords.every(([p, q]) => !adj[p].has(q))) break;
      }
      if (a === d) throw new Error('no fan without a double edge');
      const ua = u[a];
      u.forEach((x, i) => {
        const r = rot[x], p = r.indexOf(v), off = (((i - a) % d) + d) % d;
        if (x === ua) rot[x] = [...r.slice(0, p), ...chords.map((c) => c[1]), ...r.slice(p + 1)];
        else if (off === 1 || off === d - 1) rot[x] = [...r.slice(0, p), ...r.slice(p + 1)];
        else rot[x] = [...r.slice(0, p), ua, ...r.slice(p + 1)];
      });
      for (const [p, q] of chords) (adj[p].add(q), adj[q].add(p));
    } else for (const x of u) rot[x].splice(rot[x].indexOf(v), 1);
    for (const x of u) adj[x].delete(v);
    present[v] = 0;
    stack.push({v, u, saved, chords});
    ev.push({op: 'remove', r: v});
  }
  let swaps = 0;
  const swap = (ch: Set<number>, a: number, b: number) => (flip(col, ch, a, b), ev.push({op: 'swap', chain: sorted(ch), a, b}), swaps++);
  const ink = (c: number) => INK_NAMES[c];
  while (stack.length) {
    const {v, u, saved, chords} = stack.pop()!;
    for (const [p, q] of chords) (adj[p].delete(q), adj[q].delete(p));
    u.forEach((x, i) => (rot[x] = saved[i], adj[x].add(v)));
    rot[v] = u;
    ev.push({op: 'restore', r: v});
    const cs = u.map((x) => col[x]), free = [0, 1, 2, 3].find((c) => !cs.includes(c));
    if (free !== undefined) {
      col[v] = free;
      ev.push({op: 'paint', r: v, c: free});
      continue;
    }
    if (u.length === 4) {
      const ch = chainOf(adj, col, u[0], cs[0], cs[2]);
      let c = cs[0];
      if (!ch.has(u[2])) swap(ch, cs[0], cs[2]);
      else {
        ev.push({op: 'mark', r: sorted(ch), tag: `the ${ink(cs[0])}-${ink(cs[2])} chain joins up`});
        swap(chainOf(adj, col, u[1], cs[1], cs[3]), cs[1], cs[3]);
        c = cs[1];
      }
      col[v] = c;
      ev.push({op: 'paint', r: v, c});
      continue;
    }
    // five neighbors on four inks: w0 sits between the two that share an ink (B)
    const k = [0, 1, 2, 3, 4].find((i) => cs[(i + 1) % 5] === cs[(i + 4) % 5])!;
    const w = [0, 1, 2, 3, 4].map((i) => u[(k + i) % 5]), [R, B, G, Y] = [col[w[0]], col[w[1]], col[w[2]], col[w[3]]];
    let done = false;
    for (const [other, target] of [[G, w[2]], [Y, w[3]]]) {
      const ch = chainOf(adj, col, w[0], R, other);
      if (!ch.has(target)) {
        swap(ch, R, other);
        col[v] = R;
        ev.push({op: 'paint', r: v, c: R});
        done = true;
        break;
      }
      ev.push({op: 'mark', r: sorted(ch), tag: `the ${ink(R)}-${ink(other)} chain joins up`});
    }
    if (done) continue;
    const ch1 = chainOf(adj, col, w[1], B, Y), ch2 = chainOf(adj, col, w[4], B, G), touched = new Set([...ch1, ...ch2, v]);
    swap(ch1, B, Y);
    swap(ch2, B, G);
    col[v] = B;
    ev.push({op: 'paint', r: v, c: B});
    const bad = new Map<string, [number, number]>();
    for (const x of touched) for (const y of adj[x]) if (col[x] >= 0 && col[x] === col[y]) bad.set(`${Math.min(x, y)}-${Math.max(x, y)}`, [Math.min(x, y), Math.max(x, y)]);
    if (bad.size) {
      for (const b of bad.values()) ev.push({op: 'clash', r: b});
      const [p, q] = bad.values().next().value!;
      return solve(m, 4, ev, 'clash', `Kempe's double swap left ${nm(m, p)} and ${nm(m, q)} on the same ink. This is the hole Heawood found.`);
    }
  }
  return solve(m, 4, ev, 'solved', `Kempe's method finished with four inks${swaps ? `, after ${swaps} chain swap${swaps > 1 ? 's' : ''}` : ''}.`);
};

/** The smallest reason a map cannot be done with three inks: a region whose neighbors contain an odd ring (a ring of three
 *  is four regions that all touch each other). Shortest ring wins, then the fewest neighbors, then the lowest index. */
export const obstruction = (m: FMap): {hub: number; ring: number[]} | null => {
  let best: {hub: number; ring: number[]} | null = null;
  for (let v = 0; v < m.n; v++) {
    const N = new Set(m.adj[v]);
    if (N.size < 3 || (best && N.size >= m.adj[best.hub].length && best.ring.length === 3)) continue;
    for (const s of N) {
      const dist = new Map([[s, 0]]), par = new Map<number, number>(), q = [s];
      for (let h = 0; h < q.length; h++) {
        const x = q[h];
        for (const y of m.adj[x]) {
          if (!N.has(y)) continue;
          if (!dist.has(y)) (dist.set(y, dist.get(x)! + 1), par.set(y, x), q.push(y));
          else if (dist.get(y) === dist.get(x) && x < y) {
            const pa = [x], pb = [y];
            for (let a = x, b = y; a !== b; ) (a = par.get(a)!, b = par.get(b)!, pa.push(a), pb.push(b));
            const ring = [...pa, ...pb.slice(0, -1).reverse()];
            if (!best || ring.length < best.ring.length || (ring.length === best.ring.length && N.size < m.adj[best.hub].length)) best = {hub: v, ring};
          }
        }
      }
    }
  }
  return best;
};

/** Exact backtracking on a set of regions (given in sweep order): a region with at most one ink left goes next, otherwise the
 *  next one west to east; the first region's ink is fixed by symmetry; conflict-directed backjumping, so a dead end only
 *  undoes the choices that caused it. (300 random maps of 12-600 regions, four inks: at most 2,214 events; DSATUR order with
 *  the same backjumping thrashed past 400,000 on some.) Events paint / stuck / unpaint. */
const search = (adj: number[][], verts: number[], k: number, limit: number) => {
  const inV = new Set(verts), col = new Int8Array(adj.length).fill(-1), at = new Int32Array(adj.length), ev: TraceEvent[] = [];
  let bt = 0, steps = 0, gaveup = false;
  const pick = () => {
    let first = -1;
    for (const v of verts) {
      if (col[v] >= 0) continue;
      if (first < 0) first = v;
      let mask = 0;
      for (const u of adj[v]) if (inV.has(u) && col[u] >= 0) mask |= 1 << col[u];
      let s = 0;
      for (let c = mask; c; c &= c - 1) s++;
      if (s >= k - 1) return v;
    }
    return first;
  };
  // null = solved below; otherwise the painted regions that caused the dead end
  const rec = (depth: number): Set<number> | null => {
    const v = pick();
    if (v < 0) return null;
    // each ink a neighbor already wears is blamed on the earliest-painted neighbor wearing it
    let mask = 0;
    const blame = new Int32Array(k).fill(-1), conf = new Set<number>();
    for (const u of adj[v]) if (col[u] >= 0) (mask |= 1 << col[u]), (blame[col[u]] < 0 || at[u] < at[blame[col[u]]]) && (blame[col[u]] = u);
    for (const u of blame) if (u >= 0) conf.add(u);
    const opts: number[] = [];
    for (let c = 0; c < k; c++) if (!(mask & (1 << c))) opts.push(c);
    if (!opts.length) return ev.push({op: 'stuck', r: v, need: k}), conf;
    for (const c of depth === 0 ? opts.slice(0, 1) : opts) {
      if (++steps > limit) return (gaveup = true), conf;
      col[v] = c;
      at[v] = depth;
      ev.push({op: 'paint', r: v, c});
      const sub = rec(depth + 1);
      if (!sub) return null;
      if (gaveup) return sub;
      col[v] = -1;
      ev.push({op: 'unpaint', r: v});
      bt++;
      if (!sub.has(v)) return sub; // v's ink did not cause it: jump straight back past v
      for (const x of sub) if (x !== v) conf.add(x);
    }
    return conf;
  };
  return {ok: rec(0) === null, ev, bt, gaveup, col};
};

/** Connected pieces of the map, each in sweep order (searching them one at a time keeps a dead end in one from re-trying another). */
const components = (m: FMap) => {
  const seen = new Uint8Array(m.n), out: number[][] = [], order = sweepOrder(m), pos = new Int32Array(m.n);
  order.forEach((v, i) => (pos[v] = i));
  for (const s of order) {
    if (seen[s]) continue;
    const comp = [s];
    seen[s] = 1;
    for (let h = 0; h < comp.length; h++) for (const y of m.adj[comp[h]]) if (!seen[y]) (seen[y] = 1, comp.push(y));
    out.push(comp.sort((a, b) => pos[a] - pos[b]));
  }
  return out;
};

/** Exact: with three inks, first look for the small reason it cannot work (and prove it there, like the video); otherwise
 *  search every piece of the map. Gives up after `limit` paints. */
export const exact = (m: FMap, k: number, limit = 200000, shortcut = true): Solve => {
  const ev: TraceEvent[] = [];
  if (k === 3 && shortcut) {
    const ob = obstruction(m);
    if (ob) {
      const verts = [ob.hub, ...ob.ring], s = search(m.adj, verts, 3, limit);
      if (!s.ok && !s.gaveup) {
        const L = ob.ring.length, why = L === 3
          ? `${cap(names(m, verts))} all touch each other.`
          : `${cap(nm(m, ob.hub))} has ${L} neighbors in a ring (${names(m, ob.ring)}). An odd ring needs three inks by itself, and ${nm(m, ob.hub)} touches all of them, so it needs a fourth.`;
        for (const e of s.ev) ev.push(e);
        const ring = search(m.adj, ob.ring, 3, limit);
        if (ring.ok) {
          for (const v of ob.ring) ev.push({op: 'paint', r: v, c: ring.col[v]});
          ev.push({op: 'stuck', r: ob.hub, need: 3});
        }
        ev.push({op: 'mark', r: verts, tag: L === 3 ? 'four regions that all touch' : 'an odd ring and its hub'});
        return solve(m, 3, ev, 'impossible', `No way with three inks (${s.bt} backtracks). ${why}`);
      }
    }
  }
  let bt = 0;
  const col = new Int8Array(m.n).fill(-1);
  for (const comp of components(m)) {
    const s = search(m.adj, comp, k, limit);
    for (const e of s.ev) ev.push(e);
    bt += s.bt;
    if (s.gaveup) return solve(m, k, ev, 'gaveup', `The search gave up after ${limit.toLocaleString('en-US')} steps.`);
    if (!s.ok) return solve(m, k, ev, 'impossible', `No way with ${k} inks: every branch tried (${bt} backtracks).`);
    for (const v of comp) col[v] = s.col[v];
  }
  return solve(m, k, ev, 'solved', `Exact search: done with ${inksUsed(col)} inks (${bt} backtrack${bt === 1 ? '' : 's'}).`);
};

// ================================================================== random maps

const mulberry = (a: number) => () => {
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
type P2 = [number, number];
const SEG = 360, RADIUS = 0.25, SEA_HALF = 0.265; // a thin sea ring (0.29 was a thick red band that pulled the eye off the map)

/** One Voronoi cell clipped to the disc polygon, with the owner of every edge (neighbor index, n = the sea). */
const clipCell = (P: P2[], i: number, disc: P2[], n: number) => {
  let poly = disc.slice(), own = disc.map(() => n), rmax = 2;
  const [px, py] = P[i];
  const others = P.map((_, j) => j).filter((j) => j !== i);
  const d2 = others.map((j) => (P[j][0] - px) ** 2 + (P[j][1] - py) ** 2);
  const order = others.map((_, k) => k).sort((a, b) => d2[a] - d2[b]);
  for (const k of order) {
    if (d2[k] > 4 * rmax * rmax) break; // the bisector lies beyond the cell's farthest corner: nothing further can cut it
    const j = others[k], dx = P[j][0] - px, dy = P[j][1] - py, mx = (P[j][0] + px) / 2, my = (P[j][1] + py) / 2;
    const f = (q: P2) => (q[0] - mx) * dx + (q[1] - my) * dy;
    const np: P2[] = [], no: number[] = [];
    for (let e = 0; e < poly.length; e++) {
      const p = poly[e], q = poly[(e + 1) % poly.length], fp = f(p), fq = f(q);
      const cut = (): P2 => {
        const t = fp / (fp - fq);
        return [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
      };
      if (fp <= 0) {
        np.push(p), no.push(own[e]);
        if (fq > 0) np.push(cut()), no.push(j);
      } else if (fq <= 0) np.push(cut()), no.push(own[e]);
    }
    poly = np;
    own = no;
    rmax = 0;
    for (const q of poly) rmax = Math.max(rmax, Math.hypot(q[0] - px, q[1] - py));
  }
  // drop zero-length edges (float noise at a corner)
  for (let e = poly.length - 1; e >= 0 && poly.length > 3; e--) {
    const q = poly[(e + 1) % poly.length];
    if (Math.hypot(q[0] - poly[e][0], q[1] - poly[e][1]) < 1e-12) {
      const nx = (e + 1) % poly.length;
      own[e] = own[nx];
      poly.splice(nx, 1);
      own.splice(nx, 1);
    }
  }
  return {poly, own};
};

/** The dual of the cells + sea as a rotation system, or null when it is not a plane triangulation (randmap.py dual). */
const triangulation = (owns: number[][], n: number): number[][] | null => {
  const V = n + 1, faces = new Map<string, [number, number, number]>();
  for (let i = 0; i < n; i++) {
    const r: number[] = [];
    for (const o of owns[i]) if (r[r.length - 1] !== o) r.push(o);
    if (r.length > 1 && r[0] === r[r.length - 1]) r.pop();
    if (new Set(r).size !== r.length || r.length < 2) return null; // a cell touching the sea along two coasts
    r.forEach((u, k) => {
      const f: [number, number, number] = [i, u, r[(k + 1) % r.length]], s = f.indexOf(Math.min(...f));
      const c: [number, number, number] = [f[s], f[(s + 1) % 3], f[(s + 2) % 3]];
      faces.set(c.join(), c);
    });
  }
  const succ = Array.from({length: V}, () => new Map<number, number>());
  for (const [a, b, c] of faces.values())
    for (const [x, y, z] of [[a, b, c], [b, c, a], [c, a, b]]) {
      if (succ[x].has(y)) return null;
      succ[x].set(y, z);
    }
  const rot: number[][] = [];
  let E2 = 0;
  for (let v = 0; v < V; v++) {
    if (succ[v].size < 3) return null;
    const start = succ[v].keys().next().value!, r = [start];
    for (let x = succ[v].get(start); x !== start; x = succ[v].get(x)) {
      if (x === undefined || r.length > succ[v].size) return null;
      r.push(x);
    }
    if (r.length !== succ[v].size) return null;
    rot.push(r);
    E2 += r.length;
  }
  if (E2 / 2 !== 3 * V - 6 || faces.size !== 2 * V - 4) return null;
  return rot;
};

/** A random map like the video's million: Voronoi cells of n uniform random points in a disc, plus the sea around it. Seeded and
 *  deterministic (our own generator, so the same seed is not the same map as the engine's numpy run). Every map is a plane
 *  triangulation (three regions at every corner); the rare one that is not is redrawn with the next sub-seed. */
export const randomMap = (n: number, seed: number): RawMap => {
  const disc: P2[] = Array.from({length: SEG}, (_, i) => [Math.cos((2 * Math.PI * i) / SEG), Math.sin((2 * Math.PI * i) / SEG)]);
  for (let attempt = 0; attempt < 50; attempt++) {
    const rnd = mulberry(Math.imul(seed, 0x9e3779b1) ^ Math.imul(attempt + 1, 0x85ebca77));
    const P: P2[] = Array.from({length: n}, () => {
      const r = Math.sqrt(rnd()), t = 2 * Math.PI * rnd();
      return [r * Math.cos(t), r * Math.sin(t)];
    });
    const cells = P.map((_, i) => clipCell(P, i, disc, n)), rot = triangulation(cells.map((c) => c.own), n);
    if (!rot) continue;
    const sc = (q: P2): XZ => [q[0] * RADIUS, q[1] * RADIUS];
    // the sea's coast = every cell corner on the circle, in angle order, so the coast shares its vertices with the cells
    const coast = new Map<string, P2>();
    for (const c of cells) c.poly.forEach((q, e) => (c.own[e] === n || c.own[(e + c.poly.length - 1) % c.poly.length] === n) && coast.set(q.map((x) => x.toFixed(9)).join(), q));
    const ring = [...coast.values()].sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0])).map(sc);
    const H = SEA_HALF, outer = disc.map((q): XZ => [q[0] * H, q[1] * H]), area = (ps: XZ[]) => Math.abs(ps.reduce((s, p, k) => s + p[0] * ps[(k + 1) % ps.length][1] - ps[(k + 1) % ps.length][0] * p[1], 0)) / 2;
    const regions: Region[] = cells.map((c, i) => {
      const poly = c.poly.map(sc);
      return {id: `C${i}`, name: `region ${i}`, polys: [[poly]], label: sc(P[i]), area: area(poly)};
    });
    regions.push({id: 'SEA', name: 'the sea', polys: [[outer, ring]], label: [-H * 0.68, -H * 0.68], area: area(outer) - area(ring)});
    const edges: [number, number][] = [];
    rot.forEach((r, v) => r.forEach((u) => v < u && edges.push([v, u])));
    return {name: `random_${n}_${seed}`, width: 2 * H, bbox: [-H, -H, H, H], regions, edges, rot};
  }
  throw new Error('no valid random map');
};

// ================================================================== share links

/** Colors packed two regions per base-36 character ((a + 1) * 6 + (b + 1)); trailing empty pairs dropped. */
export const packColors = (c: ArrayLike<number>) => {
  let s = '';
  for (let i = 0; i < c.length; i += 2) s += ((c[i] + 1) * 6 + ((i + 1 < c.length ? c[i + 1] : -1) + 1)).toString(36);
  return s.replace(/0+$/, '');
};
export const unpackColors = (s: string, n: number) => {
  const c = new Int8Array(n).fill(-1);
  for (let i = 0; i < s.length && 2 * i < n; i++) {
    const v = parseInt(s[i], 36);
    if (!(v >= 0 && v < 36)) break;
    c[2 * i] = Math.floor(v / 6) - 1;
    if (2 * i + 1 < n) c[2 * i + 1] = (v % 6) - 1;
  }
  return c;
};

export const MAP_KEYS = ['us', 'europe', 'world', 'benelux', 'trap', 'random'] as const;
export type MapKey = (typeof MAP_KEYS)[number];
export const SOLVERS = ['greedy', 'kempe', 'exact'] as const;
export type SolverKey = (typeof SOLVERS)[number];
export type Share = {map: MapKey; inks: number; n: number; seed: number; mode: 'paint' | 'solve'; paint: string; solver: SolverKey; t: number};
export const DEFAULT_SHARE: Share = {map: 'us', inks: 4, n: 150, seed: 1, mode: 'paint', paint: '', solver: 'greedy', t: 0};

/** URL query -> state. Everything is validated: a hand-edited link falls back to defaults, never throws. */
export const decodeShare = (q: string): Share => {
  const p = new URLSearchParams(q), s = {...DEFAULT_SHARE};
  const int = (k: string, lo: number, hi: number, d: number) => {
    const v = Number(p.get(k));
    return p.has(k) && Number.isFinite(v) ? clamp(Math.round(v), lo, hi) : d;
  };
  const m = p.get('m') as MapKey;
  if (MAP_KEYS.includes(m)) s.map = m;
  s.inks = int('k', 3, 5, s.inks);
  s.n = int('n', 12, 600, s.n);
  s.seed = int('s', 0, 999999, s.seed);
  const v = p.get('v') as SolverKey;
  if (SOLVERS.includes(v)) (s.mode = 'solve'), (s.solver = v), (s.t = clamp(Number(p.get('t')) || 0, 0, 36000));
  else s.paint = (p.get('p') ?? '').replace(/[^0-9a-z]/g, '').slice(0, 4000);
  return s;
};
export const encodeShare = (s: Share) => {
  const p = new URLSearchParams({m: s.map, k: String(s.inks)});
  if (s.map === 'random') (p.set('n', String(s.n)), p.set('s', String(s.seed)));
  if (s.mode === 'solve') (p.set('v', s.solver), p.set('t', s.t.toFixed(2)));
  else if (s.paint) p.set('p', s.paint);
  return p.toString();
};
