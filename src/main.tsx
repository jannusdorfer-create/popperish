/// <reference types="vite/client" />
// Popperish site, page one: the four-color map simulation from the video "Every Map Ever Drawn Needs Only Four Colors".
import {StrictMode, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';
import {DRY, INKS, INK_NAMES, blankState, clamp, clashEdges, colorsAt, decodeShare, encodeShare, eventAt, exact, greedy, kempe1879, kempePlain, packColors, prepMap, randomMap, replay, spreadEase, timeForPage, unpackColors, type FMap, type InkState, type MapKey, type RawMap, type Solve, type SolverKey, type Trace, type TraceEvent} from './map.ts';
import {createRenderer, exportPng, type Overlay, type Renderer} from './draw.ts';
import {facade, loadVideos, type Video} from './videos.ts';

const LINKS = {
  video: 'https://youtu.be/dkZ3XVz8Lgc', // "Every Map Ever Drawn Needs Only Four Colors", public 2026-11-23 12:00Z
  channel: 'https://www.youtube.com/channel/UCcpfG1Cvp9cmd9RlyjPU_mQ',
  kofi: 'https://ko-fi.com/popperish',
  discord: '', // no server yet: put the invite link here and the Discord buttons appear
};
const MAPS: Record<MapKey, {label: string; title: string; file?: string}> = {
  us: {label: 'US states', title: 'United States', file: 'us_states'},
  europe: {label: 'Europe', title: 'Europe', file: 'europe'},
  world: {label: 'World', title: 'The world', file: 'world'},
  benelux: {label: 'Benelux', title: 'Benelux and neighbors', file: 'benelux'},
  trap: {label: "Kempe's trap", title: "Kempe's trap", file: 'kempe_fail'},
  random: {label: 'Random', title: 'Random map'},
};
const SOLVER_INFO: Record<SolverKey, {label: string; blurb: string}> = {
  greedy: {label: 'Greedy', blurb: 'Paints west to east. Each region takes the first ink its neighbors leave free. Fast, and often not enough.'},
  kempe: {label: 'Kempe 1879', blurb: 'The famous proof as a recipe: lift off regions with five or fewer neighbors, put them back one by one, and swap two-ink chains to free an ink. His double swap can fail.'},
  exact: {label: 'Exact', blurb: 'Tries every possibility and backs up at dead ends, until it finds a coloring or proves there is none.'},
};
const SPREAD = 0.5, TAIL = 0.9, SPEEDS = [0.5, 1, 2, 4];
type Fact = {value: unknown; say: string; source: string};

const cache = new Map<string, Promise<unknown>>();
const getJson = <T,>(f: string) => {
  if (!cache.has(f)) cache.set(f, fetch(`${import.meta.env.BASE_URL}data/${f}.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${f}.json: ${r.status}`)))));
  return cache.get(f) as Promise<T>;
};
const prepared = new Map<string, FMap>();
const loadMap = async (file: string) => {
  if (!prepared.has(file)) {
    const raw = await getJson<RawMap>(file);
    for (const r of raw.regions) r.name = r.name.replace(/^Cell /, 'region ').replace(/^Sea$/, 'the sea');
    const sea = raw.regions.find((r) => r.id === 'SEA');
    if (sea) {
      // ponytail: redraw the engine's square sea as a ring around the disc (same neighbors, area left stale)
      const R = 1.06 * Math.max(...sea.polys[0][1].map((q) => Math.hypot(q[0], q[1])));
      sea.polys[0][0] = Array.from({length: 360}, (_, i) => [R * Math.cos((i * Math.PI) / 180), R * Math.sin((i * Math.PI) / 180)]);
      sea.label = [-R * 0.68, -R * 0.68];
      raw.bbox = [-R, -R, R, R];
    }
    prepared.set(file, prepMap(raw));
  }
  return prepared.get(file)!;
};
const randomOf = (n: number, seed: number) => {
  const key = `random_${n}_${seed}`;
  if (!prepared.has(key)) prepared.set(key, prepMap(randomMap(n, seed)));
  return prepared.get(key)!;
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (k: number, w: string) => `${k.toLocaleString('en-US')} ${w}${k === 1 ? '' : w.endsWith('sh') ? 'es' : 's'}`;
const used = (c: ArrayLike<number>) => new Set(Array.from(c).filter((x) => x >= 0)).size;
const pairs = (list: [number, number][]) => [...new Map(list.map((p) => [`${Math.min(...p)}-${Math.max(...p)}`, p] as const)).values()];
const describe = (m: FMap, e: TraceEvent) => {
  const nm = (i: number) => m.regions[i].name;
  switch (e.op) {
    case 'paint': return `${cap(nm(e.r))} takes ${INK_NAMES[e.c]}.`;
    case 'unpaint': return `Dead end. Back up: ${nm(e.r)} is wiped.`;
    case 'stuck': return `${cap(nm(e.r))} has no ink left.`;
    case 'remove': return `Lift off ${nm(e.r)}: five or fewer neighbors left.`;
    case 'restore': return `Put ${nm(e.r)} back.`;
    case 'swap': return `Chain swap: ${plural(e.chain.length, 'region')} trade ${INK_NAMES[e.a]} and ${INK_NAMES[e.b]}.`;
    case 'clash': return `Clash: ${nm(e.r[0])} and ${nm(e.r[1])} now share an ink.`;
    case 'mark': return `${cap(e.tag ?? '')}.`;
  }
};
const factCards = (f: Record<string, Fact>) => {
  const v = <T,>(k: string) => f[k].value as T;
  const cards: {big: string; text: string; src: string[]}[] = [];
  const add = (make: () => (typeof cards)[number]) => {
    try {
      cards.push(make());
    } catch {
      // a fact missing from facts.json: leave its card out rather than show a made-up number
    }
  };
  add(() => ({big: `${v<number>('yearsUnnoticed')} years`, text: `${f.kempeYear.say} ${f.heawoodYear.say}`, src: [f.kempeYear.source, f.heawoodYear.source]}));
  add(() => ({big: v<Record<string, number>>('randomChromatic')['4'].toLocaleString('en-US'), text: `${f.randomN.say} ${f.randomChromatic.say}`, src: [f.randomChromatic.source]}));
  add(() => ({big: `${v<{pct: number}>('kempeClashMaps').pct}%`, text: f.kempeClashMaps.say, src: [f.kempeClashMaps.source]}));
  add(() => ({big: String(v<number>('appelHaken')), text: f.appelHaken.say, src: [f.appelHaken.source]}));
  return cards;
};
const srcLabel = (s: string) => (s.startsWith('our run') ? 'Popperish simulation' : s);

const Icon = ({d, size = 18}: {d: string; size?: number}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const I = {
  undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  clear: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14',
  link: 'M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1 1M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1-1',
  download: 'M12 3v12m0 0-5-5m5 5 5-5M4 19h16',
  dice: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8.5 8.5h.01M15.5 15.5h.01M15.5 8.5h.01M8.5 15.5h.01M12 12h.01',
  play: 'M7 4.5v15l12-7.5z',
  pause: 'M8 5v14M16 5v14',
  restart: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
  ext: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
};
const Logo = () => (
  <svg className="logo" viewBox="0 0 32 32" aria-hidden="true">
    <circle cx="16" cy="16" r="13.6" fill="none" stroke="#ffd23f" strokeWidth="2.8" />
    <path d="M10 11.6h12M13.4 11.6v10M18.6 11.6v10" stroke="#ece9e2" strokeWidth="3" strokeLinecap="round" />
  </svg>
);
/** Our cover with the play ring; YouTube's player loads only when it is pressed (see videos.ts). */
const Player = ({v}: {v: Video}) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => void ref.current!.replaceChildren(facade(v)), [v]);
  return <div className="screen" ref={ref} />;
};
const Seg = <T extends string | number>({value, options, onChange, label, render}: {value: T; options: readonly T[]; onChange: (v: T) => void; label: string; render?: (v: T) => ReactNode}) => (
  <div className="seg" role="group" aria-label={label}>
    {options.map((o) => (
      <button key={o} type="button" aria-pressed={o === value} onClick={() => onChange(o)}>
        {render ? render(o) : o}
      </button>
    ))}
  </div>
);

