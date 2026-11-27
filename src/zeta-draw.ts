// Canvas scenes for "Hunt the zeros": pure functions of their state on the same dark test-room grid as the other simulations.
// Chalk for the world (the true staircase, the wire), gold for what we point at (the curve, the zeros), cyan for our engine's own stored data.
import {COL, dot, pill, room, text, type G2} from './npc-draw.ts';

export {mount} from './npc-draw.ts';
const SMALL = '500 11px Inter, system-ui, sans-serif';
const BOLD = '600 12px Inter, system-ui, sans-serif';
/** A short axis number: 0.0000025 stays readable. */
export const tick = (v: number) => {
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 1000) return v.toLocaleString('en-US');
  if (a >= 0.1) return String(+v.toPrecision(3));
  return v.toFixed(Math.min(12, 1 - Math.floor(Math.log10(a)))).replace(/0+$/, '');
};
/** A tiny height in plain words: 0.0000025 becomes "2.5 millionths". */
export const words = (v: number) => (v < 1e-3 ? `${+(v * 1e6).toPrecision(2)} millionths` : v < 0.1 ? `${+(v * 1e3).toPrecision(2)} thousandths` : String(+v.toPrecision(2)));
const niceStep = (span: number, n: number) => {
  const raw = span / n, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
};
type Box = {x0: number; x1: number; y0: number; y1: number};
const box = (w: number, h: number): Box => ({x0: w < 420 ? 50 : 58, x1: w - 14, y0: 16, y1: h - (w < 420 ? 38 : 42)});
const axes = (g: CanvasRenderingContext2D, b: Box, xs: number[], px: (v: number) => number, fmt: (v: number) => string) => {
  g.strokeStyle = COL.line;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(b.x0, b.y1 + 0.5);
  g.lineTo(b.x1, b.y1 + 0.5);
  g.stroke();
  for (const v of xs) {
    const x = px(v);
    if (x < b.x0 - 1 || x > b.x1 + 1) continue;
    g.beginPath();
    g.moveTo(x, b.y1);
    g.lineTo(x, b.y1 + 5);
    g.stroke();
    text(g, fmt(v), x, b.y1 + 19, COL.dim, 'center', SMALL);
  }
};
const ticks = (a: number, b: number, n: number) => {
  const st = niceStep(b - a, n), out: number[] = [];
  for (let v = Math.ceil(a / st) * st; v <= b + st * 1e-9; v += st) out.push(+v.toPrecision(12));
  return out;
};

// ------------------------------------------------------------------ 1. the prime staircase from waves
/** `xs`/`curve` is the smooth curve (first K waves) on a grid; `primes` makes the true staircase. The view runs from x = 1 to `view`. */
export const drawStair = (s: G2, xs: Float64Array, curve: ArrayLike<number>, primes: number[], view: number) => {
  const {g, w, h} = s, b = box(w, h);
  room(s);
  const top = primes.filter((p) => p <= view).length, ymax = Math.max(top + 1.5, 4);
  const px = (x: number) => b.x0 + ((x - 1) / (view - 1)) * (b.x1 - b.x0), py = (v: number) => b.y1 - (v / ymax) * (b.y1 - b.y0);
  g.strokeStyle = COL.grid;
  g.lineWidth = 1;
  for (const v of ticks(0, ymax, 5)) {
    g.beginPath();
    g.moveTo(b.x0, Math.round(py(v)) + 0.5);
    g.lineTo(b.x1, Math.round(py(v)) + 0.5);
    g.stroke();
    text(g, tick(v), b.x0 - 8, py(v) + 4, COL.dim, 'right', SMALL);
  }
  const showP = (b.x1 - b.x0) / view > 7; // room to name the primes themselves on the x axis
  axes(g, b, showP ? primes.filter((p) => p <= view) : ticks(0, view, 6), px, showP ? String : tick);
  text(g, 'primes up to x', b.x0 + 6, b.y0 + 12, COL.dim, 'left', SMALL);
  // the true staircase: one block up at every prime
  g.strokeStyle = COL.chalk;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(px(1), py(0));
  let c = 0;
  for (const p of primes) {
    if (p > view) break;
    g.lineTo(px(p), py(c));
    g.lineTo(px(p), py(++c));
  }
  g.lineTo(px(view), py(c));
  g.stroke();
  // the curve built from the waves
  g.strokeStyle = COL.gold;
  g.lineWidth = 2;
  g.lineJoin = 'round';
  g.beginPath();
  let started = false;
  for (let i = 0; i < xs.length && xs[i] <= view; i++) {
    const x = px(xs[i]), y = py(Math.min(Math.max(curve[i], -0.5), ymax));
    started ? g.lineTo(x, y) : (g.moveTo(x, y), (started = true));
  }
  g.stroke();
  // legend
  const lx = b.x1 - 6;
  text(g, 'true count (one block per prime)', lx, b.y1 - 30, COL.chalk, 'right', SMALL);
  text(g, 'built from the waves', lx, b.y1 - 14, COL.gold, 'right', SMALL);
};

