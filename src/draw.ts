// Canvas drawing for the map card: printed map on cream paper, ink stains that spread, dark brown borders.
// Paths live in map units (metres) and the context transform scales them; fills multiply onto the paper so its grain shows.
// Per frame: the settled map is one cached bitmap (base), the borders and labels another (lines); only regions whose ink is
// still spreading or drying are drawn live between them, then the overlays (clash, stuck, chain, mark, hover).
import {INKS, type FMap, type InkState} from './map.ts';

export const PAPER = '#efe4ca';
const BORDER = '#2b2119';
const GOLD = '#ffd84a';

export type Overlay = {
  /** map edges to flash gold (a clash) and the regions to hatch */
  clashes: [number, number][];
  hot: number[];
  hover: number;
  /** ring the clash so it can be found on a big map (solver mode) */
  callout?: boolean;
  /** paint mode: where each stain started (map x, z) and how far it must reach */
  origin?: Map<number, [number, number, number]>;
};
type Card = {x: number; y: number; w: number; h: number};
type Lay = {
  m: FMap;
  paths: Path2D[];
  bb: Float32Array;
  card: Card;
  dpr: number;
  /** device px = a * map + (e, f) */
  a: number;
  e: number;
  f: number;
  /** css px per metre */
  s: number;
  lw: number;
  tiny: number[];
  title: string;
  sub: string;
  lpx: number;
  labels: {i: number; t: string; x: number; y: number}[];
};

// ------------------------------------------------------------------ textures (made once)

let paperTex: HTMLCanvasElement | null = null;
const paperCanvas = () => {
  if (paperTex) return paperTex;
  const c = document.createElement('canvas'), N = 256;
  c.width = c.height = N;
  const x = c.getContext('2d')!, img = x.createImageData(N, N);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const [r, g, b] = [0xef, 0xe4, 0xca];
  for (let i = 0; i < N * N; i++) {
    const d = (rnd() + rnd() + rnd() - 1.5) * 9;
    img.data.set([r + d, g + d, b + d * 1.1, 255], i * 4);
  }
  x.putImageData(img, 0, 0);
  // a few long fibres, light and dark
  for (let i = 0; i < 70; i++) {
    const px = rnd() * N, py = rnd() * N, ang = rnd() * Math.PI, len = 6 + rnd() * 18;
    x.strokeStyle = rnd() < 0.5 ? 'rgba(255,252,240,0.35)' : 'rgba(120,95,60,0.10)';
    x.lineWidth = 0.6;
    for (const o of [0, N, -N]) {
      x.beginPath();
      x.moveTo(px + o, py);
      x.lineTo(px + o + Math.cos(ang) * len, py + Math.sin(ang) * len);
      x.stroke();
    }
  }
  return (paperTex = c);
};
let hatchTex: HTMLCanvasElement | null = null;
const hatchCanvas = () => {
  if (hatchTex) return hatchTex;
  const c = document.createElement('canvas');
  c.width = c.height = 10;
  const x = c.getContext('2d')!;
  x.strokeStyle = 'rgba(43,33,25,0.55)';
  x.lineWidth = 1.6;
  for (const o of [-10, 0, 10]) (x.beginPath(), x.moveTo(o, 10), x.lineTo(o + 10, 0), x.stroke());
  return (hatchTex = c);
};
/** A pattern for map-space fills that stays locked to device pixels. */
const patternFor = (c: CanvasRenderingContext2D, L: Lay, tex: HTMLCanvasElement) => {
  const p = c.createPattern(tex, 'repeat')!;
  p.setTransform(new DOMMatrix([1 / L.a, 0, 0, 1 / L.a, -L.e / L.a, -L.f / L.a]));
  return p;
};

// ------------------------------------------------------------------ layout

