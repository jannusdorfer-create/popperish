// Trip Karl: playback of real runs of our engine (sims/fall, MuJoCo). Nothing here simulates: public/data/fall/ holds the poses
// (site/scripts/fall_data.py), and this file only decodes them, eases between the 15 fps frames, and places Karl's shapes.
// No DOM in here, so check.ts can load the same data in node and test it.

export type Entry = {off: number; n: number};
export type Meta = {speed: number; stop: number; rest: number | null};
export type TripRun = Entry & Meta & {run: number; hero: boolean; twin: Entry & Meta};
export type HillRun = Entry & {run: number; where: 'top' | 'slope' | 'runout'; dist: number; speed: number; rest: number | null};
export type Shape =
  | {kind: 'capsule'; a: number[]; b: number[]; r: number}
  | {kind: 'box'; c: number[]; h: number[]}
  | {kind: 'ellipsoid'; c: number[]; h: number[]};
export type Box = {name: string; centre: number[]; half_size: number[]};
export type Counts = Record<string, number>;
export type Data = {
  fps: number;
  posUnit: number;
  qUnit: number;
  bodies: string[];
  rest: Record<string, number[]>;
  shapes: Record<string, Shape[]>;
  stairs: {rise: number; going: number; risers: number; treads: number; width: number; top_height: number; boxes: Box[]};
  trip: TripRun[];
  twinDelta: number;
  hill: HillRun[];
  hillHero: HillRun;
  hillTwins: {delta: number; a: HillRun; b: HillRun};
  terrain: {cell: number; rows: number; cols: number; x0: number; z0: number};
  flat: (Entry & {run: number; rest: number})[];
  files: Record<'trip' | 'hill' | 'flat' | 'terrain', string>;
  facts: {
    trip: {runs: number; stopCounts: Counts; stopPct: Counts; mostCommon: number; bottomPct: number; speedLo: number; speedHi: number; restMedian: number; bySpeed: Record<string, {runs: number; meanStop: number}>};
    tripTwins: {pairs: number; byPrecision: Record<string, {pct_pairs_end_10cm_apart: number; pct_pairs_end_on_different_steps: number}>; alpha: number};
    stairs: {risers: number; treads: number; rise: number; going: number};
    flat: {runs: number; firstContact: {median: number; min: number; max: number}; spreadCm: {mean: number; max: number}; headSdCm: number; pushJitter: number; twins1e6End10cm: number};
    hill: {
      runs: number;
      slopeDeg: number;
      slopeLength: number;
      overPct: number;
      where: {top: number; slope: number; runout: number};
      dist: {median: number; p10: number; p90: number; max: number};
      twinsGap: number;
      twinsPairs: number;
      byPrecision: Record<string, {pct_end_1m_apart: number}>;
      alpha: number;
    };
    dummy: {massKg: number; heightM: number};
  };
};

export const NB = 16;
/** Pose = per body [x, y, z, qx, qy, qz, qw], glTF axes (y up, metres). */
export type Pose = Float32Array;
export const newPose = (): Pose => new Float32Array(NB * 7);

/** One engine run: int16 frames from the pack, eased to any time t (seconds). */
export class Run {
  readonly n: number;
  readonly dur: number;
  readonly fps: number;
  private f: Float32Array;
  constructor(buf: Int16Array, e: Entry, d: Pick<Data, 'fps' | 'posUnit' | 'qUnit'>) {
    this.fps = d.fps;
    this.n = e.n;
    this.dur = (e.n - 1) / this.fps;
    this.f = new Float32Array(e.n * NB * 7);
    const src = buf.subarray(e.off, e.off + e.n * NB * 7);
    for (let i = 0; i < src.length; i++) this.f[i] = src[i] * (i % 7 < 3 ? d.posUnit : 1 / d.qUnit);
  }
  /** Pose at time t: positions lerped, quaternions nlerped (the pack keeps neighbours on one hemisphere). */
  at(t: number, out: Pose = newPose()) {
    const k = Math.max(0, Math.min(this.n - 1, t * this.fps)), i = Math.min(this.n - 2, Math.floor(k)), u = this.n < 2 ? 0 : k - i;
    const A = Math.max(0, i) * NB * 7, B = A + (this.n < 2 ? 0 : NB * 7), f = this.f;
    for (let b = 0; b < NB; b++) {
      const o = b * 7;
      for (let j = 0; j < 7; j++) out[o + j] = f[A + o + j] + (f[B + o + j] - f[A + o + j]) * u;
      const l = Math.hypot(out[o + 3], out[o + 4], out[o + 5], out[o + 6]) || 1;
      for (let j = 3; j < 7; j++) out[o + j] /= l;
    }
    return out;
  }
  last(out: Pose = newPose()) {
    return this.at(this.dur, out);
  }
}

