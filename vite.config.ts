import {defineConfig} from 'vite';

// Two static pages: / (the landing that lists the simulations) and /four-color (the map lab). site/ also holds the old
// GitHub Pages files (index.html, terms, privacy, the TikTok callback), so the pages live in src/ and Vite builds from there.
const page = (f: string) => new URL(`./src/${f}`, import.meta.url).pathname;
export default defineConfig({
  root: 'src',
  publicDir: '../public',
  build: {outDir: '../dist', emptyOutDir: true, rollupOptions: {input: {home: page('index.html'), fourColor: page('four-color.html'), privacy: page('privacy.html')}}},
});
