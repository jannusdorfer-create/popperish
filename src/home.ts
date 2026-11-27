// The landing: the hero reel, the latest videos, and the four-color card inking itself the first time it comes into view.
import {dateLabel, facade, loadVideos, watchUrl, type Video} from './videos.ts';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&${({'&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot'})[c]};`);
const ICON = {pause: 'M8 5v14M16 5v14', play: 'M7 4.5v15l12-7.5z'};

// ------------------------------------------------------------------ hero reel
// The page ships the poster only; the 2.3 MB reel loads unless the visitor asked for reduced motion or less data.
const reel = document.querySelector<HTMLVideoElement>('.reel video');
const toggle = document.querySelector<HTMLButtonElement>('.reel-toggle');
const saveData = (navigator as Navigator & {connection?: {saveData?: boolean}}).connection?.saveData;
if (reel && toggle && !reduce && !saveData) {
  let paused = false, visible = true;
  const sync = () => (visible && !paused ? reel.play().catch(() => {}) : reel.pause());
  const icon = () => {
    toggle.setAttribute('aria-label', paused ? 'Play the background video' : 'Pause the background video');
    toggle.querySelector('path')!.setAttribute('d', paused ? ICON.play : ICON.pause);
  };
  reel.src = '/reel.mp4';
  new IntersectionObserver(([e]) => ((visible = e.isIntersecting), sync())).observe(reel);
  toggle.addEventListener('click', () => ((paused = !paused), icon(), sync()));
  icon();
  toggle.hidden = false;
}

// ------------------------------------------------------------------ latest videos
const box = document.querySelector<HTMLElement>('#videos .list');
if (box)
  loadVideos().then((all) => {
    if (!all.length) return;
    const [first, ...rest] = all;
    const link = (v: Video) => `<a href="${watchUrl(v.id)}" target="_blank" rel="noreferrer">${esc(v.title)}</a>`;
    box.innerHTML = `
      <article class="feature">
        <div class="screen"></div>
        <div>
          <p class="meta">Newest · ${dateLabel(first.date)}</p>
          <h3>${link(first)}</h3>
          ${first.blurb ? `<p>${esc(first.blurb)}</p>` : ''}
          <div class="btns">
            ${first.sim ? `<a class="btn gold" href="${first.sim}">Run the simulation</a>` : ''}
            <a class="btn" href="${watchUrl(first.id)}" target="_blank" rel="noreferrer">Watch on YouTube</a>
          </div>
        </div>
      </article>
      <ul class="tiles">${rest
        .slice(0, 8)
        .map((v) => `<li class="tile"><div class="screen"></div><h3>${link(v)}</h3><p class="meta">${dateLabel(v.date)}</p>${v.sim ? `<a class="run" href="${v.sim}">Run the simulation</a>` : ''}</li>`)
        .join('')}</ul>`;
    box.querySelectorAll('.screen').forEach((s, i) => s.append(facade(all[i])));
  });

// ------------------------------------------------------------------ the four-color card
// Near the viewport: load the US map and draw it blank. In view: ink it west to east with a four-coloring from our exact
// solver, each state's ink spreading and drying the way it does in the simulation. Reduced motion shows the finished map.
const card = document.querySelector<HTMLElement>('.sim .card');
const canvas = card?.querySelector('canvas');
if (card && canvas) {
  const near = new IntersectionObserver(async ([e]) => {
    if (!e.isIntersecting) return;
    near.disconnect();
    const [{prepMap, exact, replay, sweepOrder, timeTrace, colorsAt, DRY}, {createRenderer}] = await Promise.all([import('./map.ts'), import('./draw.ts')]);
    const raw = await fetch('/data/us_states.json').then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));
    const m = prepMap(raw);
    const inks = replay(exact(m, 4).trace.events, m.n);
    const tt = timeTrace({map: m.name, palette: 4, events: sweepOrder(m).map((r) => ({op: 'paint' as const, r, c: inks[r]}))}, m, {sps: 11, spread: 0.6});
    const r = createRenderer(canvas), ov = {clashes: [], hot: [], hover: -1};
    const END = tt.end + 0.6 + DRY;
    let t = reduce ? END : -1, t0 = 0, id = 0;
    const frame = (now: number) => {
      if (t0) t = Math.min(END, (now - t0) / 1000);
      r.draw(colorsAt(tt, t), ov, now);
      id = t0 && t < END ? requestAnimationFrame(frame) : 0;
    };
    new ResizeObserver(([x]) => (r.resize(x.contentRect.width, x.contentRect.height), r.setMap(m, 'United States', `${m.n} regions · ${m.edges.length} borders`), frame(performance.now()))).observe(card);
    document.fonts?.ready.then(() => (r.relayout(), id || frame(performance.now())));
    requestAnimationFrame(() => canvas.classList.add('on'));
    if (reduce) return;
    const inView = new IntersectionObserver(([v]) => {
      if (!v.isIntersecting) return;
      inView.disconnect();
      t0 = performance.now() + 250; // a beat on the blank map first
      id ||= requestAnimationFrame(frame);
    }, {threshold: 0.6});
    inView.observe(card);
  }, {rootMargin: '600px 0px'});
  near.observe(card);
}

// ------------------------------------------------------------------ the Be the NPC card
// Near the viewport: load the drawing code; in view: the ball from 2 m falls tick by tick, the way the game sees it.
const game = document.querySelector<HTMLElement>('.sim .card.game');
const gcanvas = game?.querySelector('canvas');
if (game && gcanvas) {
  const near = new IntersectionObserver(async ([e]) => {
    if (!e.isIntersecting) return;
    near.disconnect();
    const [{mount, drawDrop}, {dropTicks}] = await Promise.all([import('./npc-draw.ts'), import('./npc-sim.ts')]);
    const land = dropTicks(2);
    let shown = reduce ? Infinity : 0, t0 = 0;
    const paint = mount(gcanvas, (s) => drawDrop(s, 2, shown));
    requestAnimationFrame(() => gcanvas.classList.add('on'));
    if (reduce) return;
    const frame = (now: number) => {
      shown = Math.min(land, Math.floor(((now - t0) / 1000) * 30)); // half speed, so the dots can be followed
      paint();
      if (shown < land) requestAnimationFrame(frame);
    };
    const inView = new IntersectionObserver(([v]) => {
      if (!v.isIntersecting) return;
      inView.disconnect();
      t0 = performance.now() + 400;
      requestAnimationFrame(frame);
    }, {threshold: 0.6});
    inView.observe(game);
  }, {rootMargin: '600px 0px'});
  near.observe(game);
}

// ------------------------------------------------------------------ the Hunt the zeros card
// Near the viewport: load the maths and drawing code; in view: the staircase of primes sharpens as waves are added, one zero at a time.
const hunt = document.querySelectorAll<HTMLElement>('.sim .card.game')[1];
const hcanvas = hunt?.querySelector('canvas');
if (hunt && hcanvas) {
  const near = new IntersectionObserver(async ([e]) => {
    if (!e.isIntersecting) return;
    near.disconnect();
    const [{mount, drawStair}, {Staircase, findZeros, primesUpTo}] = await Promise.all([import('./zeta-draw.ts'), import('./zeta-sim.ts')]);
    const primes = primesUpTo(30), S = new Staircase(30, 0.05, findZeros(0, 140).slice(0, 40)), KMAX = 40;
    let K = reduce ? KMAX : 0, curve = S.at(K), t0 = 0;
    const paint = mount(hcanvas, (s) => drawStair(s, S.xs, curve, primes, 30));
    requestAnimationFrame(() => hcanvas.classList.add('on'));
    if (reduce) return;
    const frame = (now: number) => {
      const u = Math.max(0, Math.min((now - t0) / 7000, 1));
      K = Math.round(KMAX * u * u);
      curve = S.at(K);
      paint();
      if (u < 1) requestAnimationFrame(frame);
    };
    const inView = new IntersectionObserver(([v]) => {
      if (!v.isIntersecting) return;
      inView.disconnect();
      t0 = performance.now() + 500;
      requestAnimationFrame(frame);
    }, {threshold: 0.6});
    inView.observe(hunt);
  }, {rootMargin: '600px 0px'});
  near.observe(hunt);
}

// ------------------------------------------------------------------ the Get lost card
// Near the viewport: load the maths and drawing code; in view: 400 walkers leave the fountain, most fade into the rim, a few come home gold.
const lost = document.querySelectorAll<HTMLElement>('.sim .card.game')[2];
const lcanvas = lost?.querySelector('canvas');
if (lost && lcanvas) {
  const near = new IntersectionObserver(async ([e]) => {
    if (!e.isIntersecting) return;
    near.disconnect();
    const [{mount, drawPaving, drawFountain, drawCrowd, diskIn, COL}, {Crowd, paving, eye}, {mulberry32}] = await Promise.all([import('./escher-draw.ts'), import('./escher-sim.ts'), import('./npc-sim.ts')]);
    const N = 400, pave = paving(7).frames, O = Float64Array.of(0, 0, 1), c = new Crowd(N), order = new Int32Array(N).fill(-1), rng = mulberry32(7);
    let s = 0, t0 = 0;
    const step = () => {
      let k = c.homeCount;
      c.step(rng);
      for (let i = 0; i < N; i++) if (c.home[i] === c.t) order[i] = k++;
    };
    if (reduce) while (c.wandering) step();
    const paint = mount(lcanvas, (S) => {
      const d = diskIn(0, 0, S.w, S.h, 10);
      S.g.fillStyle = COL.bg;
      S.g.fillRect(0, 0, S.w, S.h);
      drawPaving(S, d, pave, eye(), O);
      drawFountain(S, d, O);
      drawCrowd(S, d, c, c.wandering ? s - Math.floor(s) : 1, order);
    });
    requestAnimationFrame(() => lcanvas.classList.add('on'));
    if (reduce) return;
    const frame = (now: number) => {
      s = Math.max(0, (now - t0) / 1000) * 3.2; // three steps a second, so the first ones home can be seen
      while (c.wandering && Math.floor(s) > c.t) step();
      paint();
      if (c.wandering) requestAnimationFrame(frame);
    };
    const inView = new IntersectionObserver(([v]) => {
      if (!v.isIntersecting) return;
      inView.disconnect();
      t0 = performance.now() + 500;
      requestAnimationFrame(frame);
    }, {threshold: 0.6});
    inView.observe(lost);
  }, {rootMargin: '600px 0px'});
  near.observe(lost);
}

// ------------------------------------------------------------------ the Trip Karl card
// Near the viewport: load the stair and the 10,000 stops (a small JSON, no poses); in view: the stops stack up on the treads.
const trip = document.querySelectorAll<HTMLElement>('.sim .card.game')[3];
const tcanvas = trip?.querySelector('canvas');
if (trip && tcanvas) {
  const near = new IntersectionObserver(async ([e]) => {
    if (!e.isIntersecting) return;
    near.disconnect();
    const [{mount, camera, frame, bounds, stairPoints, drawStairs, drawTally, COL}, {tallyOrder}, {mulberry32}] = await Promise.all([import('./fall-draw.ts'), import('./fall-sim.ts'), import('./npc-sim.ts')]);
    const D = await fetch('/data/fall/fall.json').then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));
    const k = camera(6, 12), counts = new Array(D.stairs.risers + 1).fill(0), stops = D.facts.trip.stopCounts as Record<string, number>;
    const order = tallyOrder(stops, mulberry32(11)), max = Math.max(...Object.values(stops));
    let shown = reduce ? order.length : 0, t0 = 0;
    for (let i = 0; i < shown; i++) counts[order[i]]++;
    const paint = mount(tcanvas, (s) => {
      s.g.fillStyle = COL.bg;
      s.g.fillRect(0, 0, s.w, s.h);
      frame(k, bounds(k, stairPoints(D, 3.2)), s.w, s.h, 12);
      drawStairs(s, k, D, false);
      drawTally(s, k, D, counts, max, 1.4);
    });
    requestAnimationFrame(() => tcanvas.classList.add('on'));
    if (reduce) return;
    const frameFn = (now: number) => {
      const u = Math.max(0, Math.min((now - t0) / 4500, 1)), target = Math.round(order.length * (1 - (1 - u) ** 2.2));
      while (shown < target) counts[order[shown++]]++;
      paint();
      if (u < 1) requestAnimationFrame(frameFn);
    };
    const inView = new IntersectionObserver(([v]) => {
      if (!v.isIntersecting) return;
      inView.disconnect();
      t0 = performance.now() + 500;
      requestAnimationFrame(frameFn);
    }, {threshold: 0.6});
    inView.observe(trip);
  }, {rootMargin: '600px 0px'});
  near.observe(trip);
}