export const buildPaths = (m: FMap) => {
  const paths: Path2D[] = [], bb = new Float32Array(m.n * 4);
  m.regions.forEach((r, i) => {
    const p = new Path2D();
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const poly of r.polys)
      for (const ring of poly) {
        // a ring that jumps across the map (Russia and Fiji cross the antimeridian) is cut there into pieces, each closed
        // along its own map edge, so no line runs across the whole world
        const L = ring.length, jump = (k: number) => Math.abs(ring[(k + 1) % L][0] - ring[k][0]) > m.width / 2;
        let k0 = 0;
        while (k0 < L && !jump((k0 + L - 1) % L)) k0++;
        if (k0 === L) k0 = 0;
        for (let n = 0; n < L; n++) {
          const k = (k0 + n) % L, [x, z] = ring[k];
          if (n === 0 || jump((k + L - 1) % L)) (n && p.closePath(), p.moveTo(x, z));
          else p.lineTo(x, z);
          x0 = Math.min(x0, x), x1 = Math.max(x1, x), z0 = Math.min(z0, z), z1 = Math.max(z1, z);
        }
        p.closePath();
      }
    paths.push(p);
    bb.set([x0, z0, x1, z1], i * 4);
  });
  return {paths, bb};
};

/** Fit the map into a card (device px) under a printed title strip. */
const fit = (m: FMap, P: {paths: Path2D[]; bb: Float32Array}, card: Card, dpr: number, title: string, sub: string): Lay => {
  const [x0, z0, x1, z1] = m.bbox, cw = card.w / dpr, ch = card.h / dpr;
  const padX = cw * 0.045, padT = Math.max(30, ch * 0.12), padB = ch * 0.06;
  const s = Math.min((cw - 2 * padX) / (x1 - x0), (ch - padT - padB) / (z1 - z0));
  const ox = card.x / dpr + (cw - (x1 - x0) * s) / 2, oy = card.y / dpr + padT + (ch - padT - padB - (z1 - z0) * s) / 2;
  const a = s * dpr, e = (ox - x0 * s) * dpr, f = (oy - z0 * s) * dpr;
  const tiny: number[] = [];
  for (let i = 0; i < m.n; i++) if (Math.max(P.bb[i * 4 + 2] - P.bb[i * 4], P.bb[i * 4 + 3] - P.bb[i * 4 + 1]) * s < 8) tiny.push(i);
  return {m, ...P, card, dpr, a, e, f, s, lw: m.n > 200 ? 0.7 : m.n > 70 ? 0.85 : 1.1, tiny, title, sub, lpx: 10, labels: []};
};
const mapT = (c: CanvasRenderingContext2D, L: Lay) => c.setTransform(L.a, 0, 0, L.a, L.e, L.f);
const box = (L: Lay, i: number, pad = 0): [number, number, number, number] => [L.bb[i * 4] - pad, L.bb[i * 4 + 1] - pad, L.bb[i * 4 + 2] - L.bb[i * 4] + 2 * pad, L.bb[i * 4 + 3] - L.bb[i * 4 + 1] + 2 * pad];
const hole = (lift: number) => `rgba(26,18,12,${0.9 * lift})`;
/** The card in map units. Fills and stains are cut to it, so a region that runs far off the map (Russia, out to the Pacific) never hands
 *  the canvas a rect or an arc thousands of card-widths wide; a Discord viewer saw Russia's settled ink vanish and flash back on erase (2026-11-26). */
const view = (L: Lay) => {
  const x = (L.card.x - L.e) / L.a, y = (L.card.y - L.f) / L.a;
  return [x, y, x + L.card.w / L.a, y + L.card.h / L.a] as const;
};
const inView = (L: Lay, [x, y, w, h]: [number, number, number, number]): [number, number, number, number] => {
  const [vx0, vy0, vx1, vy1] = view(L), x0 = Math.max(x, vx0), y0 = Math.max(y, vy0);
  return [x0, y0, Math.max(0, Math.min(x + w, vx1) - x0), Math.max(0, Math.min(y + h, vy1) - y0)];
};
/** Distance from a stain origin to the farthest card corner: a stain this big covers every visible point of its region. */
const reach = (L: Lay, ox: number, oz: number) => {
  const [x0, y0, x1, y1] = view(L);
  return Math.hypot(Math.max(Math.abs(ox - x0), Math.abs(ox - x1)), Math.max(Math.abs(oz - y0), Math.abs(oz - y1)));
};

