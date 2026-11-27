#!/usr/bin/env python3
"""Data for popperish.com/fall: public/data/fall/fall.json (index, facts, geometry) + trip.bin, hill.bin, flat.bin (poses).

Every pose is a real run of our engine (sims/fall). Most come straight from the video kit (video/public/kit/fall/fall.json and
fall_outdoor.json); two sets the kit does not have are re-run here with the engine and cached in sims/fall/out/site_runs.json:
  - each slider run again with its walking speed 1e-6 m/s faster (the "a millionth faster" twin)
  - flat-floor shoves 0-9 (the facts batch's own first ten pushes; the kit only kept run 0)
The re-runs are checked against the kit first (the engine is deterministic: the same run must give the same poses).

Run from the repo root:  sims/fall/.venv/bin/python site/scripts/fall_data.py
Poses: 15 fps, int16 little-endian, frames[t][body] = [x, y, z] in 2 mm units, then [qx, qy, qz, qw] * 32767 (glTF axes, y up).
"""
import json, pathlib, re, sys
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'sims/fall'))
import engine  # noqa: E402
import mujoco  # noqa: E402

KIT = ROOT / 'video/public/kit/fall'
OUT = ROOT / 'site/public/data/fall'
CACHE = ROOT / 'sims/fall/out/site_runs.json'
TWIN = 1e-6           # m/s: the slider twin's extra walking speed
POS_UNIT, Q_UNIT = 0.002, 32767
SEED = 20261127


def pick_by_speed(runs, lo=1.0, hi=1.8, n=61):
    """Runs spread over the speed range: the run nearest each of n evenly spaced speeds (ponytail: nearest-target pick, not optimal)."""
    sp = np.array([r['speed_m_per_s'] for r in runs])
    return sorted({int(np.abs(sp - t).argmin()) for t in np.linspace(lo, hi, n)}, key=lambda i: sp[i])


def engine_runs(slider, kit):
    """The twins and flat shoves, from the cache or the engine (the cache key is the job list)."""
    jobs = {'twins': [r['run'] for r in slider], 'flat': list(range(10)), 'twin': TWIN}
    if CACHE.is_file():
        c = json.loads(CACHE.read_text())
        if c['jobs'] == jobs:
            return c['twins'], c['flat']
    from multiprocessing import Pool
    P = {r['run']: r['params'] for r in slider}
    # determinism first: the kit's run, re-run, must come back pose for pose
    probe = engine._kit_walk((P[slider[0]['run']], 0.0))
    assert np.abs(np.array(probe['frames']) - np.array(slider[0]['frames'])).max() < 2e-4, 'engine re-run differs from the kit'
    flat0 = engine._kit_run(('flat', engine.push_for('flat', 0, SEED)))
    assert np.abs(np.array(flat0['frames']) - np.array(kit['flat']['frames'])).max() < 2e-4, 'flat re-run differs from the kit'
    with Pool(12) as pool:
        tw = pool.map(engine._kit_walk, [(P[i], TWIN) for i in jobs['twins']])
        fl = pool.map(engine._kit_run, [('flat', engine.push_for('flat', i, SEED)) for i in jobs['flat']])
    CACHE.parent.mkdir(exist_ok=True)
    CACHE.write_text(json.dumps({'jobs': jobs, 'twins': tw, 'flat': fl}, separators=(',', ':')))
    return tw, fl


class Pack:
    """Runs appended into one int16 buffer; each run's index entry says where its frames start (in int16s) and how many."""

    def __init__(self):
        self.parts, self.off = [], 0

    def add(self, frames):
        f = np.asarray(frames, dtype=np.float64)[::2]            # 30 -> 15 fps
        q = f[..., 3:7].copy()
        for t in range(1, len(q)):                                # keep each body's quaternion on one side, so lerp works
            flip = (q[t] * q[t - 1]).sum(-1) < 0
            q[t][flip] *= -1
        a = np.concatenate([np.round(f[..., :3] / POS_UNIT), np.round(q * Q_UNIT)], -1)
        assert np.abs(a).max() <= 32767
        a = a.astype('<i2')
        self.parts.append(a.ravel())
        entry = {'off': self.off, 'n': len(f)}
        self.off += a.size
        return entry

    def write(self, name):
        b = np.concatenate(self.parts).astype('<i2').tobytes()
        (OUT / name).write_bytes(b)
        return len(b)


