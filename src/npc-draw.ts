// Canvas scenes for "Be the NPC". Every scene is a pure function of its state (plus a clock for the radar), drawn on a dark
// test-room grid in the site's colors: chalk for the world, cyan for the game's own positions, gold for what we point at.
import {BALL_R, DT, G, WALL, STEP32, dropTrack, realFall, ulp32, walkTrack, type Throw} from './npc-sim.ts';

export const COL = {bg: '#15120f', grid: 'rgba(236,233,226,0.06)', line: 'rgba(236,233,226,0.22)', chalk: '#ece9e2', dim: '#a7a094', cyan: '#5cd6ff', gold: '#ffd23f', bad: '#ff8a6b'};
const FONT = '500 12px Inter, system-ui, sans-serif';

export type G2 = {g: CanvasRenderingContext2D; w: number; h: number};

/** Size the canvas to its CSS box at the device pixel ratio and call `draw` now and after every resize. */
export const mount = (canvas: HTMLCanvasElement, draw: (s: G2) => void) => {
  const paint = () => {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    if (!r.width || !r.height) return;
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (canvas.width !== w || canvas.height !== h) ((canvas.width = w), (canvas.height = h));
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, r.width, r.height);
    draw({g, w: r.width, h: r.height});
  };
  new ResizeObserver(paint).observe(canvas);
  document.fonts?.ready.then(paint);
  paint();
  return paint;
};

export const room = ({g, w, h}: G2, step = 32) => {
  g.fillStyle = COL.bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = COL.grid;
  g.lineWidth = 1;
  g.beginPath();
  for (let x = 0.5; x < w; x += step) (g.moveTo(x, 0), g.lineTo(x, h));
  for (let y = 0.5; y < h; y += step) (g.moveTo(0, y), g.lineTo(w, y));
  g.stroke();
};
export const text = (g: CanvasRenderingContext2D, s: string, x: number, y: number, color = COL.dim, align: CanvasTextAlign = 'left', font = FONT) => {
  g.font = font;
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = 'alphabetic';
  g.fillText(s, x, y);
};
export const pill = (g: CanvasRenderingContext2D, s: string, x: number, y: number, align: CanvasTextAlign) => {
  const f = '600 12px Inter, system-ui, sans-serif';
  g.font = f;
  const tw = g.measureText(s).width, x0 = align === 'center' ? x - tw / 2 : align === 'right' ? x - tw : x;
  g.fillStyle = 'rgba(21,18,15,0.88)';
  g.fillRect(x0 - 4, y - 12, tw + 8, 17);
  text(g, s, x, y, COL.gold, align, f);
};
export const dot = (g: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string | null, stroke?: string, lw = 2) => {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  if (fill) ((g.fillStyle = fill), g.fill());
  if (stroke) ((g.strokeStyle = stroke), (g.lineWidth = lw), g.stroke());
};

// ------------------------------------------------------------------ 1. drop
const T_MAX = 0.8; // s on the time axis: a 3 m drop lasts 0.78 s