/** Rotate v by unit quaternion q (x, y, z, w at q[o..o+3]) into out. */
export const rot = (q: ArrayLike<number>, o: number, v: ArrayLike<number>, out: number[] = [0, 0, 0]) => {
  const x = q[o], y = q[o + 1], z = q[o + 2], w = q[o + 3];
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  out[0] = v[0] + w * tx + (y * tz - z * ty);
  out[1] = v[1] + w * ty + (z * tx - x * tz);
  out[2] = v[2] + w * tz + (x * ty - y * tx);
  return out;
};
/** A body-frame point into the world for body b of pose p. */
export const toWorld = (p: Pose, b: number, v: ArrayLike<number>, out: number[] = [0, 0, 0]) => {
  rot(p, b * 7 + 3, v, out);
  out[0] += p[b * 7], (out[1] += p[b * 7 + 1]), (out[2] += p[b * 7 + 2]);
  return out;
};

/** The engine's stop step from the pelvis position: 0 top landing, 1..12 treads from the top, 13 bottom landing (engine.stop_step). */
export const stopStep = (pelvisZ: number, going: number, risers: number) => (pelvisZ < 0 ? 0 : Math.min(Math.floor(pelvisZ / going) + 1, risers));
export const stopName = (s: number, risers = 13) => (s === 0 ? 'the top landing' : s >= risers ? 'the bottom landing' : `tread ${s}`);

/** The facts' twin distance: mean over the 16 bodies of the distance between the two poses. */
export const poseGap = (a: Pose, b: Pose) => {
  let s = 0;
  for (let i = 0; i < NB; i++) s += Math.hypot(a[i * 7] - b[i * 7], a[i * 7 + 1] - b[i * 7 + 1], a[i * 7 + 2] - b[i * 7 + 2]);
  return s / NB;
};

/** The lowest world height any of Karl's shapes reaches in pose p (capsule ends minus radius, box corners, ellipsoid bottom). */
export const lowest = (d: Pick<Data, 'bodies' | 'shapes'>, p: Pose) => {
  let lo = Infinity;
  const w = [0, 0, 0];
  d.bodies.forEach((name, b) => {
    for (const s of d.shapes[name] ?? []) {
      if (s.kind === 'capsule') for (const e of [s.a, s.b]) lo = Math.min(lo, toWorld(p, b, e, w)[1] - s.r);
      else if (s.kind === 'box') for (let k = 0; k < 8; k++) lo = Math.min(lo, toWorld(p, b, [s.c[0] + (k & 1 ? 1 : -1) * s.h[0], s.c[1] + (k & 2 ? 1 : -1) * s.h[1], s.c[2] + (k & 4 ? 1 : -1) * s.h[2]], w)[1]);
      else {
        // ellipsoid: bottom = centre height minus the half-extent along world y of the rotated axes
        const c = toWorld(p, b, s.c, w)[1], ax = [0, 0, 0];
        let e = 0;
        for (let k = 0; k < 3; k++) e += (rot(p, b * 7 + 3, [k === 0 ? s.h[0] : 0, k === 1 ? s.h[1] : 0, k === 2 ? s.h[2] : 0], ax)[1]) ** 2;
        lo = Math.min(lo, c - Math.sqrt(e));
      }
    }
  });
  return lo;
};

/** Shuffled list of stop steps with exactly the facts' counts (the tally reveals it in order). */
export const tallyOrder = (counts: Counts, rng: () => number) => {
  const a: number[] = [];
  for (const [k, n] of Object.entries(counts)) for (let i = 0; i < n; i++) a.push(+k);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
