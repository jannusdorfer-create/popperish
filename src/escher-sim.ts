// The maths for "Get lost": a port of sims/escher/engine.py to float64. A stone's frame is a 3x3 Lorentz matrix on the
// hyperboloid (x, y, t), curvature radius R = 1, row-major in a Float64Array(9). Stepping across edge k of a stone M goes to M·GENS[k].
// Shared by the page, the home card and check.ts.
import type {Rng} from './npc-sim.ts';

export const P = 7, Q = 3; // heptagons, three at every corner
export const R_IN = Math.acosh(Math.cos(Math.PI / Q) / Math.sin(Math.PI / P)); // centre to edge midpoint
export const R_OUT = Math.acosh(1 / (Math.tan(Math.PI / P) * Math.tan(Math.PI / Q))); // centre to corner
export const STEP = 2 * R_IN; // centre to centre of neighbouring stones
export const ESCAPE = 14; // ponytail: as the engine, beyond 14 R the chance of ever coming back is < e^-14; count as gone
export const COSH_IN = Math.cosh(R_IN), COSH_ESC = Math.cosh(ESCAPE);

/** What our engine found (sims/escher/facts.json); check.ts holds these to the file. */
export const FACTS = {
  walkers: 1_000_000, homePct: 29.43, homeStep2Pct: 14.36, lastReturn: 141, flatSteps: 1000, flatHomePct: 67.84,
  rings: [1, 7, 21, 56, 147, 385, 1008, 2639, 6909, 18088, 47355], flatRings: [1, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40], within10: 76616,
};

export type M3 = Float64Array;
export type V3 = Float64Array;

export const eye = (): M3 => Float64Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1);
export const mul = (a: M3, b: M3, o: M3 = new Float64Array(9)): M3 => {
  const a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3], a4 = a[4], a5 = a[5], a6 = a[6], a7 = a[7], a8 = a[8];
  const b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3], b4 = b[4], b5 = b[5], b6 = b[6], b7 = b[7], b8 = b[8];
  o[0] = a0 * b0 + a1 * b3 + a2 * b6; o[1] = a0 * b1 + a1 * b4 + a2 * b7; o[2] = a0 * b2 + a1 * b5 + a2 * b8;
  o[3] = a3 * b0 + a4 * b3 + a5 * b6; o[4] = a3 * b1 + a4 * b4 + a5 * b7; o[5] = a3 * b2 + a4 * b5 + a5 * b8;
  o[6] = a6 * b0 + a7 * b3 + a8 * b6; o[7] = a6 * b1 + a7 * b4 + a8 * b7; o[8] = a6 * b2 + a7 * b5 + a8 * b8;
  return o;
};
/** Inverse of a Lorentz matrix: J Mᵀ J with J = diag(1, 1, -1). */
export const inv = (m: M3): M3 => Float64Array.of(m[0], m[3], -m[6], m[1], m[4], -m[7], -m[2], -m[5], m[8]);
export const apply = (m: M3, v: V3, o: V3 = new Float64Array(3)): V3 => {
  const x = v[0], y = v[1], t = v[2];
  o[0] = m[0] * x + m[1] * y + m[2] * t; o[1] = m[3] * x + m[4] * y + m[5] * t; o[2] = m[6] * x + m[7] * y + m[8] * t;
  return o;
};
export const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] - a[2] * b[2]; // Minkowski
/** Hyperbolic distance between two points on the hyperboloid. */
export const hdist = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.acosh(Math.max(1, -dot(a, b)));

const rot = (a: number): M3 => Float64Array.of(Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1);
const boostX = (d: number): M3 => Float64Array.of(Math.cosh(d), 0, Math.sinh(d), 0, 1, 0, Math.sinh(d), 0, Math.cosh(d));
/** Step across edge k: face edge k, cross to the neighbour, turn round so its frame matches ours (as the engine). */
export const GENS: M3[] = Array.from({length: P}, (_, k) => mul(mul(rot((2 * Math.PI * k) / P), boostX(STEP)), rot(Math.PI)));

