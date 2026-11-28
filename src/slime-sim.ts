// Slime mold: the pure logic behind /slime. Nothing here touches the DOM or WebGL, so check.ts runs it in node.
// Worlds are masks on a grid (row 0 = north, 1 = off limits): the Kanto map with sea and mountains closed off the way light closed
// them off in the dish, an open dish, and a maze. The maze also carries a small tube network and the tube-adaptation rule of Tero
// et al. (busy tubes thicken, quiet ones thin), which decides where the agents are allowed to stay.
import {mulberry32} from './npc-sim.ts';

export type Pt = {x: number; y: number};
export type Facts = {
  runs: number; connected: number; cities: number; dishCm: number; hours: number;
  slime: {cost: number; ft: number};
  rail: {cost: number; ft: number; km: number};
  mst: {km: number};
  beat: {cost: number; trips: number; ft: number; all: number; alpha: number};
  maze: {seeds: number; won: number; routes: number; ratio: number};
};
export type SlimeData = {
  arena: number[];
  kmPerUnit: number;
  land: {outer: number[]; holes: number[][]};
  cities: {name: string; x: number; y: number; tokyo: boolean}[];
  rail: number[][];
  mtn: {w: number; h: number; rle: number[]};
  facts: Facts;
};
export type World = {kind: 'tokyo' | 'free' | 'maze'; w: number; h: number; blocked: Uint8Array; oats: Pt[]; names: string[]; start: Pt};

/** The grid for an arena at a given width: the height keeps the dish's proportions. */
export const gridSize = (arena: number[], w: number) => ({w, h: Math.round((w * (arena[3] - arena[1])) / (arena[2] - arena[0]))});
/** Kit units (x east, y north) to grid cells (row 0 = north). */
export const toGrid = (arena: number[], w: number, h: number, x: number, y: number): Pt => ({x: ((x - arena[0]) / (arena[2] - arena[0])) * w, y: ((arena[3] - y) / (arena[3] - arena[1])) * h});

/** Even-odd scanline fill of closed rings (flat grid-cell coordinates) into `out` (1 = inside). Cell centres decide. */
export const fillRings = (rings: number[][], w: number, h: number, out = new Uint8Array(w * h)) => {
  const xs: number[] = [];
  for (let y = 0; y < h; y++) {
    const yc = y + 0.5;
    xs.length = 0;
    for (const r of rings) {
      const n = r.length / 2;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const x0 = r[2 * j], y0 = r[2 * j + 1], x1 = r[2 * i], y1 = r[2 * i + 1];
        if (y0 > yc !== y1 > yc) xs.push(x0 + ((yc - y0) / (y1 - y0)) * (x1 - x0));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)), x1 = Math.min(w, Math.ceil(xs[k + 1] - 0.5)); x < x1; x++) out[y * w + x] ^= 1;
  }
  return out;
};
const ring = (arena: number[], w: number, h: number, flat: number[]) => {
  const o: number[] = [];
  for (let i = 0; i < flat.length; i += 2) {
    const p = toGrid(arena, w, h, flat[i], flat[i + 1]);
    o.push(p.x, p.y);
  }
  return o;
};
/** 1 on land (lakes are water). */
export const landMask = (D: SlimeData, w: number, h: number) => {
  const out = new Uint8Array(w * h);
  // outer and each hole are filled separately and xor-ed, so a hole cuts the land without ordering tricks
  fillRings([ring(D.arena, w, h, D.land.outer)], w, h, out);
  for (const hole of D.land.holes) fillRings([ring(D.arena, w, h, hole)], w, h, out);
  return out;
};
/** The run-length coded mountain mask, resampled (nearest) to the grid: 1 where the mountain is lit. */
export const lightMask = (m: SlimeData['mtn'], w: number, h: number) => {
  const src = new Uint8Array(m.w * m.h);
  let at = 0, v = 0;
  for (const n of m.rle) (src.fill(v, at, at + n), (at += n), (v ^= 1));
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(m.h - 1, Math.floor(((y + 0.5) * m.h) / h));
    for (let x = 0; x < w; x++) out[y * w + x] = src[sy * m.w + Math.min(m.w - 1, Math.floor(((x + 0.5) * m.w) / w))];
  }
  return out;
};
/** The nearest free cell centre to (x, y) within r cells, or null. */
export const snapFree = (blocked: Uint8Array, w: number, h: number, x: number, y: number, r = 40): Pt | null => {
  const cx = Math.floor(x), cy = Math.floor(y);
  let best: Pt | null = null, bd = Infinity;
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const px = cx + dx, py = cy + dy;
      if (px < 0 || py < 0 || px >= w || py >= h || blocked[py * w + px]) continue;
      const d = dx * dx + dy * dy;
      if (d < bd) ((bd = d), (best = {x: px + 0.5, y: py + 0.5}));
    }
  return best;
};
/** Cells reachable from `from` through free cells (4-neighbour flood fill). */
export const reachable = (blocked: Uint8Array, w: number, h: number, from: Pt) => {
  const seen = new Uint8Array(w * h), stack = [Math.floor(from.y) * w + Math.floor(from.x)];
  if (blocked[stack[0]]) return seen;
  seen[stack[0]] = 1;
  while (stack.length) {
    const i = stack.pop()!, x = i % w, y = (i / w) | 0;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && !blocked[j] && !seen[j]) ((seen[j] = 1), stack.push(j));
  }
  return seen;
};

