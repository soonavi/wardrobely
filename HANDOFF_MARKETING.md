# Selv — Marketing Handoff

Handoff brief for an agent picking up the **marketing** workstream. Everything below reflects the project state as of this session (July 2026). The product side is being built in parallel; your job is positioning, creative, growth, and launch.

---

## 1. What the app is (one paragraph)

**Selv** is a Gen Z virtual-wardrobe + 3D try-on app. A user **designs a customizable 3D character** in a character creator (skin tone, face shape, eyes, hair, brows, facial hair, body type, accessories — no photo, no measurements), digitizes **their real clothes** (photograph an item → it becomes a 3D wardrobe piece), mixes and saves outfits on their character, and can **try on items they don't own** before buying ("shop the fit"). A social outfit-sharing feed is planned for **Phase 2** (not in v1). It's cross-platform (Expo/React Native), iOS-first, backed by Supabase.

**Positioning (one line):** *Your closet, but make it 3D — dress up as yourself.*
**The wedge:** the only product combining (1) a 3D character *you design yourself* + (2) *your actual clothes* + (3) a TikTok-native sharing loop. Competitors have at most two of the three.

**Pivot note (2026-07-20):** the app used to plan a photo + measurement-derived avatar; that's been dropped for a character creator (see `AVATAR_CREATOR_PLAN.md`). It's a privacy win (no face photo, no biometric-adjacent data collected for the avatar) and a stronger content hook ("design your character" performs very well on TikTok). Garment photos (photographing clothes) are unaffected.

---

## 2. Naming status — IMPORTANT

- Working name is **Selv** (chosen this session). It captures the core mechanic ("digital twin") and doubles as a social hook ("twinning" = matching fits).
- The earlier name **"Drobe" was dropped** — it's already an active competitor (joindrobe.com).
- **Not final. Trademark/domain clearance not yet done.** Shortlist alternates: **Fitcast**, **Mimic**, **Fitroom**, **Wardro**. Run a formal clearance before locking, and before any paid spend that bakes the name into creative.

---

## 3. Brand identity (use consistently in all creative)

