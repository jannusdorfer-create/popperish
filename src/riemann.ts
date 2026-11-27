// Hunt the zeros: four live parts (the staircase from waves, the hunt along the line, the near misses, the spacings).
// The maths is in zeta-sim.ts (shared with check.ts), the scenes in zeta-draw.ts; this file wires them to the page.
import {Staircase, Z, findZeros, meanGap, primesUpTo, staircaseMiss, trueSteps, turing} from './zeta-sim.ts';
import {drawHunt, drawPair, drawSpacing, drawStair, mount, poisson, wigner, words, type Hunt, type Pair} from './zeta-draw.ts';
import {facade} from './videos.ts';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const num = (n: number, d = 0) => n.toLocaleString('en-US', {minimumFractionDigits: d, maximumFractionDigits: d});
const fill = (el: HTMLInputElement) => el.style.setProperty('--p', `${((+el.value - +el.min) / (+el.max - +el.min)) * 100}%`);
const label = (c: HTMLCanvasElement, s: string) => c.setAttribute('aria-label', s);
const press = (btns: HTMLButtonElement[], on: (b: HTMLButtonElement) => boolean) => btns.forEach((b) => b.setAttribute('aria-pressed', String(on(b))));
const loadData = fetch('/data/zeta.json').then((r) => (r.ok ? r.json() : Promise.reject(new Error(`zeta.json ${r.status}`))));

// ------------------------------------------------------------------ 1. the staircase from waves
// The zeros are found right here (a few milliseconds below t = 600); each one's wave is computed once, in idle slices, then K is a running sum.
{
  const gammas = findZeros(0, 605).slice(0, 300), primes = primesUpTo(100);
  const S = new Staircase(100, 0.05, gammas), steps = trueSteps(S.xs, primes);
  const input = $<HTMLInputElement>('st-in'), canvas = $<HTMLCanvasElement>('st-canvas'), range = $<HTMLButtonElement>('st-range'), play = $<HTMLButtonElement>('st-play');
  const chips = [...document.querySelectorAll<HTMLButtonElement>('.chip[data-k]')];
  let K = 0, view = 30, curve = S.at(0), raf = 0;
  const paint = mount(canvas, (s) => drawStair(s, S.xs, curve, primes, view));
  const msg = (rise: number) =>
    K === 0 ? 'No waves yet: the gold curve is the smooth average of how primes thin out, with no corners.' :
    K < 10 ? `${K} wave${K > 1 ? 's' : ''}. The step at 7 is rising ${rise.toFixed(2)} of the 1 it should, and most corners are still soft.` :
    K < 100 ? `${K} waves: a corner now sits at every prime, with ripples in between.` :
    `${K} waves: the gold curve hugs the staircase. Each new wave sharpens every corner a little more, and none of them is ever exact.`;
  const update = (k: number) => {
    K = Math.max(0, Math.min(300, Math.round(k)));
    curve = S.at(K);
    input.value = String(K);
    fill(input);
    const rise = curve[105] - curve[95], miss = staircaseMiss(curve, steps, Math.round((view - 2) / 0.05) + 1); // x = 6.75 .. 7.25
    $('st-val').textContent = $('st-k').textContent = $('st-hud').textContent = String(K);
    $('st-rise').textContent = rise.toFixed(2);
    $('st-miss').textContent = miss.toFixed(2);
    $('st-note').textContent = msg(rise);
    label(canvas, `The staircase that counts primes up to ${view}, and the curve built from ${K} waves. ${msg(rise)}`);
    chips.forEach((c) => c.setAttribute('aria-pressed', String(+c.dataset.k! === K)));
    paint();
  };
  const stop = () => (cancelAnimationFrame(raf), (raf = 0), (play.textContent = 'Add the waves'));
  input.addEventListener('input', () => (stop(), update(+input.value)));
  chips.forEach((c) => c.addEventListener('click', () => (stop(), update(+c.dataset.k!))));
  range.addEventListener('click', () => {
    view = view === 30 ? 100 : 30;
    range.textContent = view === 30 ? 'Show up to 100' : 'Show up to 30';
    range.setAttribute('aria-pressed', String(view === 100));
    update(K);
  });
  play.addEventListener('click', () => {
    if (raf) return stop();
    if (reduce) return update(300);
    const from = K >= 300 ? 0 : K, t0 = performance.now(), dur = 9000;
    play.textContent = 'Pause';
    const f = (now: number) => {
      const u = Math.min((now - t0) / dur, 1);
      update(from + (300 - from) * u * u);
      raf = u < 1 ? requestAnimationFrame(f) : 0;
      if (!raf) stop();
    };
    raf = requestAnimationFrame(f);
  });
  update(0);
  const pump = () => S.work(6) && setTimeout(pump, 0);
  setTimeout(pump, 200);
}

