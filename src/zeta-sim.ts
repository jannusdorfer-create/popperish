// Hunt the zeros: the maths behind the page, in plain double precision (shared with check.ts, which asserts the numbers the page quotes).
//   Z(t)      Hardy's wire: the zeta landscape's height along the gold line, flipped so it is a real number. Zeros are its crossings.
//   findZeros every crossing in a window; theta/gram/turing: the count that says none is missing.
//   Staircase the prime-counting staircase and the smooth curve built from the first K zeros (the explicit formula).
// Below t = 200 Z comes from the Euler-Maclaurin sum (exact to about 1e-10); above, from the Riemann-Siegel formula with three correction terms
// (error under 3e-6 at t = 200, falling fast). Double precision is good for heights up to about 1e5-1e6; our engine used double-double beyond.

const PI = Math.PI, TAU = 2 * Math.PI;
export const T_EM = 200;

// ------------------------------------------------------------------ theta and the smooth count
const lnGammaIm = (t: number) => {
  // Im ln Gamma(1/4 + i t/2) by Stirling after shifting the argument right (small t only)
  let x = 0.25, y = t / 2, shift = 0;
  for (let k = 0; k < 12; k++) shift += Math.atan2(y, x + k);
  x += 12;
  const r2 = x * x + y * y, lnr = 0.5 * Math.log(r2), arg = Math.atan2(y, x);
  const [i1r, i1i] = [x / r2, -y / r2], [i2r, i2i] = cmul(i1r, i1i, i1r, i1i), [i3r, i3i] = cmul(i2r, i2i, i1r, i1i), [, i5i] = cmul(i3r, i3i, i2r, i2i);
  // (z - 1/2) ln z - z + ln(2 pi)/2 + 1/(12 z) - 1/(360 z^3) + 1/(1260 z^5)
  const im = y * lnr + (x - 0.5) * arg - y + i1i / 12 - i3i / 360 + i5i / 1260;
  return im - shift;
};
/** Riemann-Siegel theta: half the turning of the landscape's phase along the line. Zeros of Z are where cos(theta - ...) sums cancel. */
export const theta = (t: number) =>
  t < 30 ? lnGammaIm(t) - (t / 2) * Math.log(PI) : (t / 2) * Math.log(t / TAU) - t / 2 - PI / 8 + 1 / (48 * t) + 7 / (5760 * t ** 3) + 31 / (80640 * t ** 5) + 127 / (30965760 * t ** 7);
/** The smooth zero count: N(t) = theta(t)/pi + 1 (the true count differs from it by a small wobble S(t), under 2.2 in everything we ran). */
export const smoothCount = (t: number) => theta(t) / PI + 1;
/** Mean gap between zeros near height t. */
export const meanGap = (t: number) => TAU / Math.log(Math.max(t, 20) / TAU);

// ------------------------------------------------------------------ Z(t)
const BERN = [1 / 6, -1 / 30, 1 / 42, -1 / 30, 5 / 66, -691 / 2730, 7 / 6, -3617 / 510, 43867 / 798, -174611 / 330, 854513 / 138, -236364091 / 2730];
const FACT = (n: number): number => (n < 2 ? 1 : n * FACT(n - 1));
const lnTab = [0];
const lnOf = (n: number) => {
  for (let i = lnTab.length; i <= n; i++) lnTab[i] = Math.log(i);
  return lnTab[n];
};
const cmul = (a: number, b: number, c: number, d: number): [number, number] => [a * c - b * d, a * d + b * c];

/** zeta(1/2 + i t) by the Euler-Maclaurin sum: exact to about 1e-12 for t below a few hundred. */
const zetaEM = (t: number): [number, number] => {
  const N = Math.ceil(t / 2) + 10;
  let re = 0, im = 0;
  for (let n = 1; n < N; n++) {
    const a = t * lnOf(n), m = 1 / Math.sqrt(n);
    re += m * Math.cos(a);
    im -= m * Math.sin(a);
  }
  const ph = -t * lnOf(N), mag = 1 / Math.sqrt(N), nsr = mag * Math.cos(ph), nsi = mag * Math.sin(ph); // N^-s
  const d = 0.25 + t * t; // N^(1-s) / (s - 1), s - 1 = -1/2 + i t
  re += (N * (nsr * -0.5 + nsi * t)) / d + nsr / 2;
  im += (N * (nsi * -0.5 - nsr * t)) / d + nsi / 2;
  let [pr, pi] = [0.5, t]; // s (s+1) ... (s+2k-2)
  let [wr, wi] = [nsr / N, nsi / N]; // N^(-s-2k+1)
  for (let k = 1; k <= 12; k++) {
    const [tr, ti] = cmul(pr, pi, wr, wi), c = BERN[k - 1] / FACT(2 * k);
    re += c * tr;
    im += c * ti;
    [pr, pi] = cmul(pr, pi, 0.5 + 2 * k - 1, t);
    [pr, pi] = cmul(pr, pi, 0.5 + 2 * k, t);
    wr /= N * N;
    wi /= N * N;
  }
  return [re, im];
};

