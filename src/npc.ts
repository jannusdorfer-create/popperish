// Be the NPC: four tests a game character could run from inside its game (drop, wall, swim, twins), live in the browser.
// The rules are in npc-sim.ts (shared with check.ts), the scenes in npc-draw.ts; this file wires them to the page.
import {BALL_R, GAP, WALL, WALK, STEP32, TUNNEL_KMH, crowd, dropTicks, headline, medianCrowd, mulberry32, realFall, swimState, throwBall, throwMany, tunnelFrac, twinsFormula, ulp32, walkSpeed, DT, type Throw} from './npc-sim.ts';
import {drawCrowd, drawDrop, drawMinimap, drawSnap, drawWall, fmtLen, mount} from './npc-draw.ts';
import {facade, loadVideos, watchUrl} from './videos.ts';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const rng = mulberry32((Date.now() ^ (Math.random() * 2 ** 32)) >>> 0);
const num = (n: number, d = 0) => n.toLocaleString('en-US', {minimumFractionDigits: d, maximumFractionDigits: d});
const fill = (el: HTMLInputElement) => el.style.setProperty('--p', `${((+el.value - +el.min) / (+el.max - +el.min)) * 100}%`);
const label = (c: HTMLCanvasElement, s: string) => c.setAttribute('aria-label', s);
const dist = (m: number) => (m < 1000 ? `${num(m)} m` : `${num(m / 1000, 3).replace(/\.?0+$/, '')} km`);

/** A tiny tick clock: calls `step(elapsedSeconds)` every frame until it returns false. One per test, restartable. */
const clock = () => {
  let id = 0;
  const stop = () => (cancelAnimationFrame(id), (id = 0));
  const start = (step: (t: number) => boolean) => {
    stop();
    const t0 = performance.now();
    const f = () => ((id = step((performance.now() - t0) / 1000) ? requestAnimationFrame(f) : 0));
    id = requestAnimationFrame(f);
  };
  return {start, stop};
};

// ------------------------------------------------------------------ 1. drop
{
  const input = $<HTMLInputElement>('drop-in'), canvas = $<HTMLCanvasElement>('drop-canvas'), clk = clock();
  let h = 2, shown = Infinity;
  const paint = mount(canvas, (s) => drawDrop(s, h, shown));
  const hud = (k: number) => ($('drop-tick').textContent = String(Math.min(k, dropTicks(h))).padStart(2, '0'));
  const summary = () => {
    const n = dropTicks(h), tg = n * DT, tr = realFall(h), ms = Math.round(Math.abs(tg - tr) * 1000);
    $('drop-ticks').textContent = String(n);
    $('drop-game').textContent = `${tg.toFixed(3)} s`;
    $('drop-real').textContent = `${tr.toFixed(3)} s`;
    $('drop-note').textContent = `From ${h.toFixed(2)} m the ball lands on tick ${n}, never between two ticks. The game's fall is ${ms} ms ${tg < tr ? 'shorter' : 'longer'} than the real one.`;
    label(canvas, `Falling ball from ${h.toFixed(2)} meters, drawn only on game ticks. It lands on tick ${n}, ${tg.toFixed(3)} seconds; a real fall takes ${tr.toFixed(3)} seconds.`);
    hud(n);
  };
  const update = () => {
    h = +input.value;
    clk.stop();
    fill(input);
    $('drop-val').textContent = `${h.toFixed(2)} m`;
    shown = Infinity;
    summary();
    paint();
  };
  input.addEventListener('input', update);
  $('drop-go').addEventListener('click', () => {
    if (reduce) return update();
    const n = dropTicks(h);
    clk.start((t) => {
      shown = Math.floor(t * 60); // the game's own clock: one tick every 1/60 s
      hud(shown);
      paint();
      if (shown < n) return true;
      update();
      return false;
    });
  });
  update();
}