// ------------------------------------------------------------------ layers

/** Paper over the whole card, then every region's settled ink (and Kempe's lifted holes). */
const drawBase = (c: CanvasRenderingContext2D, L: Lay, st: InkState) => {
  mapT(c, L);
  c.globalCompositeOperation = 'source-over';
  c.fillStyle = patternFor(c, L, paperCanvas());
  c.fillRect((L.card.x - L.e) / L.a, (L.card.y - L.f) / L.a, L.card.w / L.a, L.card.h / L.a);
  // each fill also strokes its own edge (1 px, under the border) so two neighbors never leave a light antialiasing seam
  c.lineWidth = 1 / L.s;
  c.globalCompositeOperation = 'multiply';
  for (let i = 0; i < L.m.n; i++) if (st.to[i] >= 0) (c.fillStyle = c.strokeStyle = INKS[st.to[i]]), c.fill(L.paths[i], 'evenodd'), c.stroke(L.paths[i]);
  c.globalCompositeOperation = 'source-over';
  for (let i = 0; i < L.m.n; i++) if (st.lift[i] > 0) (c.fillStyle = c.strokeStyle = hole(st.lift[i])), c.fill(L.paths[i], 'evenodd'), c.stroke(L.paths[i]);
};

/** One region with its stain at k (from the origin), wetness and lift, painted over whatever is there. */
const drawRegion = (c: CanvasRenderingContext2D, L: Lay, paper: CanvasPattern, i: number, from: number, to: number, k: number, dry: number, lift: number, o?: [number, number, number]) => {
  const r = L.m.regions[i], [ox, oz, rad0] = o ?? [r.label[0], r.label[1], L.m.rmax[i]], b = inView(L, box(L, i, 2 / L.s)), rad = Math.min(rad0, reach(L, ox, oz));
  c.save();
  mapT(c, L);
  c.clip(L.paths[i], 'evenodd');
  c.fillStyle = paper;
  c.fillRect(...b);
  c.globalCompositeOperation = 'multiply';
  if (from >= 0) (c.fillStyle = INKS[from]), c.fillRect(...b);
  const stain = () => (c.beginPath(), c.arc(ox, oz, Math.max(k * rad * 1.02, 1e-6), 0, 2 * Math.PI));
  if (k > 0 && to !== from) {
    // the new ink replaces the old one: clean paper under the stain, then the ink
    stain();
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = paper;
    c.fill();
    if (to >= 0) (c.globalCompositeOperation = 'multiply'), (c.fillStyle = INKS[to]), c.fill();
  }
  if (dry < 1 && to >= 0) {
    // wet ink reads darker, then dries lighter
    c.globalCompositeOperation = 'multiply';
    c.fillStyle = `rgba(150,120,95,${0.45 * (1 - dry)})`;
    stain();
    c.fill();
  }
  if (lift > 0) (c.globalCompositeOperation = 'source-over'), (c.fillStyle = hole(lift)), c.fillRect(...b);
  c.restore();
  if (k >= 1 && dry >= 1 && (to >= 0 || lift > 0)) {
    // settled: cover the antialiasing seam on the edge, as drawBase does
    c.save();
    mapT(c, L);
    c.lineWidth = 1 / L.s;
    c.globalCompositeOperation = lift > 0 ? 'source-over' : 'multiply';
    c.strokeStyle = lift > 0 ? hole(lift) : INKS[to];
    c.stroke(L.paths[i]);
    c.restore();
  }
};