/** Tokyo mode: Kanto with sea, lakes and lit mountains off limits, 36 oat flakes at the cities (nearest free cell), start at Tokyo. */
export const tokyoWorld = (D: SlimeData, w: number, h: number): World => {
  const land = landMask(D, w, h), light = lightMask(D.mtn, w, h), blocked = new Uint8Array(w * h);
  for (let i = 0; i < blocked.length; i++) blocked[i] = land[i] && !light[i] ? 0 : 1;
  // Odawara to Ito is a coastal strip a few cells wide between lit mountains and the sea: open the mountain side of it into a pass
  // the swarm can steer through (agents sense ahead, so a strip narrower than their reach is a wall to them)
  const at = (name: string) => {
    const c = D.cities.find((x) => x.name === name)!;
    return toGrid(D.arena, w, h, c.x, c.y);
  };
  const pa = at('Odawara'), pb = at('Ito'), half = (13 * w) / 960, dx = pb.x - pa.x, dy = pb.y - pa.y;
  for (let y = Math.max(0, Math.floor(Math.min(pa.y, pb.y) - half)); y < Math.min(h, Math.ceil(Math.max(pa.y, pb.y) + half)); y++)
    for (let x = Math.max(0, Math.floor(Math.min(pa.x, pb.x) - half)); x < Math.min(w, Math.ceil(Math.max(pa.x, pb.x) + half)); x++) {
      const u = Math.max(0, Math.min(1, ((x + 0.5 - pa.x) * dx + (y + 0.5 - pa.y) * dy) / (dx * dx + dy * dy)));
      if (land[y * w + x] && Math.hypot(x + 0.5 - pa.x - u * dx, y + 0.5 - pa.y - u * dy) <= half) blocked[y * w + x] = 0;
    }
  const tok = D.cities.find((c) => c.tokyo)!, t = toGrid(D.arena, w, h, tok.x, tok.y);
  const cities = D.cities.map((c) => {
    const g = toGrid(D.arena, w, h, c.x, c.y);
    return {c, p: snapFree(blocked, w, h, g.x, g.y, w / 12) ?? g};
  });
  const start = snapFree(blocked, w, h, t.x, t.y, w / 12)!;
  // laid out from Tokyo outward, the order they drop onto the dish
  cities.sort((a, b) => Math.hypot(a.p.x - start.x, a.p.y - start.y) - Math.hypot(b.p.x - start.x, b.p.y - start.y));
  return {kind: 'tokyo', w, h, blocked, oats: cities.map((c) => c.p), names: cities.map((c) => c.c.name), start};
};
/** Free mode: an open dish, the slime in the middle, no oats yet. */
export const freeWorld = (w: number, h: number): World => ({kind: 'free', w, h, blocked: new Uint8Array(w * h), oats: [], names: [], start: {x: w / 2, y: h / 2}});
/** Stamp (val 1) or erase (val 0) a round patch of light; returns true if any cell changed. */
export const paintLight = (blocked: Uint8Array, w: number, h: number, x: number, y: number, r: number, val: 0 | 1 = 1) => {
  let changed = false;
  for (let py = Math.max(0, Math.floor(y - r)); py <= Math.min(h - 1, Math.ceil(y + r)); py++)
    for (let px = Math.max(0, Math.floor(x - r)); px <= Math.min(w - 1, Math.ceil(x + r)); px++)
      if ((px + 0.5 - x) ** 2 + (py + 0.5 - y) ** 2 <= r * r && blocked[py * w + px] !== val) ((blocked[py * w + px] = val), (changed = true));
  return changed;
};
/** Where to put an oat flake dropped at (x, y): the spot itself if free, else nothing (no snapping across light). */
export const dropOat = (blocked: Uint8Array, w: number, h: number, x: number, y: number): Pt | null => {
  const ix = Math.floor(x), iy = Math.floor(y);
  return ix < 0 || iy < 0 || ix >= w || iy >= h || blocked[iy * w + ix] ? null : {x, y};
};

