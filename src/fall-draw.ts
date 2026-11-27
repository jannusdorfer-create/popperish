// Canvas scenes for "Trip Karl": one fixed orthographic camera angle (from Karl's right, a little downhill and above), the
// concrete stair, the scree hill, the flat floor, and Karl himself. Karl is drawn from his own physics shapes (capsules, boxes,
// an ellipsoid head) in crash-test yellow with the black-and-yellow targets on his head - our stand-in, never the bought mesh.
import {NB, rot, toWorld, type Box, type Data, type Pose} from './fall-sim.ts';
import {text, type G2} from './npc-draw.ts';

export {mount} from './npc-draw.ts';
export const COL = {
  bg: '#15120f', chalk: '#ece9e2', dim: '#a7a094', gold: '#ffd23f', line: 'rgba(236,233,226,0.22)',
  skin: [242, 194, 48], orange: [255, 138, 61], ghost: [200, 196, 188], ink: '#1b1610', dark: '#2a2622',
};

type V = [number, number, number];
const dot3 = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: number[]): V => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: ArrayLike<number>, b: ArrayLike<number>): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// ------------------------------------------------------------------ camera
/** Orthographic camera: c points from the scene toward the camera; r, u are screen right and up; s pixels per metre. */
export type Cam = {c: V; r: V; u: V; s: number; ox: number; oy: number; cx: number; cy: number};
export const camera = (azDeg = 28, elDeg = 18): Cam => {
  const az = (azDeg * Math.PI) / 180, el = (elDeg * Math.PI) / 180;
  const c: V = [-Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
  const f: V = [-c[0], -c[1], -c[2]], r = norm(cross(f, [0, 1, 0])), u = cross(r, f);
  return {c, r, u, s: 100, ox: 0, oy: 0, cx: 0, cy: 0};
};
export const proj = (k: Cam, x: number, y: number, z: number, o: number[] = [0, 0]) => {
  o[0] = k.cx + k.s * (x * k.r[0] + y * k.r[1] + z * k.r[2] - k.ox);
  o[1] = k.cy - k.s * (x * k.u[0] + y * k.u[1] + z * k.u[2] - k.oy);
  return o;
};
/** Nearer to the camera = bigger. */
const near = (k: Cam, p: ArrayLike<number>) => dot3(p, k.c);
/** The view box (in camera r/u metres) holding these world points. */
export const bounds = (k: Cam, pts: ArrayLike<number>[]) => {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) {
    const x = dot3(p, k.r), y = dot3(p, k.u);
    (x0 = Math.min(x0, x)), (x1 = Math.max(x1, x)), (y0 = Math.min(y0, y)), (y1 = Math.max(y1, y));
  }
  return {x0, x1, y0, y1};
};
/** Point the camera so the box fills w x h with `pad` pixels to spare (and `top` extra at the top for the HUD). */
export const frame = (k: Cam, b: {x0: number; x1: number; y0: number; y1: number}, w: number, h: number, pad = 16, top = 0) => {
  k.s = Math.min((w - 2 * pad) / (b.x1 - b.x0), (h - 2 * pad - top) / (b.y1 - b.y0));
  k.ox = (b.x0 + b.x1) / 2;
  k.oy = (b.y0 + b.y1) / 2;
  k.cx = w / 2;
  k.cy = top + (h - top) / 2;
};

const rgb = (c: number[], k = 1, a = 1) => `rgba(${Math.round(Math.min(255, c[0] * k))},${Math.round(Math.min(255, c[1] * k))},${Math.round(Math.min(255, c[2] * k))},${a})`;
const LIGHT = norm([-0.45, 0.85, 0.3]);
const lit = (n: ArrayLike<number>) => 0.55 + 0.45 * Math.max(0, dot3(n, LIGHT));

