// Trip Karl: real runs of our engine (sims/fall) played back. The data is public/data/fall/ (scripts/fall_data.py); fall-sim.ts
// decodes and eases it, fall-draw.ts paints it; this file wires the page. Every number shown comes from the facts the data carries.
import {Run, newPose, poseGap, stopName, tallyOrder, type Data, type HillRun, type Pose} from './fall-sim.ts';
import {COL, bounds, camera, drawFloor, drawHill, drawKarl, drawStairs, drawTally, frame, mount, proj, stairPoints, tallyBox, terrainFrom, type Cam, type Terrain} from './fall-draw.ts';
import {pill, text, type G2} from './npc-draw.ts';
import {mulberry32} from './npc-sim.ts';
import {facade, loadVideos, watchUrl} from './videos.ts';

// The episode's YouTube ID. Swap in the real 11-character ID at release; until then every "watch" button links to the channel.
const VIDEO_ID = 'YZlJeBRYsG4';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const num = (n: number, d = 0) => n.toLocaleString('en-US', {minimumFractionDigits: d, maximumFractionDigits: d});
const rng = mulberry32((Date.now() ^ (Math.random() * 2 ** 32)) >>> 0);
const sec = (t: number, d = 1) => `${t.toFixed(d)} s`;
const bin = (f: string) => fetch(`/data/fall/${f}`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${f}: ${r.status}`)))).then((b) => new Int16Array(b));
const near = (el: Element, go: () => void) => {
  const io = new IntersectionObserver(([e]) => e.isIntersecting && (io.disconnect(), go()), {rootMargin: '900px 0px'});
  io.observe(el);
};
/** A cached background layer: redrawn only when the canvas size changes. */
const layer = (draw: (s: G2) => void) => {
  let c: HTMLCanvasElement | null = null, key = '';
  return (s: G2) => {
    const dpr = Math.min(devicePixelRatio || 1, 2), k = `${s.w}x${s.h}@${dpr}`;
    if (!c || k !== key) {
      c = document.createElement('canvas');
      c.width = Math.round(s.w * dpr);
      c.height = Math.round(s.h * dpr);
      const g = c.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw({g, w: s.w, h: s.h});
      key = k;
    }
    s.g.drawImage(c, 0, 0, s.w, s.h);
  };
};
/** A clock that runs a scene until `until()` says stop; paint is called every frame. */
const clock = (tick: (dt: number) => boolean) => {
  let raf = 0, last = 0;
  const frameFn = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    raf = tick(dt) ? requestAnimationFrame(frameFn) : 0;
  };
  return {
    start: () => (cancelAnimationFrame(raf), (last = performance.now()), (raf = requestAnimationFrame(frameFn))),
    stop: () => (cancelAnimationFrame(raf), (raf = 0)),
  };
};

async function main() {
  const D: Data = await fetch('/data/fall/fall.json').then((r) => r.json());
  const F = D.facts, ST = D.stairs, PELVIS = D.bodies.indexOf('pelvis');
  const fact: Record<string, string> = {mass: String(F.dummy.massKg), height: F.dummy.heightM.toFixed(2), slope: String(F.hill.slopeDeg), slopeLen: String(F.hill.slopeLength)};
  document.querySelectorAll<HTMLElement>('[data-fact]').forEach((el) => (el.textContent = fact[el.dataset.fact!] ?? el.textContent));
  const pctOf = (k: number) => F.trip.stopPct[String(k)] ?? 0;
  const stairCam = (s: G2, k: Cam) => frame(k, bounds(k, stairPoints(D)), s.w, s.h, 14, 30);
  const treadTop = (step: number) => {
    const hw = ST.width / 2;
    if (step >= ST.risers) return {y: 0, z0: ST.treads * ST.going, z1: ST.treads * ST.going + 1.3, hw};
    return {y: ST.top_height - step * ST.rise, z0: (step - 1) * ST.going, z1: step * ST.going, hw};
  };
  /** Gold outline on the tread (or landing) where a run stopped, with its name. */
  const markTread = (s: G2, k: Cam, step: number, strong: boolean, label: string) => {
    const {g} = s, t = treadTop(step), a = [0, 0];
    g.beginPath();
    [[-t.hw, t.z0], [t.hw, t.z0], [t.hw, t.z1], [-t.hw, t.z1]].forEach(([x, z], i) => (proj(k, x, t.y, z, a), i ? g.lineTo(a[0], a[1]) : g.moveTo(a[0], a[1])));
    g.closePath();
    g.fillStyle = strong ? 'rgba(255,210,63,0.22)' : 'rgba(236,233,226,0.08)';
    g.fill();
    g.strokeStyle = strong ? COL.gold : 'rgba(236,233,226,0.45)';
    g.lineWidth = strong ? 2 : 1;
    g.stroke();
    if (label) {
      proj(k, -t.hw, t.y, (t.z0 + t.z1) / 2, a);
      pill(g, label, a[0] - 8, a[1] + 22, 'right');
    }
  };

  // ------------------------------------------------------------------ 1. trip Karl
  const tripReady = bin(D.files.trip).then((buf) => D.trip.map((r) => ({base: new Run(buf, r, D), twin: new Run(buf, r.twin, D)})));
  {
    const canvas = $<HTMLCanvasElement>('trip-canvas'), slider = $<HTMLInputElement>('trip-in'), go = $<HTMLButtonElement>('trip-go'), twinBtn = $<HTMLButtonElement>('trip-twin'), note = $('trip-note');
    const k = camera(), bg = layer((s) => (stairCam(s, k), drawStairs(s, k, D)));
    let runs: {base: Run; twin: Run}[] = [], sel = 0, mode: 'idle' | 'trip' | 'twin' = 'idle', t = 0, done = false;
    const pa = newPose(), pb = newPose();
    const nearest = (v: number) => D.trip.reduce((best, r, i) => (Math.abs(r.speed - v) < Math.abs(D.trip[best].speed - v) ? i : best), 0);
    const paint = mount(canvas, (s) => {
      stairCam(s, k);
      bg(s);
      if (!runs.length) return;
      const r = D.trip[sel], R = runs[sel];
      if (done && mode === 'trip') markTread(s, k, r.stop, true, stopName(r.stop));
      if (done && mode === 'twin') (markTread(s, k, r.stop, false, ''), markTread(s, k, r.twin.stop, true, stopName(r.twin.stop)));
      if (mode === 'twin') {
        drawKarl(s, k, D, R.base.at(t, pa), {col: COL.ghost, alpha: 0.32});
        drawKarl(s, k, D, R.twin.at(t, pb));
      } else drawKarl(s, k, D, R.base.at(mode === 'idle' ? 0 : t, pa));
    });
    const readout = () => {
      const r = D.trip[sel];
      $('trip-hud').textContent = sec(t);
      $('trip-stop').textContent = done && mode !== 'idle' ? stopName(r.stop) : mode === 'trip' ? '...' : mode === 'twin' ? stopName(r.stop) : '-';
      const rest = mode === 'twin' ? r.twin.rest : r.rest;
      $('trip-rest').textContent = done && mode !== 'idle' ? (rest == null ? 'over 8 s' : sec(rest)) : '-';
      $('trip-twin-stop').textContent = mode === 'twin' ? (done ? stopName(r.twin.stop) : '...') : '-';
      canvas.setAttribute('aria-label', `Karl on a concrete stair seen from the side, walking at ${r.speed.toFixed(3)} m/s. ${note.textContent}`);
    };
    const say = (s: string) => ((note.textContent = s), readout());
    const finish = () => {
      const r = D.trip[sel];
      done = true;
      if (mode === 'trip') {
        say(`${r.hero ? 'This is the run from the video. ' : ''}At ${r.speed.toFixed(3)} m/s Karl stopped on ${stopName(r.stop)}${r.stop === F.trip.mostCommon ? `, the most common place, though only ${pctOf(r.stop)}% of our 10,000 trips stopped there` : `, where ${pctOf(r.stop)}% of our 10,000 trips stopped`}. Now trip him again with everything the same except his speed, a millionth of a metre per second faster.`);
        twinBtn.disabled = false;
      } else {
        const gap = poseGap(runs[sel].base.last(pa), runs[sel].twin.last(pb)), cm = gap * 100, P = F.tripTwins.byPrecision['1e-06'];
        const apart = cm >= 100 ? `${(gap).toFixed(2)} m` : `${cm.toFixed(cm < 1 ? 2 : 0)} cm`;
        say(r.twin.stop !== r.stop
          ? `${r.speed.toFixed(7)} m/s stopped on ${stopName(r.stop)}; ${(r.speed + D.twinDelta).toFixed(7)} m/s stopped on ${stopName(r.twin.stop)}, his parts ${apart} from where they were on average. In our engine twins a millionth apart ended on different treads in ${P.pct_pairs_end_on_different_steps}% of pairs.`
          : `Same tread this time, ${stopName(r.stop)}, but his parts ended ${apart} from the first run on average. Twins a millionth apart ended on different treads in ${P.pct_pairs_end_on_different_steps}% of our pairs and 10 cm or more apart in ${P.pct_pairs_end_10cm_apart}%. Try another speed.`);
      }
      readout();
    };
    const run = clock((dt) => {
      const R = runs[sel], dur = mode === 'twin' ? Math.max(R.base.dur, R.twin.dur) : R.base.dur;
      t = reduce ? dur : Math.min(dur, t + dt);
      if (t >= dur && !done) finish();
      readout();
      paint();
      return t < dur;
    });
    const choose = () => {
      sel = nearest(+slider.value);
      $('trip-val').textContent = `${D.trip[sel].speed.toFixed(3)} m/s`;
      run.stop();
      (mode = 'idle'), (t = 0), (done = false);
      twinBtn.disabled = true;
      say(`The nearest to your speed of the ${D.trip.length} trips on this page, picked by speed from our ${num(F.trip.runs)}${D.trip[sel].hero ? ', and the one from the video' : ''}. Each also has its own stride, heading and arm swing. Press Trip.`);
      paint();
    };
    const play = (m: 'trip' | 'twin') => {
      (mode = m), (t = 0), (done = false);
      say(m === 'trip' ? `Karl walks onto the stair at ${D.trip[sel].speed.toFixed(3)} m/s...` : `The twin, ${(D.trip[sel].speed + D.twinDelta).toFixed(7)} m/s, beside the first run (pale)...`);
      run.start();
    };
    slider.addEventListener('input', choose);
    go.addEventListener('click', () => play('trip'));
    twinBtn.addEventListener('click', () => play('twin'));
    slider.min = String(F.trip.speedLo);
    slider.max = String(F.trip.speedHi);
    tripReady.then((r) => {
      runs = r;
      go.disabled = false;
      choose();
    }, () => say('The runs did not load. Reload the page to try again.'));
  }

  // ------------------------------------------------------------------ 2. 10,000 trips
  {
    const canvas = $<HTMLCanvasElement>('tally-canvas'), go = $<HTMLButtonElement>('tally-go'), note = $('tally-note');
    const k = camera(6, 12), bg = layer((s) => (stairCam(s, k), drawStairs(s, k, D)));
    const counts = new Array(ST.risers + 1).fill(0), max = Math.max(...Object.values(F.trip.stopCounts)), TALL = 1.55;
    let order: number[] = [], shown = 0, done = false;
    const paint = mount(canvas, (s) => {
      stairCam(s, k);
      bg(s);
      drawTally(s, k, D, counts, max, TALL, done ? F.trip.mostCommon : -1);
      // labels at the column tops, biggest first, skipping any that would overlap a column or a label already placed
      const f = `600 ${s.w < 500 ? 11 : 12}px Inter, system-ui, sans-serif`, cols = counts.map((n, step) => ({n, step, ...tallyBox(k, D, step, (TALL * n) / max)})).filter((c) => c.n);
      const boxes = cols.map((c) => c.box);
      s.g.font = f;
      [...cols]
        .sort((a, b) => b.n - a.n)
        .forEach(({n, step, top: [x, y]}) => {
          const label = done ? `${pctOf(step)}%` : num(n), tw = s.g.measureText(label).width;
          const bx = [x - tw / 2 - 2, y - 18, x + tw / 2 + 2, y - 3];
          if (bx[0] < 2 || bx[2] > s.w - 2 || boxes.some((o) => bx[0] < o[2] && bx[2] > o[0] && bx[1] < o[3] && bx[3] > o[1])) return;
          boxes.push(bx);
          text(s.g, label, x, y - 6, step === F.trip.mostCommon && done ? COL.gold : COL.chalk, 'center', f);
        });
    });
    const readout = () => {
      $('tally-hud').textContent = num(shown);
      $('tally-top').textContent = done ? stopName(F.trip.mostCommon) : '-';
      $('tally-top-pct').textContent = done ? `${pctOf(F.trip.mostCommon)}%` : '-';
      $('tally-bottom').textContent = done ? `${F.trip.bottomPct}%` : '-';
    };
    const slowFast = () => {
      const b = Object.entries(F.trip.bySpeed), [lo, hi] = [b[0], b[b.length - 1]];
      return `Walking speed hardly decides it: the slowest walkers (under ${lo[0].split('-')[1]} m/s) stopped on tread ${lo[1].meanStop.toFixed(1)} on average, the fastest (over ${hi[0].split('-')[0]} m/s) on tread ${hi[1].meanStop.toFixed(1)}.`;
    };
    let T = 0;
    const DUR = 5;
    const run = clock((dt) => {
      T = reduce ? DUR : Math.min(DUR, T + dt);
      const u = T / DUR, target = Math.round(order.length * (1 - (1 - u) ** 2.2));
      while (shown < target) counts[order[shown++]]++;
      if (T >= DUR && !done) {
        done = true;
        const steps = Object.keys(F.trip.stopCounts).map(Number), lo = Math.min(...steps), hi = Math.max(...steps);
        note.textContent = `Every stop from ${stopName(lo)} to ${stopName(hi)} happened. The most common, ${stopName(F.trip.mostCommon)}, got only ${pctOf(F.trip.mostCommon)}% of the ${num(F.trip.runs)} trips, and ${F.trip.bottomPct}% went all the way to the bottom. ${slowFast()}`;
        go.textContent = 'Again';
      }
      readout();
      paint();
      return T < DUR;
    });
    const start = () => {
      order = tallyOrder(F.trip.stopCounts, rng);
      counts.fill(0);
      (shown = 0), (T = 0), (done = false);
      note.textContent = `${num(F.trip.runs)} trips, each one a full run of our engine, landing one after another.`;
      run.start();
    };
    go.addEventListener('click', start);
    go.disabled = false;
    readout();
    const io = new IntersectionObserver(([e]) => e.isIntersecting && (io.disconnect(), shown || start()), {threshold: 0.5});
    io.observe(canvas);
  }

  // ------------------------------------------------------------------ 3. the hill
  {
    const canvas = $<HTMLCanvasElement>('hill-canvas'), go = $<HTMLButtonElement>('hill-go'), twinsBtn = $<HTMLButtonElement>('hill-twins'), note = $('hill-note');
    const k = camera(12, 14);
    let terrain: Terrain | null = null, buf: Int16Array | null = null, active: {meta: HillRun; run: Run; label?: string; col?: number[]}[] = [], t = 0, done = false, last = -1, snap = true;
    const poses = [newPose(), newPose()];
    const view = {s: 0, ox: 0, oy: 0};
    const where = (w: string) => (w === 'top' ? 'On top' : w === 'slope' ? 'On the slope' : 'Below the slope');
    const down = (r: HillRun) => (r.where === 'top' ? 'stayed up' : `${r.dist.toFixed(1)} m`);
    /** Frame every active Karl with room around him: at least 8 m of hill, more as the twins spread apart. */
    const aim = (s: G2, dt: number) => {
      const pts: number[][] = [];
      active.forEach((_, i) => {
        const p = poses[i], x = p[PELVIS * 7], y = p[PELVIS * 7 + 1], z = p[PELVIS * 7 + 2];
        for (const [dx, dy, dz] of [[-2.5, -1.6, -3], [2.5, 2.2, 3]]) pts.push([x + dx, y + dy, z + dz]);
      });
      const b = bounds(k, pts), minW = s.w < 500 ? 7 : 9, cw = (b.x0 + b.x1) / 2, ch = (b.y0 + b.y1) / 2;
      const hw = Math.max(minW, b.x1 - b.x0) / 2, hh = Math.max((minW * (s.h - 28)) / s.w, b.y1 - b.y0) / 2;
      frame(k, {x0: cw - hw, x1: cw + hw, y0: ch - hh, y1: ch + hh}, s.w, s.h, 10, 28);
      if (snap || reduce) ((view.s = k.s), (view.ox = k.ox), (view.oy = k.oy), (snap = false));
      else {
        const f = 1 - Math.exp(-dt / 0.45);
        view.s += (k.s - view.s) * f;
        view.ox += (k.ox - view.ox) * f;
        view.oy += (k.oy - view.oy) * f;
      }
      (k.s = view.s), (k.ox = view.ox), (k.oy = view.oy);
    };
    let frameDt = 0;
    const paint = mount(canvas, (s) => {
      s.g.fillStyle = COL.bg;
      s.g.fillRect(0, 0, s.w, s.h);
      if (!terrain || !active.length) return;
      active.forEach((a, i) => a.run.at(t, poses[i]));
      aim(s, frameDt);
      frameDt = 0;
      drawHill(s, k, terrain, F.hill.slopeDeg, F.hill.slopeLength);
      active.forEach((a, i) => drawKarl(s, k, D, poses[i], {col: a.col, label: a.label}));
    });
    const readout = (twins: boolean) => {
      $('hill-hud').textContent = sec(t);
      const [a, b] = active.map((x) => x.meta);
      if (twins) {
        $('hill-k1').textContent = 'A, down the slope';
        $('hill-k2').textContent = 'B, down the slope';
        $('hill-k3').textContent = 'Apart at rest';
        $('hill-v1').textContent = done ? down(a) : '...';
        $('hill-v2').textContent = done ? down(b) : '...';
        $('hill-v3').textContent = done ? `${F.hill.twinsGap} m` : '...';
      } else {
        $('hill-k1').textContent = 'Ended';
        $('hill-k2').textContent = 'Down the slope';
        $('hill-k3').textContent = 'Came to rest';
        $('hill-v1').textContent = a && done ? where(a.where) : a ? '...' : '-';
        $('hill-v2').textContent = a && done ? down(a) : a ? '...' : '-';
        $('hill-v3').textContent = a && done ? (a.rest == null ? 'over 20 s' : sec(a.rest)) : a ? '...' : '-';
      }
    };
    const run = clock((dt) => {
      const dur = Math.max(...active.map((a) => a.run.dur)), twins = active.length > 1;
      t = reduce ? dur : Math.min(dur, t + dt);
      frameDt += dt;
      if (t >= dur && !done) {
        done = true;
        if (twins) {
          const [a, b] = active.map((x) => x.meta);
          note.textContent = `A and B walked at the same speed as far as anyone could ever measure, the same in every other way. A stopped ${down(a)} down the slope, B ${down(b)}${b.where === 'runout' ? ', below the foot of it' : ''}: ${F.hill.twinsGap} m apart. This is the pair from the video, the furthest apart of our ${F.hill.twinsPairs} twin pairs at this precision.`;
        } else {
          const a = active[0].meta, W = F.hill.where;
          note.textContent = a.where === 'top'
            ? `He went down but stayed on the path, like ${W.top}% of our ${num(F.hill.runs)} runs. Press again: most go over.`
            : `Over the edge and ${a.dist.toFixed(1)} m down the slope${a.where === 'runout' ? ', past its foot' : ''}. Of our ${num(F.hill.runs)} runs ${F.hill.overPct}% went over the edge; the middle 80% of those stopped between ${F.hill.dist.p10.toFixed(1)} m and ${F.hill.dist.p90.toFixed(1)} m down, the furthest ${F.hill.dist.max.toFixed(1)} m.`;
        }
      }
      readout(twins);
      paint();
      return t < dur;
    });
    const play = (list: typeof active, msg: string) => {
      active = list;
      (t = 0), (done = false), (snap = true);
      note.textContent = msg;
      run.start();
    };
    go.addEventListener('click', () => {
      let i = Math.floor(rng() * D.hill.length);
      if (i === last) i = (i + 1) % D.hill.length;
      last = i;
      play([{meta: D.hill[i], run: new Run(buf!, D.hill[i], D)}], 'Karl walks along the edge of the path...');
    });
    twinsBtn.addEventListener('click', () => {
      const tw = D.hillTwins;
      play(
        [
          {meta: tw.a, run: new Run(buf!, tw.a, D), label: 'A', col: COL.skin},
          {meta: tw.b, run: new Run(buf!, tw.b, D), label: 'B', col: COL.orange},
        ],
        'Two walks, speeds the same as far as anyone could ever measure, everything else the same. They start as one Karl...',
      );
    });
    near(canvas, () =>
      Promise.all([bin(D.files.hill), bin(D.files.terrain)]).then(([h, tr]) => {
        buf = h;
        terrain = terrainFrom(D.terrain, tr);
        active = [{meta: D.hillHero, run: new Run(buf, D.hillHero, D)}];
        go.disabled = twinsBtn.disabled = false;
        snap = true;
        paint();
      }, () => (note.textContent = 'The hill did not load. Reload the page to try again.')),
    );
  }

  // ------------------------------------------------------------------ 4. measure better?
  {
    const S = F.tripTwins.byPrecision, H = F.hill.byPrecision;
    const unit = (v: number) => {
      const [n, u] = v >= 1e-2 ? [v * 100, 'cm/s'] : v >= 1e-5 ? [v * 1000, 'mm/s'] : v >= 1e-7 ? [v * 1e6, 'µm/s'] : [v * 1e9, 'nm/s'];
      return `${+n.toPrecision(2)} ${u}`;
    };
    // ponytail: rows below 1e-8 m/s are left out: there the solver's own tolerance (~1e-10) sets the split, not the push (same rule as the video)
    const keys = Object.keys(H).filter((k) => k in S && +k >= 1e-8).sort((a, b) => +b - +a);
    $('prec-body').innerHTML = keys
      .map((k) => {
        const a = S[k].pct_pairs_end_on_different_steps, b = H[k].pct_end_1m_apart, tag = +k === 1e-6 ? ' (a millionth)' : +k === 1e-8 ? ' (a hundred-millionth)' : '';
        return `<tr><th scope="row">${unit(+k)}${tag}</th><td><span class="bar flat" style="--w:${a}%" aria-hidden="true"></span>${a}%</td><td><span class="bar" style="--w:${b}%" aria-hidden="true"></span>${b}%</td></tr>`;
      })
      .join('');
    $('prec-note').textContent = `Each row is ${F.tripTwins.pairs} pairs of twins on the stairs and ${F.hill.twinsPairs} on the hill, the same in everything but walking speed. On the hill, knowing his speed a hundred million times better leaves the share of twins ending a metre or more apart where it was. The physicists' name for this is the uncertainty exponent: ${F.tripTwins.alpha} on the stairs, ${F.hill.alpha} on the hill, where 1 would mean ten times better measurement gives ten times fewer surprises, and 0 none at all.`;
  }

  // ------------------------------------------------------------------ 5. the flat floor
  {
    const canvas = $<HTMLCanvasElement>('flat-canvas'), go = $<HTMLButtonElement>('flat-go'), note = $('flat-note');
    const k = camera(), bg = layer((s) => (place(s), drawFloor(s, k, -1.4, 1.4, -2.6, 1.6)));
    const place = (s: G2) => frame(k, bounds(k, [[-0.6, 0, -2.1], [0.6, 0, 0.7], [-0.6, 1.95, 0.2], [0.6, 0, -2.1], [-0.6, 0, 0.7]]), s.w, s.h, 18, 30);
    let runs: Run[] = [], t = 0, playing = false;
    const pose: Pose = newPose();
    const paint = mount(canvas, (s) => {
      place(s);
      bg(s);
      // nine pale Karls under a solid one: if any shove fell differently, a pale one would show
      runs.forEach((r, i) => drawKarl(s, k, D, r.at(playing || t ? t : 0, pose), i < runs.length - 1 ? {col: COL.ghost, alpha: 0.45} : {}));
    });
    const run = clock((dt) => {
      const dur = Math.max(...runs.map((r) => r.dur));
      t = reduce ? dur : Math.min(dur, t + dt);
      $('flat-hud').textContent = sec(t, 2);
      if (t >= dur) {
        playing = false;
        $('flat-hit').textContent = sec(F.flat.firstContact.median, 2);
        $('flat-spread').textContent = `${(F.flat.spreadCm.mean * 10).toFixed(1)} mm`;
        $('flat-runs').textContent = num(F.flat.runs);
        note.textContent = `One Karl, because all ten fell the same way (nine are drawn pale underneath the tenth), though each shove differed by up to ${F.flat.pushJitter * 1000} mm/s. Across all ${num(F.flat.runs)} shoves he hit the floor at ${F.flat.firstContact.median} s every time, and the final poses differed by ${(F.flat.spreadCm.mean * 10).toFixed(1)} mm on average, ${(F.flat.spreadCm.max * 10).toFixed(1)} mm at most. Twins a millionth apart: ${F.flat.twins1e6End10cm}% ended 10 cm apart. With nothing to bounce off, a fall is predictable.`;
      }
      paint();
      return t < dur;
    });
    go.addEventListener('click', () => {
      (t = 0), (playing = true);
      note.textContent = 'Ten shoves at once...';
      run.start();
    });
    near(canvas, () =>
      bin(D.files.flat).then((b) => {
        runs = D.flat.map((e) => new Run(b, e, D));
        go.disabled = false;
        paint();
      }, () => (note.textContent = 'The flat floor did not load. Reload the page to try again.')),
    );
  }

  // ------------------------------------------------------------------ facts and the video
  {
    const P6 = F.tripTwins.byPrecision['1e-06'];
    const cards = [
      {big: `${pctOf(F.trip.mostCommon)}%`, text: `of ${num(F.trip.runs)} trips stopped on ${stopName(F.trip.mostCommon)}, the most common place. Every stop from tread 4 to the bottom landing happened.`, part: 'Stairs'},
      {big: `${P6.pct_pairs_end_on_different_steps}%`, text: 'of twin trips a millionth of a metre per second apart came to rest on different treads.', part: 'Stairs'},
      {big: `${F.hill.twinsGap} m`, text: 'between two walks on the hill whose speeds differed by far less than anything you could measure.', part: 'Hill'},
      {big: sec(F.flat.firstContact.median, 2), text: `is when every one of ${num(F.flat.runs)} shoves on a flat floor hit it. They came to rest within ${(F.flat.spreadCm.max * 10).toFixed(1)} mm of each other.`, part: 'Flat floor'},
    ];
    $('facts').innerHTML = cards.map((c) => `<article class="fact"><b>${c.big}</b><p>${c.text}</p><small>${c.part}</small></article>`).join('');
  }
}

// the episode: once VIDEO_ID is set the buttons go to it, and once scripts/videos.py lists it (slug body-fall) it plays here
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