// ------------------------------------------------------------------ 2. hunt along the line
export type Hunt = {a: number; b: number; ts: Float64Array; zs: Float64Array; zeros: number[]; lo: number; hi: number};
/** The wire Z(t) over the window [a, b], a bead on the middle for every crossing found; the dashed ends are the clean marks the count is checked between. */
export const drawHunt = (s: G2, d: Hunt) => {
  const {g, w, h} = s, bx = box(w, h);
  room(s);
  let m = 0;
  for (let i = 0; i < d.zs.length; i++) m = Math.max(m, Math.abs(d.zs[i]));
  const ymax = Math.max(m * 1.12, 0.05), px = (t: number) => bx.x0 + ((t - d.a) / (d.b - d.a)) * (bx.x1 - bx.x0), mid = (bx.y0 + bx.y1) / 2, py = (v: number) => mid - (v / ymax) * ((bx.y1 - bx.y0) / 2);
  g.save();
  g.beginPath();
  g.rect(bx.x0, bx.y0 - 4, bx.x1 - bx.x0, bx.y1 - bx.y0 + 8);
  g.clip();
  for (const e of [d.lo, d.hi]) {
    if (e < d.a - 1e-9 || e > d.b + 1e-9) continue;
    g.setLineDash([3, 4]);
    g.strokeStyle = 'rgba(92,214,255,0.7)';
    g.beginPath();
    g.moveTo(px(e), bx.y0);
    g.lineTo(px(e), bx.y1);
    g.stroke();
    g.setLineDash([]);
  }
  g.restore();
  // the middle line
  g.strokeStyle = COL.line;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(bx.x0, mid + 0.5);
  g.lineTo(bx.x1, mid + 0.5);
  g.stroke();
  for (const v of ticks(-ymax, ymax, 4)) if (Math.abs(v) > 1e-12) text(g, tick(v), bx.x0 - 8, py(v) + 4, COL.dim, 'right', SMALL);
  text(g, '0', bx.x0 - 8, mid + 4, COL.dim, 'right', SMALL);
  axes(g, bx, ticks(d.a, d.b, w < 420 ? 4 : 7), px, (v) => tick(v));
  text(g, 'Z(t), the wire', bx.x0 + 6, bx.y0 + 12, COL.dim, 'left', SMALL);
  // the wire
  g.save();
  g.beginPath();
  g.rect(bx.x0, bx.y0 - 4, bx.x1 - bx.x0, bx.y1 - bx.y0 + 8);
  g.clip();
  g.strokeStyle = COL.chalk;
  g.lineWidth = 1.8;
  g.lineJoin = 'round';
  g.beginPath();
  for (let i = 0; i < d.ts.length; i++) (i ? g.lineTo : g.moveTo).call(g, px(d.ts[i]), py(d.zs[i]));
  g.stroke();
  g.restore();
  // a gold bead on the middle for every crossing
  const many = d.zeros.length > 40;
  for (const z of d.zeros) {
    if (z < d.a || z > d.b) continue;
    dot(g, px(z), mid, many ? 3 : 5.5, COL.gold, COL.bg, many ? 1 : 2);
  }
  // name the zeros when the names fit (neighbours alternate above and below the line, so only every second one must clear)
  const vis = d.zeros.filter((z) => z >= d.a && z <= d.b), digits = w < 520 ? 3 : 6;
  g.font = BOLD;
  const need = g.measureText((vis[0] ?? 0).toFixed(digits)).width + 10;
  let gap = Infinity;
  for (let i = 2; i < vis.length; i++) gap = Math.min(gap, px(vis[i]) - px(vis[i - 2]));
  if (vis.length <= 14 && gap >= need) vis.forEach((z, i) => px(z) - need / 2 > bx.x0 && px(z) + need / 2 < bx.x1 && text(g, z.toFixed(digits), px(z), mid + (i % 2 ? 22 : -12), COL.gold, 'center', BOLD));
  if (d.lo >= d.a && d.lo <= d.b) text(g, 'clean mark', px(d.lo) + 5, bx.y1 - 6, COL.cyan, 'left', SMALL);
  if (d.hi >= d.a && d.hi <= d.b) text(g, 'clean mark', px(d.hi) - 5, bx.y1 - 6, COL.cyan, 'right', SMALL);
};