/** `shown` = ticks revealed so far (the ball sits on tick floor(shown)); Infinity shows the whole fall. */
export const drawDrop = (s: G2, h: number, shown: number) => {
  const {g, w, h: H} = s;
  room(s);
  const track = dropTrack(h), land = track.length - 1, k = Math.min(Math.floor(shown), land);
  const top = 30, floor = H - 40, scale = (floor - top) / 3; // px per metre, 3 m fills the height
  const yPx = (m: number) => floor - Math.max(m, 0) * scale;
  // world column on the left
  const wx = Math.min(70, w * 0.14);
  g.strokeStyle = COL.line;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(wx - 34, floor + 0.5);
  g.lineTo(wx + 34, floor + 0.5);
  g.stroke();
  for (let m = 0; m <= 3; m += 0.5) {
    g.beginPath();
    g.moveTo(wx - 40, yPx(m));
    g.lineTo(wx - 34, yPx(m));
    g.stroke();
    if (m % 1 === 0) text(g, `${m} m`, wx - 46, yPx(m) + 4, COL.dim, 'right', '500 11px Inter, system-ui, sans-serif');
  }
  g.setLineDash([3, 4]);
  g.strokeStyle = COL.line;
  g.beginPath();
  g.moveTo(wx, yPx(h));
  g.lineTo(wx, floor);
  g.stroke();
  g.setLineDash([]);
  dot(g, wx, yPx(track[k]) - 9, 9, k === land ? COL.gold : COL.cyan);
  // chart: height against time
  const cx0 = wx + 78, cx1 = w - 16, tx = (t: number) => cx0 + (t / T_MAX) * (cx1 - cx0);
  g.strokeStyle = COL.line;
  g.beginPath();
  g.moveTo(cx0, floor + 0.5);
  g.lineTo(cx1, floor + 0.5);
  g.moveTo(cx0 + 0.5, top);
  g.lineTo(cx0 + 0.5, floor);
  g.stroke();
  for (let n = 0; n <= T_MAX / DT; n += 10) {
    const x = tx(n * DT);
    g.beginPath();
    g.moveTo(x, floor);
    g.lineTo(x, floor + 5);
    g.stroke();
    text(g, String(n), x, floor + 19, COL.dim, 'center', '500 11px Inter, system-ui, sans-serif');
  }
  text(g, 'game tick (60 per second)', (cx0 + cx1) / 2, floor + 34, COL.dim, 'center', '500 11px Inter, system-ui, sans-serif');
  // what really happens: one smooth curve, ends at the real fall time
  const tr = realFall(h);
  g.strokeStyle = 'rgba(236,233,226,0.35)';
  g.lineWidth = 1.5;
  g.beginPath();
  for (let i = 0; i <= 60; i++) {
    const t = (tr * i) / 60, y = h - (G * t * t) / 2;
    i ? g.lineTo(tx(t), yPx(y)) : g.moveTo(tx(t), yPx(y));
  }
  g.stroke();
  g.setLineDash([4, 4]);
  g.strokeStyle = COL.gold;
  g.beginPath();
  g.moveTo(tx(tr), top);
  g.lineTo(tx(tr), floor);
  g.stroke();
  g.setLineDash([]);
  const tl = (land * DT) < tr + 0.0001;
  text(g, `real ${tr.toFixed(3)} s`, tx(tr) + (tl ? 6 : -6), top + 10, COL.gold, tl ? 'left' : 'right');
  // the game's own positions, only on ticks
  for (let n = 0; n <= k; n++) dot(g, tx(n * DT), yPx(track[n]), n === land ? 6 : 3.6, n === land ? COL.gold : COL.cyan, n === land ? COL.bg : undefined, 2);
  if (k === land) text(g, `tick ${land}`, tx(land * DT) + (tl ? -8 : 8), yPx(0) - 24, COL.chalk, tl ? 'right' : 'left', '600 12px Inter, system-ui, sans-serif');
};

// ------------------------------------------------------------------ 2. wall
/** The ball only exists where `shown` ticks have put it; its circle is drawn to scale (7.3 cm across, wall 20 cm). */
export const drawWall = (s: G2, t: Throw, shown: number, hitShown: boolean) => {
  const {g, w, h} = s;
  room(s);
  const margin = 0.65 + t.step + BALL_R, x0 = -margin, x1 = WALL + margin;
  const sc = (w - 32) / (x1 - x0), px = (x: number) => 16 + (x - x0) * sc, mid = h * 0.46;
  // the lane and the wall
  g.strokeStyle = COL.line;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(0, mid + 0.5 + BALL_R * sc + 14);
  g.lineTo(w, mid + 0.5 + BALL_R * sc + 14);
  g.stroke();
  const wh = Math.min(h - 70, 150);
  g.fillStyle = 'rgba(236,233,226,0.8)';
  g.fillRect(px(0), mid - wh / 2, WALL * sc, wh);
  text(g, 'wall 20 cm', px(WALL / 2), mid - wh / 2 - 8, COL.chalk, 'center');
  // ticks
  const last = Math.min(Math.max(Math.floor(shown), 0), t.xs.length - 1);
  const rr = Math.max(BALL_R * sc, 3);
  for (let i = 0; i <= last; i++) {
    const x = t.xs[i];
    if (x < x0 - rr || x > x1 + rr) continue;
    const isHit = i === t.hit, cur = i === last;
    if (isHit && hitShown) dot(g, px(x), mid, rr, 'rgba(255,138,107,0.55)', COL.bad, 2);
    else dot(g, px(x), mid, rr, cur ? COL.cyan : null, cur ? undefined : 'rgba(92,214,255,0.7)', 1.5);
  }
  // one tick, measured: the two positions either side of the wall
  const i = t.xs.findIndex((x, j) => x < -BALL_R && t.xs[j + 1] > WALL + BALL_R);
  if (t.hit < 0 && i >= 0 && last > i) {
    const a = px(t.xs[i]), b = px(t.xs[i + 1]), y = Math.max(mid + rr + 34, mid + wh / 2 + 24);
    g.strokeStyle = COL.gold;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(a, y - 5);
    g.lineTo(a, y + 5);
    g.moveTo(b, y - 5);
    g.lineTo(b, y + 5);
    g.moveTo(a, y);
    g.lineTo(b, y);
    g.stroke();
    text(g, `one tick = ${(t.step * 100).toFixed(0)} cm`, (a + b) / 2, y + 20, COL.gold, 'center');
    text(g, 'never overlaps the wall', (a + b) / 2, y + 36, COL.dim, 'center');
  }
  if (last < t.xs.length) text(g, `tick ${last}`, 16, 22, COL.dim);
};

