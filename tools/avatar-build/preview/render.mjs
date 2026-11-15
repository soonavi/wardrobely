#!/usr/bin/env node
// Headless preview renderer: loads a .glb in real three.js inside Chromium and
// writes PNGs. This is how the avatar gets *looked at* during the build - a
// mesh that passes every structural check can still look wrong, and the only
// way to know is to render it.
//
//   node render.mjs --glb out/selv-human.glb --out shots/ [--config shots.json]
//
// The page is preview/viewer.html; it accepts a JSON "job" describing which
// nodes are visible, which morph weights are set, material tints and cameras.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..');
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
if (!args.glb || !args.out) {
  console.error('usage: render.mjs --glb <file.glb> --out <dir> [--config <shots.json>] [--runtime <bundle.js>]');
  process.exit(2);
}
const glbPath = path.resolve(args.glb);
const outDir = path.resolve(args.out);
fs.mkdirSync(outDir, { recursive: true });
const job = args.config ? JSON.parse(fs.readFileSync(path.resolve(args.config), 'utf8')) : { shots: [{ name: 'front' }] };
const threeDir = path.join(repo, 'app', 'node_modules', 'three');
const runtimePath = args.runtime ? path.resolve(args.runtime) : null;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let file;
  if (url.pathname === '/') file = path.join(here, 'viewer.html');
  else if (url.pathname === '/model.glb') file = glbPath;
  else if (url.pathname === '/runtime.js') file = runtimePath;
  else if (url.pathname.startsWith('/three/')) file = path.join(threeDir, url.pathname.slice('/three/'.length));
  else file = path.join(here, url.pathname);
  if (!file || !fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const size = job.size || [720, 960];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); else if (args.verbose) console.log(m.text()); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(`http://127.0.0.1:${port}/${runtimePath ? '?runtime=1' : ''}`);
await page.waitForFunction(() => window.__ready === true || window.__failed, null, { timeout: 120000 });
const failed = await page.evaluate(() => window.__failed);
if (failed) { console.error('viewer failed:', failed); errors.forEach((e) => console.error(e)); process.exit(1); }
const info = await page.evaluate(() => window.__info);
if (args.verbose) console.log(JSON.stringify(info, null, 1));
for (const shot of job.shots) {
  const report = await page.evaluate((s) => window.__shoot(s), shot);
  const file = path.join(outDir, `${shot.name}.png`);
  await page.locator('canvas').screenshot({ path: file });
  console.log(`${file}${report ? ' ' + JSON.stringify(report) : ''}`);
}
errors.forEach((e) => console.error(e));
await browser.close();
server.close();