// ------------------------------------------------------------------ 3. near misses
export type Pair = {t0: number; dt: ArrayLike<number>; z: ArrayLike<number>; over: ArrayLike<number>; zeros: [number, number]; names: [string, string]; peak: number; full: boolean};
/** The wire between and around a close pair: our engine's stored values (cyan) with the live double-precision calculation on top (chalk, dashed). `full` draws the usual scale (the wire swings about 1), where a pair like this lies flat on the line. */
export const drawPair = (s: G2, d: Pair) => {
  const {g, w, h} = s, bx = box(w, h);
  room(s);
  const lo = d.dt[0], hi = d.dt[d.dt.length - 1], mid = (bx.y0 + bx.y1) / 2;
  const ymax = d.full ? 1 : d.peak * 1.8, px = (t: number) => bx.x0 + ((t - d.t0 - lo) / (hi - lo)) * (bx.x1 - bx.x0), py = (v: number) => mid - (v / ymax) * ((bx.y1 - bx.y0) / 2);
  g.strokeStyle = COL.line;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(bx.x0, mid + 0.5);
  g.lineTo(bx.x1, mid + 0.5);
  g.stroke();
  const unit = d.full ? 1 : ymax < 1e-4 ? 1e6 : ymax < 0.1 ? 1e3 : 1, unitName = unit === 1e6 ? 'millionths' : unit === 1e3 ? 'thousandths' : '';
  for (const v of ticks(-ymax * unit, ymax * unit, 4)) if (Math.abs(v) > 1e-9) text(g, tick(v), bx.x0 - 8, py(v / unit) + 4, COL.dim, 'right', SMALL);
  text(g, '0', bx.x0 - 8, mid + 4, COL.dim, 'right', SMALL);
  // time axis in offsets from the first zero, so the digits that matter are the ones shown
  const base = d.zeros[0], off = (v: number) => tick(+(v - base).toPrecision(3));
  axes(g, bx, ticks(lo + d.t0 - base, hi + d.t0 - base, w < 420 ? 3 : 5).map((v) => v + base), px, off);
  text(g, `distance from the first zero (t = ${base.toLocaleString('en-US', {maximumFractionDigits: 3})})`, (bx.x0 + bx.x1) / 2, bx.y1 + 34, COL.dim, 'center', SMALL);
  text(g, d.full ? 'Z(t), usual scale' : unitName ? `Z(t) in ${unitName}` : 'Z(t), zoomed in', bx.x0 + 6, bx.y0 + 12, COL.dim, 'left', SMALL);
  g.save();
  g.beginPath();
  g.rect(bx.x0, bx.y0 - 2, bx.x1 - bx.x0, bx.y1 - bx.y0 + 4);
  g.clip();
  const line = (z: ArrayLike<number>, color: string, lw: number, dash: number[]) => {
    g.strokeStyle = color;
    g.lineWidth = lw;
    g.lineJoin = 'round';
    g.setLineDash(dash);
    g.beginPath();
    for (let i = 0; i < z.length; i++) (i ? g.lineTo : g.moveTo).call(g, px(d.t0 + d.dt[i]), py(z[i]));
    g.stroke();
    g.setLineDash([]);
  };
  line(d.z, COL.cyan, 2.4, []);
  line(d.over, COL.chalk, 1.4, [4, 4]);
  g.restore();
  // the peak between the two zeros, and the two beads
  const [z1, z2] = d.zeros;
  let pk = 0, pi = 0;
  for (let i = 0; i < d.z.length; i++) {
    const t = d.t0 + d.dt[i];
    if (t > z1 && t < z2 && Math.abs(d.z[i]) > pk) ((pk = Math.abs(d.z[i])), (pi = i));
  }
  const tp = px(d.t0 + d.dt[pi]), yp = py(d.z[pi]);
  g.setLineDash([3, 4]);
  g.strokeStyle = COL.gold;
  g.beginPath();
  g.moveTo(tp, mid);
  g.lineTo(tp, yp);
  g.stroke();
  g.setLineDash([]);
  if (!d.full) pill(g, `rises to ${words(pk)}`, tp + 8, (mid + yp) / 2 + 4, 'left');
  for (let i = 0; i < 2; i++) {
    const x = px(d.zeros[i]);
    dot(g, x, mid, 6, COL.gold, COL.bg, 2);
    text(g, d.names[i], x, mid + (i ? 26 : -14), COL.gold, 'center', BOLD);
  }
  text(g, "our engine's values", bx.x1 - 4, bx.y0 + 12, COL.cyan, 'right', SMALL);
  text(g, 'live, in your browser (dashed)', bx.x1 - 4, bx.y0 + 28, COL.chalk, 'right', SMALL);
};

