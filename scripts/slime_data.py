#!/usr/bin/env python3
"""Data for popperish.com/slime: public/data/slime/slime.json (Kanto map, 36 cities, the rail graph, mountain mask, facts).

Reads video/public/kit/slime/slime.json + mountains.png and sims/slime/facts.json; writes slime.json (about 15 KB) and
tokyo-run.json: tube widths of the engine's representative run (kit tero run 863) at 20 of its 93 keyframes, the part of the
run where the fan thins into a network, for the edges still alive at the first of them. The swarm follows those widths.
Units are kit units (cm of Tero's 17 cm dish), x east, y north, origin at the dish centre. The mountain mask is the kit's
elevation image cut to a binary 'light' mask (the slime avoids light), at half size, run-length coded, row 0 = north.

Run from the repo root:  sims/slime/.venv/bin/python site/scripts/slime_data.py
"""
import base64, json, pathlib
import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
KIT = ROOT / 'video/public/kit/slime'
OUT = ROOT / 'site/public/data/slime/slime.json'
RUN = OUT.with_name('tokyo-run.json')
KEY_T = [7.0, 7.25, 7.5, 8.0, 8.5, 9.0, 10.0, 12.0, 14.0, 17.0, 20.0, 24.0, 28.0, 34.0, 40.0, 55.0, 70.0, 95.0, 120.0, 150.0]  # engine time units
LIGHT = 90                    # kit level 0..255 (150 m .. 450 m): lit from about 240 m up, low enough that Ito stays connected
r2 = lambda v: [round(x, 2) for x in v]


def rle(mask):
    """Alternating run lengths over the row-major mask, starting with a run of zeros."""
    flat, runs, cur, n = mask.ravel().astype(np.uint8), [], 0, 0
    for v in flat:
        if v == cur:
            n += 1
        else:
            runs.append(n)
            cur, n = v, 1
    runs.append(n)
    return runs


def tokyo_run(d):
    """The run's tube widths (8-bit log codes, 0 = gone) at KEY_T, for the edges alive at the first of them."""
    t = d['tero']
    kf = t['keyframes']
    qs = [np.frombuffer(base64.b64decode(x), np.uint8) for x in kf['D']]
    pick = [kf['t'].index(x) for x in KEY_T]
    E = np.asarray(t['edges']).reshape(-1, 2)
    keep = np.flatnonzero(qs[pick[0]] > 0)
    used = np.unique(E[keep])
    remap = {int(n): i for i, n in enumerate(used)}
    nodes = np.asarray(t['nodes']).reshape(-1, 2)[used]
    return {
        'note': 'sims/slime tero run %d (seed %d), see video/public/kit/slime/slime.json' % (t['run'], t['seed']),
        'nodes': [round(float(v), 2) for v in nodes.ravel()],
        'edges': [remap[int(n)] for n in E[keep].ravel()],
        'cities': [remap[int(n)] for n in t['city_nodes'] if int(n) in remap],
        'times': KEY_T,
        'D': [base64.b64encode(qs[i][keep].tobytes()).decode() for i in pick],
        'lo': -3.0, 'hi': 0.3,
    }


def main():
    d = json.loads((KIT / 'slime.json').read_text())
    f = json.loads((ROOT / 'sims/slime/facts.json').read_text())
    img = Image.open(KIT / 'mountains.png').convert('L')
    w, h = img.width // 2, img.height // 2
    small = np.asarray(img.resize((w, h), Image.BOX))
    mask = small >= LIGHT
    land = d['land'][0]
    rail = d['rail']
    nodes = rail['nodes']
    segs = [[nodes[a]['x'], nodes[a]['y'], nodes[b]['x'], nodes[b]['y']] for a, b in rail['edges']]
    s, r, m, bt, mz = f['slime'], f['rail'], f['mst'], f['beat_rail'], f['maze']
    out = {
        'arena': d['arena']['kit'],
        'kmPerUnit': round(d['km_per_unit'], 4),
        'land': {'outer': r2(land['outer']), 'holes': [r2(x) for x in land['holes']]},
        'cities': [{'name': c['name'], 'x': c['x'], 'y': c['y'], 'tokyo': c['tokyo']} for c in d['cities']],
        'rail': segs,
        'mtn': {'w': w, 'h': h, 'rle': rle(mask)},
        # numbers the page quotes, copied from sims/slime/facts.json (src/check.ts compares them)
        'facts': {
            'runs': f['runs']['n'], 'connected': f['runs']['connected'], 'cities': r['cities'],
            'dishCm': f['literature']['arena_width_cm'], 'hours': f['literature']['experiment_hours'],
            'slime': {'cost': s['TL_MST']['median'], 'ft': s['FT']['median']},
            'rail': {'cost': r['TL_MST'], 'ft': r['FT'], 'km': r['TL_km']},
            'mst': {'km': m['TL_km']},
            'beat': {'cost': bt['count']['TL_MST'], 'trips': bt['count']['MD_MST'], 'ft': bt['count']['FT'], 'all': bt['count']['all'], 'alpha': bt['alpha_better']},
            'maze': {'seeds': mz['tero_seeds'], 'won': mz['shortest_won'], 'routes': len(mz['route_length_px']), 'ratio': mz['longest_over_shortest']},
        },
    }
    run = tokyo_run(d)
    RUN.write_text(json.dumps(run, separators=(',', ':')))
    print(f'{RUN} {RUN.stat().st_size / 1024:.1f} KB, {len(run["edges"]) // 2} edges, {len(run["nodes"]) // 2} nodes')
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(',', ':')))
    print(f'{OUT} {OUT.stat().st_size / 1024:.1f} KB, mask {w}x{h}, {len(out["mtn"]["rle"])} runs, {mask.mean() * 100:.0f}% lit')


main()
