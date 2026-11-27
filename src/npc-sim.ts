// "Be the NPC" logic for the site: pure, no DOM, so the page and src/check.ts share it.
// Same rules as our engine sims/npc/engine.py: fixed 60 Hz tick, semi-implicit Euler, positions in 32-bit floats,
// collisions checked once per tick. check.ts compares the numbers with sims/npc/facts.json.

export const DT = 1 / 60;
export const G = 9.81;
export const WALL = 0.2; // m
export const BALL_R = 0.0365; // baseball radius, m (7.3 cm across)
export const WALK = 1.4; // m/s
/** Wall plus ball: the distance a ball must cover in one tick to hop over the wall. */
export const GAP = WALL + 2 * BALL_R;
export const TUNNEL_KMH = (GAP / DT) * 3.6;

export type Rng = () => number;
/** Small seeded generator (mulberry32) so the check is repeatable; the page seeds it from the clock. */
export const mulberry32 = (seed: number): Rng => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// ------------------------------------------------------------------ 1. drop

/** Height of the ball on every tick from 0 until the first tick at or below the floor (that last one is the landing). */
export const dropTrack = (h: number) => {
  const ys = [h];
  let y = h, v = 0;
  while (y > 0) {
    v -= G * DT; // velocity first, then position: semi-implicit Euler
    y += v * DT;
    ys.push(y);
  }
  return ys;
};
export const dropTicks = (h: number) => dropTrack(h).length - 1;
/** Closed form of dropTicks (the engine's land_tick). */
export const dropTicksClosed = (h: number) => Math.ceil((-1 + Math.sqrt(1 + (8 * h) / (G * DT * DT))) / 2);
export const realFall = (h: number) => Math.sqrt((2 * h) / G);

// ------------------------------------------------------------------ 2. wall

export type Throw = {
  /** metres per tick */
  step: number;
  /** ball centre on every tick, wall spans 0 .. WALL on the same axis */
  xs: number[];
  /** index of the first tick that overlaps the wall, or -1 when the ball hopped over it */
  hit: number;
};
const inWall = (x: number) => x >= -BALL_R && x <= WALL + BALL_R;

/** One throw at v m/s. `phase` (0..1) is where the first tick lands relative to the wall: the random tick phase. */
export const throwBall = (v: number, phase: number, margin = 0.6): Throw => {
  const step = v * DT;
  const x0 = -phase * step; // a tick position just before the wall
  const back = Math.ceil(margin / step); // run-up ticks, same lattice
  const xs: number[] = [];
  for (let k = -back; x0 + k * step <= WALL + margin + step; k++) xs.push(x0 + k * step);
  return {step, xs, hit: xs.findIndex(inWall)};
};
/** The share of throws at v m/s that go through, in theory. */
export const tunnelFrac = (v: number) => Math.max(0, 1 - GAP / (v * DT));
/** Throw n balls at v m/s with random tick phase; returns how many came out the other side. */
export const throwMany = (v: number, n: number, rng: Rng) => {
  const step = v * DT;
  let through = 0;
  for (let i = 0; i < n; i++) {
    const x0 = -rng() * step;
    const k = Math.ceil((-BALL_R - x0) / step); // first tick at or past the wall's near face
    if (x0 + k * step > WALL + BALL_R) through++;
  }
  return through;
};

// ------------------------------------------------------------------ 3. swim

export const STEP32 = Math.fround(WALK * DT);
/** Spacing between neighbouring float32 numbers at x (x > 0): the smallest step the NPC can take there. */
export const ulp32 = (x: number) => {
  let e = Math.floor(Math.log2(x));
  if (2 ** e > x) e--;
  else if (2 ** (e + 1) <= x) e++;
  return 2 ** (e - 23);
};
/** Her float32 positions after 0..frames ticks of a 1.4 m/s walk starting `x0` m from the middle. */
export const walkTrack = (x0: number, frames: number) => {
  const xs = [Math.fround(x0)];
  for (let i = 0; i < frames; i++) xs.push(Math.fround(xs[i] + STEP32));
  return xs;
};
/** Her measured speed over `frames` ticks (the engine uses 600, ten seconds). */
export const walkSpeed = (x0: number, frames = 600) => {
  const xs = walkTrack(x0, frames);
  return (xs[frames] - xs[0]) / (frames * DT);
};
export type SwimState = 'fine' | 'wrong' | 'frozen';
export const swimState = (speed: number): SwimState => (speed === 0 ? 'frozen' : Math.abs(speed - WALK) / WALK > 0.1 ? 'wrong' : 'fine');

// ------------------------------------------------------------------ 4. twins

/** Send people one at a time, each with one of n looks picked at random, until a look repeats. */
export const crowd = (n: number, rng: Rng) => {
  const seen = new Map<number, number>();
  const looks: number[] = [];
  for (;;) {
    const x = Math.floor(rng() * n);
    looks.push(x);
    const first = seen.get(x);
    if (first !== undefined) return {looks, first, count: looks.length};
    seen.set(x, looks.length - 1);
  }
};
export const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const medianCrowd = (n: number, crowds: number, rng: Rng) => median(Array.from({length: crowds}, () => crowd(n, rng).count));
/** Birthday maths: half of all crowds have a repeat by about this many people. */
export const twinsFormula = (n: number) => 1.1774 * Math.sqrt(n);

// ------------------------------------------------------------------ the numbers the page quotes

/** The four headline facts; src/check.ts compares them with sims/npc/facts.json. */
export const headline = () => ({
  dropTick: dropTicks(2),
  tunnelKmh: Math.round(TUNNEL_KMH),
  wrongFromM: 2 ** 17,
  frozenFromM: 2 ** 19,
  twinsMedian1000: medianCrowd(1000, 20000, mulberry32(20261124)),
});
