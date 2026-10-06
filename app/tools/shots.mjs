/**
 * shots.mjs — screenshot every screen without a dev server, simulator or device.
 *
 * WHY THIS EXISTS
 * `expo start` is a heavy way to answer "what does this look like right now".
 * This builds the web target once (`expo export`), serves the static bundle,
 * and drives it with headless Chromium.
 *
 * WHY IT MOCKS RATHER THAN SIGNS IN
 * app/_layout.tsx gates hard: no session -> /sign-in, no age verdict ->
 * /sign-in, no build -> /onboarding. So an unauthenticated run can only ever
 * photograph the sign-in screen. Rather than create a real user — this project
 * has no staging database, so that would write real rows to production auth —
 * the run seeds a session into localStorage and answers Supabase's HTTP calls
 * from the fixtures below. Nothing leaves the machine and the live database is
 * never touched.
 *
 * The consequence to keep in mind: these are screenshots of the real app with
 * invented data. They are authoritative about layout, typography and colour,
 * and say nothing about whether a query is correct.
 *
 * THE 3D SCREENS ARE INDICATIVE ONLY. /tryon and /character run expo-gl +
 * three through react-native-web on SwiftShader, which is not the device GPU.
 *
 * Usage:  npm run shots          (build + shoot)
 *         npm run shots -- --no-build   (reuse an existing dist/)
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// playwright is a devDependency here, but fall back to a global install so the
// script also works in a bare container.
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require("/opt/node-tools/node_modules/playwright/index.js"));
}

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(APP, "dist");
const OUT = path.join(APP, "screenshots");
const PORT = 8099;

/**
 * The Supabase session lives in localStorage under `sb-<projectRef>-auth-token`,
 * so the ref has to match the URL the bundle was built against. Node does not
 * read .env on its own — Expo does that at build time — so read it here too,
 * and fail loudly rather than silently seeding a key nothing will ever look at.
 */
const readEnv = (key) => {
  if (process.env[key]) return process.env[key];
  for (const f of [".env.local", ".env"]) {
    const file = path.join(APP, f);
    if (!fs.existsSync(file)) continue;
    const m = fs.readFileSync(file, "utf8").match(new RegExp(`^${key}=(.*)$`, "m"));
    if (m) return m[1].trim();
  }
  return undefined;
};

const SUPABASE_URL = readEnv("EXPO_PUBLIC_SUPABASE_URL");
if (!SUPABASE_URL) {
  console.error("Missing EXPO_PUBLIC_SUPABASE_URL (checked env, .env.local, .env).\n" +
    "The screenshots need it only to derive the auth storage key — no request reaches it.");
  process.exit(1);
}
const PROJECT_REF = SUPABASE_URL.match(/https:\/\/([^.]+)\./)?.[1];

// --- fixtures --------------------------------------------------------------
const UID = "00000000-0000-4000-8000-000000000001";
const NOW = "2026-10-06T12:00:00Z";

/**
 * A labelled placeholder served over HTTP from this script's own server.
 * Deliberately not a data: URI — react-native-web's Image renders an <img>,
 * and the unencoded SVG data URIs fall foul of its loader, which surfaces in
 * the app as its own "Image unavailable" fallback rather than as an error.
 */
const img = (label, bg = "#D9D2C5") =>
  `http://localhost:${PORT}/__fixture/${encodeURIComponent(label)}--${encodeURIComponent(bg)}.svg`;

const profile = {
  id: UID,
  display_name: "Sample User",
  body_type: "rectangle",
  height_cm: 178,
  weight_kg: 72,
  build: "athletic",
  birth_year: 1998,
  age_verified_on: "2026-09-01",
  created_at: NOW,
};

const g = (id, category, name, color, brand, extra = {}) => ({
  id, user_id: UID, image_path: null, category, name, color, brand,
  tags: [], created_at: NOW, template_id: null,
  measurement_source: null, chest_cm: null, waist_cm: null, hip_cm: null,
  length_cm: null, shoulder_cm: null, sleeve_cm: null, inseam_cm: null,
  texture_path: null, source: "upload", processing_status: "ready",
  product_id: null, image_url: img(name), ...extra,
});

const garments = [
  g("g1", "top", "Oxford Shirt", "white", "Uniqlo", {
    measurement_source: "user", chest_cm: 104, shoulder_cm: 45, sleeve_cm: 64,
  }),
  g("g2", "bottom", "Straight Jeans", "indigo", "Levi's", {
    measurement_source: "estimated", waist_cm: 82, inseam_cm: 81,
  }),
  g("g3", "outerwear", "Wool Overcoat", "charcoal", "COS"),
  g("g4", "shoes", "Leather Derbies", "brown", "Grenson"),
  g("g5", "top", "Merino Crewneck", "navy", "Everlane"),
  g("g6", "accessory", "Canvas Tote", "ecru", "Baggu"),
];

