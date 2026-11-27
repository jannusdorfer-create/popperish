// Get lost: one walker on the {7,3} paving (camera follows her or stays home), then 1,000 at once beside a flat floor.
// The maths is in escher-sim.ts (shared with check.ts), the scenes in escher-draw.ts; this file wires them to the page.
import {COSH_ESC, COSH_IN, Crowd, FACTS, FlatCrowd, GENS, P, apply, between, boostTo, eye, fix, inv, locate, mul, paving, ringOf, towards, type M3, type V3} from './escher-sim.ts';
import {COL, caption, diskIn, drawCrowd, drawFlat, drawFountain, drawPaving, drawWalker, mount, type Disk} from './escher-draw.ts';
import {mulberry32} from './npc-sim.ts';
import {facade} from './videos.ts';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const rng = mulberry32((Date.now() ^ (Math.random() * 2 ** 32)) >>> 0);
const num = (n: number, d = 0) => n.toLocaleString('en-US', {minimumFractionDigits: d, maximumFractionDigits: d});
const pct = (a: number, b: number) => `${b ? ((100 * a) / b).toFixed(1) : '0.0'}%`;
const label = (c: HTMLCanvasElement, s: string) => c.setAttribute('aria-label', s);
const O = Float64Array.of(0, 0, 1);
const centre = (m: M3): V3 => Float64Array.of(m[2], m[5], m[8]);
const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
// every stone out to ring 8 from a reference stone: enough to cover the disk from whichever stone holds the camera
const PAVE = paving(8).frames;

// ------------------------------------------------------------------ 1. get lost
{
  const canvas = $<HTMLCanvasElement>('walk-canvas'), go = $<HTMLButtonElement>('walk-go'), follow = $<HTMLButtonElement>('walk-follow');
  const speeds = [...document.querySelectorAll<HTMLButtonElement>('.chip[data-speed]')], note = $('walk-note');
  // Everything is kept in the camera's frame (camera at the origin) and moved when the camera moves, so the numbers we draw stay small
  // however far she wanders. W is her stone in the home frame, used only to tell how far from home she is.
  let Lw = eye(), Ln = eye(), Lh = eye(), A = eye(), W = eye(), Wn = eye(), trail: V3[] = [];
  let walking = false, u = 0, steps = 0, ended: '' | 'home' | 'gone' = '', following = true, stepDur = 0.42, raf = 0, last = 0;
  const at = new Float64Array(3);
  const walkerAt = () => (walking && !reduce ? between(centre(Lw), centre(Ln), ease(u), at) : (at.set(centre(Lw)), at));
  const paint = mount(canvas, (s) => {
    const d: Disk = diskIn(0, 0, s.w, s.h);
    s.g.fillStyle = COL.bg;
    s.g.fillRect(0, 0, s.w, s.h);
    const h = centre(Lh);
    drawPaving(s, d, PAVE, A, h);
    drawFountain(s, d, h);
    drawWalker(s, d, trail, walkerAt(), ended === 'home');
  });
  const readout = () => {
    const ring = ringOf(centre(W));
    $('walk-hud').textContent = $('walk-steps').textContent = num(steps);
    $('walk-ring').textContent = String(ring);
    $('walk-state').textContent = ended === 'home' ? `Home, step ${steps}` : ended === 'gone' ? 'Lost' : steps ? 'Wandering' : 'At the fountain';
    label(canvas, `The paving seen from above, ${following ? 'the view following the walker' : 'the view centred on the fountain'}. After ${steps} steps she is ${ring} stones from home. ${note.textContent}`);
  };
  const say = (s: string) => ((note.textContent = s), readout());
  const button = () => (go.textContent = walking ? 'Stop' : steps ? 'Get lost again' : 'Get lost');
  const pick = () => {
    const g = GENS[Math.floor(rng() * P)];
    Ln = mul(Lw, g);
    Wn = mul(W, g);
  };
  // after each step: is she home, or past the point of no return?
  const arrive = () => {
    Lw = fix(Ln);
    W = fix(Wn);
    steps++;
    trail.push(centre(Lw));
    if (trail.length > 400) trail.shift();
    const t = W[8];
    if (t < COSH_IN) {
      ended = 'home';
      say(steps === 2
        ? `Home on step 2: one step out and straight back over the same edge. About half of all homecomings happen like this, on step 2. Our engine sent out a million walkers and only ${FACTS.homePct}% ever came home.`
        : `Home on step ${steps}. She found the fountain again, which only ${FACTS.homePct}% of our million walkers ever did. The latest homecoming among them was on step ${FACTS.lastReturn}.`);
    } else if (t > COSH_ESC) {
      ended = 'gone';
      say(`Lost after ${steps} steps, ${ringOf(centre(W))} stones from the fountain. Out here every step away opens up more new stones than she could search, and fewer than one walker in a million ever gets back from this far, so we stop counting her. That is how ${(100 - FACTS.homePct).toFixed(2)}% of our million ended.`);
    } else readout();
    if (ended) ((walking = false), button());
    else pick();
  };
  // Move the camera a fraction f of the way to point q (camera coordinates): a pure boost, applied to everything we hold.
  const moveCamera = (q: V3, f: number) => {
    const B = inv(boostTo(towards(q, f)));
    Lw = fix(mul(B, Lw)), (Ln = fix(mul(B, Ln))), (Lh = fix(mul(B, Lh))), (A = fix(mul(B, A)));
    trail = trail.map((v) => apply(B, v));
  };
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (walking) {
      u += dt / stepDur;
      while (walking && u >= 1) ((u -= 1), arrive());
      if (!walking) u = 0;
    }
    const q = following ? walkerAt() : centre(Lh), off = Math.acosh(Math.max(1, q[2]));
    if (off > 1e-5) moveCamera(Float64Array.from(q), reduce ? 1 : 1 - Math.exp(-dt / (following ? 0.09 : 0.28)));
    A = locate(A, O);
    paint();
    raf = walking || off > 1e-4 ? requestAnimationFrame(frame) : 0;
  };
  const run = () => raf || ((last = performance.now()), (raf = requestAnimationFrame(frame)));
  go.addEventListener('click', () => {
    if (walking) {
      walking = false;
      u = 0;
      say(`Stopped after ${steps} steps, ${ringOf(centre(W))} stones from the fountain.`);
      button();
      return;
    }
    // a fresh walk from the fountain; the camera starts there too
    Lw = eye(), (Lh = eye()), (A = eye()), (W = eye()), (trail = [centre(Lw)]), (steps = 0), (u = 0), (ended = '');
    walking = true;
    pick();
    say('She sets off from the fountain. Every step she crosses one of the seven edges of her stone, picked at random.');
    button();
    run();
  });
  follow.addEventListener('click', () => {
    following = !following;
    follow.setAttribute('aria-pressed', String(following));
    readout();
    run();
  });
  speeds.forEach((b) =>
    b.addEventListener('click', () => {
      stepDur = +b.dataset.speed!;
      speeds.forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
    }),
  );
  trail = [];
  readout();
}