/** The pure boost (no turn) that carries the origin to point p: the camera moves this way, so the view never spins. */
export const boostTo = (p: ArrayLike<number>): M3 => {
  const x = p[0], y = p[1], t = p[2], k = 1 / (1 + t);
  return Float64Array.of(1 + x * x * k, x * y * k, x, x * y * k, 1 + y * y * k, y, x, y, t);
};
/** The point a fraction s of the way from the origin to p, along the straight (geodesic) line. */
export const towards = (p: ArrayLike<number>, s: number): V3 => {
  const d = Math.acosh(Math.max(1, p[2])), r = Math.hypot(p[0], p[1]);
  if (r < 1e-12) return Float64Array.of(0, 0, 1);
  const sh = Math.sinh(s * d) / r;
  return Float64Array.of(p[0] * sh, p[1] * sh, Math.cosh(s * d));
};
/** The point a fraction s of the way from a to b (both on the hyperboloid). */
export const between = (a: ArrayLike<number>, b: ArrayLike<number>, s: number, o: V3 = new Float64Array(3)): V3 => {
  const d = hdist(a, b);
  if (d < 1e-9) return (o.set(b), o);
  const u = Math.sinh((1 - s) * d) / Math.sinh(d), v = Math.sinh(s * d) / Math.sinh(d);
  o[0] = u * a[0] + v * b[0]; o[1] = u * a[1] + v * b[1]; o[2] = u * a[2] + v * b[2];
  return o;
};

/** Pull a matrix back onto the Lorentz group (Gram-Schmidt in the Minkowski metric, the t column first) so rounding never piles up. */
export const fix = (m: M3): M3 => {
  const c = (j: number) => [m[j], m[3 + j], m[6 + j]];
  const put = (j: number, v: number[]) => ((m[j] = v[0]), (m[3 + j] = v[1]), (m[6 + j] = v[2]));
  const t = c(2), nt = Math.sqrt(-dot(t, t));
  for (let i = 0; i < 3; i++) t[i] /= nt;
  const x = c(0), xt = dot(x, t);
  for (let i = 0; i < 3; i++) x[i] += xt * t[i];
  const nx = Math.sqrt(dot(x, x));
  for (let i = 0; i < 3; i++) x[i] /= nx;
  const y = c(1), yt = dot(y, t), yx = dot(y, x);
  for (let i = 0; i < 3; i++) y[i] += yt * t[i] - yx * x[i];
  const ny = Math.sqrt(dot(y, y));
  for (let i = 0; i < 3; i++) y[i] /= ny;
  put(0, x), put(1, y), put(2, t);
  return m;
};

// Edge k of a stone: the outward normal (spacelike) of the line through it, in the stone's own frame; x is beyond edge k when <x, N_k> > 0.
export const EDGE_N = Array.from({length: P}, (_, k) => [Math.cosh(R_IN) * Math.cos((2 * Math.PI * k) / P), Math.cosh(R_IN) * Math.sin((2 * Math.PI * k) / P), Math.sinh(R_IN)]);
/** The corners of the home stone, between edges k and k+1. */
export const CORNERS: V3[] = Array.from({length: P}, (_, k) => {
  const a = (2 * Math.PI * (k + 0.5)) / P;
  return Float64Array.of(Math.sinh(R_OUT) * Math.cos(a), Math.sinh(R_OUT) * Math.sin(a), Math.cosh(R_OUT));
});

/** Which edge of stone m the point x lies most beyond, or -1 when x is on the stone. */
export const beyond = (m: M3, x: ArrayLike<number>) => {
  const u = apply(inv(m), Float64Array.from(x as ArrayLike<number>));
  let k = -1, best = 1e-12;
  for (let e = 0; e < P; e++) {
    const s = dot(u, EDGE_N[e]);
    if (s > best) ((best = s), (k = e));
  }
  return k;
};
/** Walk from stone m to the stone holding x, one edge at a time (the stone that holds the camera, for drawing). */
export const locate = (m: M3, x: ArrayLike<number>): M3 => {
  for (let i = 0; i < 64; i++) {
    const k = beyond(m, x);
    if (k < 0) return m;
    m = fix(mul(m, GENS[k]));
  }
  return m;
};
/** Steps from home of the stone holding x: reflect across the most violated edge of the home stone until x is home (engine fold_count). */
export const ringOf = (x: ArrayLike<number>) => {
  const v = Float64Array.from(x as ArrayLike<number>);
  for (let c = 0; c < 400; c++) {
    let k = 0, best = -Infinity;
    for (let e = 0; e < P; e++) {
      const s = dot(EDGE_N[e], v);
      if (s > best) ((best = s), (k = e));
    }
    if (best <= 1e-9) return c;
    const n = EDGE_N[k];
    for (let i = 0; i < 3; i++) v[i] -= 2 * best * n[i];
  }
  return -1;
};