def geometry():
    """The dummy's collision shapes in each body's own frame (glTF axes, metres): what the page draws instead of the mesh."""
    M = engine.model('trip')
    R = engine.GLTF_FROM_MJ
    out = {}
    for g in range(M.ngeom):
        b = M.geom_bodyid[g]
        if b == 0:
            continue
        body, size, pos = M.body(b).name, M.geom_size[g], R @ M.geom_pos[g]
        rot = np.zeros(9)
        mujoco.mju_quat2Mat(rot, M.geom_quat[g])
        rot = R @ rot.reshape(3, 3)
        t = M.geom_type[g]
        if t == mujoco.mjtGeom.mjGEOM_CAPSULE:
            ax = rot[:, 2] * size[1]
            shape = {'kind': 'capsule', 'a': np.round(pos - ax, 4).tolist(), 'b': np.round(pos + ax, 4).tolist(), 'r': round(float(size[0]), 4)}
        elif t == mujoco.mjtGeom.mjGEOM_BOX:
            assert np.allclose(np.abs(rot), np.abs(R)), f'{body}: rotated box'
            shape = {'kind': 'box', 'c': np.round(pos, 4).tolist(), 'h': np.round(np.abs(R) @ size, 4).tolist()}
        elif t == mujoco.mjtGeom.mjGEOM_ELLIPSOID:
            shape = {'kind': 'ellipsoid', 'c': np.round(pos, 4).tolist(), 'h': np.round(np.abs(R) @ size[:3], 4).tolist()}
        else:
            continue
        out.setdefault(body, []).append(shape)
    return out


def terrain(step=3):
    """The hill's heightfield, every `step`-th 0.1 m sample, in cm (int16) - the page draws it as shaded quads."""
    meta = json.loads((KIT / 'hill_v2.json').read_text())
    H = np.load(KIT / 'hill_v2_height.npy')[::step, ::step]
    cell = meta['cell_m'] * step
    # glTF: sample [i, j] at X = 15 - j*cell, Y = H, Z = -6 + i*cell
    return {'cell': cell, 'rows': H.shape[0], 'cols': H.shape[1], 'x0': 15.0, 'z0': -6.0}, np.round(H * 100).astype('<i2')