// ------------------------------------------------------------------ 2. hunt along the line
let windowZeros: number[] = []; // what part 4 uses for its "Part 2 window" option
let onWindow = () => {};
{
  const input = $<HTMLInputElement>('hunt-in'), canvas = $<HTMLCanvasElement>('hunt-canvas'), note = $('hunt-note');
  const chips = [...document.querySelectorAll<HTMLButtonElement>('.chip[data-t]')];
  let c = 0, gaps = 5, data: Hunt | null = null, pending = 0;
  const span = (at: number) => gaps * meanGap(at), edge = () => Math.max(0, c - span(c) / 2);
  const paint = mount(canvas, (s) => data && drawHunt(s, data));
  const compute = () => {
    const a = edge(), b = a + span(a), tu = turing(a, b);
    const n = Math.max(160, Math.min(900, Math.round((b - a) / (meanGap(b) / 14)))), ts = new Float64Array(n + 1), zs = new Float64Array(n + 1);
    for (let i = 0; i <= n; i++) ((ts[i] = a + ((b - a) * i) / n), (zs[i] = Z(ts[i])));
    const inView = tu.zeros.filter((z) => z >= a && z <= b);
    windowZeros = inView;
    data = {a, b, ts, zs, zeros: tu.zeros, lo: tu.lo, hi: tu.hi};
    $('hunt-val').textContent = `${num(a, a < 100 ? 1 : 0)} to ${num(b, b < 100 ? 1 : 0)}`;
    $('hunt-hud').textContent = num((a + b) / 2, a < 100 ? 1 : 0);
    $('hunt-n').textContent = String(inView.length);
    $('hunt-found').textContent = String(tu.found);
    $('hunt-want').textContent = String(tu.expected);
    const list = inView.slice(0, 4).map((z) => z.toFixed(6)).join(', ') + (inView.length > 4 ? `, and ${inView.length - 4} more` : '');
    const verdict = tu.ok
      ? `None missing: between the two clean marks (t = ${num(tu.lo, tu.lo < 100 ? 2 : 0)} and ${num(tu.hi, tu.hi < 100 ? 2 : 0)}) the count says exactly ${tu.expected} zeros, and we found ${tu.found}.`
      : `The counts differ (${tu.found} found, ${tu.expected} expected). Either a pair of zeros hid between our samples, or this is one of the rare stretches where the rule needs a wider check. Move a little and look again.`;
    note.textContent = `${inView.length ? `Zeros at t = ${list}. ` : 'No zero in view. '}${verdict}`;
    label(canvas, `The wire Z of t from ${num(a, 1)} to ${num(b, 1)} with a bead on each of ${inView.length} zeros. ${verdict}`);
    input.value = String(Math.round(200 * Math.log10(c + 1)));
    fill(input);
    chips.forEach((k) => k.setAttribute('aria-pressed', String(+k.dataset.t! === c)));
    paint();
    onWindow();
  };
  const go = (to: number) => {
    c = Math.max(0, Math.min(1e5, to));
    if (!pending) pending = requestAnimationFrame(() => ((pending = 0), compute()));
  };
  input.addEventListener('input', () => go(10 ** (+input.value / 200) - 1));
  chips.forEach((k) => k.addEventListener('click', () => ((gaps = +k.dataset.t! ? 8 : 5), go(+k.dataset.t!))));
  $('hunt-in-z').addEventListener('click', () => ((gaps = Math.max(3, gaps / 2)), go(c)));
  $('hunt-out-z').addEventListener('click', () => ((gaps = Math.min(48, gaps * 2)), go(c)));
  $('hunt-next').addEventListener('click', () => go(data?.zeros.find((z) => z > c + 1e-6) ?? findZeros(c + 1e-6, c + 8 * meanGap(c + 20))[0] ?? c));
  // drag the picture, or use the arrow keys
  let drag: {x: number; c: number} | null = null;
  canvas.addEventListener('pointerdown', (e) => ((drag = {x: e.clientX, c}), canvas.setPointerCapture(e.pointerId)));
  canvas.addEventListener('pointermove', (e) => drag && go(drag.c - ((e.clientX - drag.x) / canvas.clientWidth) * span(c)));
  canvas.addEventListener('pointerup', () => (drag = null));
  canvas.addEventListener('pointercancel', () => (drag = null));
  canvas.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== '+' && k !== '-' && k !== '=') return;
    e.preventDefault();
    if (k === 'ArrowLeft') go(c - span(c) / 4);
    else if (k === 'ArrowRight') go(c + span(c) / 4);
    else ((gaps = k === '-' ? Math.min(48, gaps * 2) : Math.max(3, gaps / 2)), go(c));
  });
  new ResizeObserver(() => data && compute()).observe(canvas);
  compute();
}

