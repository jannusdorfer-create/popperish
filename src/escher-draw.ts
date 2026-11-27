// Canvas scenes for "Get lost": the paving in the Poincare disk, the fountain, the walkers, and the flat floor beside it.
// Plain stones in the episode's warm sandstone, fading into dusk toward the rim. Everything is drawn in the camera's frame:
// the page keeps every matrix relative to the camera, so no number ever gets big where it is drawn.
import {CORNERS, Crowd, FlatCrowd, P, R_IN, apply, between, hdist, mul, type M3, type V3} from './escher-sim.ts';
import {text, type G2} from './npc-draw.ts';

export {mount} from './npc-draw.ts';
export const COL = {
  bg: '#15120f', mortar: '#3a2a20', dusk: '#221d2b', rim: '#5a4a62', stone: ['#b39470', '#bc9a72', '#b18c6c', '#c4ac88', '#a88a62'], home: '#d9c29a',
  chalk: '#ece9e2', dim: '#a7a094', gold: '#ffd23f', lamp: '#ffb45a', water: '#7fb3c4',
};

export type Disk = {cx: number; cy: number; R: number};
export const diskIn = (x: number, y: number, w: number, h: number, pad = 12): Disk => ({cx: x + w / 2, cy: y + h / 2, R: Math.max(10, Math.min(w, h) / 2 - pad)});
/** Hyperboloid point to screen (Poincare disk). */
export const toScreen = (d: Disk, v: ArrayLike<number>, o: number[] = [0, 0]) => {
  const k = d.R / (1 + v[2]);
  o[0] = d.cx + v[0] * k;
  o[1] = d.cy - v[1] * k;
  return o;
};
/** How many screen pixels one unit of hyperbolic length is worth at point v (the disk's conformal factor). */
export const scaleAt = (d: Disk, v: ArrayLike<number>) => d.R / (1 + v[2]);

const hash = (n: number) => {
  let h = Math.imul(n | 0, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca77);
  return (h ^ (h >>> 13)) >>> 0;
};
const mid = new Float64Array(3), tmp = new Float64Array(9), ctr = new Float64Array(3), corner = new Float64Array(3), seg = new Float64Array(3);
const buckets: number[][] = COL.stone.map(() => []);
let pts = new Float32Array(1 << 16);

/**
 * The paving around the camera. frames: every stone out to some ring from a reference stone (escher-sim paving());
 * anchor: the stone that holds the camera, in camera coordinates; home: the home stone's centre in camera coordinates
 * (each stone's tone comes from its distance to home, so a stone keeps its tone as the camera moves).
 */
