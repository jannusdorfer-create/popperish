#!/usr/bin/env python3
"""public/data/zeta.json for the Hunt the zeros page: the first zeros, the two near-miss pairs, the spacing histograms and the headline numbers.

Reads our engine's outputs (sims/zeta/facts.json and video/public/kit/zeta/*.json), nothing is recomputed. Run: python3 scripts/zeta_data.py
`npm run check` asserts the page numbers against sims/zeta/facts.json, so rerun this if the engine's facts change.
"""
import json
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
REPO = SITE.parent
KIT, FACTS, OUT = REPO / 'video/public/kit/zeta', REPO / 'sims/zeta/facts.json', SITE / 'public/data/zeta.json'
load = lambda p: json.loads(Path(p).read_text())

facts, pairs, sp, zf = load(FACTS), load(KIT / 'pairs.json'), load(KIT / 'spacings.json'), load(KIT / 'zeros_first.json')
keep = ['zeros_checked', 'height_T', 'zeros_located', 'closest_pair', 'lehmer_pair', 'lehmer_pair_peak_absZ', 'closest_pair_peak_absZ', 'largest_gap', 'spacing_l1_distance_to_gue', 'validation_max_abs_error_vs_odlyzko', 'max_abs_S']


def pair(p):
    return {'n': p['n'], 't1': p['t1'], 't2': p['t2'], 'normGap': p.get('norm_gap') or facts['closest_pair']['value']['normalized_gap'], 'wide': {'t0': p['t_origin'], 'dt': p['dt'], 'z': p['z']}, 'zoom': {'t0': p['zoom']['t_origin'], 'dt': p['zoom']['dt'], 'z': p['zoom']['z']}}


out = {
    'facts': {k: facts[k]['value'] for k in keep},
    'zeros': zf['gamma'][:400],
    'lehmer': pair(pairs['lehmer']),
    'closest': pair(pairs['closest_dense']),
    'spacing': {'binStep': sp['bin_edges']['step'], 'bins': len(sp['s']), 'all': sp['all'], 'first10k': sp['first10k'], 'wigner': sp['wigner']['density'], 'poisson': sp['poisson']['density'], 'gue': sp['gue']['density']},
}
OUT.write_text(json.dumps(out, separators=(',', ':')) + '\n')
print(f'{OUT.relative_to(SITE)}: {OUT.stat().st_size / 1024:.0f} KB')