const poly = (g: CanvasRenderingContext2D, k: Cam, pts: number[][], fill: string, stroke?: string, lw = 1) => {
  const o = [0, 0];
  g.beginPath();
  pts.forEach((p, i) => (proj(k, p[0], p[1], p[2], o), i ? g.lineTo(o[0], o[1]) : g.moveTo(o[0], o[1])));
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  if (stroke) ((g.strokeStyle = stroke), (g.lineWidth = lw), g.stroke());
};
/** The faces of an axis-aligned box that face the camera, shaded, in a drawable order. */
const boxFaces = (g: CanvasRenderingContext2D, k: Cam, c: number[], h: number[], col: number[], edge?: string) => {
  for (let ax = 0; ax < 3; ax++)
    for (const sg of [-1, 1]) {
      if (sg * k.c[ax] <= 0) continue;
      const n = [0, 0, 0];
      n[ax] = sg;
      const a = (ax + 1) % 3, b = (ax + 2) % 3, pts: number[][] = [];
      for (const [p, q] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const v = [0, 0, 0];
        v[ax] = c[ax] + sg * h[ax];
        v[a] = c[a] + p * h[a];
        v[b] = c[b] + q * h[b];
        pts.push(v);
      }
      poly(g, k, pts, rgb(col, lit(n)), edge, 1);
    }
};

// ------------------------------------------------------------------ the stair
const CONCRETE = [150, 146, 139], WALL = [70, 66, 61];
export const stairPoints = (d: Pick<Data, 'stairs'>, tall = 4.1) => {
  const top = d.stairs.top_height, end = d.stairs.going * d.stairs.treads, hw = d.stairs.width / 2;
  return [[-hw, 0, -0.7], [hw, 0, -0.7], [-hw, tall, -0.5], [-hw, 0, end + 0.9], [hw, 0, end + 0.9], [-hw, top, -0.7], [hw, tall, -0.2]];
};
/** The flight, its far side wall and the floor at the bottom. Treads numbered on their sides when `labels`. */
export const drawStairs = ({g}: G2, k: Cam, d: Pick<Data, 'stairs'>, labels = true) => {
  const st = d.stairs, hw = st.width / 2, end = st.going * st.treads;
  // far wall (inner face) and the floor of the bottom landing
  const wl = st.boxes.find((b) => b.name === 'wallL');
  if (wl) {
    const x = wl.centre[0] - wl.half_size[0], y1 = wl.centre[1] + wl.half_size[1], z0 = wl.centre[2] - wl.half_size[2], z1 = wl.centre[2] + wl.half_size[2];
    poly(g, k, [[x, 0, z0], [x, 0, z1], [x, y1, z1], [x, y1, z0]], rgb(WALL, 0.75));
    // a few board lines so the wall reads as a wall
    g.strokeStyle = 'rgba(0,0,0,0.18)';
    g.lineWidth = 1;
    g.beginPath();
    const a = [0, 0], b = [0, 0];
    for (let y = 0.5; y < y1; y += 0.5) (proj(k, x, y, z0, a), proj(k, x, y, z1, b), g.moveTo(a[0], a[1]), g.lineTo(b[0], b[1]));
    g.stroke();
  }
  poly(g, k, [[-hw, 0, 0], [hw, 0, 0], [hw, 0, end + 1.6], [-hw, 0, end + 1.6]], rgb(CONCRETE, 0.62));
  const boxes = st.boxes.filter((b) => b.name.startsWith('tread') || b.name === 'landing_top').sort((a: Box, b: Box) => a.centre[2] - b.centre[2]);
  for (const b of boxes) boxFaces(g, k, b.centre, b.half_size, CONCRETE, 'rgba(20,18,15,0.35)');
  // nosing edges, then the numbers
  g.strokeStyle = 'rgba(236,233,226,0.35)';
  g.lineWidth = 1;
  g.beginPath();
  const a = [0, 0], c = [0, 0];
  for (let i = 1; i <= st.treads; i++) {
    const y = st.top_height - i * st.rise, z = i * st.going;
    proj(k, -hw, y, z, a), proj(k, hw, y, z, c), g.moveTo(a[0], a[1]), g.lineTo(c[0], c[1]);
  }
  g.stroke();
  if (labels && k.s > 40) {
    const f = `600 ${Math.round(Math.min(13, Math.max(9, k.s * 0.07)))}px Inter, system-ui, sans-serif`;
    for (let i = 1; i <= st.treads; i++) {
      proj(k, -hw, st.top_height - i * st.rise - st.rise * 0.55, (i - 0.5) * st.going, a);
      text(g, String(i), a[0], a[1] + 4, 'rgba(21,18,15,0.7)', 'center', f);
    }
  }
};