export const drawPaving = ({g}: G2, d: Disk, frames: Float64Array, anchor: M3, home: V3) => {
  // mortar under everything; tiles are drawn a little shrunk so the gaps scale with the stones
  g.save();
  g.beginPath();
  g.arc(d.cx, d.cy, d.R, 0, Math.PI * 2);
  g.fillStyle = COL.mortar;
  g.fill();
  g.clip();
  const maxT = Math.cosh(Math.log((2.6 * d.R) / 1.2)); // stones further out are under ~1 px: the rim haze covers them
  const n = frames.length / 9;
  for (const b of buckets) b.length = 0;
  let homeAt = -1, used = 0;
  const xy = [0, 0];
  for (let i = 0; i < n; i++) {
    const f = frames.subarray(i * 9, i * 9 + 9);
    // the centre's t first (3 multiplies): most stones are culled here
    const t = anchor[6] * f[2] + anchor[7] * f[5] + anchor[8] * f[8];
    if (t > maxT) continue;
    mul(anchor, f, tmp);
    ctr[0] = tmp[2], (ctr[1] = tmp[5]), (ctr[2] = tmp[8]);
    const dh = hdist(home, ctr);
    if (dh < 0.3) homeAt = used;
    const sub = t < 1.8 ? 6 : t < 4 ? 3 : 1; // big stones near the camera get curved edges
    const need = P * sub * 2 + 3;
    if (used + need > pts.length) {
      const next = new Float32Array(pts.length * 2);
      next.set(pts);
      pts = next;
    }
    toScreen(d, ctr, xy);
    const cx = xy[0], cy = xy[1], s = 0.9;
    pts[used] = P * sub;
    let w = used + 1;
    for (let k = 0; k < P; k++) {
      apply(tmp, CORNERS[k], corner);
      apply(tmp, CORNERS[(k + 1) % P], seg);
      for (let j = 0; j < sub; j++) {
        const v = j ? between(corner, seg, j / sub, ctr) : corner;
        toScreen(d, v, xy);
        pts[w++] = cx + (xy[0] - cx) * s;
        pts[w++] = cy + (xy[1] - cy) * s;
      }
    }
    buckets[dh < 0.3 ? 0 : hash(Math.round(dh * 1e4)) % buckets.length].push(used);
    used = w;
  }
  buckets.forEach((b, i) => {
    g.beginPath();
    for (const at of b) {
      if (at === homeAt) continue;
      const m = pts[at];
      g.moveTo(pts[at + 1], pts[at + 2]);
      for (let k = 1; k < m; k++) g.lineTo(pts[at + 1 + 2 * k], pts[at + 2 + 2 * k]);
      g.closePath();
    }
    g.fillStyle = COL.stone[i];
    g.fill();
  });
  if (homeAt >= 0) {
    const m = pts[homeAt];
    g.beginPath();
    g.moveTo(pts[homeAt + 1], pts[homeAt + 2]);
    for (let k = 1; k < m; k++) g.lineTo(pts[homeAt + 1 + 2 * k], pts[homeAt + 2 + 2 * k]);
    g.closePath();
    g.fillStyle = COL.home;
    g.fill();
  }
  // dusk: warm light in the middle, the stones fading into the evening toward the rim
  const glow = g.createRadialGradient(d.cx, d.cy, 0, d.cx, d.cy, d.R);
  glow.addColorStop(0, 'rgba(255, 200, 140, 0.10)');
  glow.addColorStop(0.45, 'rgba(60, 40, 50, 0.05)');
  glow.addColorStop(0.8, 'rgba(34, 29, 43, 0.55)');
  glow.addColorStop(0.97, 'rgba(34, 29, 43, 0.96)');
  glow.addColorStop(1, COL.dusk);
  g.fillStyle = glow;
  g.fillRect(d.cx - d.R, d.cy - d.R, 2 * d.R, 2 * d.R);
  g.restore();
  g.beginPath();
  g.arc(d.cx, d.cy, d.R + 0.5, 0, Math.PI * 2);
  g.strokeStyle = 'rgba(236, 233, 226, 0.16)';
  g.lineWidth = 1;
  g.stroke();
};

/** The fountain on the home stone: a stone basin, water, a gold rim. Sized in hyperbolic units so it shrinks with the stone. */
export const drawFountain = ({g}: G2, d: Disk, home: V3) => {
  const px = scaleAt(d, home) * R_IN * 0.62, xy = toScreen(d, home);
  if (px < 1.5) return;
  g.beginPath();
  g.arc(xy[0], xy[1], px, 0, Math.PI * 2);
  g.fillStyle = '#8a6f52';
  g.fill();
  g.beginPath();
  g.arc(xy[0], xy[1], px * 0.78, 0, Math.PI * 2);
  g.fillStyle = COL.water;
  g.fill();
  g.lineWidth = Math.max(1, px * 0.12);
  g.strokeStyle = COL.gold;
  g.beginPath();
  g.arc(xy[0], xy[1], px * 0.9, 0, Math.PI * 2);
  g.stroke();
  if (px > 6) {
    g.beginPath();
    g.arc(xy[0], xy[1], px * 0.22, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255, 255, 255, 0.75)';
    g.fill();
  }
};