/** Every stone out to ring maxK from home, by BFS over centres (the engine's rings()): frames (9 per stone), ring of each, count per ring. */
export const paving = (maxK: number) => {
  const key = (m: M3) => `${Math.round((m[2] / m[8]) * 1e7) + 0},${Math.round((m[5] / m[8]) * 1e7) + 0},${Math.round(Math.acosh(Math.max(m[8], 1)) * 1e5)}`; // as the engine; + 0 folds -0 into 0
  const seen = new Set([key(eye())]), frames: M3[] = [eye()], ring = [0], counts = [1];
  let frontier = [eye()];
  for (let r = 1; r <= maxK; r++) {
    const next: M3[] = [];
    for (const m of frontier)
      for (const g of GENS) {
        const n = mul(m, g), k = key(n);
        if (seen.has(k)) continue;
        seen.add(k), next.push(n), frames.push(n), ring.push(r);
      }
    counts.push(next.length);
    frontier = next;
  }
  const flat = new Float64Array(frames.length * 9);
  frames.forEach((m, i) => flat.set(m, i * 9));
  return {frames: flat, ring: Uint8Array.from(ring), counts, n: frames.length};
};

/** n walkers on the paving, all starting on the home stone; each step every one still wandering crosses a random edge.
 * A walker is done when she steps back onto the home stone (home) or passes the escape radius (gone), as in the engine. */
export class Crowd {
  n: number;
  m: Float64Array; // her stone's frame, 9 per walker
  prev: Float64Array; // her stone's centre one step ago, 3 per walker (for drawing the step in between)
  home: Int16Array; // the step she came home on, 0 = not (yet)
  gone: Int16Array; // the step she passed the escape radius, 0 = not (yet)
  t = 0;
  wandering: number;
  homeCount = 0;
  goneCount = 0;
  private tmp = new Float64Array(9);
  constructor(n: number) {
    this.n = this.wandering = n;
    this.m = new Float64Array(n * 9);
    this.prev = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) (this.m.set(eye(), i * 9), (this.prev[i * 3 + 2] = 1));
    this.home = new Int16Array(n);
    this.gone = new Int16Array(n);
  }
  step(rng: Rng) {
    if (!this.wandering) return;
    this.t++;
    const {m, tmp} = this;
    for (let i = 0; i < this.n; i++) {
      if (this.home[i] || this.gone[i]) continue;
      const o = i * 9;
      this.prev[i * 3] = m[o + 2], (this.prev[i * 3 + 1] = m[o + 5]), (this.prev[i * 3 + 2] = m[o + 8]);
      mul(m.subarray(o, o + 9), GENS[Math.floor(rng() * P)], tmp);
      m.set(tmp, o);
      const t = tmp[8];
      if (t < COSH_IN) ((this.home[i] = this.t), this.homeCount++, this.wandering--);
      else if (t > COSH_ESC) ((this.gone[i] = this.t), this.goneCount++, this.wandering--);
    }
  }
}

/** The same walk on a flat square floor: four neighbours, home is (0, 0). Walkers who come home stop, as in the engine. */
export class FlatCrowd {
  n: number;
  x: Int32Array;
  y: Int32Array;
  px: Int32Array;
  py: Int32Array;
  home: Int16Array;
  t = 0;
  homeCount = 0;
  constructor(n: number) {
    this.n = n;
    this.x = new Int32Array(n), (this.y = new Int32Array(n)), (this.px = new Int32Array(n)), (this.py = new Int32Array(n));
    this.home = new Int16Array(n);
  }
  step(rng: Rng) {
    this.t++;
    for (let i = 0; i < this.n; i++) {
      if (this.home[i]) continue;
      this.px[i] = this.x[i], (this.py[i] = this.y[i]);
      const g = Math.floor(rng() * 4);
      if (g < 2) this.x[i] += g ? -1 : 1;
      else this.y[i] += g === 3 ? -1 : 1;
      if (!this.x[i] && !this.y[i]) ((this.home[i] = this.t), this.homeCount++);
    }
  }
}