const caps = (c: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, L: Lay, align: CanvasTextAlign, weight = 600, alpha = 0.78) => {
  c.font = `${weight} ${px * L.dpr}px Inter, system-ui, sans-serif`;
  c.textAlign = align;
  c.textBaseline = 'alphabetic';
  if ('letterSpacing' in c) (c as unknown as {letterSpacing: string}).letterSpacing = `${0.14 * px * L.dpr}px`;
  c.fillStyle = `rgba(43,33,25,${alpha})`;
  c.fillText(text.toUpperCase(), x, y);
  if ('letterSpacing' in c) (c as unknown as {letterSpacing: string}).letterSpacing = '0px';
};

/** Borders, printed labels, the title strip and the neat line (transparent layer above the ink). */
const drawLines = (c: CanvasRenderingContext2D, L: Lay) => {
  mapT(c, L);
  c.lineJoin = 'round';
  c.strokeStyle = BORDER;
  c.lineWidth = L.lw / L.s;
  for (const p of L.paths) c.stroke(p);
  c.setTransform(1, 0, 0, 1, 0, 0);
  const {x, y, w, h} = L.card, d = L.dpr, px = Math.min(11, Math.max(9, (w / d) * 0.012));
  // neat line: a thin double frame like a printed sheet
  c.strokeStyle = 'rgba(43,33,25,0.55)';
  c.lineWidth = d;
  const inset = Math.round(Math.min(w, h) * 0.022);
  c.strokeRect(x + inset + 0.5, y + inset + 0.5, w - 2 * inset - 1, h - 2 * inset - 1);
  c.lineWidth = 0.5 * d;
  c.strokeRect(x + inset + 3.5 * d, y + inset + 3.5 * d, w - 2 * inset - 7 * d, h - 2 * inset - 7 * d);
  const ty = y + inset + 3.5 * d + Math.max(15, h / d * 0.06) * d;
  caps(c, L.title, x + inset + 12 * d, ty, px * 1.1, L, 'left', 700, 0.85);
  caps(c, L.sub, x + w - inset - 12 * d, ty, px * 0.9, L, 'right', 600, 0.6);
  // labels where they fit (US states by code, countries by ISO code, small synthetic maps by number); drawn per frame
  // in drawOverlays so the text can turn light on dark inks
  const label = (i: number) => {
    const r = L.m.regions[i];
    if (r.id === 'SEA') return '';
    if (/^C\d+$/.test(r.id)) return L.m.n <= 16 ? r.id.slice(1) : '';
    return r.id;
  };
  L.lpx = Math.max(8, Math.min(L.m.n <= 16 ? 15 : 10.5, L.s * 0.012)) * d;
  c.font = `600 ${L.lpx}px Inter, system-ui, sans-serif`;
  L.labels = [];
  for (let i = 0; i < L.m.n; i++) {
    const t = label(i);
    if (!t) continue;
    const [, , bw, bh] = box(L, i), tw = c.measureText(t).width;
    if (bw * L.a < tw + 10 * d || bh * L.a < L.lpx * 1.8 || Math.sqrt(L.m.regions[i].area) * L.a < tw * 1.7) continue;
    L.labels.push({i, t, x: L.a * L.m.regions[i].label[0] + L.e, y: L.a * L.m.regions[i].label[1] + L.f});
  }
};

/** Shared border polylines of two regions (map units): segments of a's rings whose ends are both vertices of b. Shared arcs
 *  carry identical coordinates in these maps. ponytail: a sliver region wedged between two others could fool the end test. */
const sharedBorder = (m: FMap, a: number, b: number) => {
  const key = (q: number[]) => `${Math.round(q[0] * 1e6)},${Math.round(q[1] * 1e6)}`, onB = new Set<string>(), out: number[][][] = [];
  for (const poly of m.regions[b].polys) for (const ring of poly) for (const q of ring) onB.add(key(q));
  for (const poly of m.regions[a].polys)
    for (const ring of poly) {
      let cur: number[][] | null = null;
      ring.forEach((p, k) => {
        const q = ring[(k + 1) % ring.length];
        if (onB.has(key(p)) && onB.has(key(q))) {
          if (cur && cur[cur.length - 1] === p) cur.push(q);
          else out.push((cur = [p, q]));
        } else cur = null;
      });
    }
  return out;
};