// ------------------------------------------------------------------ 2. lose 1,000 people
{
  const N = 1000, canvas = $<HTMLCanvasElement>('crowd-canvas'), go = $<HTMLButtonElement>('crowd-go'), note = $('crowd-note');
  let H = new Crowd(N), F = new FlatCrowd(N), hOrder = new Int32Array(N).fill(-1), fOrder = new Int32Array(N).fill(-1);
  let s = 0, raf = 0, last = 0, half = 6, running = false, layer: HTMLCanvasElement | null = null, layerKey = '';
  // the two scenes side by side when there is room, stacked on a phone
  const layout = (w: number, h: number) => {
    const side = w > h * 1.25, top = 26;
    const a = side ? {x: 0, y: top, w: w / 2, h: h - top} : {x: 0, y: top, w, h: h / 2 - top};
    const b = side ? {x: w / 2, y: top, w: w / 2, h: h - top} : {x: 0, y: h / 2 + top, w, h: h / 2 - top};
    return {a, b, side};
  };
  // The paving behind the crowd never moves (home-centred), so it is drawn once per size into its own canvas.
  const paved = (d: Disk, w: number, h: number) => {
    const dpr = Math.min(devicePixelRatio || 1, 2), key = `${w}x${h}@${dpr}`;
    if (layer && layerKey === key) return layer;
    layer = document.createElement('canvas');
    layer.width = Math.round(w * dpr);
    layer.height = Math.round(h * dpr);
    const g = layer.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPaving({g, w, h}, d, PAVE, eye(), O);
    drawFountain({g, w, h}, d, O);
    layerKey = key;
    return layer;
  };
  const paint = mount(canvas, (S) => {
    const {g, w, h} = S, L = layout(w, h), d = diskIn(L.a.x, L.a.y, L.a.w, L.a.h);
    g.fillStyle = COL.bg;
    g.fillRect(0, 0, w, h);
    g.drawImage(paved(d, w, h), 0, 0, w, h);
    const u = running ? s - Math.floor(s) : 1;
    drawCrowd(S, d, H, reduce ? 1 : u, hOrder);
    drawFlat(S, L.b, F, F.t < FACTS.flatSteps ? u : 1, half, fOrder);
    const lx = (r: {x: number; w: number; h: number}) => r.x + Math.max(12, (r.w - Math.min(r.w, r.h)) / 2 + 12);
    caption(S, 'Heptagon paving', lx(L.a), L.a.y - 8);
    caption(S, 'Flat square floor', lx(L.b), L.b.y - 8);
  });
  const readout = () => {
    $('crowd-hud').textContent = num(Math.min(F.t, FACTS.flatSteps));
    $('crowd-home').textContent = pct(H.homeCount, N);
    $('crowd-gone').textContent = pct(H.goneCount, N);
    $('crowd-flat').textContent = pct(F.homeCount, N);
    label(canvas, `A thousand walkers on the heptagon paving and a thousand on a flat floor, after ${Math.min(F.t, FACTS.flatSteps)} steps. Paving: ${H.homeCount} home, ${H.goneCount} lost. Flat floor: ${F.homeCount} home.`);
  };
  const tick = () => {
    if (H.wandering) {
      let k = H.homeCount;
      H.step(rng);
      for (let i = 0; i < N; i++) if (H.home[i] === H.t) hOrder[i] = k++;
      if (!H.wandering)
        note.textContent = `The paving is decided after ${H.t} steps: ${H.homeCount} of your 1,000 came home (${pct(H.homeCount, N)}), the other ${H.goneCount} are lost for good. Our engine lost a million: ${FACTS.homePct}% came home. The flat floor keeps going.`;
    }
    if (F.t < FACTS.flatSteps) {
      let k = F.homeCount;
      F.step(rng);
      for (let i = 0; i < N; i++) if (F.home[i] === F.t) fOrder[i] = k++;
    }
  };
  const finish = () => {
    running = false;
    go.textContent = 'Lose 1,000 more';
    note.textContent = `After ${FACTS.flatSteps} steps on the flat floor ${F.homeCount} of 1,000 had come home (${pct(F.homeCount, N)}; our engine: ${FACTS.flatHomePct}% of a million), and on a flat floor the rest would get there too, given long enough. On the paving ${pct(H.homeCount, N)} came home, all of them early, and the rest never will.`;
  };
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // slow while the first ones find their way back, then faster and faster: 1,000 steps take about 16 seconds
    const rate = Math.min(110, 3 + 0.55 * s);
    const target = reduce ? FACTS.flatSteps : Math.min(FACTS.flatSteps, s + rate * dt);
    while (Math.floor(target) > F.t) tick();
    s = target;
    half += (Math.max(6, 2.6 * Math.sqrt(F.t + 1)) - half) * Math.min(1, dt * 3);
    if (reduce) half = 2.6 * Math.sqrt(F.t + 1);
    readout();
    if (F.t >= FACTS.flatSteps) finish();
    paint();
    raf = running ? requestAnimationFrame(frame) : 0;
  };
  go.addEventListener('click', () => {
    cancelAnimationFrame(raf);
    H = new Crowd(N), (F = new FlatCrowd(N)), hOrder.fill(-1), fOrder.fill(-1), (s = 0), (half = 6);
    running = true;
    go.textContent = 'Start again';
    note.textContent = 'A thousand people set off from each fountain. Watch who comes back.';
    last = performance.now();
    raf = requestAnimationFrame(frame);
  });
  readout();
}