// ------------------------------------------------------------------ the maze
// Corridor centre-lines in the video's 1024 px square (y down), turned so the oats sit at the top and bottom of the dish.
// A is the first oat, B the second; two ways round at each of two forks (short or long), and dead ends.
export const MAZE_PATHS: Record<string, number[][]> = {
  stem_A: [[110, 512], [300, 512]],
  alpha1: [[300, 512], [300, 380], [560, 380]],
  alpha2: [[300, 512], [300, 760], [450, 760], [450, 640], [560, 640], [560, 380]],
  mid: [[560, 380], [680, 380]],
  beta1: [[680, 380], [680, 250], [800, 250], [800, 512]],
  beta2: [[680, 380], [680, 512], [680, 880], [800, 880], [800, 512]],
  stem_B: [[800, 512], [914, 512]],
  dead1: [[300, 380], [300, 140], [160, 140]],
  dead2: [[450, 760], [450, 920], [250, 920]],
  dead3: [[560, 380], [560, 200], [440, 200], [440, 280]],
  dead4: [[680, 250], [680, 120], [900, 120]],
  dead5: [[800, 880], [930, 880], [930, 700]],
  dead6: [[160, 512], [160, 700], [100, 700]],
};
export const MAZE_ROUTES: Record<string, string[]> = {
  'alpha1+beta1': ['stem_A', 'alpha1', 'mid', 'beta1', 'stem_B'],
  'alpha1+beta2': ['stem_A', 'alpha1', 'mid', 'beta2', 'stem_B'],
  'alpha2+beta1': ['stem_A', 'alpha2', 'mid', 'beta1', 'stem_B'],
  'alpha2+beta2': ['stem_A', 'alpha2', 'mid', 'beta2', 'stem_B'],
};
export const MAZE_SHORTEST = 'alpha1+beta1';
const CORRIDOR = 0.043; // corridor width as a share of the dish width
const mazePt = (w: number, h: number, [x, y]: number[]): Pt => ({x: (y / 1024) * w, y: (x / 1024) * h});

export type Edge = {a: number; b: number; len: number; tag: string};
export type Net = {nodes: Pt[]; edges: Edge[]; A: number; B: number};
/** The maze as a graph: every corridor cut into pieces of about 10 units, joined where corridors meet. */
export const mazeNet = (w: number, h: number): Net => {
  const nodes: Pt[] = [], edges: Edge[] = [], id = new Map<string, number>();
  const node = (x: number, y: number) => {
    const k = `${Math.round(x * 100)},${Math.round(y * 100)}`;
    if (!id.has(k)) (id.set(k, nodes.length), nodes.push(mazePt(w, h, [x, y])));
    return id.get(k)!;
  };
  for (const [tag, path] of Object.entries(MAZE_PATHS))
    for (let s = 0; s + 1 < path.length; s++) {
      const [x0, y0] = path[s], [x1, y1] = path[s + 1], n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 10);
      for (let i = 0; i < n; i++) {
        const a = node(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n), b = node(x0 + ((x1 - x0) * (i + 1)) / n, y0 + ((y1 - y0) * (i + 1)) / n);
        edges.push({a, b, len: Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y), tag});
      }
    }
  return {nodes, edges, A: node(110, 512), B: node(914, 512)};
};
/** Maze mode: corridors are free, everything else is wall; the two oats sit at the ends of the stems. */
export const mazeWorld = (w: number, h: number): World => {
  const net = mazeNet(w, h), blocked = new Uint8Array(w * h).fill(1), r = (CORRIDOR * w) / 2;
  for (const e of net.edges) {
    const a = net.nodes[e.a], b = net.nodes[e.b], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
    for (let y = Math.max(0, Math.floor(Math.min(a.y, b.y) - r)); y <= Math.min(h - 1, Math.ceil(Math.max(a.y, b.y) + r)); y++)
      for (let x = Math.max(0, Math.floor(Math.min(a.x, b.x) - r)); x <= Math.min(w - 1, Math.ceil(Math.max(a.x, b.x) + r)); x++) {
        const t = Math.max(0, Math.min(1, ((x + 0.5 - a.x) * dx + (y + 0.5 - a.y) * dy) / l2));
        if ((x + 0.5 - a.x - t * dx) ** 2 + (y + 0.5 - a.y - t * dy) ** 2 <= r * r) blocked[y * w + x] = 0;
      }
  }
  return {kind: 'maze', w, h, blocked, oats: [net.nodes[net.A], net.nodes[net.B]], names: ['A', 'B'], start: net.nodes[net.A]};
};
export const corridorWidth = (w: number) => CORRIDOR * w;
/** n cells chosen at random from the free ones (the maze starts filled with slime). */
export const scatter = (blocked: Uint8Array, w: number, n: number, rng: () => number) => {
  const free: number[] = [];
  for (let i = 0; i < blocked.length; i++) if (!blocked[i]) free.push(i);
  return Array.from({length: n}, () => {
    const c = free[Math.floor(rng() * free.length)];
    return {x: (c % w) + rng(), y: Math.floor(c / w) + rng()};
  });
};

