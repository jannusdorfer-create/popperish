// Grow a railway: a swarm of simulated slime agents on the GPU (slime-draw.ts) over three worlds (slime-sim.ts): Kanto with 36 oat
// flakes, a dish you draw on, and a maze. The numbers in "What our engine found" come from the facts the data file carries.
import {Physarum, drawOverlay, MAX_OATS, type OatDraw, type Params} from './slime-draw.ts';
import {GuideRun, Tero, corridorWidth, dropOat, freeWorld, gridSize, mazeNet, mazeWorld, paintLight, scatter, toGrid, tokyoWorld, MAZE_PATHS, MAZE_ROUTES, type Net, type Pt, type RunData, type SlimeData, type World} from './slime-sim.ts';
import {mulberry32} from './npc-sim.ts';
import {facade, loadVideos, watchUrl} from './videos.ts';

// The episode's YouTube ID. Swap in the real 11-character ID at release; until then every "watch" button links to the channel.
const VIDEO_ID = 'PSPw22_F4lo';

type Mode = 'tokyo' | 'free' | 'maze';
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const num = (n: number, d = 0) => n.toLocaleString('en-US', {minimumFractionDigits: d, maximumFractionDigits: d});
// a phone gets a smaller grid and swarm; the governor below trims either further if frames run long
const small = innerWidth < 620 || (matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820);
const GRID_W = small ? 640 : 960, SIDE = small ? 320 : 768, K = GRID_W / 960;
const STEPS_PER_SEC = 120, HOURS = 26, STEPS_PER_HOUR = (24 * STEPS_PER_SEC) / HOURS; // 26 dish hours in about 24 s at 1x
const tune = import.meta.env.DEV ? Object.fromEntries(new URLSearchParams(location.hash.slice(1))) : {};
const params = (): Params => ({sa: 0.6, ra: 0.55, so: 10 * K, ss: 1.3 * K, tw: 1, sw: 6, gw: 8, jit: 0.03, dep: 1, diff: 0.55, decay: 0.93, starve: 0.05, k: 0.07, lambda: 60 * K, sat: 0.15, ...Object.fromEntries(Object.entries(tune).map(([k, v]) => [k, +v])) });

// Phases (tokyo, free): the slime first spreads out, avoiding its own trail and following the scent of the oats, then its trail
// starts to attract and the fan condenses into veins. The numbers are tunable in dev through the URL hash.
const T = {p1: 5, p2: 3, tw0: -1, tw1: 0.6, sw0: 4, sw1: 0.5, g0: 5, gd: 15, gw: 10, ...Object.fromEntries(Object.entries(tune).filter(([k]) => /^(p1|p2|tw0|tw1|sw0|sw1|g0|gd|gw)$/.test(k)).map(([k, v]) => [k, +v]))};
const phase = (steps: number) => {
  const v = Math.max(0, Math.min(1, (steps / STEPS_PER_SEC - T.p1) / T.p2));
  return v * v * (3 - 2 * v);
};