// ------------------------------------------------------------------ 2. wall
{
  const input = $<HTMLInputElement>('wall-in'), canvas = $<HTMLCanvasElement>('wall-canvas'), clk = clock(), note = $('wall-note');
  let v = 100 / 3.6, phase = 0.35, t: Throw = throwBall(v, phase), shown = Infinity;
  const end = () => (t.hit >= 0 ? t.hit : t.xs.length - 1);
  const paint = mount(canvas, (s) => drawWall(s, t, shown, t.hit >= 0 && shown >= t.hit));
  const hud = () => ($('wall-tick').textContent = String(Math.min(shown, end())).padStart(2, '0'));
  const finished = () => {
    const i = t.xs.findIndex((x, j) => x < -BALL_R && t.xs[j + 1] > (WALL + BALL_R));
    const msg = t.hit >= 0 ? `Hit on tick ${t.hit}: the ball overlaps the wall, so the game stops it.` : i >= 0 ? `Through the wall. On tick ${i} the ball was in front of it, on tick ${i + 1} behind it. No tick ever saw them touch.` : 'The ball never reached the wall.';
    note.textContent = msg;
    label(canvas, `Top view of a ${Math.round(v * 3.6)} kilometer per hour throw at the wall. ${msg}`);
  };
  const setThrow = (p: number) => ((phase = p), (t = throwBall(v, phase)));
  const reset = () => {
    v = +input.value / 3.6;
    clk.stop();
    fill(input);
    $('wall-val').textContent = `${input.value} km/h`;
    const cm = v * DT * 100;
    $('wall-tickcm').textContent = `${cm.toFixed(cm < 10 ? 1 : 0)} cm`;
    $('wall-formula').textContent = `${(tunnelFrac(v) * 100).toFixed(1)}%`;
    $('wall-measured').textContent = '-';
    setThrow(phase);
    shown = Infinity;
    hud();
    note.textContent = +input.value < TUNNEL_KMH ? `Below ${Math.round(TUNNEL_KMH)} km/h one tick covers less than wall plus ball (${(GAP * 100).toFixed(1)} cm), so a throw always touches the wall on some tick.` : `One tick now covers more than wall plus ball (${(GAP * 100).toFixed(1)} cm), so some throws jump the wall between two ticks.`;
    label(canvas, `Top view of a ${input.value} kilometer per hour throw at the wall. ${note.textContent}`);
    paint();
  };
  input.addEventListener('input', reset);
  $('wall-throw').addEventListener('click', () => {
    setThrow(rng());
    shown = 0;
    note.textContent = 'Throwing, in slow motion.';
    if (reduce) return ((shown = Infinity), hud(), finished(), paint());
    clk.start((s) => {
      shown = Math.min(Math.floor(s * 20), end());
      hud();
      paint();
      if (shown < end()) return true;
      finished();
      return false;
    });
  });
  $('wall-step').addEventListener('click', () => {
    clk.stop();
    if (!(shown < end())) (setThrow(rng()), (shown = 0));
    else shown++;
    hud();
    if (shown >= end()) finished();
    else note.textContent = `Tick ${shown}: the game checks the ball against the wall.`;
    paint();
  });
  $('wall-many').addEventListener('click', () => {
    const n = 10000, k = throwMany(v, n, rng), f = tunnelFrac(v);
    $('wall-measured').textContent = `${((k / n) * 100).toFixed(1)}%`;
    note.textContent = `${num(k)} of ${num(n)} throws went through (${((k / n) * 100).toFixed(1)}%). The formula max(0, 1 - ${GAP.toFixed(3)} / (speed / 60)) says ${(f * 100).toFixed(1)}%.`;
  });
  reset();
}

