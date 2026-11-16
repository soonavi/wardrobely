#!/usr/bin/env node
// Runs the exported web build of the app in headless Chromium against a mocked
// Supabase, walks the main screens and writes a screenshot of each.
//
// This exists because "the code typechecks" and "the screen shows a person"
// are different claims, and only one of them was ever being checked.
//
//   cd app && EXPO_PUBLIC_SUPABASE_URL=https://selvtest.supabase.co \
//     EXPO_PUBLIC_SUPABASE_ANON_KEY=test-anon-key npx expo export --platform web --output-dir /tmp/selv-web
//   node tools/webcheck/run.mjs --dist /tmp/selv-web --out /tmp/selv-shots [--scenario new-user]
//
// The Supabase URL the bundle was built with must be the mock origin below.
// Nothing here talks to a real backend.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
if (!args.dist || !args.out) {
  console.error('usage: run.mjs --dist <expo web export dir> --out <screenshot dir> [--scenario returning|new-user] [--only name,name]');
  process.exit(2);
}
const DIST = path.resolve(args.dist);
const OUT = path.resolve(args.out);
const SCENARIO = args.scenario || 'returning';
const ONLY = typeof args.only === 'string' ? new Set(args.only.split(',')) : null;
fs.mkdirSync(OUT, { recursive: true });