// ------------------------------------------------------------------ 3 and 4 need the stored data
loadData.then((D) => {
  const f = D.facts;
  // ---------------------------------------------------------------- 3. near misses
  {
    const canvas = $<HTMLCanvasElement>('pair-canvas'), chipsP = [...document.querySelectorAll<HTMLButtonElement>('.chip[data-pair]')], chipsV = [...document.querySelectorAll<HTMLButtonElement>('.chip[data-view]')];
    let which: 'lehmer' | 'closest' = 'lehmer', full = false, d: Pair | null = null;
    const paint = mount(canvas, (s) => d && drawPair(s, d));
    const live = (p: {t0: string; dt: number[]}) => p.dt.map((dt) => Z(+p.t0 + dt));
    const maxDiff = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.max(...Array.from(a, (v, i) => Math.abs(v - b[i])));
    const render = () => {
      const p = D[which], v = full ? p.wide : p.zoom, over = live(v), peak = which === 'lehmer' ? f.lehmer_pair_peak_absZ : f.closest_pair_peak_absZ, off = maxDiff(v.z, over);
      const nm = (n: number) => `#${num(n)}`, zeros = [+p.t1, +p.t2] as [number, number];
      d = {t0: +v.t0, dt: v.dt, z: v.z, over, zeros, names: [nm(p.n), nm(p.n + 1)], peak, full};
      const lehmerNote = `Lehmer's pair, found in 1956 near t = 7,005: zeros ${num(p.n)} and ${num(p.n + 1)}, ${p.normGap.toFixed(4)} of a usual gap apart. Between them the wire rises only to ${words(peak)} before turning back.`;
      const ratio = Math.round(f.lehmer_pair_peak_absZ / f.closest_pair_peak_absZ / 100) * 100;
      const oursNote = `Our closest pair among the first ${num(f.zeros_located)} zeros: zeros ${num(p.n)} and ${num(p.n + 1)}, at height about ${num(+p.t1, 2)}, one ${Math.round(1 / p.normGap / 100) * 100}th of a usual gap apart. The wire rises to ${words(peak)}, about ${num(ratio)} times flatter than Lehmer's.`;
      const pct = (off / peak) * 100, agree = `Live double precision agrees with our engine's values to within ${pct < 1 ? 1 : Math.ceil(pct)}% of the rise${pct < 10 ? ', so the live calculation holds up even here' : ', which is too coarse here, so trust the engine'}.`;
      const msg = `${which === 'lehmer' ? lehmerNote : oursNote} ${full ? 'On the usual scale the wire hugs the line here.' : agree}`;
      $('pair-gap').textContent = String(+p.normGap.toPrecision(3));
      $('pair-rise').textContent = words(peak);
      $('pair-note').textContent = msg;
      label(canvas, `The wire between zeros ${num(p.n)} and ${num(p.n + 1)}. ${msg}`);
      press(chipsP, (b) => b.dataset.pair === which);
      press(chipsV, (b) => (b.dataset.view === 'full') === full);
      paint();
    };
    chipsP.forEach((b) => b.addEventListener('click', () => ((which = b.dataset.pair as typeof which), render())));
    chipsV.forEach((b) => b.addEventListener('click', () => ((full = b.dataset.view === 'full'), render())));
    render();
  }
  // ---------------------------------------------------------------- 4. spacings
  {
    const canvas = $<HTMLCanvasElement>('sp-canvas'), chips = [...document.querySelectorAll<HTMLButtonElement>('.chip[data-sp]')], note = $('sp-note');
    let mode: 'all' | 'first' | 'live' = 'all', view: {step: number; hist: number[]; label: string} = {step: 0.02, hist: D.spacing.all.density, label: ''};
    const paint = mount(canvas, (s) => drawSpacing(s, view));
    const share = (hist: ArrayLike<number>, step: number, upTo: number) => Array.from(hist).slice(0, Math.round(upTo / step)).reduce((a, b) => a + b * step, 0);
    const theory = (fn: (s: number) => number, upTo: number) => {
      let a = 0;
      for (let i = 0; i < 400; i++) a += (fn(((i + 0.5) * upTo) / 400) * upTo) / 400;
      return a;
    };
    const pct = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;
    const render = () => {
      let n = 0, msg = '';
      if (mode === 'live') {
        const z = windowZeros, norm: number[] = [];
        for (let i = 1; i < z.length; i++) norm.push(((z[i] - z[i - 1]) * Math.log(z[i - 1] / (2 * Math.PI))) / (2 * Math.PI));
        n = norm.length;
        const step = 0.1, hist = new Array(n < 30 ? 0 : 32).fill(0);
        if (n >= 30) for (const s of norm) if (s < 3.2) hist[Math.floor(s / step)] += 1 / (n * step);
        view = {step, hist, label: `${num(n)} gaps from the Part 2 window`};
        msg = n < 30 ? `The Part 2 window holds only ${num(n)} gaps, too few for a picture. Zoom out there to take in more zeros, or move it up the line.` : `${num(n)} gaps from the zeros you found in Part 2, rescaled so the usual gap is 1. With this few gaps the bars are rough, but the tiny gaps are still missing.`;
      } else {
        const sp = D.spacing, src = mode === 'all' ? sp.all : sp.first10k;
        n = src.n_spacings;
        view = {step: sp.binStep, hist: src.density, label: `${num(n)} gaps from our run`};
        msg = mode === 'all' ? `All ${num(n)} gaps between neighbouring zeros in our run, one bead each. They stay away from tiny gaps and follow the heavy-atom curve closely: the two sit ${sp.all.l1_vs_gue.toFixed(3)} apart on a scale where 0 is identical.` : `The first 10,000 gaps only. The match is rougher (${sp.first10k.l1_vs_gue.toFixed(3)} apart) and gets better the higher you go: ${sp.all.l1_vs_gue.toFixed(3)} for all hundred million.`;
      }
      const ok = n >= 30;
      $('sp-ours').textContent = ok ? pct(share(view.hist, view.step, 0.2)) : '-';
      $('sp-pois').textContent = pct(theory(poisson, 0.2));
      $('sp-wig').textContent = pct(theory(wigner, 0.2));
      note.textContent = msg;
      label(canvas, `Histogram of ${num(n)} gaps between neighbouring zeros against random scatter and the heavy-atom curve. ${msg}`);
      press(chips, (b) => b.dataset.sp === mode);
      paint();
    };
    chips.forEach((b) => b.addEventListener('click', () => ((mode = b.dataset.sp as typeof mode), render())));
    onWindow = () => mode === 'live' && render();
    render();
  }
  // ---------------------------------------------------------------- facts
  {
    const ratio = Math.round(f.lehmer_pair_peak_absZ / f.closest_pair_peak_absZ / 100) * 100, T = Math.round(f.height_T);
    const cards = [
      {big: num(f.zeros_checked), text: `zeros counted by Turing's check, all the way up to height ${num(T)}. Every one sits on the line. A computer check, not a proof.`, part: 'Part 2'},
      {big: num(f.zeros_located), text: `zeros located one by one for the spacing study. The closest neighbours are zeros ${num(f.closest_pair.n)} and ${num(f.closest_pair.n + 1)}.`, part: 'Part 3'},
      {big: `${num(ratio)} times`, text: `closer to not crossing than Lehmer's famous pair: our wire rises ${words(f.closest_pair_peak_absZ)}, his rises ${words(f.lehmer_pair_peak_absZ)}.`, part: 'Part 3'},
      {big: f.spacing_l1_distance_to_gue.toFixed(3), text: `how far the gaps sit from the random-matrix law for all hundred million zeros. For the first 10,000 it was ${D.spacing.first10k.l1_vs_gue.toFixed(3)}.`, part: 'Part 4'},
    ];
    $('facts').innerHTML = cards.map((c) => `<article class="fact"><b>${c.big}</b><p>${c.text}</p><small>${c.part}</small></article>`).join('');
  }
}).catch((e) => {
  for (const id of ['pair-note', 'sp-note']) $(id).textContent = 'The data for this part did not load. Reload the page to try again.';
  console.warn(e);
});

// ------------------------------------------------------------------ the video
{
  const screen = $('cta-screen');
  screen.append(facade({id: '_FfKh9IyhTc', slug: 'riemann', title: 'Did An AI Just Prove The Riemann Hypothesis?', date: '2026-11-24T12:00:00Z', thumb: '/thumbs/riemann.webp', blurb: ''}));
  $('watch-cta').remove();
}
