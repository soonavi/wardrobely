# Selv — Waitlist Landing Page

A single, self-contained `index.html` (inline CSS + vanilla JS, no build step, no npm install) implementing the Selv waitlist landing page in the brand's visual language (digital lavender / acid green / warm ink / cream, Space Grotesk + Inter).

## Run it locally

Just open the file directly in a browser:

```
C:\Projects\WARDROBESPEC\landing\index.html
```

Double-click it, or drag it into a browser window. No server, no build step, no dependencies to install.

## Host it

This folder is deploy-ready as-is:

- **Vercel / Netlify (drag & drop)** — drag the whole `landing` folder onto the Vercel or Netlify web dashboard (or run `netlify deploy` / `vercel` from inside the folder). Both will serve `index.html` as a static site with zero config.
- **Any static host** (GitHub Pages, S3 + CloudFront, Cloudflare Pages, a plain nginx box, etc.) — just upload `index.html` (and the hero image once you've localized it, see below).

## Supabase wiring

The page talks directly to Supabase's REST API via `fetch()` — no SDK is loaded.

- **Project URL:** `https://tmldopeuctftnteerxjg.supabase.co`
- **Table:** `waitlist` — the form does `POST /rest/v1/waitlist` with `{ email, referred_by, source }` and expects the inserted row back (via `Prefer: return=representation`), reading `referral_code` off the response to build the user's personal invite link (`?ref=<code>`).
- **Live count:** `POST /rest/v1/rpc/waitlist_count` (an RPC granted to `anon`) returns the current signup count, rendered as "Join N already in line" (rounded, comma-formatted). If the count is low (< 25) or the request fails for any reason, the page falls back to "Be one of the first." — it never breaks the page.
- **Referrals:** an incoming `?ref=CODE` query param is read on load and sent as `referred_by` on signup.
- **Duplicate emails:** a `409` from Supabase (unique constraint) is treated as a friendly "you're already on the list" success state rather than an error.
- The embedded key (`sb_publishable_1JZLG6n_BMCk2-9dg76lSA_O6c_Ntli`) is a **publishable** anon-style key — it's safe to ship in client-side code as long as Row Level Security on the `waitlist` table only allows `insert` (not `select`/`update`/`delete`) for the anon role, and the `waitlist_count` RPC is the only read path exposed.

## Before this goes to production

- **Localize the hero image.** It's currently referenced directly from a CloudFront URL:
  `https://d8j0ntlcm91z4.cloudfront.net/user_3FMl9VUjLhJKarfvJj8VEEfaDdY/hf_20260714_185459_56847be6-6b35-4f89-ad47-135296299e61.png`
  Download it into this `landing` folder (e.g. `landing/hero.png`) and update the `<img src>` in `index.html` before launch — don't rely on a third-party CDN link staying alive indefinitely.
- Double-check Supabase RLS policies on `waitlist` before going live (insert-only for anon, no public select).
- "Selv" is a working brand concept — name, colors, and pricing are directional per the brand kit and may change before launch.
