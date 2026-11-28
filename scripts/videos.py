#!/usr/bin/env python3
"""Released Popperish videos for the site: public/data/videos.json (newest first) and a 640 px webp cover per video.

Reads math/<slug>/publish.json (+ meta.json for the one-line summary). A video is in when it has a videoId and its release
time (publishAt if set, else publishedAt) is not in the future. Run it before a deploy: python3 scripts/videos.py
"""
import json, os, shutil, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
MATH = SITE.parent / 'math'
THUMBS, OUT = SITE / 'public' / 'thumbs', SITE / 'public' / 'data' / 'videos.json'
SIMS = {'four-color': '/four-color', 'gta-npc': '/npc', 'riemann': '/riemann', 'escher-world': '/escher', 'body-fall': '/fall', 'slime-tokyo': '/slime'}  # episode slug -> its simulation page; add a line per new simulation


def cover(slug_dir: Path, pub: dict) -> Path | None:
    # publish.json names the cover that is live on YouTube (after an A/B swap thumb.png can be the old one)
    names = [Path(pub.get('thumbnail') or '').name, 'thumb.png', 'thumb.jpg']
    return next((slug_dir / n for n in names if n and (slug_dir / n).is_file()), None)


def webp(src: Path, dst: Path) -> None:
    """640 px wide webp, redone only when the source file (or its mtime) changed: dst carries the source's mtime."""
    if dst.is_file() and dst.stat().st_mtime == src.stat().st_mtime:
        return
    if shutil.which('cwebp'):  # this machine's ffmpeg is built without libwebp
        cmd = ['cwebp', '-quiet', '-q', '80', '-m', '6', '-resize', '640', '0', '-metadata', 'none', str(src), '-o', str(dst)]
    else:
        cmd = ['ffmpeg', '-v', 'error', '-y', '-i', str(src), '-vf', 'scale=640:-2:flags=lanczos', '-c:v', 'libwebp', '-quality', '80', str(dst)]
    subprocess.run(cmd, check=True)
    st = src.stat()
    os.utime(dst, (st.st_atime, st.st_mtime))


def main() -> None:
    now = datetime.now(timezone.utc)
    THUMBS.mkdir(parents=True, exist_ok=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    videos, skipped = {}, []
    for pub_file in sorted(MATH.glob('*/publish.json')):
        d, slug = pub_file.parent, pub_file.parent.name
        try:
            pub = json.loads(pub_file.read_text())
        except ValueError as e:
            skipped.append(f'{slug}: bad publish.json ({e})')
            continue
        vid, when = pub.get('videoId'), pub.get('publishAt') or pub.get('publishedAt')
        if not vid or not when:
            continue
        at = datetime.fromisoformat(when.replace('Z', '+00:00'))
        at = at if at.tzinfo else at.replace(tzinfo=timezone.utc)
        if at > now:
            skipped.append(f'{slug}: releases {when}')
            continue
        try:
            meta = json.loads((d / 'meta.json').read_text())
        except (OSError, ValueError):
            meta = {}
        src = cover(d, pub)
        if not src:
            skipped.append(f'{slug}: no cover')
            continue
        webp(src, THUMBS / f'{slug}.webp')
        title = pub.get('title') or meta.get('title') or slug  # publish.json holds the live title (Monopoly and Risk were retitled)
        blurb = (meta.get('description') or '').split('\n')[0].strip()
        videos.setdefault(vid, {'id': vid, 'slug': slug, 'title': title, 'date': at.strftime('%Y-%m-%dT%H:%M:%SZ'), 'thumb': f'/thumbs/{slug}.webp', 'blurb': blurb, **({'sim': SIMS[slug]} if slug in SIMS else {})})
    out = sorted(videos.values(), key=lambda v: v['date'], reverse=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1) + '\n')
    print(f'{len(out)} videos -> {OUT.relative_to(SITE)} (newest: {out[0]["slug"] if out else "none"})')
    for s in skipped:
        print('  skipped', s)


if __name__ == '__main__':
    sys.exit(main())