// ------------------------------------------------------------------ 3. swim
const LOGMAX = 6; // decades: the map edge sits at 1,000 km
/** Round minimap: distance from the middle on a log scale, with a slow radar sweep. */
export const drawMinimap = (s: G2, d: number, state: 'fine' | 'wrong' | 'frozen', now: number) => {
  const {g, w, h} = s;
  g.fillStyle = COL.bg;
  g.fillRect(0, 0, w, h);
  const R = Math.min(w, h) / 2 - 6, cx = w / 2, cy = h / 2, rad = (m: number) => (R * (Math.log10(m) + 0.4)) / (LOGMAX + 0.4);
  g.save();
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.clip();
  const bg = g.createRadialGradient(cx, cy, 0, cx, cy, R);
  bg.addColorStop(0, '#1d2a2e');
  bg.addColorStop(1, '#101619');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(92,214,255,0.18)';
  g.lineWidth = 1;
  for (let e = 0; e <= LOGMAX; e++) (g.beginPath(), g.arc(cx, cy, rad(10 ** e), 0, Math.PI * 2), g.stroke());
  g.beginPath();
  g.moveTo(cx - R, cy);
  g.lineTo(cx + R, cy);
  g.moveTo(cx, cy - R);
  g.lineTo(cx, cy + R);
  g.stroke();
  const sweep = (now / 2400) % 1 * Math.PI * 2;
  const sg = g.createConicGradient(sweep, cx, cy);
  sg.addColorStop(0, 'rgba(92,214,255,0)');
  sg.addColorStop(0.9, 'rgba(92,214,255,0)');
  sg.addColorStop(1, 'rgba(92,214,255,0.28)');
  g.fillStyle = sg;
  g.fillRect(0, 0, w, h);
  const a = -0.6, bx = cx + Math.cos(a) * rad(Math.max(d, 1)), by = cy + Math.sin(a) * rad(Math.max(d, 1));
  const c = state === 'fine' ? COL.gold : state === 'wrong' ? '#ffb347' : COL.bad;
  dot(g, bx, by, 9, c === COL.bad ? 'rgba(255,138,107,0.25)' : 'rgba(255,210,63,0.2)');
  dot(g, bx, by, 4, c);
  dot(g, cx, cy, 2.5, COL.chalk);
  g.restore();
  g.strokeStyle = 'rgba(236,233,226,0.45)';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.stroke();
  text(g, '1 km', cx, cy - rad(1e3) + 11, COL.dim, 'center', '500 10px Inter, system-ui, sans-serif');
  text(g, '1,000 km', cx, cy - rad(1e6) + 20, COL.dim, 'center', '500 10px Inter, system-ui, sans-serif');
};

