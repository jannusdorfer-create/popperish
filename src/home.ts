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