/** Her trail (stone centres, camera coordinates, oldest first) and her, at point `at`. */
export const drawWalker = ({g}: G2, d: Disk, trail: V3[], at: V3, home: boolean) => {
  const xy = [0, 0];
  if (trail.length) {
    g.lineJoin = g.lineCap = 'round';
    const from = Math.max(0, trail.length - 160);
    for (let i = from; i < trail.length; i++) {
      const a = trail[i], b = i + 1 < trail.length ? trail[i + 1] : at, age = (trail.length - i) / 160;
      g.strokeStyle = `rgba(255, 180, 90, ${(0.95 * (1 - age)).toFixed(3)})`;
      g.lineWidth = Math.max(0.8, Math.min(3, scaleAt(d, a) * 0.06));
      g.beginPath();
      // the straight line between two stones is an arc in the disk
      for (let j = 0; j <= 6; j++) {
        toScreen(d, between(a, b, j / 6, mid), xy);
        if (j) g.lineTo(xy[0], xy[1]);
        else g.moveTo(xy[0], xy[1]);
      }
      g.stroke();
    }
  }
  toScreen(d, at, xy);
  g.beginPath();
  g.arc(xy[0], xy[1], 10, 0, Math.PI * 2);
  g.fillStyle = home ? 'rgba(255, 210, 63, 0.28)' : 'rgba(236, 233, 226, 0.18)';
  g.fill();
  g.beginPath();
  g.arc(xy[0], xy[1], 5.5, 0, Math.PI * 2);
  g.fillStyle = home ? COL.gold : COL.chalk;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = COL.bg;
  g.stroke();
};

/** Where the k-th walker home stands round the fountain (a sunflower spiral), in pixels from its centre. */
const spot = (k: number, r: number) => {
  const a = k * 2.39996, q = r * Math.sqrt((k + 0.5) / 1000); // r = the radius a full thousand would fill
  return [Math.cos(a) * q, Math.sin(a) * q];
};

/**
 * The crowd on the paving, home-centred. `u` in [0, 1] is how far through the current step everyone is.
 * order[i] = how many came home before walker i (or -1), so the homecomers stand round the fountain in arrival order.
 */
export const drawCrowd = ({g}: G2, d: Disk, c: Crowd, u: number, order: Int32Array) => {
  const xy = [0, 0], cur = new Float64Array(3), at = new Float64Array(3), home = toScreen(d, [0, 0, 1], [0, 0]);
  const ring = d.R * Math.tanh(R_IN / 2) * 0.86;
  const dots: number[] = [], gold: number[] = [];
  for (let i = 0; i < c.n; i++) {
    const o = i * 9, h = c.home[i], gone = c.gone[i];
    if (gone && gone < c.t) continue; // gone a step ago: past the rim
    cur[0] = c.m[o + 2], (cur[1] = c.m[o + 5]), (cur[2] = c.m[o + 8]);
    if (h && h < c.t) {
      const s = spot(order[i], ring);
      gold.push(home[0] + s[0], home[1] + s[1], 1);
      continue;
    }
    between(c.prev.subarray(i * 3, i * 3 + 3), cur, u, at);
    toScreen(d, at, xy);
    if (h) {
      // walking her last step home, then out to her spot
      const s = spot(order[i], ring), k = Math.max(0, (u - 0.6) / 0.4);
      gold.push(xy[0] + (home[0] + s[0] - xy[0]) * k, xy[1] + (home[1] + s[1] - xy[1]) * k, 1);
    } else {
      const fade = 1 - (Math.hypot(xy[0] - d.cx, xy[1] - d.cy) / d.R) ** 6;
      dots.push(xy[0], xy[1], gone ? fade * (1 - u) : fade);
    }
  }
  const r = Math.max(1.4, Math.min(2.6, d.R / 110));
  for (const a of [0.25, 0.5, 0.75, 1]) {
    g.beginPath();
    for (let i = 0; i < dots.length; i += 3) {
      if (dots[i + 2] <= a - 0.25 || dots[i + 2] > a) continue;
      g.moveTo(dots[i] + r, dots[i + 1]);
      g.arc(dots[i], dots[i + 1], r, 0, Math.PI * 2);
    }
    g.fillStyle = `rgba(236, 233, 226, ${a * 0.92})`;
    g.fill();
  }
  const rg = Math.max(1.1, ring / 32); // the pile round the fountain: dots spaced for a thousand
  g.beginPath();
  for (let i = 0; i < gold.length; i += 3) (g.moveTo(gold[i] + rg, gold[i + 1]), g.arc(gold[i], gold[i + 1], rg, 0, Math.PI * 2));
  g.fillStyle = COL.gold;
  g.fill();
};