const outfits = [
  {
    id: "o1", user_id: UID, name: "Weekday", created_at: NOW, occasion: "work",
    outfit_items: [
      { id: "oi1", outfit_id: "o1", garment_id: "g1", garment: garments[0] },
      { id: "oi2", outfit_id: "o1", garment_id: "g2", garment: garments[1] },
      { id: "oi3", outfit_id: "o1", garment_id: "g4", garment: garments[3] },
    ],
  },
  {
    id: "o2", user_id: UID, name: "Cold Morning", created_at: NOW, occasion: "casual",
    outfit_items: [
      { id: "oi4", outfit_id: "o2", garment_id: "g5", garment: garments[4] },
      { id: "oi5", outfit_id: "o2", garment_id: "g3", garment: garments[2] },
    ],
  },
];

const brands = [
  { id: "b1", name: "Meridian", slug: "meridian", logo_url: img("M", "#141026"),
    is_active: true, created_at: NOW },
];

const p = (id, name, cents, category, color) => ({
  id, brand_id: "b1", external_id: id, name,
  description: "A considered piece, cut for everyday wear.",
  category, color, price_cents: cents, sale_price_cents: null, currency: "USD",
  image_url: img(name), extra_image_urls: [], tryon_image_url: null,
  template_id: null, product_url: "https://example.com/" + id,
  commission_rate_bps: 800, sizes: ["XS", "S", "M", "L", "XL"], tags: [],
  in_stock: true, is_active: true, created_at: NOW, updated_at: NOW,
  brand: brands[0],   // PRODUCT_SELECT embeds brand:brands(*)
});

const products = [
  p("p1", "Relaxed Linen Shirt", 11800, "top", "sand"),
  p("p2", "Pleated Trouser", 14500, "bottom", "black"),
  p("p3", "Cropped Trench", 32000, "outerwear", "stone"),
  p("p4", "Silk Slip Dress", 24800, "dress", "plum"),
];

const TABLES = {
  profiles: [profile],
  garments,
  outfits,
  outfit_items: outfits.flatMap((o) => o.outfit_items),
  brands,
  brand_products: products,
  avatars: [],
  wishlist_items: products.slice(0, 2).map((pr, i) => ({
    id: "w" + i, user_id: UID, product_id: pr.id, created_at: NOW,
    product: pr, brand: brands[0],
  })),
  product_try_ons: [],
  affiliate_conversions: [],
  assistant_preferences: [],   // assistant is off; no row means "never asked"
  assistant_suggestions: [],
  waitlist_signups: [],
};

const SESSION = {
  access_token: "fixture-access-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365,
  refresh_token: "fixture-refresh-token",
  user: {
    id: UID, aud: "authenticated", role: "authenticated",
    email: "sample@selv.app", email_confirmed_at: NOW, phone: "",
    created_at: NOW, updated_at: NOW, app_metadata: { provider: "email" },
    user_metadata: {}, identities: [],
  },
};

// --- static server with SPA fallback ---------------------------------------
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".ttf": "font/ttf", ".woff": "font/woff",
  ".woff2": "font/woff2", ".ico": "image/x-icon", ".map": "application/json" };

const server = http.createServer((req, res) => {
  const p0 = decodeURIComponent(req.url.split("?")[0]);
  if (p0.startsWith("/__fixture/")) {
    const [label, bg] = path.basename(p0, ".svg").split("--");
    res.writeHead(200, { "Content-Type": "image/svg+xml" });
    return res.end(
      `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500">
         <rect width="400" height="500" fill="${bg || "#D9D2C5"}"/>
         <text x="200" y="250" font-family="sans-serif" font-size="24"
               fill="#5B5368" text-anchor="middle">${label}</text>
       </svg>`);
  }
  let f = path.join(DIST, p0);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    const idx = path.join(f, "index.html");
    f = fs.existsSync(idx) ? idx : path.join(DIST, "index.html");
  }
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});

const ROUTES = [
  ["01-sign-in",       "/sign-in",       { anon: true }],
  ["02-onboarding",    "/onboarding",    { noBuild: true }],
  ["03-wardrobe",      "/wardrobe"],
  ["04-outfits",       "/outfits"],
  ["05-shop",          "/shop"],
  ["06-tryon",         "/tryon"],
  ["07-profile",       "/profile"],
  ["08-add-garment",   "/add-garment"],
  ["09-garment-detail","/garment/g1"],
  ["10-product-detail","/product/p1"],
  ["11-wishlist",      "/wishlist"],
  ["12-orders",        "/orders"],
  ["13-character",     "/character"],
  ["14-create-avatar", "/create-avatar"],
  ["15-brand",         "/brand/b1"],
];