const MOCK_ORIGIN = 'https://selvtest.supabase.co';
const UID = '11111111-2222-4333-8444-555555555555';
const NOW = Math.floor(Date.now() / 1000);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, role: 'authenticated', aud: 'authenticated', exp: NOW + 86400, iat: NOW })}.c2lnbmF0dXJl`;
const USER = {
  id: UID, aud: 'authenticated', role: 'authenticated', email: 'tester@example.com',
  email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: { provider: 'email' }, user_metadata: {},
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
};
const SESSION = { access_token: JWT, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 86400, expires_at: NOW + 86400, user: USER };

const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'));
const tables = structuredClone(fixtures.tables);
if (SCENARIO === 'new-user') {
  tables.profiles[0].build = null;
  tables.avatars = [];
  tables.garments = [];
  tables.outfits = [];
}
for (const rows of Object.values(tables)) for (const r of rows) for (const k of Object.keys(r)) if (r[k] === '$UID') r[k] = UID;

// ---- static server with SPA fallback --------------------------------------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.glb': 'model/gltf-binary', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let file = path.join(DIST, decodeURIComponent(url.pathname));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// ---- mocked Supabase -------------------------------------------------------
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const seen = new Map();
const writes = [];
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range' };

function filterRows(rows, params) {
  let out = rows;
  for (const [key, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key)) continue;
    const m = /^(eq|in|is|neq)\.(.*)$/.exec(raw);
    if (!m) continue;
    const [, op, val] = m;
    if (op === 'eq') out = out.filter((r) => String(r[key]) === val);
    if (op === 'neq') out = out.filter((r) => String(r[key]) !== val);
    if (op === 'in') { const set = new Set(val.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, ''))); out = out.filter((r) => set.has(String(r[key]))); }
    if (op === 'is') out = out.filter((r) => (val === 'null' ? r[key] == null : String(r[key]) === val));
  }
  const limit = params.get('limit');
  return limit ? out.slice(0, Number(limit)) : out;
}

async function handle(route) {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  const key = `${method} ${url.pathname}`;
  seen.set(key, (seen.get(key) || 0) + 1);
  const json = (body, status = 200, headers = {}) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });

  if (url.pathname.startsWith('/auth/v1/user')) return json(USER);
  if (url.pathname.startsWith('/auth/v1/token')) return json(SESSION);
  if (url.pathname.startsWith('/auth/v1/logout')) return route.fulfill({ status: 204, headers: cors });
  if (url.pathname.startsWith('/auth/v1/')) return json({});
  if (url.pathname.startsWith('/rest/v1/rpc/')) {
    const fn = url.pathname.split('/').pop();
    writes.push(`rpc ${fn}`);
    return json(fixtures.rpc?.[fn] ?? null);
  }
  if (url.pathname.startsWith('/rest/v1/')) {
    const table = url.pathname.split('/')[3];
    const rows = tables[table] ?? (tables[table] = []);
    const single = (req.headers().accept || '').includes('vnd.pgrst.object');
    if (method === 'GET' || method === 'HEAD') {
      const out = filterRows(rows, url.searchParams);
      if (single) return out.length ? json(out[0]) : json({ code: 'PGRST116', message: 'no rows', details: 'The result contains 0 rows' }, 406);
      return json(out, 200, { 'content-range': `0-${Math.max(out.length - 1, 0)}/${out.length}` });
    }
    let body = {};
    try { body = JSON.parse(req.postData() || '{}'); } catch { /* not json */ }
    writes.push(`${method} ${table} ${JSON.stringify(body).slice(0, 160)}`);
    if (method === 'DELETE') { const gone = filterRows(rows, url.searchParams); tables[table] = rows.filter((r) => !gone.includes(r)); return json(single ? gone[0] ?? null : gone); }
    const incoming = Array.isArray(body) ? body : [body];
    const result = [];
    for (const patch of incoming) {
      let target = method === 'PATCH' ? filterRows(rows, url.searchParams)[0] : rows.find((r) => (patch.id && r.id === patch.id) || (patch.user_id && r.user_id === patch.user_id && table === 'avatars'));
      if (!target) { target = { id: patch.id || `mock-${table}-${rows.length + 1}`, created_at: new Date().toISOString() }; rows.push(target); }
      Object.assign(target, patch);
      result.push(target);
    }
    return json(single ? result[0] : result, method === 'POST' ? 201 : 200);
  }
  if (url.pathname.startsWith('/storage/v1/object/sign')) return json({ signedURL: `/object/sign/mock.png?token=mock` });
  if (url.pathname.startsWith('/storage/v1/')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'image/png' }, body: PNG_1PX });
  if (url.pathname.startsWith('/functions/v1/')) return json({});
  return json({});
}

// ---- drive the app ---------------------------------------------------------
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: false });
await context.addInitScript(([session]) => {
  try { window.localStorage.setItem('sb-selvtest-auth-token', JSON.stringify(session)); } catch { /* storage blocked */ }
}, [SESSION]);
await context.route(`${MOCK_ORIGIN}/**`, handle);
const page = await context.newPage();
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(`[console.error] ${m.text().slice(0, 400)}`); });
page.on('pageerror', (e) => problems.push(`[pageerror] ${String(e.message).slice(0, 400)}`));
page.on('requestfailed', (r) => { if (!r.url().startsWith('data:')) problems.push(`[requestfailed] ${r.url().slice(0, 160)} ${r.failure()?.errorText}`); });

const settle = (ms = 1200) => page.waitForTimeout(ms);
async function shot(name) {
  if (ONLY && !ONLY.has(name)) return;
  const file = path.join(OUT, `${SCENARIO}-${name}.png`);
  await page.screenshot({ path: file });
  console.log(file);
}
async function go(route, wait = 2500) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'load' });
  await settle(wait);
}
async function tapText(text, opts = {}) {
  const el = page.getByText(text, { exact: opts.exact ?? true }).first();
  if (await el.count()) { await el.click({ timeout: 4000 }).catch((e) => problems.push(`[tap ${text}] ${e.message.split('\n')[0]}`)); await settle(opts.wait ?? 900); return true; }
  problems.push(`[tap ${text}] not found`);
  return false;
}

const steps = typeof args.steps === 'string' ? JSON.parse(fs.readFileSync(path.resolve(args.steps), 'utf8')) : fixtures.scenarios[SCENARIO];
for (const step of steps) {
  if (step.go) await go(step.go, step.wait);
  if (step.tap) await tapText(step.tap, step);
  if (step.drag) {
    const box = { x: 195, y: step.drag.y ?? 300 };
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    await page.mouse.move(box.x + step.drag.dx, box.y, { steps: 8 });
    await page.mouse.up();
    await settle(500);
  }
  if (step.eval) console.log(`eval: ${JSON.stringify(await page.evaluate(step.eval).catch((e) => String(e)))}`);
  if (step.scroll) { await page.mouse.wheel(0, step.scroll); await settle(500); }
  if (step.wait && !step.go && !step.tap) await settle(step.wait);
  if (step.shot) await shot(step.shot);
}

console.log('\nrequests:');
for (const [k, n] of [...seen].sort()) console.log(`  ${String(n).padStart(3)}  ${k}`);
if (writes.length) { console.log('\nwrites:'); for (const w of writes) console.log(`  ${w}`); }
console.log(`\nproblems: ${problems.length}`);
for (const p of [...new Set(problems)].slice(0, 40)) console.log(`  ${p}`);
await browser.close();
server.close();
process.exit(0);