/**
 * The tube rule of Tero et al. on a graph: a flow of 1 goes in at A and out at B, and every tube's width D follows
 * dD/dt = |Q| - D, with Q = D / length * (pressure drop). Tubes that carry flow stay, the others thin away.
 */
export class Tero {
  net: Net;
  D: Float64Array;
  p: Float64Array;
  constructor(net: Net, sigma = 0, rng: () => number = mulberry32(1)) {
    this.net = net;
    this.D = Float64Array.from(net.edges, () => Math.max(0.05, 1 + sigma * (rng() + rng() + rng() - 1.5) * 2));
    this.p = new Float64Array(net.nodes.length);
  }
  /** Pressures for the current widths by conjugate gradients (the system is singular but consistent: flow in = flow out). */
  solve() {
    const {nodes, edges, A, B} = this.net, n = nodes.length, c = Float64Array.from(edges, (e, i) => this.D[i] / e.len), p = this.p;
    const mul = (v: Float64Array, out: Float64Array) => {
      out.fill(0);
      for (let i = 0; i < edges.length; i++) {
        const d = c[i] * (v[edges[i].a] - v[edges[i].b]);
        out[edges[i].a] += d;
        out[edges[i].b] -= d;
      }
    };
    const b = new Float64Array(n);
    b[A] = 1;
    b[B] = -1;
    const r = new Float64Array(n), q = new Float64Array(n), d = new Float64Array(n);
    mul(p, q);
    let rr = 0;
    for (let i = 0; i < n; i++) ((r[i] = b[i] - q[i]), (d[i] = r[i]), (rr += r[i] * r[i]));
    for (let it = 0; it < 4 * n && rr > 1e-18; it++) {
      mul(d, q);
      let dq = 0;
      for (let i = 0; i < n; i++) dq += d[i] * q[i];
      if (dq <= 0) break;
      const al = rr / dq;
      let rn = 0;
      for (let i = 0; i < n; i++) ((p[i] += al * d[i]), (r[i] -= al * q[i]), (rn += r[i] * r[i]));
      const be = rn / rr;
      rr = rn;
      for (let i = 0; i < n; i++) d[i] = r[i] + be * d[i];
    }
  }
  /** One adaptation step of size dt. */
  step(dt: number) {
    this.solve();
    const {edges} = this.net;
    for (let i = 0; i < edges.length; i++) {
      const q = Math.abs((this.D[i] / edges[i].len) * (this.p[edges[i].a] - this.p[edges[i].b]));
      this.D[i] = Math.max(1e-9, this.D[i] + dt * (q - this.D[i]));
    }
  }
}

/** Tube widths of our engine's representative Tokyo run (scripts/slime_data.py), played back between its keyframes. */
export type RunData = {nodes: number[]; edges: number[]; cities: number[]; times: number[]; D: string[]; lo: number; hi: number};
export class GuideRun {
  n: number;
  frames: Float32Array[];
  constructor(r: RunData) {
    this.n = r.edges.length / 2;
    this.frames = r.D.map((b64) => {
      const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
      return Float32Array.from({length: this.n}, (_, i) => {
        const q = bin.charCodeAt(i);
        return q ? 10 ** (r.lo + ((q - 1) / 254) * (r.hi - r.lo)) : 0;
      });
    });
  }
  /** Widths at u in [0, 1] across the keyframes (linear between neighbouring keyframes). */
  at(u: number, out = new Float32Array(this.n)) {
    const f = Math.max(0, Math.min(1, u)) * (this.frames.length - 1), j = Math.min(Math.floor(f), this.frames.length - 2), w = f - j, a = this.frames[j], b = this.frames[j + 1];
    for (let i = 0; i < this.n; i++) out[i] = a[i] + (b[i] - a[i]) * w;
    return out;
  }
}