function App() {
  const init = useMemo(() => decodeShare(location.search), []);
  const [mapKey, setMapKey] = useState<MapKey>(init.map);
  const [n, setN] = useState(init.n);
  const [nDraft, setNDraft] = useState(init.n);
  const [seed, setSeed] = useState(init.seed);
  const [inks, setInks] = useState(init.inks);
  const [mode, setMode] = useState(init.mode);
  const [solver, setSolver] = useState<SolverKey>(init.solver);
  const [t, setTState] = useState(init.t);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [ink, setInk] = useState(0);
  const [map, setMap] = useState<FMap | null>(null);
  const [colors, setColors] = useState<Int8Array>(new Int8Array(0));
  const [undoStack, setUndo] = useState<Int8Array[]>([]);
  const [hover, setHover] = useState(-1);
  const [named, setNamed] = useState(-1);
  const [traces, setTraces] = useState<Record<string, Trace> | null>(null);
  const [facts, setFacts] = useState<Record<string, Fact> | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [video, setVideo] = useState<Video | null>(null);
  const tRef = useRef(init.t), firstPaint = useRef(init.paint), keepT = useRef(init.mode === 'solve');
  const saved = useRef(new Map<string, Int8Array>());
  const strokes = useRef(new Map<number, {from: number; to: number; t0: number; o: [number, number, number]}>());
  const cardRef = useRef<HTMLDivElement>(null), canvasRef = useRef<HTMLCanvasElement>(null), rend = useRef<Renderer | null>(null);
  const frame = useRef<(now: number) => {st: InkState; ov: Overlay} | null>(() => null), kick = useRef(() => {});
  const setT = (x: number) => ((tRef.current = x), setTState(x));
  const info = MAPS[mapKey];

  useEffect(() => void getJson<Record<string, Fact>>('facts').then(setFacts, () => {}), []);
  // the episode plays here once it is out and scripts/videos.py has listed it; until then the Watch buttons link to YouTube
  useEffect(() => void loadVideos().then((all) => setVideo(all.find((v) => v.slug === 'four-color') ?? null)), []);
  useEffect(() => {
    const id = setTimeout(() => setN(nDraft), 160);
    return () => clearTimeout(id);
  }, [nDraft]);

  // load (or generate) the map; restore its painting from this visit or from a shared link
  useEffect(() => {
    let off = false;
    const done = (m: FMap) => {
      if (off) return;
      let c = saved.current.get(m.name) ?? new Int8Array(m.n).fill(-1);
      if (firstPaint.current) (c = unpackColors(firstPaint.current, m.n)), (firstPaint.current = '');
      strokes.current.clear();
      setMap(m);
      setColors(c);
      setUndo([]);
      setHover(-1);
      setNamed(-1);
    };
    setError('');
    if (mapKey === 'random') done(randomOf(n, seed));
    else loadMap(info.file!).then(done, (e) => !off && setError(`Could not load the map (${e.message}).`));
    if (mapKey === 'trap') getJson<Record<string, Trace>>('traces').then((x) => !off && setTraces(x), () => {});
    return () => void (off = true);
  }, [mapKey, n, seed, info.file]);
  useEffect(() => void (map && colors.length === map.n && saved.current.set(map.name, colors)), [map, colors]);

  const solved = useMemo(() => {
    if (!map || mode !== 'solve') return null;
    let s: Solve;
    if (solver === 'greedy') s = greedy(map, inks);
    else if (solver === 'exact') s = exact(map, inks);
    else if (mapKey === 'trap') {
      if (!traces) return null;
      s = {trace: traces.kempe_fail, result: {kind: 'clash', msg: "Kempe's two swaps are each legal, but done together they leave two neighbors on the same ink."}};
    } else s = map.rot ? kempe1879(map) : kempePlain(map);
    return {...s, tt: timeForPage(s.trace, map)};
  }, [map, mode, solver, inks, traces, mapKey]);
  const end = solved ? solved.tt.end + TAIL : 0;

  useEffect(() => {
    if (!solved) return;
    if (keepT.current) return void ((keepT.current = false), setT(clamp(tRef.current, 0, solved.tt.end + TAIL)));
    setT(0);
    setPlaying(true);
  }, [solved]);
  useEffect(() => {
    if (!playing || !solved) return;
    let id = 0, last = performance.now();
    const step = (now: number) => {
      const nt = Math.min(solved.tt.end + TAIL, tRef.current + ((now - last) / 1000) * speed);
      last = now;
      setT(nt);
      if (nt >= solved.tt.end + TAIL) setPlaying(false);
      else id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [playing, solved, speed]);

  const st = useMemo(() => (solved ? colorsAt(solved.tt, t) : null), [solved, t]);
  // counters and clashes read whole events (a chain swap ripples, but it is one step: no clash mid-ripple)
  const step = solved ? eventAt(solved.tt, t) : -1;
  const done = useMemo(() => (solved && map ? replay(solved.trace.events, map.n, step + 1) : null), [solved, map, step]);
  const shown = mode === 'solve' ? done : colors;
  const clashes = useMemo(() => (map && shown && shown.length === map.n ? clashEdges(map, shown) : []), [map, shown]);
  const painted = shown ? Array.from(shown).filter((c) => c >= 0).length : 0;
  const sub = map ? `${plural(map.n, 'region')} · ${plural(map.edges.length, 'border')}` : '';

  // the renderer runs its own frames while anything moves; React only says "something changed"
  useEffect(() => {
    const r = createRenderer(canvasRef.current!);
    rend.current = r;
    let id = 0;
    const tick = (now: number) => {
      id = 0;
      const f = frame.current(now);
      if (f && r.draw(f.st, f.ov, now)) id = requestAnimationFrame(tick);
    };
    kick.current = () => void (id ||= requestAnimationFrame(tick));
    const ro = new ResizeObserver(([e]) => (r.resize(e.contentRect.width, e.contentRect.height), kick.current()));
    ro.observe(cardRef.current!);
    document.fonts?.ready.then(() => (r.relayout(), kick.current()));
    return () => (ro.disconnect(), cancelAnimationFrame(id));
  }, []);
  useEffect(() => void (map && rend.current?.setMap(map, info.title, sub)), [map, info.title, sub]);
  frame.current = (now) => {
    if (!map || colors.length !== map.n) return null;
    if (mode === 'solve') {
      if (!st) return null;
      const list = pairs(st.clash && st.clash.k > 0 ? [...clashes, st.clash.r] : clashes);
      return {st, ov: {clashes: list, hot: [...new Set(list.flat())], hover, callout: true}};
    }
    const s = blankState(map.n), origin = new Map<number, [number, number, number]>();
    s.from.set(colors);
    s.to.set(colors);
    for (const [i, k] of strokes.current) {
      const el = (now - k.t0) / 1000;
      if (el >= SPREAD + DRY || colors[i] !== k.to) continue;
      s.from[i] = k.from;
      s.k[i] = spreadEase(el / SPREAD);
      s.dry[i] = clamp((el - SPREAD) / DRY) ** 2 * (3 - 2 * clamp((el - SPREAD) / DRY));
      origin.set(i, k.o);
    }
    return {st: s, ov: {clashes, hot: [...new Set(clashes.flat())], hover, origin}};
  };
  useEffect(() => kick.current());

  // the address bar always holds the shareable state (not while playing)
  const shareState = {map: mapKey, inks, n, seed, mode, paint: packColors(colors), solver, t};
  useEffect(() => {
    if (playing || !map) return;
    const id = setTimeout(() => window.history.replaceState(null, '', `?${encodeShare({...shareState, t: tRef.current})}`), 250);
    return () => clearTimeout(id);
  });

  const point = (e: RPointerEvent<HTMLCanvasElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    return [e.clientX - b.left, e.clientY - b.top] as const;
  };
  const onDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (!map || !rend.current) return;
    const [x, y] = point(e), i = rend.current.hit(x, y);
    setNamed(i);
    if (mode !== 'paint' || i < 0 || colors[i] === ink) return;
    const now = performance.now();
    for (const [r, k] of strokes.current) if (now - k.t0 > (SPREAD + DRY) * 1000) strokes.current.delete(r);
    strokes.current.set(i, {from: colors[i], to: ink, t0: now, o: rend.current.stainFrom(i, x, y)});
    setUndo((h) => [...h.slice(-199), colors]);
    const next = colors.slice();
    next[i] = ink;
    setColors(next);
  };
  const onMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType !== 'mouse' || !rend.current) return;
    const i = rend.current.hit(...point(e));
    if (i !== hover) (setHover(i), setNamed(i));
  };
  const undo = () => {
    if (!undoStack.length) return;
    strokes.current.clear();
    setColors(undoStack[undoStack.length - 1]);
    setUndo(undoStack.slice(0, -1));
  };
  const clear = () => {
    if (!map || !colors.some((c) => c >= 0)) return;
    strokes.current.clear();
    setUndo((h) => [...h.slice(-199), colors]);
    setColors(new Int8Array(map.n).fill(-1));
  };
  const say = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2200);
  };
  const copyLink = async () => {
    const url = `${location.origin}${location.pathname}?${encodeShare({...shareState, t: tRef.current})}`;
    try {
      await navigator.clipboard.writeText(url);
      say('Link copied');
    } catch {
      window.prompt('Copy this link', url);
    }
  };
  const caption = () => {
    const ink = `${plural(used(shown ?? []), 'ink')}, ${clashes.length ? plural(clashes.length, 'clash') : 'no clashes'}`;
    return mode === 'solve' ? `${info.title} · ${SOLVER_INFO[solver].label} at ${t.toFixed(1)} s · ${ink}` : `${info.title} · ${painted} of ${map?.n} painted · ${ink}`;
  };
  const download = async () => {
    const f = frame.current(performance.now() + 1e7);
    if (!map || !f) return;
    try {
      const blob = await exportPng(map, f.st, {...f.ov, origin: undefined}, info.title, sub, caption());
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `popperish-four-colors-${mapKey}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch {
      say('Could not make the PNG');
    }
  };
  const pickMode = (m: 'paint' | 'solve') => (setMode(m), setPlaying(false));
  const togglePlay = () => {
    if (!solved) return;
    if (!playing && t >= end - 1e-3) setT(0);
    setPlaying(!playing);
  };

  let status: ReactNode, tone = '';
  if (error) (status = error), (tone = 'bad');
  else if (!map) status = 'Loading the map...';
  else if (mode === 'paint') {
    if (painted === map.n && !clashes.length) (status = `Done: all ${plural(map.n, 'region')}, ${plural(used(colors), 'ink')}, no clashes.`), (tone = 'good');
    else if (clashes.length) (status = `${plural(clashes.length, 'clash')}: neighbors that share an ink are hatched.`), (tone = 'bad');
    else status = 'Tap a region to paint it. Neighbors may not share an ink.';
  } else if (!solved) status = 'Working...';
  else if (t >= solved.tt.end) {
    // the trap's verdict in the fact-checked wording when facts.json is in
    status = mapKey === 'trap' && solver === 'kempe' && facts?.kempeFailMap ? facts.kempeFailMap.say : solved.result.msg;
    tone = solved.result.kind === 'solved' ? 'good' : 'bad';
  }
  else {
    const i = eventAt(solved.tt, t);
    status = i < 0 ? 'Ready.' : describe(map, solved.trace.events[i]);
  }
  const cards = facts ? factCards(facts) : [];
  const ctaText = (
    <>
      <h2>The whole story is in the video</h2>
      <p>How a proof everyone accepted fell apart, and what it took to finally settle the question.</p>
    </>
  );
  const ctaButtons = (
    <div className="cta-buttons">
      {!video && (
        <a className="btn gold big" href={LINKS.video} target="_blank" rel="noreferrer">
          <Icon d={I.play} size={16} /> Watch the video
        </a>
      )}
      <a className="btn big" href={LINKS.kofi} target="_blank" rel="noreferrer">
        Support Popperish on Ko-fi
      </a>
      {LINKS.discord && (
        <a className="btn big" href={LINKS.discord} target="_blank" rel="noreferrer">
          Join the Discord
        </a>
      )}
    </div>
  );
  const nm = named >= 0 && map ? map.regions[named] : null;

  return (
    <>
      <header className="top wrap">
        <a className="brand" href="/" aria-label="Popperish home">
          <Logo />
          <span>POPPERISH</span>
        </a>
        <nav className="links">
          <a className="hide-sm" href="/#sims">
            Simulations
          </a>
          {LINKS.discord && (
            <a className="hide-sm" href={LINKS.discord} target="_blank" rel="noreferrer">
              Discord
            </a>
          )}
          <a className="btn" href={LINKS.kofi} target="_blank" rel="noreferrer">
            <span className="hide-sm">Support Popperish</span>
            <span className="show-sm">Support</span>
          </a>
          <a className="btn gold" href={LINKS.video} target="_blank" rel="noreferrer">
            <Icon d={I.play} size={15} />
            <span className="hide-sm">Watch the video</span>
            <span className="show-sm">Video</span>
          </a>
        </nav>
      </header>

      <main className="wrap">
        <section className="hero">
          <p className="kicker">Simulation · Four Color Map</p>
          <h1>Every map ever drawn needs only four colors</h1>
          <p className="intro">Paint a map so that no two neighbors share an ink. Then watch three methods try, including a famous proof that turned out to be wrong.</p>
        </section>

        <section className="lab">
          <div className="maps">
            <h2 className="label">Map</h2>
            <div className="chips">
              {(Object.keys(MAPS) as MapKey[]).map((k) => (
                <button key={k} type="button" className="chip" aria-pressed={k === mapKey} onClick={() => setMapKey(k)}>
                  {MAPS[k].label}
                </button>
              ))}
            </div>
            {mapKey === 'random' && (
              <div className="random">
                <label className="range">
                  <span>Regions</span>
                  <input type="range" min={12} max={600} value={nDraft} onChange={(e) => setNDraft(+e.target.value)} style={{'--p': `${((nDraft - 12) / 588) * 100}%`} as CSSProperties} />
                  <b>{nDraft}</b>
                </label>
                <button type="button" className="btn" onClick={() => setSeed((s) => (s * 7919 + 13) % 1000000)} title={`Map #${seed}`}>
                  <Icon d={I.dice} /> New map
                </button>
              </div>
            )}
          </div>

          <div className="card-wrap">
            <div className="card" ref={cardRef}>
              <canvas ref={canvasRef} className={mode === 'paint' ? 'paint' : ''} onPointerDown={onDown} onPointerMove={onMove} onPointerLeave={() => (setHover(-1), setNamed(-1))} role="img" aria-label={`${info.title}: ${painted} of ${map?.n ?? 0} regions inked`} />
              {nm && (
                <div className="where">
                  {cap(nm.name)} <span>· {plural(map!.adj[named].length, 'neighbor')}</span>
                </div>
              )}
            </div>
          </div>

          <div className="controls">
            <Seg label="Mode" value={mode} options={['paint', 'solve'] as const} onChange={pickMode} render={(m) => (m === 'paint' ? 'Paint it yourself' : 'Watch a solver')} />

            <div className="row">
              <h2 className="label">Inks</h2>
              <Seg label="Number of inks" value={inks} options={[3, 4, 5]} onChange={(k) => (setInks(k), setInk((c) => Math.min(c, k - 1)))} />
            </div>

            {mode === 'paint' ? (
              <div className="inks" role="group" aria-label="Ink">
                {INKS.slice(0, inks).map((c, i) => (
                  <button key={c} type="button" className="ink" style={{'--ink': c} as CSSProperties} aria-pressed={ink === i} aria-label={INK_NAMES[i]} title={cap(INK_NAMES[i])} onClick={() => setInk(i)} />
                ))}
                <button type="button" className="ink eraser" aria-pressed={ink === -1} aria-label="eraser" title="Eraser" onClick={() => setInk(-1)} />
                <span className="ink-name">{ink >= 0 ? cap(INK_NAMES[ink]) : 'Eraser'}</span>
              </div>
            ) : (
              <>
                <Seg label="Solver" value={solver} options={['greedy', 'kempe', 'exact'] as const} onChange={(v) => (v === solver ? (setT(0), setPlaying(true)) : setSolver(v))} render={(v) => SOLVER_INFO[v].label} />
                <div className="player">
                  <button type="button" className="play" onClick={togglePlay} aria-label={playing ? 'Pause' : t >= end - 1e-3 ? 'Play again' : 'Play'} disabled={!solved}>
                    <Icon d={playing ? I.pause : t >= end - 1e-3 && solved ? I.restart : I.play} size={20} />
                  </button>
                  <input type="range" aria-label="Time" min={0} max={end || 1} step={0.01} value={Math.min(t, end || 1)} onChange={(e) => (setPlaying(false), setT(+e.target.value))} style={{'--p': `${end ? (Math.min(t, end) / end) * 100 : 0}%`} as CSSProperties} />
                  <span className="time">
                    {t.toFixed(1)}
                    <i> / {end.toFixed(1)} s</i>
                  </span>
                  <button type="button" className="speed" onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])} aria-label={`Speed ${speed}x, change`} title="Speed">
                    {speed}×
                  </button>
                </div>
              </>
            )}

            <p className={`status ${tone}`} aria-live="polite">
              {status}
            </p>
            <div className="stats">
              <div>
                <b>
                  {painted}
                  <i>/{map?.n ?? 0}</i>
                </b>
                <span>Painted</span>
              </div>
              <div className={clashes.length ? 'alert' : ''}>
                <b>{clashes.length}</b>
                <span>Clashes</span>
              </div>
              <div>
                <b>{used(shown ?? [])}</b>
                <span>Inks used</span>
              </div>
            </div>

            {mode === 'paint' ? (
              <div className="row buttons">
                <button type="button" className="btn" onClick={undo} disabled={!undoStack.length}>
                  <Icon d={I.undo} /> Undo
                </button>
                <button type="button" className="btn" onClick={clear} disabled={!painted}>
                  <Icon d={I.clear} /> Clear
                </button>
              </div>
            ) : (
              <p className="blurb">
                {SOLVER_INFO[solver].blurb}
                {solver === 'kempe' && inks !== 4 && ' It always uses four inks.'}
              </p>
            )}
            <div className="row buttons share">
              <button type="button" className="btn" onClick={copyLink} disabled={!map}>
                <Icon d={I.link} /> Copy link
              </button>
              <button type="button" className="btn" onClick={download} disabled={!map}>
                <Icon d={I.download} /> Download PNG
              </button>
            </div>
          </div>
        </section>

        {cards.length > 0 && (
          <section className="facts">
            <h2 className="label">From the video</h2>
            <div className="fact-grid">
              {cards.map((c) => (
                <article key={c.big} className="fact">
                  <b>{c.big}</b>
                  <p>{c.text}</p>
                  <small>{[...new Set(c.src.map(srcLabel))].join('; ')}</small>
                </article>
              ))}
            </div>
          </section>
        )}

        {video ? (
          <section className="cta has-video">
            <Player v={video} />
            <div>
              {ctaText}
              {ctaButtons}
            </div>
          </section>
        ) : (
          <section className="cta">
            <div>{ctaText}</div>
            {ctaButtons}
          </section>
        )}
      </main>

      <footer className="foot wrap">
        <a className="brand small" href="/" aria-label="Popperish home">
          <Logo />
          <span>POPPERISH</span>
        </a>
        <p>
          &copy; 2026 Popperish · <a href="/privacy">Privacy and copyright</a> · Map data: US Census Bureau and Natural Earth · <a href={LINKS.channel} target="_blank" rel="noreferrer">YouTube</a> · <a href={LINKS.kofi} target="_blank" rel="noreferrer">Ko-fi</a>
        </p>
      </footer>
      <div className={`toast ${toast ? 'on' : ''}`} role="status">
        {toast}
      </div>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