/** Tally columns on the treads: counts[step] stacked as gold blocks, tallest = `tall` metres. */
export const drawTally = (s: G2, k: Cam, d: Pick<Data, 'stairs'>, counts: number[], max: number, tall: number, hot = -1) => {
  const st = d.stairs, hw = 0.16;
  for (let step = 0; step <= st.risers; step++) {
    const n = counts[step] ?? 0;
    if (!n) continue;
    const hgt = Math.max(0.012, (tall * n) / max);
    const y0 = step >= st.risers ? 0 : st.top_height - step * st.rise, z = step >= st.risers ? st.treads * st.going + 0.55 : (step - 0.5) * st.going;
    const col = step === hot ? [255, 222, 110] : [255, 210, 63];
    boxFaces(s.g, k, [0, y0 + hgt / 2, z], [hw, hgt / 2, step >= st.risers ? 0.16 : 0.095], col, 'rgba(60,40,0,0.45)');
  }
};
/** A tally column's screen box [x0, y0, x1, y1] and the point above its top where its label goes. */
export const tallyBox = (k: Cam, d: Pick<Data, 'stairs'>, step: number, hgt: number) => {
  const st = d.stairs, bottom = step >= st.risers, y0 = bottom ? 0 : st.top_height - step * st.rise, z = bottom ? st.treads * st.going + 0.55 : (step - 0.5) * st.going;
  const hz = bottom ? 0.16 : 0.095, o = [0, 0], b = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    proj(k, i & 1 ? 0.16 : -0.16, y0 + (i & 2 ? hgt : 0), z + (i & 4 ? hz : -hz), o);
    (b[0] = Math.min(b[0], o[0])), (b[1] = Math.min(b[1], o[1])), (b[2] = Math.max(b[2], o[0])), (b[3] = Math.max(b[3], o[1]));
  }
  return {box: b, top: proj(k, 0, y0 + hgt, z)};
};

// ------------------------------------------------------------------ the hill
export type Terrain = {cell: number; rows: number; cols: number; x0: number; z0: number; Y: Float32Array};
export const terrainFrom = (t: Data['terrain'], raw: Int16Array): Terrain => ({...t, Y: Float32Array.from(raw, (v) => v / 100)});
const tX = (t: Terrain, j: number) => t.x0 - j * t.cell, tZ = (t: Terrain, i: number) => t.z0 + i * t.cell;
/** Terrain height under world (x, z), bilinear. */
export const heightAt = (t: Terrain, x: number, z: number) => {
  const fj = Math.max(0, Math.min(t.cols - 1.001, (t.x0 - x) / t.cell)), fi = Math.max(0, Math.min(t.rows - 1.001, (z - t.z0) / t.cell));
  const j = Math.floor(fj), i = Math.floor(fi), u = fj - j, v = fi - i, Y = t.Y, C = t.cols;
  return (Y[i * C + j] * (1 - u) + Y[i * C + j + 1] * u) * (1 - v) + (Y[(i + 1) * C + j] * (1 - u) + Y[(i + 1) * C + j + 1] * u) * v;
};
const ROCK = [138, 133, 126], TOPSOIL = [112, 116, 98];
const hash = (a: number, b: number) => {
  let h = Math.imul(a * 73856093 ^ b * 19349663, 0x9e3779b1);
  h ^= h >>> 15;
  return ((h >>> 0) % 1000) / 1000;
};
/**
 * The scree hill as shaded quads, far to near, at a level of detail that keeps each quad about 9 px across (so a wide shot of
 * the whole slope costs about as much as a close one). The near edge of the strip is cut like a model, with distance posts
 * every 10 m down the slope (along the 35 degree face, as the facts measure it).
 */