/** The flat square floor, the same crowd walking it: zooms out as they spread. `half` = cells from the middle to the edge. */
export const drawFlat = (s: G2, box: {x: number; y: number; w: number; h: number}, c: FlatCrowd, u: number, half: number, order: Int32Array) => {
  const {g} = s, cx = box.x + box.w / 2, cy = box.y + box.h / 2, side = Math.min(box.w, box.h) - 24, cell = side / (2 * half);
  const x0 = cx - side / 2, y0 = cy - side / 2;
  g.save();
  g.beginPath();
  g.rect(x0, y0, side, side);
  g.fillStyle = COL.stone[0];
  g.fill();
  g.clip();
  // mortar lines while the stones are big enough to see; zoomed far out the floor reads as one surface
  const alpha = Math.min(1, (cell - 3) / 5);
  if (alpha > 0) {
    g.beginPath();
    const n = Math.ceil(half) + 1;
    for (let k = -n; k <= n; k++) {
      const p = (k - 0.5) * cell;
      g.moveTo(cx + p, y0), g.lineTo(cx + p, y0 + side);
      g.moveTo(x0, cy + p), g.lineTo(x0 + side, cy + p);
    }
    g.strokeStyle = `rgba(58, 42, 32, ${(0.75 * alpha).toFixed(3)})`;
    g.lineWidth = Math.max(0.75, Math.min(3, cell * 0.1));
    g.stroke();
  }
  const glow = g.createRadialGradient(cx, cy, 0, cx, cy, side * 0.72);
  glow.addColorStop(0, 'rgba(255, 200, 140, 0.10)');
  glow.addColorStop(0.6, 'rgba(34, 29, 43, 0.25)');
  glow.addColorStop(1, 'rgba(34, 29, 43, 0.85)');
  g.fillStyle = glow;
  g.fillRect(x0, y0, side, side);
  // home stone
  const hs = Math.max(6, cell * 0.9);
  g.fillStyle = COL.home;
  g.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
  g.strokeStyle = COL.gold;
  g.lineWidth = 2;
  g.strokeRect(cx - hs / 2, cy - hs / 2, hs, hs);
  const r = Math.max(1.4, Math.min(2.6, side / 220)), ring = side * 0.16;
  const dots: number[] = [], gold: number[] = [];
  for (let i = 0; i < c.n; i++) {
    const h = c.home[i];
    if (h && h < c.t) {
      const p = spot(order[i], ring);
      gold.push(cx + p[0], cy + p[1]);
      continue;
    }
    const x = c.px[i] + (c.x[i] - c.px[i]) * u, y = c.py[i] + (c.y[i] - c.py[i]) * u;
    const sx = cx + x * cell, sy = cy - y * cell;
    if (h) {
      const p = spot(order[i], ring), k = Math.max(0, (u - 0.6) / 0.4);
      gold.push(sx + (cx + p[0] - sx) * k, sy + (cy + p[1] - sy) * k);
    } else dots.push(sx, sy);
  }
  g.beginPath();
  for (let i = 0; i < dots.length; i += 2) (g.moveTo(dots[i] + r, dots[i + 1]), g.arc(dots[i], dots[i + 1], r, 0, Math.PI * 2));
  g.fillStyle = 'rgba(236, 233, 226, 0.92)';
  g.fill();
  const rg = Math.max(1.1, ring / 32);
  g.beginPath();
  for (let i = 0; i < gold.length; i += 2) (g.moveTo(gold[i] + rg, gold[i + 1]), g.arc(gold[i], gold[i + 1], rg, 0, Math.PI * 2));
  g.fillStyle = COL.gold;
  g.fill();
  g.restore();
  g.strokeStyle = 'rgba(236, 233, 226, 0.16)';
  g.lineWidth = 1;
  g.strokeRect(x0 - 0.5, y0 - 0.5, side + 1, side + 1);
};

export const caption = (s: G2, label: string, x: number, y: number) => text(s.g, label, x, y, COL.dim, 'left', '500 12px Inter, system-ui, sans-serif');