/** Her float32 grid zoomed in: rings are where she wants to be each tick, dots where the numbers let her stand. */
export const drawSnap = (s: G2, x0: number, shown: number) => {
  const {g, w, h} = s;
  room(s);
  const N = 12, ideal = Array.from({length: N + 1}, (_, k) => k * STEP32), xs = walkTrack(x0, N), base = xs[0], act = xs.map((x) => x - base);
  const span = Math.max(ideal[N], act[N]) * 1.08 + STEP32, left = 36, right = w - 24, sc = (right - left) / span, px = (m: number) => left + m * sc;
  const step = ulp32(x0), rowI = h * 0.32, rowA = h * 0.7, axis = h * 0.88;
  const tiny = step * sc < 4;
  // the float grid: the only places she can stand
  if (!tiny) {
    g.strokeStyle = 'rgba(92,214,255,0.4)';
    g.lineWidth = 1;
    g.beginPath();
    for (let m = 0; m <= span + step; m += step) (g.moveTo(Math.round(px(m)) + 0.5, rowI - 14), g.lineTo(Math.round(px(m)) + 0.5, axis));
    g.stroke();
  } else {
    g.fillStyle = 'rgba(92,214,255,0.1)';
    g.fillRect(left, rowI - 14, right - left, axis - rowI + 14);
  }
  text(g, 'where she wants to be', left, rowI - 24, COL.dim);
  text(g, tiny ? 'where she is: steps too small to see here' : 'where she is: only on the grid', left, rowA + 28, COL.dim);
  const k = Math.min(Math.floor(shown), N);
  for (let n = 0; n <= k; n++) {
    dot(s.g, px(ideal[n]), rowI, 5, null, 'rgba(236,233,226,0.75)', 1.5);
    if (n) {
      g.strokeStyle = 'rgba(255,210,63,0.45)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(px(ideal[n]), rowI + 6);
      g.lineTo(px(act[n]), rowA - 6);
      g.stroke();
    }
    dot(g, px(act[n]), rowA, n === k ? 6 : 4.5, n === k ? COL.gold : 'rgba(255,210,63,0.7)');
  }
  // scale: the smallest step
  if (!tiny) {
    const x = px(0);
    g.strokeStyle = COL.cyan;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x, axis + 10);
    g.lineTo(x + step * sc, axis + 10);
    g.stroke();
    text(g, `smallest step ${fmtLen(step)}`, x + step * sc + 8, axis + 14, COL.cyan);
  } else text(g, `smallest step ${fmtLen(step)}`, left, axis + 14, COL.cyan);
};
export const fmtLen = (m: number) => (m >= 0.1 ? `${m.toFixed(m >= 1 ? 2 : 3)} m` : m >= 0.001 ? `${(m * 1000).toFixed(m >= 0.01 ? 1 : 2)} mm` : `${(m * 1000).toPrecision(2)} mm`);

// ------------------------------------------------------------------ 4. twins
const hue = (look: number) => (look * 137.508) % 360;
/** Pedestrians in the order they arrive; the pair of identical looks is ringed once it has shown up. */
export const drawCrowd = (s: G2, looks: number[], first: number, shown: number, n: number) => {
  const {g, w, h} = s;
  room(s);
  if (!looks.length) {
    text(g, `${n.toLocaleString('en-US')} different looks in this city`, w / 2, h / 2 - 4, COL.dim, 'center', '500 14px Inter, system-ui, sans-serif');
    text(g, 'Send a crowd to see who walks by', w / 2, h / 2 + 18, COL.dim, 'center');
    return;
  }
  const pad = 14, cell = Math.max(7, Math.min(64, Math.floor(Math.sqrt(((w - 2 * pad) * (h - 2 * pad)) / looks.length)))), cols = Math.max(1, Math.floor((w - 2 * pad) / cell));
  // the grid is centred in the panel, so a small crowd gets big people instead of one strip at the top
  const ox = (w - Math.min(cols, looks.length) * cell) / 2, oy = Math.max(pad, (h - Math.ceil(looks.length / cols) * cell) / 2);
  const at = (i: number) => [ox + (i % cols) * cell + cell / 2, oy + Math.floor(i / cols) * cell + cell / 2];
  const k = Math.min(Math.floor(shown), looks.length), r = cell * 0.36;
  for (let i = 0; i < k; i++) {
    const [x, y] = at(i);
    g.fillStyle = `hsl(${hue(looks[i])} 62% ${50 + (looks[i] % 3) * 7}%)`;
    if (cell >= 12) {
      g.beginPath();
      g.roundRect(x - r * 0.8, y - r * 0.2, r * 1.6, r * 1.3, 2);
      g.fill();
      dot(g, x, y - r * 0.65, r * 0.5, '#e8c9a8');
    } else g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  if (k === looks.length) {
    for (const i of [first, looks.length - 1]) {
      const [x, y] = at(i);
      dot(g, x, y, cell * 0.62, null, COL.gold, 2.5);
    }
    const [x, y] = at(looks.length - 1);
    const right = x > w * 0.6;
    pill(g, `person ${looks.length}`, x + (right ? -cell : cell), y + cell * 0.62 + 14, right ? 'right' : 'left');
    const [fx, fy] = at(first);
    pill(g, `person ${first + 1}`, fx, fy + cell * 0.62 + 14, 'center');
  }
};