export const drawHill = (s: G2, k: Cam, t: Terrain, slopeDeg: number, slopeLen: number) => {
  const {g, w, h} = s, st = Math.max(1, Math.min(10, Math.ceil(9 / (t.cell * k.s)))), C = t.cols, Y = t.Y;
  const a = [0, 0], b = [0, 0], c = [0, 0], e = [0, 0];
  const grow = 0.7; // px: quads overlap a hair so no seams show between them
  for (let j = 0; j + st < t.cols; j += st)
    for (let i = 0; i + st < t.rows; i += st) {
      const x0 = tX(t, j), x1 = tX(t, j + st), z0 = tZ(t, i), z1 = tZ(t, i + st);
      const y00 = Y[i * C + j], y01 = Y[i * C + j + st], y10 = Y[(i + st) * C + j], y11 = Y[(i + st) * C + j + st];
      proj(k, x0, y00, z0, a), proj(k, x1, y01, z0, b), proj(k, x1, y11, z1, c), proj(k, x0, y10, z1, e);
      if (Math.max(a[0], b[0], c[0], e[0]) < 0 || Math.min(a[0], b[0], c[0], e[0]) > w || Math.max(a[1], b[1], c[1], e[1]) < 0 || Math.min(a[1], b[1], c[1], e[1]) > h) continue;
      // normal from the two diagonals
      const n = norm(cross([x1 - x0, y11 - y00, z1 - z0], [x0 - x1, y10 - y01, z1 - z0]));
      if (n[1] < 0) ((n[0] = -n[0]), (n[1] = -n[1]), (n[2] = -n[2]));
      const base = z0 < -0.3 ? TOPSOIL : ROCK, l = (0.42 + 0.62 * Math.max(0, dot3(n, LIGHT))) * (0.98 + 0.04 * hash(i, j));
      const mx = (a[0] + b[0] + c[0] + e[0]) / 4, my = (a[1] + b[1] + c[1] + e[1]) / 4, gx = (p: number[]) => p[0] + Math.sign(p[0] - mx) * grow, gy = (p: number[]) => p[1] + Math.sign(p[1] - my) * grow;
      g.beginPath();
      g.moveTo(gx(a), gy(a)), g.lineTo(gx(b), gy(b)), g.lineTo(gx(c), gy(c)), g.lineTo(gx(e), gy(e));
      g.closePath();
      g.fillStyle = rgb(base, l);
      g.fill();
    }
  // the cut near edge
  const jn = Math.floor((t.cols - 1) / st) * st, xn = tX(t, jn);
  g.beginPath();
  for (let i = 0; i < t.rows; i += st) (proj(k, xn, Y[i * C + jn], tZ(t, i), a), i ? g.lineTo(a[0], a[1]) : g.moveTo(a[0], a[1]));
  proj(k, xn, -3, tZ(t, t.rows - 1), a), g.lineTo(a[0], a[1]);
  proj(k, xn, -3, tZ(t, 0), a), g.lineTo(a[0], a[1]);
  g.closePath();
  const sk = g.createLinearGradient(0, 0, 0, h);
  sk.addColorStop(0, '#5a4c3d');
  sk.addColorStop(1, '#3a3027');
  g.fillStyle = sk;
  g.fill();
  g.strokeStyle = 'rgba(236,233,226,0.25)';
  g.lineWidth = 1;
  g.stroke();
  // distance posts beside Karl's walking line
  const th = (slopeDeg * Math.PI) / 180, px = -2.6;
  for (let m = 10; m <= slopeLen; m += 10) {
    const z = m * Math.cos(th), y = heightAt(t, px, z);
    proj(k, px, y, z, a), proj(k, px, y + 1.1, z, b);
    if (a[0] < -40 || a[0] > w + 40) continue;
    g.strokeStyle = 'rgba(236,233,226,0.75)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(a[0], a[1]), g.lineTo(b[0], b[1]);
    g.stroke();
    text(g, `${m} m`, b[0], b[1] - 5, COL.chalk, 'center', '600 11px Inter, system-ui, sans-serif');
  }
};

// ------------------------------------------------------------------ the flat floor
export const drawFloor = ({g}: G2, k: Cam, x0: number, x1: number, z0: number, z1: number) => {
  poly(g, k, [[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]], rgb(CONCRETE, 0.6));
  g.strokeStyle = 'rgba(0,0,0,0.16)';
  g.lineWidth = 1;
  g.beginPath();
  const a = [0, 0], b = [0, 0];
  for (let x = Math.ceil(x0 * 2) / 2; x <= x1; x += 0.5) (proj(k, x, 0, z0, a), proj(k, x, 0, z1, b), g.moveTo(a[0], a[1]), g.lineTo(b[0], b[1]));
  for (let z = Math.ceil(z0 * 2) / 2; z <= z1; z += 0.5) (proj(k, x0, 0, z, a), proj(k, x1, 0, z, b), g.moveTo(a[0], a[1]), g.lineTo(b[0], b[1]));
  g.stroke();
};

