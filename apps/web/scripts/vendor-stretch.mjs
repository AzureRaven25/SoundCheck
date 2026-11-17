// Copies signalsmith-stretch (MIT) to public/vendor so it is served unbundled. The library serialises
// its own source into an AudioWorklet; bundler transforms (e.g. Turbopack's process polyfill) would
// leak into the worklet scope and break it.
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const entry = fileURLToPath(import.meta.resolve('signalsmith-stretch'));
mkdirSync(new URL('../public/vendor/', import.meta.url), { recursive: true });
copyFileSync(entry, new URL('../public/vendor/signalsmith-stretch.mjs', import.meta.url));
console.log('vendored signalsmith-stretch → public/vendor/signalsmith-stretch.mjs');