const run = async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch({
    args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox",
           "--disable-dev-shm-usage"],
  });
  fs.mkdirSync(OUT, { recursive: true });
  const report = [];

  for (const [name, route, opts = {}] of ROUTES) {
    const ctx = await browser.newContext({
      viewport: { width: 393, height: 852 }, deviceScaleFactor: 2,
      isMobile: true, hasTouch: true,
    });

    // Answer every Supabase call from fixtures. Nothing reaches the network.
    await ctx.route("**/*.supabase.co/**", async (routeReq) => {
      const req = routeReq.request();
      const url = new URL(req.url());
      // These responses are cross-origin (supabase.co vs localhost), so the
      // count header has to be explicitly exposed or supabase-js cannot read
      // it and every `count: "exact"` query silently reports 0.
      const CORS = {
        "access-control-allow-origin": "*",
        "access-control-expose-headers": "content-range, x-total-count",
      };
      const json = (body, status = 200, extra = {}) =>
        routeReq.fulfill({
          status,
          headers: { ...CORS, "content-type": "application/json", ...extra },
          body: JSON.stringify(body),
        });

      if (url.pathname.startsWith("/storage/")) {
        return routeReq.fulfill({ status: 302, headers: { location: img("image") } });
      }
      if (url.pathname.startsWith("/auth/")) {
        if (url.pathname.endsWith("/user")) return json(SESSION.user);
        if (url.pathname.endsWith("/logout")) return json({});
        return json(SESSION);
      }
      if (url.pathname.startsWith("/rest/v1/rpc/")) {
        const fn = url.pathname.split("/").pop();
        if (fn === "record_age_check") return json({ allowed: true, age_verified_on: "2026-09-01" });
        if (fn === "create_affiliate_click") return json({ click_token: "fixture-token" });
        return json(null);
      }
      if (url.pathname.startsWith("/rest/v1/")) {
        const table = url.pathname.replace("/rest/v1/", "").split("?")[0];
        if (!["GET", "HEAD"].includes(req.method())) return json({}, 204);
        let rows = TABLES[table] ?? [];
        if (table === "profiles" && opts.noBuild) rows = [{ ...profile, build: null }];

        // Emulate enough PostgREST to keep .eq()/.in()/.maybeSingle() honest.
        // Without this every detail screen gets the whole table back and
        // .single() fails with "multiple (or no) rows returned".
        for (const [key, raw] of url.searchParams) {
          if (["select", "order", "limit", "offset", "and", "or"].includes(key)) continue;
          const [op, ...rest] = raw.split(".");
          const val = rest.join(".");
          rows = rows.filter((row) => {
            const cell = row[key];
            if (op === "eq")  return String(cell) === val;
            if (op === "neq") return String(cell) !== val;
            if (op === "is")  return val === "null" ? cell == null : String(cell) === val;
            if (op === "in")  return val.replace(/[()]/g, "").split(",").includes(String(cell));
            return true;
          });
        }

        const order = url.searchParams.get("order");
        if (order) {
          const [col, dir] = order.split(".");
          rows = [...rows].sort((a, b) =>
            (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === "desc" ? -1 : 1));
        }

        // `.select(..., { count: "exact" })` reads the total off Content-Range,
        // not the body — without it the wardrobe header renders "0/25 items"
        // while the grid below is full.
        const prefer = req.headers()["prefer"] || "";
        if (prefer.includes("count=")) {
          const n = rows.length;
          return json(req.method() === "HEAD" ? [] : rows, 200,
            { "content-range": `0-${Math.max(n - 1, 0)}/${n}` });
        }

        // supabase-js asks for a bare object (not an array) on .single()/.maybeSingle().
        const accept = req.headers()["accept"] || "";
        if (accept.includes("pgrst.object")) {
          if (rows.length === 1) return json(rows[0]);
          return json({ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" }, 406);
        }
        return json(rows);
      }
      return json({});
    });

    if (!opts.anon) {
      await ctx.addInitScript(
        ([ref, session]) => {
          try {
            window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session));
          } catch {}
        },
        [PROJECT_REF, SESSION],
      );
    }

    const page = await ctx.newPage();
    const errs = [];
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 150)); });
    page.on("pageerror", (e) => errs.push("PAGEERROR " + String(e).slice(0, 150)));
    try {
      await page.goto(`http://localhost:${PORT}${route}`, { waitUntil: "networkidle", timeout: 45000 });
    } catch (e) { errs.push("NAV " + String(e).slice(0, 110)); }
    await page.waitForTimeout(4000); // fonts + auth bootstrap + redirect settle

    const landed = new URL(page.url()).pathname;
    const text = (await page.evaluate(() => document.body.innerText).catch(() => "")) 
      .replace(/\s+/g, " ").trim();
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    report.push({ name, requested: route, landedOn: landed, chars: text.length,
                  preview: text.slice(0, 90), errors: [...new Set(errs)].slice(0, 2) });
    await ctx.close();
  }

  await browser.close();
  server.close();
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  for (const r of report) {
    const ok = r.landedOn.replace(/\/$/, "") === r.requested.replace(/\/$/, "") ? "  " : "->";
    console.log(`${r.name.padEnd(19)} ${ok} ${r.landedOn.padEnd(18)} ${String(r.chars).padStart(5)}ch | ${r.preview}`);
    if (r.errors.length) console.log(`${"".padEnd(19)}    ! ${r.errors.join(" | ")}`);
  }
  console.log(`\n${report.length} screenshots -> ${OUT}`);
};

run().catch((e) => { console.error(e); server.close(); process.exit(1); });
