// Our videos on the site: public/data/videos.json (written by scripts/videos.py) and a click-to-load player.
// Until someone presses play, a video is our own cover from public/thumbs; only the click loads YouTube's player
// (youtube-nocookie.com), so no request goes to Google before that.

export type Video = {id: string; slug: string; title: string; date: string; thumb: string; blurb: string; sim?: string};

export const loadVideos = (): Promise<Video[]> => fetch('/data/videos.json').then((r) => (r.ok ? r.json() : []), () => []);
export const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
export const dateLabel = (iso: string) => new Date(iso).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'});

const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" fill="currentColor"/></svg>';
let current: {frame: HTMLIFrameElement; facade: HTMLButtonElement} | null = null;

/** A button with our cover and the gold play ring; pressing it swaps in the YouTube player, one player at a time. */
export const facade = (v: Video) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'facade';
  b.setAttribute('aria-label', `Play ${v.title}`);
  const img = Object.assign(document.createElement('img'), {src: v.thumb, alt: '', width: 640, height: 360, loading: 'lazy', decoding: 'async'});
  const ring = Object.assign(document.createElement('span'), {className: 'ring', innerHTML: PLAY});
  b.append(img, ring);
  b.addEventListener('click', () => {
    const f = document.createElement('iframe');
    f.className = 'facade';
    f.title = v.title;
    f.src = `https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1&rel=0`;
    f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen; web-share';
    f.allowFullscreen = true;
    f.referrerPolicy = 'strict-origin-when-cross-origin';
    if (current) (current.frame.closest('.tile')?.classList.remove('playing'), current.frame.replaceWith(current.facade));
    b.closest('.tile')?.classList.add('playing');
    b.replaceWith(f);
    current = {frame: f, facade: b};
    f.focus();
  });
  return b;
};