// Riemann-Siegel correction: Phi(p) = cos(2 pi (p^2 - p - 1/16)) / cos(2 pi p) is smooth; its Taylor series around p = 1/2 comes from one small FFT on a circle.
const DEG = 40, TAYLOR = (() => {
  const co = new Float64Array(DEG + 1), n = 128, r = 0.5;
  const cos = (x: number, y: number): [number, number] => [Math.cos(x) * Math.cosh(y), -Math.sin(x) * Math.sinh(y)];
  for (let k = 0; k < n; k++) {
    const a = (TAU * k) / n, ux = r * Math.cos(a), uy = r * Math.sin(a);
    const [n1, n2] = cos(TAU * (ux * ux - uy * uy) - (5 * PI) / 8, TAU * 2 * ux * uy), [d1, d2] = cos(TAU * ux, TAU * uy), dd = d1 * d1 + d2 * d2;
    const fr = -(n1 * d1 + n2 * d2) / dd, fi = -(n2 * d1 - n1 * d2) / dd;
    for (let j = 0; j <= DEG; j++) co[j] += (fr * Math.cos(-j * a) - fi * Math.sin(-j * a)) / n / r ** j;
  }
  return co;
})();
const phiD = (p: number, d: number) => {
  const u = p - 0.5;
  let s = 0;
  for (let n = d; n <= DEG; n++) {
    let f = 1;
    for (let j = 0; j < d; j++) f *= n - j;
    s += TAYLOR[n] * f * u ** (n - d);
  }
  return s;
};

/** Hardy's Z(t) (real). Riemann-Siegel above T_EM: Z = 2 sum_{n<=N} cos(theta - t ln n)/sqrt(n) + (-1)^(N-1) (t/2pi)^(-1/4) (C0 + C1 a^-1 + C2 a^-2), a = sqrt(t/2pi). */
export const Z = (t: number): number => {
  if (t < T_EM) {
    const [re, im] = zetaEM(t), th = theta(t);
    return re * Math.cos(th) - im * Math.sin(th);
  }
  const a = Math.sqrt(t / TAU), N = Math.floor(a), p = a - N, th = theta(t);
  let s = 0;
  for (let n = 1; n <= N; n++) s += Math.cos(th - t * lnOf(n)) / Math.sqrt(n);
  const c0 = phiD(p, 0), c1 = -phiD(p, 3) / (96 * PI ** 2), c2 = phiD(p, 6) / (18432 * PI ** 4) + phiD(p, 2) / (64 * PI ** 2);
  return 2 * s + (N % 2 ? 1 : -1) * (c0 + c1 / a + c2 / (a * a)) / Math.sqrt(a);
};

// ------------------------------------------------------------------ the hunt
/** Squeeze a sign change between a (Z<0 side or >0) and b to about 1e-11 (Illinois false position). */
const refine = (f: (t: number) => number, a: number, b: number, fa: number, fb: number) => {
  let side = 0;
  for (let i = 0; i < 60 && b - a > 1e-11 * Math.max(1, Math.abs(b)); i++) {
    const c = (a * fb - b * fa) / (fb - fa), fc = f(c);
    if (fc === 0) return c;
    if (fc * fb > 0) ((b = c), (fb = fc), side === -1 && (fa /= 2), (side = -1));
    else ((a = c), (fa = fc), side === 1 && (fb /= 2), (side = 1));
  }
  return (a + b) / 2;
};

/** Every place Z(t) crosses the middle between t0 and t1, sorted. Samples at a quarter of a typical gap, refines each sign change, and also
 *  probes every spot where the wire turns back just before the middle (a near-miss pair like Lehmer's sits between two samples). */
export const findZeros = (t0: number, t1: number, f: (t: number) => number = Z): number[] => {
  const out: number[] = [], h = Math.min(0.25 * meanGap(t1), 0.5), n = Math.max(2, Math.ceil((t1 - t0) / h));
  const ts = new Float64Array(n + 1), zs = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) ((ts[i] = t0 + ((t1 - t0) * i) / n), (zs[i] = f(ts[i])));
  for (let i = 0; i < n; i++) if (zs[i] * zs[i + 1] < 0) out.push(refine(f, ts[i], ts[i + 1], zs[i], zs[i + 1]));
  for (let i = 1; i < n; i++) {
    const s = Math.sign(zs[i]);
    if (!s || s !== Math.sign(zs[i - 1]) || s !== Math.sign(zs[i + 1]) || Math.abs(zs[i]) >= Math.min(Math.abs(zs[i - 1]), Math.abs(zs[i + 1]))) continue;
    let a = ts[i - 1], b = ts[i + 1]; // ternary search for the point where s*Z is smallest
    for (let k = 0; k < 60; k++) {
      const m1 = a + (b - a) / 3, m2 = b - (b - a) / 3;
      if (s * f(m1) < s * f(m2)) b = m2;
      else a = m1;
    }
    const tm = (a + b) / 2, fm = f(tm);
    if (s * fm < 0) out.push(refine(f, ts[i - 1], tm, zs[i - 1], fm), refine(f, tm, ts[i + 1], fm, zs[i + 1]));
  }
  return out.sort((x, y) => x - y);
};