// ------------------------------------------------------------------ 4. spacings
export type Spacing = {step: number; hist: ArrayLike<number>; label: string};
/** The random-matrix curve (Wigner's guess for heavy-atom energy levels): 32/pi^2 s^2 exp(-4 s^2 / pi). */
export const wigner = (s: number) => ((32 / Math.PI ** 2) * s * s) * Math.exp((-4 * s * s) / Math.PI);
/** Random scatter (Poisson): tiny gaps are the commonest. */
export const poisson = (s: number) => Math.exp(-s);
/** Bars: how often neighbours are a given distance apart (1 = the usual gap). Curves: random scatter and the random-matrix law. */
export const drawSpacing = (s: G2, d: Spacing) => {
  const {g, w, h} = s, b = box(w, h), smax = 3.2, ymax = 1.05;
  room(s);
  const px = (v: number) => b.x0 + (v / smax) * (b.x1 - b.x0), py = (v: number) => b.y1 - (v / ymax) * (b.y1 - b.y0);
  for (const v of [0.25, 0.5, 0.75, 1]) {
    g.strokeStyle = COL.grid;
    g.beginPath();
    g.moveTo(b.x0, Math.round(py(v)) + 0.5);
    g.lineTo(b.x1, Math.round(py(v)) + 0.5);
    g.stroke();
    text(g, tick(v), b.x0 - 8, py(v) + 4, COL.dim, 'right', SMALL);
  }
  axes(g, b, [0, 0.5, 1, 1.5, 2, 2.5, 3], px, tick);
  text(g, 'gap between neighbouring zeros (1 = the usual gap)', (b.x0 + b.x1) / 2, b.y1 + 34, COL.dim, 'center', SMALL);
  text(g, 'how common (density)', b.x0 + 6, b.y0 + 12, COL.dim, 'left', SMALL);
  g.fillStyle = 'rgba(92,214,255,0.55)';
  for (let i = 0; i < d.hist.length; i++) {
    const x0 = px(i * d.step), x1 = px((i + 1) * d.step), y = py(Math.min(d.hist[i], ymax));
    g.fillRect(x0 + 0.3, y, Math.max(x1 - x0 - 0.6, 0.8), b.y1 - y);
  }
  const curve = (f: (v: number) => number, color: string, dash: number[], lw: number) => {
    g.strokeStyle = color;
    g.lineWidth = lw;
    g.setLineDash(dash);
    g.beginPath();
    for (let i = 0; i <= 160; i++) (i ? g.lineTo : g.moveTo).call(g, px((i * smax) / 160), py(Math.min(f((i * smax) / 160), ymax)));
    g.stroke();
    g.setLineDash([]);
  };
  curve(poisson, COL.bad, [6, 5], 2);
  curve(wigner, COL.gold, [], 2.4);
  const lx = b.x1 - 6, ly = b.y0 + 30;
  text(g, d.label, lx, ly, COL.cyan, 'right', SMALL);
  text(g, 'random scatter (Poisson)', lx, ly + 17, COL.bad, 'right', SMALL);
  text(g, "heavy-atom levels (Wigner's curve)", lx, ly + 34, COL.gold, 'right', SMALL);
};