def main():
    kit = json.loads((KIT / 'fall.json').read_text())
    out_kit = json.loads((KIT / 'fall_outdoor.json').read_text())
    facts = json.loads((ROOT / 'sims/fall/facts.json').read_text())
    fo = json.loads((ROOT / 'sims/fall/facts_outdoor.json').read_text())
    assert kit['bodies'] == out_kit['bodies'] and kit['fps'] == out_kit['fps'] == 30
    OUT.mkdir(parents=True, exist_ok=True)

    crowd = kit['trip_crowd']
    slider = [crowd[i] for i in pick_by_speed(crowd)]
    hero = kit['trip_hero']
    slider.append({**hero, 'params': hero['params']})          # the run from the video: its own twin is re-run like the rest
    slider.sort(key=lambda r: r['speed_m_per_s'])
    twins, flat = engine_runs(slider, kit)

    def meta(r):
        return {'speed': round(r['speed_m_per_s'], 12), 'stop': r['stop_step'], 'rest': None if r['settled_s'] is None else round(r['settled_s'], 2)}

    tp = Pack()
    trip = []
    for r, t in zip(slider, twins):
        assert abs(t['speed_m_per_s'] - r['speed_m_per_s'] - TWIN) < 1e-11
        trip.append({'run': r['run'], **meta(r), **tp.add(r['frames']), 'hero': r['run'] == hero['run'],
                     'twin': {**meta(t), **tp.add(t['frames'])}})
    trip_bytes = tp.write('trip.bin')

    # hill: every 5th run of the kit's 100 by distance down the slope (so a random pick is as likely to stay up top as the batch was),
    # plus the hero and the twin pair
    hp = Pack()
    hc = sorted(out_kit['hill_crowd'], key=lambda r: (r['distance_down_slope_m'] if r['where'] != 'top' else -99, r['run']))
    hsel = hc[2::5]

    def hmeta(r):
        return {'run': r['run'], 'where': r['where'], 'dist': r['distance_down_slope_m'], 'speed': round(r['walking_speed_m_per_s'], 12),
                'rest': None if r['settled_s'] is None else round(r['settled_s'], 2)}

    hill = [{**hmeta(r), **hp.add(r['frames'])} for r in hsel]
    hh = out_kit['hill_hero']
    hill_hero = {**hmeta(hh), **hp.add(hh['frames'])}
    ht = out_kit['hill_twins']
    hill_twins = {'delta': ht['delta_m_per_s'], 'a': {**hmeta(ht['a']), **hp.add(ht['a']['frames'])}, 'b': {**hmeta(ht['b']), **hp.add(ht['b']['frames'])}}
    tinfo, H = terrain()
    hill_bytes = hp.write('hill.bin')
    (OUT / 'terrain.bin').write_bytes(H.tobytes())

    fp = Pack()
    flat_runs = [{'run': i, 'rest': round(r['settled_s'], 2), **fp.add(r['frames'])} for i, r in enumerate(flat)]
    flat_bytes = fp.write('flat.bin')

    E, H_tw, A, C = facts['E_trip'], facts['H_trip_twins'], facts['A_flat'], facts['C_D_twins_flat']
    hf = fo['hill']
    data = {
        'about': 'popperish.com/fall: real runs of our engine (sims/fall, MuJoCo, seed 20261127); written by site/scripts/fall_data.py. Poses 15 fps, int16: position / 0.002 m, quaternion (x, y, z, w) * 32767, glTF axes.',
        'fps': 15, 'posUnit': POS_UNIT, 'qUnit': Q_UNIT, 'bodies': kit['bodies'], 'rest': kit['rest'], 'shapes': geometry(),
        'stairs': {k: kit['stairs'][k] for k in ('rise', 'going', 'risers', 'treads', 'width', 'top_height', 'boxes')},
        'trip': trip, 'twinDelta': TWIN,
        'hill': hill, 'hillHero': hill_hero, 'hillTwins': hill_twins, 'terrain': tinfo,
        'flat': flat_runs,
        'files': {'trip': 'trip.bin', 'hill': 'hill.bin', 'flat': 'flat.bin', 'terrain': 'terrain.bin'},
        # what the page quotes, copied from the facts files (check.ts compares them again)
        'facts': {
            'trip': {'runs': E['runs'], 'stopCounts': E['stop_step_counts'], 'stopPct': E['stop_step_pct'], 'mostCommon': E['most_common_stop_step'],
                     'bottomPct': E['pct_reach_bottom_landing'], 'speedLo': E['variation']['speed_lo'], 'speedHi': E['variation']['speed_hi'],
                     'restMedian': E['time_to_rest_s']['median'],
                     'bySpeed': {k: {'runs': v['runs'], 'meanStop': v['mean_stop_step']} for k, v in E['by_walking_speed_m_per_s'].items()}},
            'tripTwins': {'pairs': H_tw['pairs'], 'byPrecision': H_tw['by_speed_precision_m_per_s'], 'alpha': H_tw['uncertainty_exponent_alpha']},
            'stairs': {'risers': facts['stairs']['risers'], 'treads': facts['stairs']['treads'], 'rise': facts['stairs']['rise_m'], 'going': facts['stairs']['going_m']},
            'flat': {'runs': A['runs'], 'firstContact': A['time_to_first_ground_contact_s'], 'spreadCm': A['final_pose_spread_cm'], 'headSdCm': A['final_head_position_sd_cm'],
                     'pushJitter': facts['push']['run_to_run_difference_m_per_s'], 'twins1e6End10cm': C['by_push_precision_m_per_s']['1e-06']['pct_pairs_end_10cm_apart']},
            'hill': {'runs': hf['results']['runs'], 'slopeDeg': hf['terrain']['slope_deg'], 'slopeLength': hf['terrain']['slope_length_m'], 'overPct': hf['results']['pct_went_over_rim'],
                     'where': hf['results']['where_stops_pct'], 'dist': hf['results']['distance_down_slope_m'],
                     'twinsGap': float(re.search(r'\(([\d.]+) m\)', fo['kit_choices']['hill_twins']['why'])[1]),  # rest points (pelvis) apart
                     'twinsPairs': hf['twins']['pairs'], 'byPrecision': hf['twins']['by_speed_precision_m_per_s'], 'alpha': hf['twins']['uncertainty_exponent_alpha']},
            'dummy': {'massKg': facts['dummy']['total_mass_kg'], 'heightM': facts['dummy']['height_m']},
        },
    }
    (OUT / 'fall.json').write_text(json.dumps(data, separators=(',', ':')))
    total = sum((OUT / f).stat().st_size for f in ['fall.json', 'trip.bin', 'hill.bin', 'flat.bin', 'terrain.bin'])
    print(f'{len(trip)} slider runs (+ twins) {trip_bytes / 1e6:.2f} MB, {len(hill)} hill runs + hero + twins {hill_bytes / 1e6:.2f} MB, '
          f'{len(flat_runs)} flat {flat_bytes / 1e3:.0f} kB, terrain {H.nbytes / 1e3:.0f} kB; total {total / 1e6:.2f} MB')
    print('twins on a different tread:', sum(t['stop'] != t['twin']['stop'] for t in trip), 'of', len(trip))


if __name__ == '__main__':
    main()