/** Gram point g_n: theta(g_n) = n pi (n >= -1; g_-1 = 9.667). Where the wire has the sign (-1)^n there, the point is "good". */
export const gram = (n: number) => {
  let lo = 6.3, hi = 16;
  while (theta(hi) < n * PI) hi *= 2;
  for (let i = 0; i < 80; i++) {
    const m = (lo + hi) / 2;
    if (theta(m) < n * PI) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
};
export const gramIndex = (t: number) => Math.floor(theta(t) / PI); // the Gram point at or just below t
export const isGood = (n: number) => (n % 2 ? -1 : 1) * Z(gram(n)) > 0;

export type Turing = {lo: number; hi: number; nLo: number; nHi: number; found: number; expected: number; ok: boolean; zeros: number[]};
/** The "none missing" check for the window [a, b]. The formula for the count is exact at a good Gram point: N(g_n) = n + 1. Move each end of the window out
 *  to the nearest good Gram point, count the crossings we found between them, and compare with the difference of the two formula counts. */
export const turing = (a: number, b: number): Turing => {
  let nLo = Math.max(-1, gramIndex(Math.max(a, 9.7))), nHi = Math.max(nLo + 1, gramIndex(Math.max(b, 9.7)) + 1);
  if (a <= gram(-1)) nLo = -1;
  while (nLo > -1 && !isGood(nLo)) nLo--;
  while (!isGood(nHi)) nHi++;
  const lo = gram(nLo), hi = gram(nHi), zeros = findZeros(nLo === -1 ? 0 : lo, hi);
  const expected = nHi - nLo, found = zeros.length;
  return {lo: nLo === -1 ? 0 : lo, hi, nLo, nHi, found, expected, ok: found === expected, zeros};
};

// ------------------------------------------------------------------ primes and the explicit formula
export const primesUpTo = (n: number) => {
  const sieve = new Uint8Array(n + 1), out: number[] = [];
  for (let i = 2; i <= n; i++) {
    if (sieve[i]) continue;
    out.push(i);
    for (let j = i * i; j <= n; j += i) sieve[j] = 1;
  }
  return out;
};
/** pi(x): the true staircase. */
export const piTrue = (primes: number[], x: number) => {
  let lo = 0, hi = primes.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (primes[m] <= x) lo = m + 1;
    else hi = m;
  }
  return lo;
};