// ------------------------------------------------------------------ 3. the rings
{
  const top = Math.log10(FACTS.rings[10]);
  $('rings-body').innerHTML = FACTS.rings
    .slice(1)
    .map((n, i) => {
      const f = FACTS.flatRings[i + 1], w = (v: number) => `${((Math.log10(v) / top) * 100).toFixed(1)}%`;
      return `<tr><th scope="row">${i + 1}</th><td><span class="bar" style="--w:${w(n)}" aria-hidden="true"></span>${num(n)}</td><td><span class="bar flat" style="--w:${w(f)}" aria-hidden="true"></span>${num(f)}</td></tr>`;
    })
    .join('');
}

// ------------------------------------------------------------------ facts and the video
{
  const half = Math.round((FACTS.homeStep2Pct / FACTS.homePct) * 100);
  const cards = [
    {big: `${FACTS.homePct}%`, text: `of a million walkers on the paving ever came home. The other ${(100 - FACTS.homePct).toFixed(2)}% wandered off for good.`, part: 'Our engine'},
    {big: 'Step 2', text: `is when ${half}% of the homecomers made it: one step out, and straight back over the same edge.`, part: 'Our engine'},
    {big: `Step ${FACTS.lastReturn}`, text: 'was the latest anyone came home. After that nobody did, out of a million.', part: 'Our engine'},
    {big: `${FACTS.flatHomePct}%`, text: `came home within ${num(FACTS.flatSteps)} steps on a flat square floor, and on a flat floor every walker gets home in the end.`, part: 'Flat floor'},
  ];
  $('facts').innerHTML = cards.map((c) => `<article class="fact"><b>${c.big}</b><p>${c.text}</p><small>${c.part}</small></article>`).join('');
  $('cta-screen').append(facade({id: 'Y9s7lhzff4w', slug: 'escher-world', title: 'Could You Get Lost Forever In An Escher World?', date: '2026-11-26T12:13:58Z', thumb: '/thumbs/escher-world.webp', blurb: ''}));
  $('watch-cta').remove();
}