// ------------------------------------------------------------------ 3. swim
{
  const input = $<HTMLInputElement>('swim-in'), mini = $<HTMLCanvasElement>('mini-canvas'), snap = $<HTMLCanvasElement>('snap-canvas'), chips = [...document.querySelectorAll<HTMLButtonElement>('.chip[data-d]')];
  let d = 1, speed = WALK, shown = Infinity, now = 0, visible = true;
  const state = () => swimState(speed);
  const pm = mount(mini, (s) => drawMinimap(s, d, state(), now));
  const ps = mount(snap, (s) => drawSnap(s, d, shown));
  const update = () => {
    speed = walkSpeed(d);
    const st = state(), cm = STEP32 * 100, step = ulp32(d);
    $('swim-val').textContent = dist(d);
    $('swim-step').textContent = fmtLen(step);
    $('swim-speed').textContent = `${speed.toFixed(3)} m/s`;
    $('swim-state').textContent = st === 'fine' ? 'fine' : st === 'frozen' ? 'frozen' : speed > WALK ? 'too fast' : 'too slow';
    chips.forEach((c) => c.setAttribute('aria-pressed', String(+c.dataset.d! === d)));
    const msg =
      st === 'fine' ? `Her walk comes out right: positions here can hold her ${cm.toFixed(1)} cm steps.` :
      st === 'frozen' ? `Every tick her ${cm.toFixed(1)} cm step is smaller than half the smallest step (${fmtLen(step)}), so it rounds to nothing. She cannot move.` :
      `Each tick her ${cm.toFixed(1)} cm step rounds to a multiple of ${fmtLen(step)}, so she walks at ${speed.toFixed(3)} m/s instead of ${WALK}.`;
    $('swim-note').textContent = msg;
    label(snap, `${dist(d)} from the middle. Smallest step ${fmtLen(step)}. Her measured speed is ${speed.toFixed(3)} meters per second. ${msg}`);
    label(mini, `Minimap: ${dist(d)} from the middle of the map.`);
    fill(input);
    shown = reduce ? Infinity : 0;
    pm();
    ps();
  };
  const fromSlider = () => ((d = Math.round(10 ** (+input.value / 100))), update());
  input.addEventListener('input', fromSlider);
  chips.forEach((c) => c.addEventListener('click', () => ((d = +c.dataset.d!), (input.value = String(Math.round(Math.log10(d) * 100))), update())));
  if (!reduce) {
    // the radar sweeps and her ticks replay, only while the test is on screen
    new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(snap);
    const loop = (t: number) => {
      if (visible) {
        now = t;
        shown = Math.min(((t / 1000) * 4) % 16, 13); // 4 ticks a second, then a pause on the last one
        pm();
        ps();
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  update();
}

// ------------------------------------------------------------------ 4. twins
{
  const input = $<HTMLInputElement>('twins-in'), canvas = $<HTMLCanvasElement>('twins-canvas'), clk = clock(), note = $('twins-note');
  let n = 1000, looks: number[] = [], first = 0, shown = 0;
  const paint = mount(canvas, (s) => drawCrowd(s, looks, first, shown, n));
  const update = () => {
    n = Number((100 * 10 ** (+input.value / 100)).toPrecision(3));
    clk.stop();
    fill(input);
    looks = [];
    $('twins-val').textContent = num(n);
    $('twins-count').textContent = '-';
    $('twins-median').textContent = '-';
    $('twins-formula').textContent = twinsFormula(n).toFixed(1);
    note.textContent = `${num(n)} looks. You would expect about ${Math.round(twinsFormula(n))} people before two of them match, not ${num(n)}.`;
    label(canvas, `Empty crowd. ${num(n)} different looks.`);
    paint();
  };
  input.addEventListener('input', update);
  $('twins-go').addEventListener('click', () => {
    const c = crowd(n, rng);
    ({looks, first} = c);
    $('twins-count').textContent = String(c.count);
    const msg = `Person ${c.count} has the same look as person ${first + 1}. That took ${c.count} people out of ${num(n)} looks.`;
    label(canvas, msg);
    if (reduce) return ((shown = Infinity), (note.textContent = msg), paint());
    note.textContent = 'Sending people...';
    shown = 0;
    const rate = Math.max(40, c.count / 1.6);
    clk.start((s) => {
      shown = Math.floor(s * rate);
      paint();
      if (shown < c.count) return true;
      note.textContent = msg;
      return false;
    });
  });
  $('twins-many').addEventListener('click', () => {
    const m = medianCrowd(n, 1000, rng);
    $('twins-median').textContent = num(m, m % 1 ? 1 : 0);
    note.textContent = `Half of 1,000 crowds had a twin within ${num(m, m % 1 ? 1 : 0)} people. The formula 1.1774 × √${num(n)} says ${twinsFormula(n).toFixed(1)}.`;
  });
  update();
}

// ------------------------------------------------------------------ facts and the video
{
  const f = headline();
  const cards = [
    {big: `Tick ${f.dropTick}`, text: `A ball dropped from 2 m always lands on tick ${f.dropTick}. The real fall takes ${(realFall(2) / DT).toFixed(1)} ticks.`},
    {big: `${f.tunnelKmh} km/h`, text: `Above this speed a baseball can jump a 20 cm wall between two ticks.`},
    {big: `${num(f.wrongFromM / 1000)} km`, text: `From here out, a 1.4 m/s walk comes out wrong. From ${num(f.frozenFromM / 1000)} km she cannot move at all.`},
    {big: `${f.twinsMedian1000} people`, text: `With 1,000 different looks, half of all crowds contain a repeated look within this many people.`},
  ];
  $('facts').innerHTML = cards.map((c, i) => `<article class="fact"><b>${c.big}</b><p>${c.text}</p><small>Test ${i + 1}</small></article>`).join('');
}
// the episode plays here once it is out and scripts/videos.py has listed it (slug gta-npc); until then the buttons link to the channel
loadVideos().then((all) => {
  const v = all.find((x) => x.slug === 'gta-npc');
  if (!v) return;
  $<HTMLAnchorElement>('watch-top').href = watchUrl(v.id);
  const cta = $('cta'), screen = document.createElement('div');
  screen.className = 'screen';
  screen.append(facade(v));
  cta.classList.add('has-video');
  cta.prepend(screen);
  $('watch-cta').remove();
});