- **Colors:** digital lavender `#8B7CFF` (deep `#5B49D6`), acid green `#C7F94B` (deep `#A6E01F`), warm ink `#141026`, cream `#F5F2EA`. Avatar gradient = lavender → acid.
- **Type:** Space Grotesk (chunky display / hero) + Inter (UI/body). Both on Google Fonts.
- **Logo (chosen):** the **"Reflection"** direction — lowercase `selv` wordmark with a faded mirrored reflection beneath it (your digital self). App icon = a lavender dot + its acid-green reflection. Full system + assets in `SELV_LOGO_REFLECTION.html` / `selv-icon.svg`. (Pending trademark clearance; don't order merch yet.)
- **Vibe (3 words):** Playful · Confident · Iconic. Deliberately NOT the beige "clean girl" pastel look every closet app uses — more maximalist/kinetic (CapCut/BeReal/Wrapped energy).
- **Voice:** talks like a group chat, not a fashion magazine. Hypes the user, never grades them ("this fit ATE," not "you look great"). Slang used correctly and sparingly.

---

## 4. Target audience

- **Primary — "Maya, 19":** TikTok-native, posts fit checks, owns 60–150 items but "has nothing to wear," buys Shein/Zara/Depop/UO, screenshots inspo she never acts on. Responds to humor, speed, peer creators, low-stakes participation.
- **Secondary — "Jordan, 24":** resale-curious (Depop/Vinted), sustainability- and cost-per-wear-motivated, shares more on IG/close friends than public TikTok.
- **Where they are:** TikTok (primary), Instagram Reels/Stories, Pinterest (discovery), Depop/Vinted, private group chats/BeReal for pre-public sharing.

---

## 5. Pricing (updated this session — reflect everywhere)

- **Free:** 3D avatar + **up to 25 wardrobe items** + unlimited outfit mixing + save/share fit cards. (The 25-item cap is now enforced in the app; "unlimited wardrobe" is NOT free.)
- **Selv+ — $6.99/mo or $39.99/yr:** unlimited wardrobe, try-on of items you don't own, wardrobe analytics (cost-per-wear), priority rendering, early access.
- **Try-before-you-buy:** affiliate commerce (commission on items tried-on then purchased) — never changes the user's price.
- The free cap number lives in one constant (`app/src/lib/pricing.ts`, `FREE_WARDROBE_LIMIT = 25`) and can be changed if strategy shifts.

---

## 6. Growth strategy & channels (from MARKETING_STRATEGY.md)

- **TikTok/Reels organic** is the core engine. 5 content pillars: (1) digitize-my-closet transformation, (2) design your character / "wait till you see mine," (3) try-before-you-buy saves, (4) outfit-remix / capsule math, (5) fit battles/duets.
- **Micro-creator seeding** (75–150 creators, 10K–100K followers, fashion/thrift niche), coordinated launch-week waves; macro reserved for the launch-day hero moment; convert organic over-performers to paid Spark Ads.
- **Pinterest** — auto-published outfit-card pins; Gen Z discovery.
- **Waitlist referral** — position-jump mechanic (each referral moves you up; milestones unlock Selv+).
- **The share-card loop ("every shared outfit is an ad")** — each saved outfit auto-generates a polished vertical share card of the user's own designed character, watermarked + "build your own" link. Modeled on Spotify Wrapped. This is the single highest-leverage organic mechanic — prioritize it in messaging.
- **North-star metric:** Weekly Avatars Styled (unique users who build ≥1 complete outfit in 7 days). Activation target: >50% reach "first outfit on their own character" in session 1.

---

## 7. Launch plan (time-sensitive)

- Product is **pre-launch**; target ship ~10 days out (store launch late July 2026). The **waitlist is live now** (see §9).
- 4-week arc in MARKETING_STRATEGY.md §7: Week 1 pre-launch build + creator outreach; Week 2 launch + Product Hunt + creator wave 1; Week 3 sustain + convert organic winners to paid; Week 4 compound + Phase-2 prep.
- 30/60/90 targets: Day 30 ≈ 15–25k downloads; Day 60 ≈ 60–100k, Week-4 retention ≥20%; Day 90 Phase-2 social feed beta, 150k+.

---

## 8. Marketing assets that already exist (files in `C:\Projects\WARDROBESPEC\`)

- **`MARKETING_STRATEGY.md`** — full GTM: competitive teardown (Whering, Acloset, DRESSX, Doji, Combyne, etc.), positioning, personas, channels, 4-week launch timeline, **10 TikTok/Reels video concepts with hooks**, pricing, metrics, body-image section, and a **COPY BANK** (3 taglines, App Store title/subtitle, 30-word description, 5 social captions). Start here.
- **`BRAND_MARKETING_KIT.html`** — visual brand board: logo/palette/type, an "avatar realism" section with the generated photoreal renders, the **5 App Store screen mockups**, a landing-page hero mock, **3 social ad concepts**, and the name shortlist. Open in a browser.
- **`APP_STORE_LISTING.md`** — store title/subtitle/keywords, description, age-rating rationale, permission strings, 5-screenshot plan. Pricing copy already updated to the 25-item free cap.
- **`legal/PRIVACY_POLICY.md`, `legal/DATA_HANDLING.md`, `LAUNCH_CHECKLIST.md`** — compliance context (matters for ad claims + store review).
- **`landing/index.html` + `landing/README.md`** — the live waitlist page source.

### Generated media (hosted on CloudFront — download for production before paid use)
**Note: these were generated pre-pivot as photoreal-avatar concept art and no longer match the shipped product (a stylized, user-designed character, not a photoreal likeness). Keep for historical reference; don't use as-is in new creative — regenerate against the actual character-creator/SVG-character look.**
- **Hero image** (woman + glowing 3D avatar twin, brand palette): `https://d8j0ntlcm91z4.cloudfront.net/user_3FMl9VUjLhJKarfvJj8VEEfaDdY/hf_20260714_185459_56847be6-6b35-4f89-ad47-135296299e61.png`
- **Full-body photoreal avatar render (superseded concept art):** `https://d8j0ntlcm91z4.cloudfront.net/user_3FMl9VUjLhJKarfvJj8VEEfaDdY/hf_20260714_185458_f9841c58-d82f-446d-9284-03a5033e73f1.png`
- (Product asset, not marketing) textured+rigged 3D GLB avatar: `https://d3u0tzju9qaucj.cloudfront.net/7d051b5a-7bfe-49fe-a484-24e7b3a9458a/9b68bd64-f86f-4c29-81e7-df1ee7d46609.glb`

---

## 9. What's LIVE right now

- **Waitlist landing page (production):** **https://selv-waitlist.vercel.app**
  - Vercel project `selv-waitlist`, team id `team_xrmRFIHuwqPhALTReSrDNewn`. Redeploy by reading `landing/index.html` and calling `deploy_to_vercel` (target production, single `index.html`, no projectSettings).
- **Backend — Supabase project `wardrobe-app`** (ref `tmldopeuctftnteerxjg`, `https://tmldopeuctftnteerxjg.supabase.co`):
  - `waitlist` table: `email`, `referral_code` (auto), `referred_by`, `source`, `created_at`. Public insert allowed (RLS). Live count via `rpc/waitlist_count`. The publishable key is already embedded in `landing/index.html` (safe — insert-only).
  - Use this to report signups and power referral mechanics.

---

## 10. IN-FLIGHT TASK — "plan out and build ads" (pick this up first)

The user asked to **plan and build ads**, and the clarifying questions didn't get answered before handoff. Re-ask (or proceed on the recommended defaults) these three:

1. **Formats:** both static + short video (recommended) / static only / video only / concepts+storyboards only.
2. **Goal right now:** waitlist signups (recommended, since the waitlist is live and launch is ~days out) / app installs at launch / brand awareness.
3. **Platforms (multi):** TikTok, Instagram Reels+Stories, Instagram/Meta feed, Pinterest.

**Recommended default if the user just says "go":** build **both** — ~5 static vertical/square ad creatives + **1–2 short vertical video ads**, objective = **waitlist signups now** (CTA "Join the waitlist" → selv-waitlist.vercel.app, with UTM params), primary platforms **TikTok + IG Reels**, plus a couple 1:1/4:5 for Meta feed and 2:3 for Pinterest. Map creatives to the 5 content pillars (§6) and the copy bank. Then produce: an `ADS_PLAN.md` (funnel, budget tiers, targeting, A/B matrix of hook × format, UTM/measurement) and an HTML ad gallery, and generate the actual creatives.

### Tools available for building ads
- **Image generation** — Higgsfield MCP `generate_image`, model `nano_banana_pro` (good with baked-in text). **Param quirk:** put `model` AND `prompt` inside the `params` object (top-level `model` alone throws). Poll results with `job_display`.
- **Video generation** — Higgsfield `generate_video` (image-to-video from the hero/ad frames, or text-to-video). Heavier; confirm credits.
- **Canva MCP**, the **visualize** widget (inline SVG/HTML mockups), **Vercel** (deploy landing variants for A/B), **scheduled tasks** (recurring posting reminders/reports).

---

## 11. Non-negotiables & gotchas

- **Body-image guardrails (hard constraint):** the avatar is a *styling* tool, never a *body-evaluation* tool. No before/after body language, no weight-loss framing, no numeric body/outfit "scores," no beauty-bias imagery. Commit to diverse bodies/skin tones in all creative. Copy hypes, never judges. (Full section in MARKETING_STRATEGY.md §11.)
- **No photo/scan framing for the avatar:** the avatar is built entirely in a character creator (skin, face, eyes, hair, brows, facial hair, body type, accessories) — don't write or generate ad creative implying a selfie, face scan, or body scan produces the avatar. Camera/photo imagery in creative should only ever be about the user's *clothes*.
- **Ad-claim accuracy:** don't claim "unlimited wardrobe" for Free; don't promise the Phase-2 social feed as if it's live in v1; keep try-before-you-buy (affiliate/physical goods) visually distinct from the Selv+ subscription.
- **Name risk:** don't hard-bake "Selv" into expensive assets until trademark clearance is done.
- **Environment limits (if using the sandbox):** binaries can't be downloaded into the repo from the sandbox; some files can't be deleted there; bash calls cap at ~45s and background processes don't persist. Generate media via the MCP tools and reference/host outputs directly.

---

## 12. Quick status of the rest of the build (context only)

Product is pre-launch: 3D avatar render spike + Day-2 measurement→shape system + account deletion + the 25-item free-cap enforcement are implemented; the app still needs a clean `npm install` + on-device test on the founder's machine. Two harmless neutralized test stubs (`app/src/lib/_pricing_smoke.ts`, `app/src/features/avatar3d/_smoke.ts`) can be deleted. None of this blocks marketing work — the waitlist is your live funnel today.
