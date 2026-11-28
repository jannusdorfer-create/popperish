import {defineConfig} from 'vite';

// Static pages: / (the landing that lists the simulations), /four-color (the map lab) and /npc (Be the NPC) and /riemann (Hunt the zeros) and /escher (Get lost) and /fall (Trip Karl) and /slime (Grow a railway). site/ also holds the old
// GitHub Pages files (index.html, terms, privacy, the TikTok callback), so the pages live in src/ and Vite builds from there.
const page = (f: string) => new URL(`./src/${f}`, import.meta.url).pathname;
export default defineConfig({
  root: 'src',
  publicDir: '../public',
  build: {outDir: '../dist', emptyOutDir: true, rollupOptions: {input: {home: page('index.html'), fourColor: page('four-color.html'), npc: page('npc.html'), riemann: page('riemann.html'), escher: page('escher.html'), fall: page('fall.html'), slime: page('slime.html'), privacy: page('privacy.html')}}},
});