/** Overlays and the tiny-region dots; returns true while something still moves (a flash). */
const drawOverlays = (c: CanvasRenderingContext2D, L: Lay, st: InkState, ov: Overlay, now: number, seen: Map<string, number>, shared: Map<string, number[][][]>) => {
  let moving = false;
  const d = L.dpr, px = (v: number) => v / L.s;
  const outline = (i: number, w: number, alpha: number, color = GOLD) => {
    c.globalAlpha = alpha;
    c.strokeStyle = BORDER;
    c.lineWidth = px(w + 2.2);
    c.stroke(L.paths[i]);
    c.strokeStyle = color;
    c.lineWidth = px(w);
    c.stroke(L.paths[i]);
    c.globalAlpha = 1;
  };
  const hatch = (i: number, alpha: number) => {
    c.save();
    c.clip(L.paths[i], 'evenodd');
    c.globalAlpha = alpha;
    c.fillStyle = patternFor(c, L, hatchCanvas());
    c.fillRect(...inView(L, box(L, i, px(2))));
    c.restore();
  };
  /** 1 = steady; flashes for the first 2.4 s after a key first appears */
  const flash = (key: string) => {
    if (!seen.has(key)) seen.set(key, now);
    const age = (now - seen.get(key)!) / 1000;
    if (age >= 2.4) return 1;
    moving = true;
    return 0.55 + 0.45 * Math.cos(age * Math.PI * 2 * 1.4);
  };
  mapT(c, L);
  c.lineJoin = 'round';
  c.lineCap = 'round';
  for (const i of ov.hot) hatch(i, 0.9);
  const live = new Set<string>();
  for (const [i, j] of ov.clashes) {
    const k = `${Math.min(i, j)}-${Math.max(i, j)}`;
    live.add(k);
    if (!shared.has(k)) shared.set(k, sharedBorder(L.m, i, j));
    const segs = shared.get(k)!, a = flash(k);
    c.globalAlpha = 0.9;
    c.strokeStyle = BORDER;
    c.lineWidth = px(6);
    if (!segs.length) c.setLineDash([px(5), px(4)]);
    const trace = () => {
      c.beginPath();
      if (segs.length) for (const s of segs) s.forEach((q, n) => (n ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])));
      else {
        // not neighbors on the map (an edge Kempe added): join their label points
        const [p, q] = [L.m.regions[i].label, L.m.regions[j].label];
        c.moveTo(p[0], p[1]);
        c.lineTo(q[0], q[1]);
      }
    };
    trace();
    c.stroke();
    c.globalAlpha = 0.35 + 0.65 * a;
    c.strokeStyle = GOLD;
    c.shadowColor = 'rgba(255,214,90,0.95)';
    c.shadowBlur = 9 * d * a;
    c.lineWidth = px(3 + 1.6 * a);
    trace();
    c.stroke();
    c.shadowBlur = 0;
    c.setLineDash([]);
    if (ov.callout) {
      const pts = segs.length ? segs.flat() : [L.m.regions[i].label, L.m.regions[j].label];
      const cx = pts.reduce((t, q) => t + q[0], 0) / pts.length, cz = pts.reduce((t, q) => t + q[1], 0) / pts.length;
      const r = Math.max(px(20), ...pts.map((q) => Math.hypot(q[0] - cx, q[1] - cz) + px(12)));
      for (const [color, w, al] of [[BORDER, 4.5, 0.75], [GOLD, 2.2, 0.55 + 0.45 * a]] as const) {
        c.globalAlpha = al;
        c.strokeStyle = color;
        c.lineWidth = px(w);
        c.beginPath();
        c.arc(cx, cz, r, 0, 2 * Math.PI);
        c.stroke();
      }
    }
    c.globalAlpha = 1;
  }
  for (const k of [...seen.keys()]) if (!live.has(k) && !k.startsWith('s')) seen.delete(k);
  if (st.mark) for (const i of st.mark.r) outline(i, 1.6, 0.85 * st.mark.k, '#f3ead6');
  if (st.chain) for (const i of st.chain.regions) outline(i, 2, st.chain.k);
  if (st.stuck) {
    const k = `s${st.stuck.r}`;
    hatch(st.stuck.r, st.stuck.k);
    outline(st.stuck.r, 2.6, st.stuck.k * (0.4 + 0.6 * flash(k)));
  } else for (const k of [...seen.keys()]) if (k.startsWith('s')) seen.delete(k);
  if (ov.hover >= 0) {
    c.strokeStyle = BORDER;
    c.lineWidth = px(2.4);
    c.stroke(L.paths[ov.hover]);
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.font = `600 ${L.lpx}px Inter, system-ui, sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  for (const {i, t, x, y} of L.labels) {
    const ink = st.k[i] >= 0.6 ? st.to[i] : st.from[i];
    c.fillStyle = (ink >= 0 && ink !== 1) || st.lift[i] > 0.5 ? 'rgba(255,247,230,0.94)' : 'rgba(43,33,25,0.8)';
    c.fillText(t, x, y);
  }
  // tiny regions (islands, microstates, DC) get a dot so they can be seen and tapped
  c.setTransform(1, 0, 0, 1, 0, 0);
  for (const i of L.tiny) {
    const [lx, lz] = L.m.regions[i].label;
    c.beginPath();
    c.arc(L.a * lx + L.e, L.a * lz + L.f, (L.m.n > 200 ? 1.9 : 2.6) * d, 0, 2 * Math.PI);
    c.fillStyle = st.lift[i] > 0.5 ? '#1a120c' : st.to[i] >= 0 ? INKS[st.to[i]] : PAPER;
    c.fill();
    c.lineWidth = 0.9 * d;
    c.strokeStyle = BORDER;
    c.stroke();
  }
  return moving;
};

// ------------------------------------------------------------------ the on-screen renderer

export type Renderer = ReturnType<typeof createRenderer>;

export const createRenderer = (canvas: HTMLCanvasElement) => {
  const ctx = canvas.getContext('2d')!;
  const base = document.createElement('canvas'), bctx = base.getContext('2d')!;
  const lines = document.createElement('canvas'), lctx = lines.getContext('2d')!;
  let L: Lay | null = null, P: {paths: Path2D[]; bb: Float32Array} | null = null, m: FMap | null = null, title = '', sub = '';
  let baked = new Int16Array(0), paper: CanvasPattern | null = null, bpaper: CanvasPattern | null = null, cssW = 0, cssH = 0;
  const seen = new Map<string, number>(), shared = new Map<string, number[][][]>();

  const layout = () => {
    if (!m || !P || !cssW) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = Math.round(cssW * dpr), H = Math.round(cssH * dpr);
    for (const c of [canvas, base, lines]) (c.width = W), (c.height = H);
    L = fit(m, P, {x: 0, y: 0, w: W, h: H}, dpr, title, sub);
    paper = patternFor(ctx, L, paperCanvas());
    bpaper = patternFor(bctx, L, paperCanvas());
    lctx.clearRect(0, 0, W, H);
    drawLines(lctx, L);
    baked = new Int16Array(m.n).fill(-99);
  };

  return {
    setMap(map: FMap, t: string, s: string) {
      if (map !== m) (m = map), (P = buildPaths(map)), seen.clear(), shared.clear();
      title = t;
      sub = s;
      layout();
    },
    resize(w: number, h: number) {
      cssW = w;
      cssH = h;
      layout();
    },
    /** Fonts arrived: redraw the printed text. */
    relayout: () => layout(),
    /** Draw one frame; true while anything still animates. */
    draw(st: InkState, ov: Overlay, now: number) {
      if (!L || !paper) return false;
      const n = L.m.n, active: number[] = [], live = new Uint8Array(n);
      let stale = 0;
      for (let i = 0; i < n; i++) {
        const settled = st.k[i] >= 1 && st.dry[i] >= 1 && (st.lift[i] === 0 || st.lift[i] === 1);
        if (!settled) active.push(i), (live[i] = 1);
        else if (baked[i] !== (st.to[i] + 1) * 2 + st.lift[i]) stale++;
      }
      if (stale > n / 4) {
        // many changes (a seek, a new map): redraw the settled layer from scratch
        drawBase(bctx, L, st);
        for (let i = 0; i < n; i++) baked[i] = (st.to[i] + 1) * 2 + st.lift[i];
      } else if (stale)
        for (let i = 0; i < n; i++) {
          const key = (st.to[i] + 1) * 2 + st.lift[i];
          if (live[i] || baked[i] === key) continue;
          drawRegion(bctx, L, bpaper!, i, st.to[i], st.to[i], 1, 1, st.lift[i]);
          baked[i] = key;
        }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(base, 0, 0);
      for (const i of active) drawRegion(ctx, L, paper, i, st.from[i], st.to[i], st.k[i], st.dry[i], st.lift[i], ov.origin?.get(i));
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(lines, 0, 0);
      const moving = drawOverlays(ctx, L, st, ov, now, seen, shared);
      return moving || active.length > 0;
    },
    /** Region under a css-px point, or -1. Tiny regions win when the tap lands near their dot. */
    hit(x: number, y: number) {
      if (!L) return -1;
      const mx = (x * L.dpr - L.e) / L.a, mz = (y * L.dpr - L.f) / L.a;
      const nearTiny = (r: number) => {
        let best = -1, bd = r;
        for (const i of L!.tiny) {
          const [lx, lz] = L!.m.regions[i].label, dd = Math.hypot(lx - mx, lz - mz) * L!.s;
          if (dd < bd) (best = i), (bd = dd);
        }
        return best;
      };
      // ponytail: a fixed 10 px magnet for regions under 8 px; pinch-zoom is the real fix for tiny regions on phones
      const t = nearTiny(10);
      if (t >= 0) return t;
      mapT(ctx, L);
      let hit = -1;
      for (let i = 0; i < L.m.n && hit < 0; i++) {
        const [x0, z0, w, h] = box(L, i);
        if (mx >= x0 && mx <= x0 + w && mz >= z0 && mz <= z0 + h && ctx.isPointInPath(L.paths[i], x * L.dpr, y * L.dpr, 'evenodd')) hit = i;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return hit >= 0 ? hit : nearTiny(20);
    },
    /** Map coordinates of a css-px point, and how far a stain from there must spread to cover region i. */
    stainFrom(i: number, x: number, y: number): [number, number, number] {
      if (!L) return [0, 0, 1];
      const mx = (x * L.dpr - L.e) / L.a, mz = (y * L.dpr - L.f) / L.a;
      let r = 1e-4;
      for (const poly of L.m.regions[i].polys) for (const ring of poly) for (const q of ring) r = Math.max(r, Math.hypot(q[0] - mx, q[1] - mz));
      return [mx, mz, r];
    },
  };
};

// ------------------------------------------------------------------ PNG export

const wordmark = (c: CanvasRenderingContext2D, x: number, y: number, h: number) => {
  // the channel logo (gold ring, chalk pi) and POPPERISH, right-aligned at x, vertically centred on y
  c.font = `${h * 0.62}px "Archivo Black", Inter, sans-serif`;
  if ('letterSpacing' in c) (c as unknown as {letterSpacing: string}).letterSpacing = `${h * 0.1}px`;
  c.textAlign = 'right';
  c.textBaseline = 'middle';
  c.fillStyle = '#ece9e2';
  c.fillText('POPPERISH', x, y + h * 0.04);
  const tw = c.measureText('POPPERISH').width, cx = x - tw - h * 0.85, r = h * 0.5;
  if ('letterSpacing' in c) (c as unknown as {letterSpacing: string}).letterSpacing = '0px';
  c.strokeStyle = '#ffd23f';
  c.lineWidth = h * 0.09;
  c.beginPath();
  c.arc(cx, y, r - c.lineWidth / 2, 0, 2 * Math.PI);
  c.stroke();
  c.strokeStyle = '#ece9e2';
  c.lineCap = 'round';
  c.lineWidth = h * 0.11;
  c.beginPath();
  c.moveTo(cx - r * 0.42, y - r * 0.3);
  c.lineTo(cx + r * 0.42, y - r * 0.3);
  c.moveTo(cx - r * 0.2, y - r * 0.3);
  c.lineTo(cx - r * 0.2, y + r * 0.42);
  c.moveTo(cx + r * 0.2, y - r * 0.3);
  c.lineTo(cx + r * 0.2, y + r * 0.42);
  c.stroke();
};

/** The current map as a PNG (1920x1080 by default): the paper card on a dark desk, a caption and the Popperish wordmark.
 *  public/og-four-color.png is this at 1200x630 (the US map, exact search, four inks), quantized to 256 colors. */
export const exportPng = (map: FMap, st: InkState, ov: Overlay, title: string, sub: string, caption: string, W = 1920, H = 1080) => {
  const k = H / 1080, c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d')!;
  const bg = x.createRadialGradient(W / 2, H * 0.42, 100, W / 2, H * 0.5, W * 0.75);
  bg.addColorStop(0, '#221b14');
  bg.addColorStop(1, '#0b0a08');
  x.fillStyle = bg;
  x.fillRect(0, 0, W, H);
  const card = {x: Math.round((W - 1350 * k) / 2), y: Math.round(54 * k), w: Math.round(1350 * k), h: Math.round(900 * k)};
  x.save();
  x.shadowColor = 'rgba(0,0,0,0.6)';
  x.shadowBlur = 60 * k;
  x.shadowOffsetY = 18 * k;
  x.fillStyle = PAPER;
  x.fillRect(card.x, card.y, card.w, card.h);
  x.restore();
  const L = fit(map, buildPaths(map), card, 1.25 * k, title, sub);
  x.save();
  x.beginPath();
  x.rect(card.x, card.y, card.w, card.h);
  x.clip();
  drawBase(x, L, {...st, to: Int8Array.from(st.to, (c, i) => (st.k[i] >= 0.5 ? c : st.from[i]))});
  x.setTransform(1, 0, 0, 1, 0, 0);
  const vig = x.createRadialGradient(card.x + card.w / 2, card.y + card.h * 0.45, card.h * 0.35, card.x + card.w / 2, card.y + card.h / 2, card.w * 0.62);
  vig.addColorStop(0, 'rgba(120,90,60,0)');
  vig.addColorStop(1, 'rgba(120,90,60,0.22)');
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = vig;
  x.fillRect(card.x, card.y, card.w, card.h);
  x.globalCompositeOperation = 'source-over';
  drawLines(x, L);
  drawOverlays(x, L, st, {...ov, hover: -1}, 1e12, new Map(), new Map());
  x.restore();
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.font = `500 ${24 * k}px Inter, sans-serif`;
  if ('letterSpacing' in x) (x as unknown as {letterSpacing: string}).letterSpacing = '0px';
  x.textAlign = 'left';
  x.textBaseline = 'middle';
  x.fillStyle = 'rgba(236,233,226,0.72)';
  x.fillText(caption, card.x, H - 63 * k);
  wordmark(x, card.x + card.w, H - 63 * k, 40 * k);
  return new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
};