const e1Real = (x: number) => {
  // E1(x) for x >= 0.5: continued fraction (Lentz)
  let b = x + 1, c = 1e300, d = 1 / b, h = d;
  for (let i = 1; i < 200; i++) {
    const a = -i * i;
    b += 2;
    d = 1 / (a * d + b);
    c = b + a / c;
    const del = c * d;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return h * Math.exp(-x);
};
/** Re E1(w) for w = wr + i wi, far from the negative real axis (here |wi| >= 9): continued fraction. */
const e1ReC = (wr: number, wi: number) => {
  let br = wr + 1, bi = wi, cr = 1e300, ci = 0;
  let dd = br * br + bi * bi, dr = br / dd, di = -bi / dd, hr = dr, hi = di;
  for (let i = 1; i < 400; i++) {
    br += 2;
    const a = -i * i;
    // d = 1 / (a d + b)
    const xr = a * dr + br, xi = a * di + bi, xx = xr * xr + xi * xi;
    dr = xr / xx;
    di = -xi / xx;
    // c = b + a / c
    const cc = cr * cr + ci * ci, qr = (a * cr) / cc, qi = (-a * ci) / cc;
    cr = br + qr;
    ci = bi + qi;
    const [er, ei] = cmul(cr, ci, dr, di);
    [hr, hi] = cmul(hr, hi, er, ei);
    if (Math.abs(er - 1) + Math.abs(ei) < 1e-14) break;
  }
  const m = Math.exp(-wr); // E1 = h e^-w
  return m * (hr * Math.cos(wi) + hi * Math.sin(wi));
};
/** Re Ei(rho ln y) for the zero rho = 1/2 + i gamma, y >= 2:  Re Ei(z) = - Re E1(-z) when Im z > 0. */
export const reEiRho = (L: number, gamma: number) => -e1ReC(-0.5 * L, -gamma * L);

const EULER = 0.5772156649015329;
const li = (y: number) => {
  const L = Math.log(y);
  let s = EULER + Math.log(L), term = 1;
  for (let k = 1; k < 80; k++) {
    term *= L / k;
    s += term / k;
    if (term / k < 1e-17 * Math.abs(s)) break;
  }
  return s;
};
/** The small leftover from the trivial zeros: integral from y to infinity of dt / (t (t^2 - 1) ln t) = sum_k E1(2 k ln y). */
const tail = (y: number) => {
  const L = Math.log(y);
  let s = 0;
  for (let k = 1; k <= 14; k++) s += e1Real(2 * k * L);
  return s;
};
const MU = [0, 1, -1, -1, 0, -1, 1, -1, 0, 0]; // Moebius function, m = 1..9
/** (m, y = x^(1/m)) for every root of x still at least 2. */
const roots = (x: number) => {
  const out: [number, number][] = [];
  for (let m = 1; m < MU.length && x ** (1 / m) >= 2; m++) if (MU[m]) out.push([m, x ** (1 / m)]);
  return out;
};
/** Smooth prime count from the first K zeros at one x (x >= 2): pi_K(x) = sum_m mu(m)/m J_K(x^(1/m)); K = 0 is the smooth average with no waves. */
export const piK = (x: number, K: number, gammas: ArrayLike<number>) => {
  let s = 0;
  for (const [m, y] of roots(x)) {
    const L = Math.log(y);
    let j = li(y) - Math.LN2 + tail(y);
    for (let n = 0; n < K; n++) j -= 2 * reEiRho(L, gammas[n]);
    s += (MU[m] / m) * j;
  }
  return s;
};

/** The curve on a grid x = 2 .. xMax, with each zero's wave stored once so any K is a running sum (a slider moves in microseconds once the rows exist). */
export class Staircase {
  readonly xs: Float64Array;
  readonly base: Float64Array;
  readonly rows: Float32Array[] = [];
  readonly gammas: ArrayLike<number>;
  private cur: Float64Array;
  private k = 0;
  private rt: [number, number][][];
  constructor(xMax: number, step: number, gammas: ArrayLike<number>) {
    this.gammas = gammas;
    const n = Math.round((xMax - 2) / step) + 1;
    this.xs = Float64Array.from({length: n}, (_, i) => 2 + i * step);
    this.rt = Array.from(this.xs, roots);
    this.base = Float64Array.from(this.xs, (_, i) => {
      let s = 0;
      for (const [m, y] of this.rt[i]) s += (MU[m] / m) * (li(y) - Math.LN2 + tail(y));
      return s;
    });
    this.cur = Float64Array.from(this.base);
  }
  /** How many zeros' waves are stored so far. */
  get ready() {
    return this.rows.length;
  }
  /** Compute the next `count` waves (call from idle frames); false when all are done. */
  work(count: number) {
    for (let c = 0; c < count && this.rows.length < this.gammas.length; c++) {
      const g = this.gammas[this.rows.length], row = new Float32Array(this.xs.length);
      for (let i = 0; i < row.length; i++) {
        let s = 0;
        for (const [m, y] of this.rt[i]) s += (MU[m] / m) * -2 * reEiRho(Math.log(y), g);
        row[i] = s;
      }
      this.rows.push(row);
    }
    return this.rows.length < this.gammas.length;
  }
  /** The curve with the first K waves added (K up to the number of zeros given). */
  at(K: number) {
    K = Math.min(K, this.gammas.length);
    while (this.rows.length < K) this.work(1);
    const r = this.rows, c = this.cur;
    while (this.k < K) {
      const row = r[this.k++];
      for (let i = 0; i < c.length; i++) c[i] += row[i];
    }
    while (this.k > K) {
      const row = r[--this.k];
      for (let i = 0; i < c.length; i++) c[i] -= row[i];
    }
    return c;
  }
}

/** The true staircase on the grid, and which grid points are away from a step (the jump itself does not count as a miss). */
export const trueSteps = (xs: Float64Array, primes: number[]) => {
  const p = Float64Array.from(xs, (x) => piTrue(primes, x)), away = Uint8Array.from(xs, (x, i) => (Math.abs(x - (primes[p[i] - 1] ?? -9)) > 0.25 && Math.abs(x - (primes[p[i]] ?? 1e9)) > 0.25 ? 1 : 0));
  return {p, away};
};
/** How far the curve misses the staircase on average (root-mean-square, steps measured in blocks), over the first `n` grid points. */
export const staircaseMiss = (curve: ArrayLike<number>, t: {p: Float64Array; away: Uint8Array}, n: number) => {
  let s = 0, c = 0;
  for (let i = 0; i < n; i++) if (t.away[i]) ((s += (curve[i] - t.p[i]) ** 2), c++);
  return Math.sqrt(s / Math.max(c, 1));
};
