// node render.mjs <svg> <out.png> <width> <height> [bg]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const [svgPath, out, w, h, bg] = process.argv.slice(2);
const dir = path.dirname(path.resolve(svgPath));
let svg = fs.readFileSync(svgPath, 'utf8');
// inline <image href="x.svg"> references as data URIs so the page needs no file access
svg = svg.replace(/href="([\w.-]+\.svg)"/g, (_, f) => `href="data:image/svg+xml;base64,${fs.readFileSync(path.join(dir, f)).toString('base64')}"`);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
await p.setContent(`<html><body style="margin:0;background:${bg ?? 'transparent'}">${svg.replace('<svg ', `<svg width="${w}" height="${h}" `)}</body></html>`);
await p.screenshot({ path: out, omitBackground: !bg });
await b.close();