async function main() {
  const [D, RUN]: [SlimeData, RunData] = await Promise.all([fetch('/data/slime/slime.json').then((r) => r.json()), fetch('/data/slime/tokyo-run.json').then((r) => r.json())]);
  const F = D.facts;
  const stage = $('stage'), glCanvas = $<HTMLCanvasElement>('slime-gl'), ov = $<HTMLCanvasElement>('slime-ov'), note = $('slime-note'), hud = $('hud');
  const {w: GW, h: GH} = gridSize(D.arena, GRID_W);
  const fill = (id: string, v: string) => document.querySelectorAll<HTMLElement>(`[data-fact="${id}"]`).forEach((el) => (el.textContent = v));
  fill('oats', String(F.cities));
  fill('dish', String(F.dishCm));

  const of = (n: number) => `${num(n)} of ${num(F.runs)}`;
  const cards = [
    {big: of(F.beat.cost), text: `grown networks used less track than the real railway. The median needed ${F.slime.cost.toFixed(2)} times the cheapest possible network, the railway ${F.rail.cost.toFixed(2)} times (${num(Math.round(F.rail.km))} km against a cheapest ${num(Math.round(F.mst.km))} km).`, part: 'Cost'},
    {big: of(F.beat.trips), text: 'gave shorter trips between the cities than the railway, so none beat it on all three measures: cost, trips and what happens when one link breaks.', part: 'Trips'},
    {big: of(F.beat.ft), text: `were harder to break: one cut at a random point leaves every city connected ${Math.round(F.rail.ft * 100)}% of the time on the railway, ${Math.round(F.slime.ft * 100)}% for the median network. Per kilometre of track, ${of(F.beat.alpha)} were tougher.`, part: 'Breaking'},
    {big: `${F.maze.won} of ${F.maze.seeds}`, text: `model slimes kept the shortest of ${F.maze.routes} routes through the maze. The longest route is ${F.maze.ratio.toFixed(2)} times as long as the shortest.`, part: 'Maze'},
  ];
  $('facts').innerHTML = cards.map((c) => `<article class="fact"><b>${c.big}</b><p>${c.text}</p><small>${c.part}</small></article>`).join('');

  let sim: Physarum;
  try {
    sim = new Physarum(glCanvas, GW, GH, SIDE, params());
  } catch {
    note.textContent = 'This simulation needs WebGL 2, which this browser does not have. Try a recent Chrome, Firefox or Safari.';
    stage.classList.add('broken');
    return;
  }
  const worlds: Partial<Record<Mode, World>> = {};
  const worldFor = (m: Mode) => (worlds[m] ??= m === 'tokyo' ? tokyoWorld(D, GW, GH) : m === 'maze' ? mazeWorld(GW, GH) : freeWorld(GW, GH));
  const rng = mulberry32((Date.now() ^ (Math.random() * 2 ** 32)) >>> 0);
  const rail = D.rail.map(([a, b, c, d]) => {
    const p = toGrid(D.arena, GW, GH, a, b), q = toGrid(D.arena, GW, GH, c, d);
    return [p.x, p.y, q.x, q.y];
  });

  let mode: Mode = 'tokyo', world: World, oats: OatDraw[] = [], speed = reduce ? 0 : 1, steps = 0, acc = 0, showRail = false, bornAt = 0;
  let tero: Tero | null = null, net: Net | null = null, teroT = 0, teroAcc = 0, guideCanvas: HTMLCanvasElement | null = null, guideAt = 0, rowsF = SIDE, grow = 0;
  let lastRead = 0;

  // ---------------------------------------------------------------- tube networks, drawn as the agents' guide
  // Tokyo follows the widths of our engine's run; the maze follows the tube rule running here. Both are lines of grey on a
  // quarter-size canvas (brighter = wider tube) that the agents sense like trail.
  const runGuide = new GuideRun(RUN);
  const runPts = Array.from({length: RUN.nodes.length / 2}, (_, i) => toGrid(D.arena, GW, GH, RUN.nodes[2 * i], RUN.nodes[2 * i + 1]));
  const runWidths = new Float32Array(runGuide.n);
  const guideCtx = () => {
    guideCanvas ??= Object.assign(document.createElement('canvas'), {width: Math.ceil(GW / 4), height: Math.ceil(GH / 4)});
    return guideCanvas.getContext('2d')!;
  };
  const paintGuide = (pts: Pt[], ends: ArrayLike<number>, widths: ArrayLike<number>, lw: number) => {
    const g = guideCtx();
    g.fillStyle = '#000';
    g.fillRect(0, 0, guideCanvas!.width, guideCanvas!.height);
    g.lineCap = 'round';
    g.lineWidth = lw / 4;
    for (let i = 0; i < widths.length; i++) {
      if (widths[i] < 0.002) continue;
      const v = Math.round(255 * Math.sqrt(Math.min(1, widths[i])));
      const a = pts[ends[2 * i]], b = pts[ends[2 * i + 1]];
      g.strokeStyle = `rgb(${v},${v},${v})`;
      g.beginPath();
      g.moveTo(a.x / 4, a.y / 4);
      g.lineTo(b.x / 4, b.y / 4);
      g.stroke();
    }
    sim.setGuide(guideCanvas);
  };
  const mazeEnds = (n: Net) => n.edges.flatMap((e) => [e.a, e.b]);
  let mazeEndsArr: number[] = [];
  const tagAlive = (tag: string) => {
    const idx = net!.edges.flatMap((e, i) => (e.tag === tag ? [i] : []));
    return idx.reduce((s, i) => s + tero!.D[i], 0) / idx.length > 0.05;
  };
  const mazeStatus = () => {
    if (!tero || !net) return {routes: Object.keys(MAZE_ROUTES).length, dead: 6};
    return {routes: Object.values(MAZE_ROUTES).filter((tags) => tags.every(tagAlive)).length, dead: Object.keys(MAZE_PATHS).filter((t) => t.startsWith('dead') && tagAlive(t)).length};
  };

  // ---------------------------------------------------------------- loading a world
  const SAY: Record<Mode, string> = {
    tokyo: `The slime starts at Tokyo. There is an oat flake at each of ${F.cities} cities, and the sea, the lakes and the high mountains are lit: the slime keeps out of the light, as it did in the real dish.`,
    free: 'Click or tap to drop an oat flake. Drag to paint light, which the slime keeps out of. The slime starts in the middle.',
    maze: 'Two oat flakes, four routes between them, and dead ends. First the slime fills every corridor.',
  };
  const load = (m: Mode) => {
    mode = m;
    world = m === 'free' ? freeWorld(GW, GH) : worldFor(m);
    const pts = m === 'maze' ? scatter(world.blocked, GW, SIDE * SIDE, rng) : null;
    const r = 7 * K;
    sim.P = params();
    sim.setWorld(world, (i) => {
      if (pts) return pts[i];
      const a = rng() * 6.2832, d = Math.sqrt(rng()) * r;
      return {x: world.start.x + Math.cos(a) * d, y: world.start.y + Math.sin(a) * d};
    });
    sim.setSpawn([world.start]);
    sim.clearGuide();
    sim.oatsChanged();
    steps = acc = 0;
    grow = m === 'maze' ? 1 : 0.04;
    teroT = teroAcc = 0;
    tero = null;
    net = null;
    bornAt = performance.now();
    if (m === 'maze') {
      net = mazeNet(GW, GH);
      mazeEndsArr = mazeEnds(net);
      tero = new Tero(net, 0.2, rng);
    }
    oats = world.oats.map((p, i) => ({p, reached: m === 'maze', born: bornAt + 250 + i * (m === 'tokyo' ? 55 : 0)}));
    if (m === 'maze') sim.reached = [true, true];
    stage.dataset.mode = m;
    document.querySelectorAll<HTMLButtonElement>('#modes button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    $('rail-row').hidden = m !== 'tokyo';
    note.textContent = SAY[m];
    ov.setAttribute('aria-label', m === 'free' ? 'The dish. Click to drop an oat flake, drag to paint light.' : 'The dish, seen from above.');
    readout();
    draw();
  };

  // ---------------------------------------------------------------- readouts and notes
  const setRead = (k: [string, string, string], v: [string, string, string]) => k.forEach((s, i) => ((($(`rk${i}`) as HTMLElement).textContent = s), (($(`rv${i}`) as HTMLElement).textContent = v[i])));
  let lastMsg = '';
  const say = (s: string) => s !== lastMsg && ((note.textContent = lastMsg = s), true);
  const readout = () => {
    const agents = num(sim.rows * SIDE), n = oats.filter((o) => o.reached).length;
    hud.textContent = `${Math.floor(steps / STEPS_PER_HOUR)}`;
    if (mode === 'tokyo') {
      setRead(['Oat flakes reached', 'Dish hours', 'Agents'], [`${n} of ${oats.length}`, `${Math.floor(steps / STEPS_PER_HOUR)}`, agents]);
      if (steps > 0) say(n === oats.length ? 'The slime has reached every oat flake. Press Reset to grow it again, or lay the real railway over it.' : `The slime has reached ${n} of ${oats.length} oat flakes and is thinning into veins between them. Lay the real railway over it with the red button.`);
    } else if (mode === 'free') {
      setRead(['Oat flakes dropped', 'Reached', 'Agents'], [`${oats.length}`, `${n}`, agents]);
      if (!oats.length) say(SAY.free);
      else say(n === oats.length ? 'It has reached every oat flake. Drop another one, or paint light across its path and watch it go around.' : `Dropped ${oats.length}, reached ${n}. Paint light across a gap and the slime will go around it.`);
    } else {
      const m = mazeStatus();
      setRead(['Routes open', 'Dead ends left', 'Agents'], [`${m.routes}`, `${m.dead}`, agents]);
      if (teroT === 0) say(SAY.maze);
      else if (m.routes === 1 && m.dead === 0) say(`One route is left, and it is the shortest. In our engine, ${F.maze.won} of ${F.maze.seeds} model slimes kept it, and the longest route is ${F.maze.ratio.toFixed(2)} times as long.`);
      else say('Now the tubes that carry little flow are thinning away: the dead ends first, then the long ways round.');
    }
  };

  // ---------------------------------------------------------------- drawing
  const size = () => {
    const r = stage.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2), w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    for (const c of [glCanvas, ov]) if (c.width !== w || c.height !== h) ((c.width = w), (c.height = h));
    return {w, h, dpr, cw: r.width, ch: r.height};
  };
  const draw = () => {
    const {w, h, dpr, cw, ch} = size();
    if (!w) return;
    sim.render(w, h);
    const g = ov.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawOverlay(g, cw, ch, GW, GH, oats, performance.now(), mode === 'tokyo' && showRail ? rail : null, mode === 'tokyo' ? world.start : null, mode === 'free' && !oats.length && steps < 600 ? world.start : null);
  };

  // ---------------------------------------------------------------- the loop
  let last = 0, visible = true, base = 1e9, fast = 0, since = 0, wasDown = 0;
  const win: number[] = [];
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!visible || document.hidden) return;
    if (speed > 0) {
      // governor: if frames run long, update fewer agents; if there is room again, bring them back
      win.push(dt * 1000);
      if (win.length >= 30) {
        const avg = win.reduce((a, b) => a + b, 0) / win.length;
        win.length = 0;
        base = Math.min(base, Math.max(7, avg));
        since++;
        if (avg > Math.max(20, base * 1.45) && since > 1) ((rowsF = Math.max(SIDE * 0.15, rowsF * 0.82)), (since = 0), (fast = 0));
        else if (avg < base * 1.2 && rowsF < SIDE && ++fast > 6) ((rowsF = Math.min(SIDE, rowsF * 1.1)), (fast = 0));
      }
      acc += dt * STEPS_PER_SEC * speed;
      const n = Math.min(Math.floor(acc), 12);
      acc -= Math.floor(acc);
      if (mode !== 'maze' && grow < 1) grow = Math.min(1, grow + (dt * speed) / 8);
      const gs = grow < 1 ? grow * grow * (3 - 2 * grow) : 1;
      sim.rows = Math.max(1, Math.round(Math.max(0.03, gs) * rowsF));
      if (mode !== 'maze') {
        const v = phase(steps);
        sim.P.tw = T.tw0 + (T.tw1 - T.tw0) * v;
        sim.P.sw = T.sw0 + (T.sw1 - T.sw0) * v;
      }
      for (let i = 0; i < n; i++) {
        sim.step();
        steps++;
      }
      if (mode === 'maze' && tero && net) {
        // hold while the slime fills the maze, then let the tubes adapt, slowly enough to watch
        if (steps > STEPS_PER_SEC * 3.5) {
          teroAcc += n * 0.14;
          for (; teroAcc >= 1; teroAcc--) (tero.step(0.1), teroT++);
        }
        if (now - guideAt > 60) ((guideAt = now), paintGuide(net.nodes, mazeEndsArr, tero.D, corridorWidth(GW) * 0.9));
      }
      if (mode === 'tokyo') {
        // after the fan has spread, the swarm starts to follow the run's tubes, and agents off the tubes starve
        const sec = steps / STEPS_PER_SEC, u = sec - T.g0;
        sim.P.gw = T.gw * Math.max(0, Math.min(1, u / 3));
        sim.P.starve = 0.05 * Math.max(0, Math.min(1, (u - 2) / 3));
        if (u > 0 && now - guideAt > 66) {
          guideAt = now;
          runGuide.at(u / T.gd, runWidths);
          paintGuide(runPts, RUN.edges, runWidths, 12 * K);
        }
      }
      if (now - lastRead > 160 && mode !== 'maze' && oats.length) {
        lastRead = now;
        const v = sim.readOats();
        let changed = false;
        oats.forEach((o, i) => {
          if (!o.reached && v[i] > 2.5 && steps > 30) ((o.reached = true), (sim.reached[i] = true), (changed = true));
        });
        if (changed) sim.setSpawn([world.start, ...oats.filter((o) => o.reached).map((o) => o.p)]);
      }
      if (now - wasDown > 120) ((wasDown = now), readout());
    }
    draw();
  };
  new ResizeObserver(draw).observe(stage);
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(stage);

  // ---------------------------------------------------------------- controls
  document.querySelectorAll<HTMLButtonElement>('#modes button').forEach((b) => b.addEventListener('click', () => load(b.dataset.mode as Mode)));
  const speeds = document.querySelectorAll<HTMLButtonElement>('#speed button');
  const setSpeed = (s: number) => {
    speed = s;
    speeds.forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.speed! === s)));
    readout();
  };
  speeds.forEach((b) => b.addEventListener('click', () => setSpeed(+b.dataset.speed!)));
  $('reset').addEventListener('click', () => (load(mode), setSpeed(speed || 1)));
  $<HTMLButtonElement>('rail').addEventListener('click', (e) => {
    showRail = !showRail;
    (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(showRail));
  });

  // free mode: a click drops an oat flake, a drag paints light
  {
    let down: {x: number; y: number; id: number} | null = null, dragged = false, dirty = false;
    const cell = (e: PointerEvent): Pt => {
      const r = ov.getBoundingClientRect();
      return {x: ((e.clientX - r.left) / r.width) * GW, y: ((e.clientY - r.top) / r.height) * GH};
    };
    const brush = () => GW * 0.032;
    const paint = (p: Pt) => {
      if (paintLight(world.blocked, GW, GH, p.x, p.y, brush())) dirty = true;
    };
    ov.addEventListener('pointerdown', (e) => {
      if (mode !== 'free') return;
      down = {x: e.clientX, y: e.clientY, id: e.pointerId};
      dragged = false;
      ov.setPointerCapture(e.pointerId);
    });
    ov.addEventListener('pointermove', (e) => {
      if (!down || e.pointerId !== down.id) return;
      if (!dragged && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 7) {
        dragged = true;
        const r = ov.getBoundingClientRect();
        paint({x: ((down.x - r.left) / r.width) * GW, y: ((down.y - r.top) / r.height) * GH});
      }
      if (dragged) paint(cell(e));
    });
    const up = (e: PointerEvent) => {
      if (!down || e.pointerId !== down.id) return;
      if (!dragged && e.type === 'pointerup') {
        const p = dropOat(world.blocked, GW, GH, cell(e).x, cell(e).y);
        if (p && world.oats.length < MAX_OATS) {
          world.oats.push(p);
          oats.push({p, reached: false, born: performance.now()});
          sim.reached.push(false);
          sim.oatsChanged();
          if (speed === 0) setSpeed(1);
          readout();
        } else if (!p) say('That spot is lit. Oat flakes go on the dark agar.');
      }
      down = null;
    };
    ov.addEventListener('pointerup', up);
    ov.addEventListener('pointercancel', up);
    const flush = () => {
      if (dirty) ((dirty = false), sim.uploadMask());
      requestAnimationFrame(flush);
    };
    flush();
  }

  load('tokyo');
  if (reduce) say('Paused, because your device asks for less motion. Press 1x to start the slime.');
  requestAnimationFrame((t) => ((last = t), frame(t)));
  setSpeed(speed);
  glCanvas.setAttribute('role', 'img');
  glCanvas.setAttribute('aria-label', 'A slime mold growing over a map of Tokyo and its oat flakes, seen from above.');
  $('agents-intro').textContent = num(SIDE * SIDE);
  // debugging in dev only: window.__slime
  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__slime = {sim, load, setSpeed, get steps() { return steps; }};
}

// the episode: once VIDEO_ID is set the buttons go to it, and once scripts/videos.py lists it it plays here
if (/^[\w-]{11}$/.test(VIDEO_ID)) {
  $<HTMLAnchorElement>('watch-top').href = $<HTMLAnchorElement>('watch-cta').href = watchUrl(VIDEO_ID);
  loadVideos().then((all) => {
    const v = all.find((x) => x.id === VIDEO_ID);
    if (!v) return;
    const cta = $('cta'), screen = document.createElement('div');
    screen.className = 'screen';
    screen.append(facade(v));
    cta.classList.add('has-video');
    cta.prepend(screen);
    $('watch-cta').remove();
  });
}

main();