// ------------------------------------------------------------------ Karl
type Item = {z: number; draw: () => void};
const JOINTS = ['l_uarm', 'r_uarm', 'l_farm', 'r_farm', 'l_hand', 'r_hand', 'l_thigh', 'r_thigh', 'l_shin', 'r_shin', 'l_foot', 'r_foot'];
export type Look = {col?: number[]; alpha?: number; label?: string};

/**
 * Karl in pose p: every physics shape of his, painted far to near. Capsules project to rounded strokes (exact for an orthographic
 * camera), boxes to their camera-facing faces, the head ellipsoid to its exact outline ellipse with a crash-test target on each side.
 */
export const drawKarl = (s: G2, k: Cam, d: Pick<Data, 'bodies' | 'shapes'>, p: Pose, look: Look = {}) => {
  const {g} = s, col = look.col ?? COL.skin, alpha = look.alpha ?? 1, items: Item[] = [], px = k.s;
  const ink = alpha < 1 ? `rgba(27,22,16,${alpha * 0.8})` : COL.ink;
  const w = [0, 0, 0], w2 = [0, 0, 0], A = [0, 0], B = [0, 0];
  d.bodies.forEach((name, b) => {
    const dark = name.endsWith('foot') || name === 'neck', tone = dark ? [52, 47, 42] : name.endsWith('hand') ? col.map((v) => v * 0.86) : col;
    for (const sh of d.shapes[name] ?? []) {
      if (sh.kind === 'capsule') {
        const a = toWorld(p, b, sh.a, [0, 0, 0]), e = toWorld(p, b, sh.b, [0, 0, 0]);
        items.push({
          z: (near(k, a) + near(k, e)) / 2,
          draw: () => {
            proj(k, a[0], a[1], a[2], A), proj(k, e[0], e[1], e[2], B);
            g.lineCap = 'round';
            g.strokeStyle = ink;
            g.lineWidth = 2 * sh.r * px + 2;
            g.beginPath();
            g.moveTo(A[0], A[1]), g.lineTo(B[0], B[1]);
            g.stroke();
            g.strokeStyle = rgb(tone, 1, alpha);
            g.lineWidth = 2 * sh.r * px;
            g.stroke();
            // a soft highlight along the lit side
            const ox = -0.35 * sh.r * px, oy = -0.35 * sh.r * px;
            g.strokeStyle = rgb(tone, 1.22, 0.55 * alpha);
            g.lineWidth = 0.55 * sh.r * px;
            g.beginPath();
            g.moveTo(A[0] + ox, A[1] + oy), g.lineTo(B[0] + ox, B[1] + oy);
            g.stroke();
          },
        });
      } else if (sh.kind === 'box') {
        const c = toWorld(p, b, sh.c, [0, 0, 0]);
        items.push({
          z: near(k, c),
          draw: () => {
            for (let ax = 0; ax < 3; ax++)
              for (const sg of [-1, 1]) {
                const n = [0, 0, 0];
                n[ax] = sg;
                const nw = rot(p, b * 7 + 3, n, [0, 0, 0]);
                if (dot3(nw, k.c) <= 0) continue;
                const a1 = (ax + 1) % 3, a2 = (ax + 2) % 3;
                g.beginPath();
                [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([u, v], i) => {
                  const q = [0, 0, 0];
                  q[ax] = sh.c[ax] + sg * sh.h[ax];
                  q[a1] = sh.c[a1] + u * sh.h[a1];
                  q[a2] = sh.c[a2] + v * sh.h[a2];
                  toWorld(p, b, q, w);
                  proj(k, w[0], w[1], w[2], A);
                  i ? g.lineTo(A[0], A[1]) : g.moveTo(A[0], A[1]);
                });
                g.closePath();
                g.fillStyle = rgb(tone, lit(nw), alpha);
                g.fill();
                g.strokeStyle = ink;
                g.lineWidth = 1.2;
                g.lineJoin = 'round';
                g.stroke();
              }
          },
        });
      } else {
        const c = toWorld(p, b, sh.c, [0, 0, 0]);
        items.push({
          z: near(k, c),
          draw: () => {
            // exact outline: the image of the unit sphere under M = [screen rows] * R * diag(h) is the ellipse with shape M M^T
            const ax = [0, 1, 2].map((i) => rot(p, b * 7 + 3, [i === 0 ? sh.h[0] : 0, i === 1 ? sh.h[1] : 0, i === 2 ? sh.h[2] : 0], [0, 0, 0]));
            let sxx = 0, sxy = 0, syy = 0;
            for (const v of ax) {
              const x = dot3(v, k.r) * px, y = -dot3(v, k.u) * px;
              (sxx += x * x), (sxy += x * y), (syy += y * y);
            }
            const tr = (sxx + syy) / 2, det = Math.sqrt(Math.max(0, ((sxx - syy) / 2) ** 2 + sxy * sxy));
            const r1 = Math.sqrt(tr + det), r2 = Math.sqrt(Math.max(0, tr - det)), ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
            proj(k, c[0], c[1], c[2], A);
            g.beginPath();
            g.ellipse(A[0], A[1], r1 + 1, r2 + 1, ang, 0, Math.PI * 2);
            g.fillStyle = ink;
            g.fill();
            g.beginPath();
            g.ellipse(A[0], A[1], r1, r2, ang, 0, Math.PI * 2);
            g.fillStyle = rgb(tone, 1, alpha);
            g.fill();
            g.beginPath();
            g.ellipse(A[0] - r1 * 0.25, A[1] - r2 * 0.3, r1 * 0.4, r2 * 0.32, ang, 0, Math.PI * 2);
            g.fillStyle = rgb(tone, 1.2, 0.45 * alpha);
            g.fill();
            // the targets on the sides of his head (whichever side faces us)
            for (const sg of [-1, 1]) {
              const nw = rot(p, b * 7 + 3, [sg, 0, 0], w2);
              if (dot3(nw, k.c) < 0.15) continue;
              const ctr = toWorld(p, b, [sh.c[0] + sg * sh.h[0] * 0.98, sh.c[1] + 0.005, sh.c[2] - 0.01], w);
              const ey = rot(p, b * 7 + 3, [0, 0.045, 0], [0, 0, 0]), ez = rot(p, b * 7 + 3, [0, 0, 0.045], [0, 0, 0]);
              proj(k, ctr[0], ctr[1], ctr[2], B);
              g.save();
              g.transform(dot3(ey, k.r) * px, -dot3(ey, k.u) * px, dot3(ez, k.r) * px, -dot3(ez, k.u) * px, B[0], B[1]);
              for (let q = 0; q < 4; q++) {
                g.beginPath();
                g.moveTo(0, 0);
                g.arc(0, 0, 1, (q * Math.PI) / 2, ((q + 1) * Math.PI) / 2);
                g.closePath();
                g.fillStyle = q % 2 ? rgb(tone, 1.08, alpha) : ink;
                g.fill();
              }
              g.restore();
            }
          },
        });
      }
    }
  });
  // black joint pins where the segments meet
  for (const name of JOINTS) {
    const b = d.bodies.indexOf(name);
    if (b < 0) continue;
    const c = [p[b * 7], p[b * 7 + 1], p[b * 7 + 2]], r = name.endsWith('hand') ? 0.026 : 0.034;
    items.push({
      z: near(k, c) + 0.04,
      draw: () => {
        proj(k, c[0], c[1], c[2], A);
        g.beginPath();
        g.arc(A[0], A[1], Math.max(1.2, r * px), 0, Math.PI * 2);
        g.fillStyle = alpha < 1 ? `rgba(42,38,34,${alpha})` : COL.dark;
        g.fill();
      },
    });
  }
  items.sort((a, b) => a.z - b.z);
  for (const it of items) it.draw();
  if (look.label) {
    const hb = d.bodies.indexOf('head');
    proj(k, p[hb * 7], p[hb * 7 + 1] + 0.32, p[hb * 7 + 2], A);
    g.font = '700 12px Inter, system-ui, sans-serif';
    const tw = g.measureText(look.label).width;
    g.fillStyle = 'rgba(21,18,15,0.85)';
    g.fillRect(A[0] - tw / 2 - 5, A[1] - 13, tw + 10, 18);
    text(g, look.label, A[0], A[1], rgb(col), 'center', '700 12px Inter, system-ui, sans-serif');
  }
};

/** World points of a pose, for framing the camera (every body origin, padded by a body's size in the caller). */
export const posePoints = (p: Pose) => Array.from({length: NB}, (_, b) => [p[b * 7], p[b * 7 + 1], p[b * 7 + 2]]);
