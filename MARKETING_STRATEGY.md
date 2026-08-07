> **Brand update (post-dated):** the app name is now **Selv** (see `SELV_VERIFICATION.md`). This document predates the rename — the former working names "Drobe"/"Twinit" and the old naming shortlist below are kept as historical rationale only. **Section 3 (Naming) is historical and untouched by the pivot note below** — it documents the naming/trademark research as it happened and should not be edited to match current product framing.
>
> **Pivot note (2026-07-20):** the product no longer builds an avatar from a photo of the user's body. Users **design a customizable 3D character** in a character creator (skin, face, eyes, hair, brows, facial hair, body type, accessories) — no photo, no measurements. Everywhere below that says "photoreal avatar of your actual body," "avatar reveal from a photo," or similar, read it as **"design your 3D self / build your character"** instead — still framed as *your* identity, just user-authored rather than photo-derived. "Dress up as yourself" still works, and is now literally true. See `AVATAR_CREATOR_PLAN.md` for the product rationale.

# Marketing & Go-to-Market Strategy
### Virtual Wardrobe + 3D Try-On App for Gen Z
**Prepared:** July 14, 2026 · **Working name:** "Drobe" (see Section 3 — name change recommended) · **Target ship date:** ~July 24, 2026

---

## 0. Executive Summary

Gen Z already performs "fit checks" for an audience — TikTok, Snap, group chats — but the wardrobe itself is still stuck in the physical world and every "outfit" they see of themselves is a mirror selfie. The opening is a **customizable 3D character the user designs themselves**, populated with **the user's own real clothes**, that turns "what do I wear" into a game you play on your phone, and turns every outfit into something shareable, remixable, and — eventually — shoppable.

**Positioning in one sentence:** *The app that lets you design a 3D you, dresses it in your real closet (and anything you're eyeing), and lets you show it off.*

**The wedge:** nobody else combines (1) a customizable 3D character *you design yourself* with (2) *your actual clothes* digitized as 3D items with (3) a social, TikTok-native sharing loop. Competitors have at most two of the three — see Section 1.

**Top 2 growth channels:** TikTok/Reels organic content (fit-check and "digitize my closet" hook formats) + creator seeding (50–150 micro creators in the fashion/thrift/style niches, seeded pre-launch). Both are cheap, native to the audience, and compound through the built-in shareable-outfit-card loop (Section 6.4).

**Pricing model:** Freemium. Free = build your avatar, digitize up to 25 items, unlimited outfit-building, save/share outfits. **Selv+** ($6.99/mo or $39.99/yr) unlocks unlimited closet, try-on of items you don't own ("shop the fit"), advanced outfit analytics, and priority avatar rendering. Secondary revenue via affiliate commerce on try-before-you-buy and brand placement.

**Naming recommendation:** Retire "Drobe" — it's actively used by a near-identical competitor already live on the App Store (joindrobe.com / getdrobe.com / drobeme.ai — see Section 3). Top pick from the alternatives: **Fitcast** or **Mimic**. Full rationale and domain/handle checks in Section 3.

---

## 1. Competitive Landscape (researched July 2026)

The space splits into three lanes: **(A) digital closet / outfit planners** (organize what you own, AI styling, low 3D fidelity), **(B) AI avatar / virtual try-on** (photorealistic you, but shopping-catalog clothes, not your closet), and **(C) social outfit/fashion feeds** (sharing-first, weak wardrobe utility). Drobe's wedge is sitting at the intersection of all three.

| App | Lane | What it does | Positioning / traction (2025–26) | The gap Drobe can own |
|---|---|---|---|---|
| **Whering** | A | Digitize closet via photo, AI stylist, outfit calendar, resale integration; just added "virtual try-on" and gallery-scan | 10M users, $7M seed (July 2026) led by eBay Ventures + Google AI Futures Fund, mostly Gen Z, ~$14M raised total — the clear category leader | Whering's "virtual try-on" shows clothes on a generic AI model, not a rigged 3D character the user actually designed and owns — no true 3D garment layer, no social feed |
| **Acloset** | A | AI closet organizer, imports from Amazon/Zara/Shein, daily outfit suggestions, cost-per-wear tracking | 7M users, Google Play Editor's Pick; strongest at fast AI-assisted closet setup | Purely 2D flat-lay logic; no avatar, no try-on of items you don't own, no social layer |
| **Save Your Wardrobe** | A | Closet digitization + aftercare marketplace (repair/clean/resell), sustainability analytics (Good On You ratings) | Positioned as B2B2C "aftersales" infra for fashion brands as much as a consumer app; London-centric services | Utility/sustainability angle, not fun or social; no 3D, no avatar, no discovery loop |
| **Combyne** | C | Outfit collage app, 800+ brand catalog, social feed for fit inspiration, gamified dress-up | Young, engaged community; most "social" of the closet apps but flat 2D collage, not true 3D | No 3D character *you* design, no garment realism (drape/fit), collage aesthetic reads dated to Gen Z now |
| **Indyx** | A | Meticulous wardrobe cataloging + optional paid human stylist "Lookbook" service | Best-in-class for cost-per-wear obsessives; human-in-the-loop styling | Premium/manual, not scalable or viral; zero avatar/3D/social |
| **Pureple** | A/B | Free closet organizer with a lightweight virtual try-on: outfit shown on a generic AI model | Free, simple, "good starting point" per reviewers, but AI model isn't you | Generic model ≠ a character you designed — exactly the gap Drobe's customizable 3D character closes |
| **Style DNA** | A | AI color analysis + body-type guidance + shoppable recs from 26k brands across 231 retailers | 3M+ users, press in Vogue/NYT/Forbes; strong on color-analysis/body-type virality | Styling-advice tool, not a wardrobe or try-on product; no avatar, no garment digitization |
| **DRESSX (DRESSX Agent)** | B | Digital-twin avatar from a selfie, AI try-on across a luxury marketplace (200+ brands, $2M+ merch), diffusion-based try-on | Positioned as the "specialist" luxury/styling layer vs. Google's mass-market try-on; launched Sept 2025 | Built for *shopping new luxury items*, not your existing closet — no "my real clothes" digitization, no casual Gen-Z social loop |
| **ZERO10** | B | AR/AI try-on widget for brand websites (upload selfie + 1–5 garment photos → try-on in ~5 sec) | B2B infrastructure play for brand partners, not a standalone consumer destination app | Not a consumer app/community at all — an embeddable widget |
| **Doji** | B | Avatar from 6 selfies + 2 full-body photos (photoreal, diffusion-model-based), try on real luxury product, swipe looks, shop | $14M seed (Thrive Capital, May 2025) days after launch; invite-only, 80+ countries, founders ex-Apple VisionOS / ex-DeepMind | Closest analog in avatar realism — but it's a *discovery/shopping* app for items you don't own, not a wardrobe for what you already have, and has no social/sharing feed |
| **Google (Try It On) / Nvidia infra** | B | Platform-level virtual try-on normalizing the category for mass e-commerce shoppers | "Google is normalizing try-on for the mass shopper" per Forbes (Apr 2026) — legitimizes the category, raises baseline user expectations | A platform, not a personal-wardrobe destination — actually helps Drobe by pre-educating users on what good try-on should feel like |

**Category read:** the wardrobe apps (Whering, Acloset, Save Your Wardrobe, Indyx) have the users and the "my real clothes" data model but weak-to-no avatar realism or social virality. The avatar apps (Doji, DRESSX, ZERO10) have jaw-dropping try-on tech but are shopping funnels for items you don't own, with no wardrobe or social layer. Whering's move into "virtual try-on" (July 2026) signals the leader sees the same gap Drobe is aimed at — this is a live race, not a greenfield. Combyne is the only real social-outfit-sharing competitor, but its 2D collage format is aesthetically dated next to what a realistic 3D avatar + short-form video culture now expects.

**Drobe's white space:** *your real closet, on a 3D character you designed yourself, shareable like a TikTok.* No competitor currently does all three. The 12–18 month window is genuinely open, but Whering's funding and user base (10M, mostly Gen Z, just raised specifically to build try-on) make it the primary company to watch and differentiate against — not to ignore.

---

## 2. Positioning & Differentiation

**One-sentence positioning:**
> Drobe [working name] turns your real closet into a 3D version of you — mix your actual clothes, try on anything before you buy it, and post the fit.

**The wedge:** *A 3D character YOU designed, not a mannequin.* Every competitor either (a) digitizes your clothes but shows them flat/2D or on a generic model, or (b) builds a great avatar but only dresses it in items you don't own. The product bets that Gen Z's core motivation isn't wardrobe organization (a chore) — it's **self-expression and social validation** ("does this fit go") which requires the character to be something they actually made, not a generic model or an algorithm's guess at their body.

**Why Drobe wins:**
1. **Identity, not inventory.** Competitors frame this as closet management (a to-do list). Drobe frames it as an identity/creativity tool (a game) — closer to Bitmoji/Genies than to a filing cabinet.
2. **Try-before-you-buy closes the loop wardrobe apps can't.** Whering/Acloset only show what you own; DRESSX/Doji only show what you could buy. Drobe does both in the same avatar, same session — "will this new jacket work with stuff I already have?"
3. **Shareable-by-default, built for vertical video.** Every saved outfit is designed to become a 3-second shareable card/video (Section 6.4), not a static catalog entry — this is a content engine wardrobe apps weren't built to be.
4. **Phase 2 social feed turns retention into acquisition.** Once outfit-sharing and following ship, each fit check becomes distribution. Combyne proved Gen Z wants an outfit-social feed; nobody has paired it with high-fidelity 3D avatars yet.

---

## 3. Naming

### Verdict on "Drobe"
**Do not ship as "Drobe."** Live web research (July 2026) found it is already the active brand name of a close competitor: **joindrobe.com** ("drobe — Digital Wardrobe & AI Styling App," already on the App Store, app-id 6758071769) plus **getdrobe.com**, **thedrobe.com**, and **drobeme.ai** — all separate wardrobe/AI-stylist apps using the same name. joindrobe.com's own marketing copy ("Your wardrobe, elevated," AI stylist chat, outfit-scoring) is close enough to this product's category that shipping as "Drobe" invites App Store confusion, SEO cannibalization, and possible trademark friction. Use "Drobe" internally as a working title only.

### 5 Alternative Names

| Name | Vibe rationale | .com | .app | @handle (IG/TikTok) | Notes |
|---|---|---|---|---|---|
| **Fitcast** | "Fit" (Gen Z slang for outfit) + "cast" (broadcast your fit / cast a 3D shape) — playful double meaning, verbable ("fitcast it") | Likely taken by unrelated broadcast/podcast brands — check before commit | Good odds, .app TLD is far less contested | @fitcast / @getfitcast as fallback | Strongest concept-to-name fit; recommend as primary pick pending a formal trademark screen |
| **Mimic** | Real word used unexpectedly (matches the 2026 naming trend of "Arc," "Linear," "Craft" — see App Store research below); literally what a parametric avatar does — mimics you | Likely taken (common word) — plan on mimicapp.com or getmimic.com | Good odds on .app | @mimic likely taken; @mimic.app or @trymimic as fallback | Short, brandable, easy to say/spell; slight risk of genericness, needs a strong wordmark |
| **Twinit** | "Digital twin" + Gen Z verb-ification ("twin it" = make it a twin of you); implies both avatar and matching outfits with friends ("we're twinning") | twinit.com likely available or cheaply acquirable | twinit.app — good odds | @twinit — good odds across platforms | Double meaning with "twinning" (Gen Z slang for matching outfits) is a strong organic hook for the social phase |
| **Fitroom** | "Fitting room" collapsed into one word + "fit" pun; simple, literal enough for App Store search, still brandable | fitroom.com may be taken (check) | fitroom.app — decent odds | @fitroom — check availability, likely partially taken | Safer/more descriptive option if a punnier name tests poorly with users; strong ASO keyword value ("fitting room") |
| **Wardro** | Truncation of "wardrobe" in the style of Whering/Acloset/Indyx naming conventions, but shorter and more ownable than "Drobe" | wardro.com likely available | wardro.app good odds | @wardro likely available | Closest to the original "Drobe" instinct (short, wardrobe-root) without the direct collision; lower virality/pun value than Fitcast or Twinit |

**Recommendation:** Lead user-test **Fitcast** and **Twinit** — both encode the product's two core mechanics (fit + digital twin of you) in a single word and lend themselves to Gen Z verbification, which is a proven virality pattern (see: "Venmo me," "Google it," "we're twinning"). Run a 24-hour domain/handle/trademark clearance sprint before final selection — this analysis is a directional read, not a legal clearance.

---

## 4. Brand Identity Direction

**Personality:** the stylish best friend who hypes your fit up, never the strict closet-organizing parent. Confident, a little chaotic, in on the joke, never lecturing about sustainability or minimalism even though the product enables both.

**Three-word vibe:** **Playful · Confident · Iconic** *(alt set: "Unserious, but polished")*

**Tone of voice:**
- Talks like a group chat, not a fashion magazine. Short, punchy, current slang used correctly and sparingly (don't overdo it — Gen Z clocks try-hard instantly).
- Hypes the user, never critiques the body or the outfit — the product's job is to make people feel *more* like themselves, not to grade them (see Section 11).
- Uses humor and specificity over generic superlatives ("this fit ATE" > "you look great").

**Color / aesthetic direction (brief for designer):**
- Lean into **2026's Gen Z palette signals**: Digital Lavender and Acid Green as accent/energy colors against a neutral base (off-white, warm charcoal) — high contrast enough to pop in a TikTok thumbnail grid, not another beige minimalist wellness-app palette.
- Avoid the "clean girl" pastel-and-serif look every closet app (Whering, Acloset) already uses — differentiate visually as more maximalist/kinetic, closer to a Gen Z creative tool (CapCut, VSCO, BeReal) than a productivity app.
- Typography: a chunky, confident display face for hero moments (outfit reveal, avatar reveal) paired with a clean, highly legible UI face — avoid script/cursive fonts, which read "millennial mom blog."
- Motion matters more than static color: the avatar reveal, the outfit-swap transition, and the share-card generation should all have a satisfying, slightly bouncy motion language — this is a "feels good to use" product, not just a "looks nice" one.
- Reference points to hand a designer: BeReal (irreverence), Gen Z Spotify Wrapped drops (bold type + shareable card format), Pinterest mood-board density (visual richness), CapCut (creative-tool energy, not utility-app energy).

---

## 5. Target Audience

### Primary persona — "Maya, 19, sophomore"
- TikTok-native (opens the app 20+ times/day), posts fit checks 2–3x/week to a finsta or close-friends story before deciding whether to post publicly.
- Buys from Shein/Zara/Depop/Urban Outfitters, mixes thrifted and new; owns 60–150 wearable items but "has nothing to wear."
- Screenshots outfit inspo from Pinterest and TikTok constantly; rarely acts on it because translating inspo into "does this work with what I own" is friction.
- Responds to: humor, speed (nothing that takes more than 30 seconds to get value), social proof from creators who feel like peers not celebrities, low-stakes ways to participate (duets, remixes) before posting original content.

### Secondary persona — "Jordan, 24, early-career, resale-curious"
- Uses Depop/Poshmark/Vinted to buy and sell; wants to know if a resale find will actually fit/suit them before buying, and wants to declutter their own closet responsibly.
- More budget-conscious, more sustainability-motivated (cost-per-wear resonates), still shares outfits but more on Instagram/close friends than public TikTok.
- Responds to: practicality messaging (return rate reduction, cost-per-wear), aesthetic curation (Pinterest board energy), slightly more polished creator content (macro/mid-tier over pure meme creators).

### Where they are
TikTok (primary), Instagram Reels/Stories, Pinterest (discovery + mood boards — 42% of Pinterest's user base is Gen Z, +30% YoY, per 2026 Pinterest data), Depop/Vinted (secondary resale-adjacent), group chats/BeReal/Snap (private fit-check sharing before public posting).

---

## 6. Growth Strategy & Channels

### 6.1 TikTok / Reels organic — content pillars & hook formats

**Content pillars:**
1. **"Digitize my closet" transformation** — real closet chaos → clean 3D wardrobe in one video (satisfying, Marie-Kondo-adjacent).
2. **Design your character / "wait till you see mine"** — the emotional hook of building and revealing your own fully-customized 3D character for the first time (face, hair, fit — all your choices); character-creator content is a proven, high-performing TikTok format, and it's inherently reaction/duet-bait.
3. **Try-before-you-buy saves** — "I was about to buy this — here's how it actually looks on me" (ties directly to affiliate revenue, Section 9).
4. **Outfit remix / capsule wardrobe math** — "I own 12 items, here are 30 outfits" (utility + creativity flex).
5. **Fit battles / duets** — two avatars, same item, different styling — built for the Phase 2 social feed but seedable pre-social via creator-vs-creator content.

**Hook formats that travel on this platform right now:** POV/transformation cuts, "wait for it" reveals, text-on-screen countdowns ("outfit 1 of 30 I didn't know I had"), sound-led trend participation (never silent product demos), and the "change clothes" TikTok trend format (rapid outfit swaps on a beat drop) — directly reproducible with the try-on feature.

### 6.2 Creator / influencer seeding
- **Micro (10K–100K followers) is the core engine, not macro.** 2026 benchmark data shows micro creators deliver ~60% higher engagement than 1M+ accounts at roughly 1/10th the cost per post — seed 75–150 micro creators in fashion/thrift/style-niche TikTok pre-launch with free Selv+ access and early avatar creation, no payment required for organic posts.
- **Structure:** send access in coordinated week-long waves (not staggered over months) so posts cluster and the algorithm reads it as a moment, not noise — 2026 creator-seeding data specifically flags timing coordination as more important than creator size for launch windows.
- **Macro (1–3 creators, 500K+)** reserved for the launch-week moment itself — one hero creator "reveal" video timed to Product Hunt / launch day for a reach spike, not the ongoing engine.
- **Organic-first funnel:** monitor which seeded creators post unprompted and with genuine enthusiasm; convert only those into paid, formalized partnerships post-launch. License their best organic content as paid Spark Ads (proven "pay once for content, get ongoing paid performance" pattern).

### 6.3 Pinterest
- Publish "outfit card" pins automatically from every saved look (opt-in), targeting Gen Z's discovery behavior — 84% of weekly Gen Z Pinners report discovering products that fit their personal style on the platform, and Gen Z increasingly starts searches on Pinterest instead of Google.
- Build themed boards around 2026 Pinterest-predicted micro-trends (curated eras, capsule aesthetics) to ride existing search demand rather than create it from scratch.

### 6.4 Waitlist virality & referral/invite loops
- Pre-launch waitlist with a **position-jump referral mechanic**: unique link per signup, each referral moves you up the queue, milestone unlocks (3 referrals = skip the line, 10 = free year of Selv+). 2026 benchmarks show top-performing waitlist referral programs hit 22–25% referral rates.
- **Character-first hook for the waitlist page itself:** let people pick a few starter options (skin tone, hair, vibe) pre-launch to see a *teaser/blurred* preview of the character they're building, unlocked fully in the real character creator at launch — creates an open loop worth returning for and worth sharing ("I need to see how mine turns out"). No photo required — same mechanic, just fed by picks instead of an upload.
- **Invite-gated early access** (à la Doji, BeReal's campus-exclusive model): early cohorts get access via invite codes from existing users, manufacturing scarcity and turning every early user into a distribution node.

### 6.5 The shareable-outfit-card growth loop ("every shared outfit is an ad")
This is the core organic engine, modeled on Spotify Wrapped (500M shares, zero paid Meta spend) and Strava/Depop's "Wrapped"-style share cards:
- Every saved outfit auto-generates a polished, on-brand, vertical share card/video of the user's *own avatar* wearing the fit — this is inherently more shareable than a screenshot because it's aspirational (looks like a lookbook shot, not a phone photo).
- The card carries a subtle watermark/handle + a "build your own" QR/link — every share is a recruiting surface, not just an engagement metric.
- Because it's the character the user designed and built themselves, sharing it taps identity/vanity motivation (far stronger than sharing a generic app feature) — this is the single highest-leverage growth mechanic in the plan and should be prioritized in early builds even before the Phase 2 social feed ships.

---

## 7. Launch Plan

### Phased rollout
1. **Phase 0 — Private beta / waitlist** (now → launch): seeded creators + waitlist referral cohort get invite codes.
2. **Phase 1 — Public launch** (~10 days out): avatar creation + wardrobe digitization + outfit builder + try-before-you-buy on a starter catalog. No social feed yet — retention is driven by the personal utility + shareable cards.
3. **Phase 2 — Social feed** (post-launch, 60–90 days): follow, browse, remix others' outfits — layered in once core avatar/wardrobe retention is proven, using the by-then-large library of shareable cards as the feed's cold-start content.

### 4-week timeline (today = July 14, 2026; ship ≈ July 24, 2026)

| Week | Dates | Focus | Key actions |
|---|---|---|---|
| **Week 1 — Pre-launch build** | Jul 14–20 | Waitlist live, creator outreach, asset production | Stand up waitlist landing page with referral mechanic + blurred-avatar teaser hook; finalize brand name/identity (Section 3–4); begin outreach to 100–150 micro creators for seeded access; produce launch-day hero creator brief; prep Product Hunt draft listing, App Store listing copy/screenshots (Section 12); start 2–3x/day organic TikTok posting on the brand account using founder/team "building in public" + early avatar demos |
| **Week 2 — Launch week** | Jul 21–27 | Ship (~Jul 24), Product Hunt, creator wave 1 | **Launch app** (~Jul 24, target a Fri/Sat/Sun for Product Hunt #1-of-day odds per 2026 PH playbook data); coordinated creator wave 1 (50+ micro creators post within 48-hour window); founder does personal outreach to 200+ warm contacts for PH launch-day support; respond to every PH comment within 30 min during the 24-hour window; daily TikTok posts featuring real user character reveals (with consent) |
| **Week 3 — Push & iterate** | Jul 28–Aug 3 | Sustain momentum, convert organic winners to paid | Identify which seeded creators over-performed organically → convert to paid Spark Ads using their content; launch referral program inside the app (not just pre-launch waitlist) to keep the invite loop running; publish first "outfit Wrapped"-style shareable moment (e.g., "your first 10 fits") to seed the share-card loop; monitor App Store reviews/ratings velocity and respond publicly |
| **Week 4 — Compound & plan Phase 2** | Aug 4–10 | Retention focus, social feed prep | Ship first retention-driven feature iteration based on Week 1–3 data (e.g., notification nudges, outfit-of-the-day prompts); begin creator wave 2 (macro/mid-tier, paid) using proven content angles from wave 1; kick off Phase 2 social feed build; publish 30-day metrics recap as its own shareable/press moment |

---

## 8. Content Strategy — 10 TikTok/Reels Video Concepts

| # | Concept | Hook (first 2 seconds) |
|---|---|---|
| 1 | **Design-your-character speedrun/reveal** | "I built a whole 3D character of myself and it's actually kind of unreal—" |
| 2 | **Digitize-my-whole-closet speedrun** | "POV: you turn your entire closet into an app in one video" |
| 3 | **"I own 14 items, watch how many outfits I actually have"** | On-screen counter ticking up outfit combos in real time |
| 4 | **Try-before-you-buy save** | "I was ONE tap from buying this — here's why I didn't" |
| 5 | **Change-clothes trend, but it's a 3D avatar** | Beat-drop rapid outfit swaps, avatar version of the viral format |
| 6 | **Rate my fit but it's my avatar not me** | "Rating my own outfits is easier when it's not actually my face" |
| 7 | **Thrift flip, digitized** | "I thrifted this for $4 — watch it go from find to full outfit" |
| 8 | **Twin battle (duet-bait)** | "Same item, two avatars — who wore it better" |
| 9 | **"What I own vs. what I think I own"** | Wardrobe analytics reveal — most-worn vs. most-forgotten items |
| 10 | **Get-ready-with-my-avatar** | GRWM format but the outfit decision happens entirely in-app first |

**Production notes:** keep every video under 20 seconds where possible, native vertical, captioned (sound-off viewing is majority), post 2–3x/day during launch weeks 1–2, prioritize trend-sound participation over original audio early on to maximize discoverability.

---

## 9. Pricing & Monetization

### Freemium structure

| Tier | Price | Includes |
|---|---|---|
| **Free** | $0 | Full avatar creation, up to 25 digitized wardrobe items, unlimited outfit-building from owned items, save/share outfit cards, basic try-on of a limited rotating catalog |
| **Selv+** | $6.99/mo or $39.99/yr (~52% discount, standard app-subscription annual-discount structure) | Unlimited wardrobe items, unlimited try-on of items you don't own ("shop the fit" across partner catalog), advanced wardrobe analytics (cost-per-wear, most/least worn), priority avatar rendering & higher-fidelity exports, early access to new features/drops |

This sits within the benchmark range for creative/lifestyle app subscriptions ($4.99–$29.99/mo per 2026 category data) while staying accessible to a primarily teen/early-20s, less-disposable-income audience — priced closer to the low end deliberately, since freemium virality (not paywall aggression) is the primary growth lever per this plan. Expect ~2–5% free-to-paid conversion at steady state per 2026 freemium benchmarks; a 7-day free trial on Selv+ should be tested given 2025–26 data showing 25–50% trial-to-paid conversion for well-targeted consumer trials.

### Other revenue
- **Affiliate/commerce on try-before-you-buy:** commission on purchases made through the "shop the fit" flow when a user buys an item they tried on virtually — directly monetizes the highest-intent moment in the product.
- **Brand partnerships:** paid placement of a brand's real catalog into the try-on layer (same infrastructure DRESSX/ZERO10 sell to brands, but with a built-in engaged Gen Z audience rather than a cold widget) — natural Phase 2+ revenue line once wardrobe/avatar traction is proven.
- **Sponsored creator challenges** inside the social feed (Phase 2) — e.g., brand-sponsored "style this item" remix challenges.

---

## 10. Metrics & Goals

**North-star metric:** **Weekly Avatars Styled** — the number of unique users who build at least one complete outfit on their avatar in a 7-day window. (Chosen over raw DAU/MAU because it captures the core "identity + creativity" loop, not just app opens; chosen over items-digitized because it captures ongoing engagement, not one-time setup.)

**Activation:** % of new users who reach "first outfit built on their own avatar" within their first session (target: >50% — this is the single most important early funnel step; avatar creation is the highest-friction, highest-reward moment and must not leak users).

**Retention loops:**
- **Habit loop:** daily/weekly "what to wear" utility (closet already digitized → low-friction return visits).
- **Creative loop:** new item added → new outfit combos unlocked → notification nudge ("3 new outfits possible with what you just added").
- **Social/vanity loop:** share-card generated → external shares → replies/reactions drive the user back into the app (even pre-Phase-2, via screenshots/DMs; fully closed once Phase 2 feed ships).
- **Commerce loop:** try-on a wishlist item → purchase → digitize the new item → repeat.

### 30/60/90-day targets

| Milestone | Target |
|---|---|
| **Day 30** | 15,000–25,000 downloads (launch + PH + creator wave 1); ≥50% of users complete avatar creation; ≥1,000 Weekly Avatars Styled by end of week 4 |
| **Day 60** | 60,000–100,000 cumulative downloads; Week-4 retention ≥20% (competitive for a lifestyle/creative app); first cohort of paid Selv+ conversions live (target 2–3% conversion); referral program contributing ≥15% of new signups |
| **Day 90** | Phase 2 social feed in beta; 150,000+ cumulative downloads; Weekly Avatars Styled as primary board-level metric with a defined growth curve; affiliate/commerce revenue live and attributable |

*(Targets are directional planning benchmarks, not guarantees — calibrate against actual Week 1–2 launch data.)*

---

## 11. Responsible, Body-Positive Messaging

Because this product lets users design a 3D character — including a body-type choice and skin-tone choice — this is not an optional add-on section — it is a core product-marketing constraint. (Note: the pivot to a user-designed character, rather than a photo/measurement-estimated avatar, removes a category of risk below — no algorithmic guess at a user's body to get wrong — but the diversity and no-scoring principles still fully apply.)

**What could go wrong:**
- A character-creator option catalog (skin tones, body types, face shapes) that's narrow or renders some choices with worse fidelity than others functions like an algorithmic "beauty" bias even without any photo estimation involved (documented issue with prior AI-avatar apps — e.g., 2023 reports of Lensa's avatars sexualizing women's likenesses while rendering men professionally) — causes real harm, not just bad UX.
- Any feature that scores, ranks, or grades outfits/characters (explicit numeric "outfit score" out of 10, streaks tied to appearance, leaderboards based on looks) risks reinforcing comparison culture in a demographic already navigating heavy social-media-driven body image pressure.
- Data sensitivity: garment photos and account data are still real user data to protect responsibly, even though the avatar itself is no longer photo- or measurement-derived — trust, once broken (a leak, a training-data controversy), is not recoverable for this category.

**How to message and design responsibly:**
- **Position the character creator as a styling/self-expression tool, not a body-evaluation tool.** Marketing copy should always frame the character around clothes and creative expression ("build your fit," "design your look") never around grading the body itself. Never use before/after body language, weight-loss-adjacent framing, or "flaw-fixing" copy anywhere in marketing or product.
- **No public numeric scoring of bodies or looks.** Outfit feedback/social features (Phase 2) should use reaction/vibe-based responses (fire, "this ate," save-to-board) rather than numeric ratings — avoid the "9.3/10" pattern seen in some AI-stylist competitor copy, which invites exactly the comparison dynamics to avoid.
- **Character-creator accuracy and diversity by default, not as an afterthought.** Commit publicly (and enforce in QA) to testing character rendering across all skin tones, body types, and hairstyles with equal fidelity — this is both an ethical obligation and a differentiation point versus any competitor whose avatar tech skews toward a narrow "ideal" body.
- **Clear, upfront data controls:** one-tap data deletion and a plain-language (not legalese) explanation of what's collected — namely that the avatar is built from the user's own character-creator picks, not a photo or scan of them, and that only garment photos (of clothes, not the user) are collected elsewhere in the app — surfaced in-product, not buried in a privacy policy.
- **Tone check on every piece of marketing copy:** the brand voice (Section 4) is designed to hype, not judge — "this fit ATE" energy, never "fix your outfit" energy. Any copy implying the user's existing choices are wrong should be cut in review.

---

## 12. COPY BANK

### Tagline options
1. **"Your closet, but make it 3D."**
2. **"See the fit before you commit."**
3. **"Dress up as yourself."**

### App Store metadata
- **Title (≤30 chars):** `Fitcast: 3D Closet & Try-On` *(29 chars — swap in final chosen name)*
- **Subtitle (≤30 chars):** `Style your avatar. Post the fit.` *(trim to fit exact name; keep under 30 chars once name is locked)*

### App-store description (30 words)
> Design your own 3D character, dress it in your real closet, and try on anything before you buy it. Mix outfits, save your favorite fits, and share your best looks.

### 5 social captions
1. "wait for the character reveal 😭 I made this from scratch"
2. "I own 14 pieces and just found 30 outfits I didn't know I had"
3. "tried this on before buying it and saved myself a return 🙏"
4. "digitizing my entire closet in one video, don't judge the pile"
5. "same top, two avatars, who wore it better 👀"

---

## Sources

- [Whering lands $7M as digital wardrobe platform reaches 10M users — Tech.eu](https://tech.eu/2026/07/07/whering-lands-7m-as-digital-wardrobe-platform-reaches-10m-users/)
- [Whering Wardrobe Styling App Raises $7M — WWD](https://wwd.com/business-news/technology/whering-styling-app-investment-ebay-google-ai-futures-1239053470/)
- [Whering secures funding from Ebay Ventures and Google AI Futures — FashionUnited](https://fashionunited.uk/news/business/whering-secures-funding-from-ebay-ventures-and-google-ai-futures/2026070789047)
- [Best Virtual Closet Apps 2026 — Beauty AI](https://beautyai.app/blog/virtual-closet-apps-2026)
- [Acloset — AI-Powered Smart Closet](https://www.acloset.app/)
- [Save Your Wardrobe — official site](https://www.saveyourwardrobe.com/en-gb)
- [Best Wardrobe Apps 2026 — Indyx](https://www.myindyx.com/blog/the-best-wardrobe-apps)
- [DRESSX — largest AI try-on and shopping platform](https://dressx.com/news/chatgpt-for-fashion-dressx-launches-the-largest-ai-try-on-and-shopping-platform-with-2m-in-luxury-merchandise)
- [Virtual Try-On in 2026 — DRESSX](https://dressx.com/news/virtual-try-on-in-2026-why-most-solutions-fall-short-(and-what-fashion-brands-actually-need))
- [Google, DressX And The New Fashion AI Virtual Try-On Stack — Forbes](https://www.forbes.com/sites/moinroberts-islam/2026/04/14/google-dressx-and-the-new-fashion-ai-virtual-try-on-stack/)
- [Zero10 Brings Web Widget, Generative AI for Virtual Fashion Try-ons — WWD](https://wwd.com/business-news/technology/zero10-generative-ai-virtual-fashion-try-on-web-widget-1236028214/)
- [Doji raises $14M to make virtual try-ons fun through AI avatars — TechCrunch](https://techcrunch.com/2025/05/15/doji-raises-14m-to-make-virtual-try-ons-fun-through-ai-avatars/)
- [How AI Virtual Try-On Solutions Google & Doji Are Changing Retail — Forbes](https://www.forbes.com/sites/stephaniehirschmiller/2025/05/29/how-ai-virtual-try-on-solutions-google--doji-are-changing-retail/)
- [Combyne — App Store](https://apps.apple.com/us/app/combyne-your-perfect-outfit/id989727742)
- [Outfit Planner App Market Research Report 2026 — OpenPR](https://www.openpr.com/news/4557248/outfit-planner-app-market-research-report-2026-closet)
- [Style DNA — official site](https://styledna.ai/)
- [joindrobe.com — drobe Digital Wardrobe & AI Styling App](https://joindrobe.com/)
- [getdrobe.com](https://getdrobe.com/)
- [DrobeMe.ai](https://www.drobeme.ai/)
- [How to name an app for App Store & Google Play: 2026 Guide — MobileAction](https://www.mobileaction.co/blog/how-to-name-an-app/)
- [App Store Optimization Title: 2026 ASO Title Playbook — AppFollow](https://appfollow.io/blog/app-store-optimization-title)
- [The ultimate list of TikTok trends for Gen Z marketing in 2026 — ContentGrip](https://www.contentgrip.com/tiktok-trends-gen-z-marketing-guide/)
- [TikTok Advertising for Fashion Brands: Style Guide 2026 — Stackmatix](https://www.stackmatix.com/blog/tiktok-advertising-fashion-brands-2026)
- [TikTok Fashion Statistics 2025](https://bestcolorfulsocks.com/blogs/news/tiktok-fashion-statistics)
- [TikTok Change Clothes Trend: How Gen Z Redefines 2025 Fashion — Accio](https://www.accio.com/business/tiktok_change_clothes_trend)
- [Virtual Try-on Market Size, Share And Growth Report, 2030 — Grand View Research](https://www.grandviewresearch.com/industry-analysis/virtual-try-on-market-report)
- [Virtual Try-On Technology Market Report 2026 — Research and Markets](https://www.researchandmarkets.com/reports/6033255/virtual-try-on-technology-market-report)
- [Product Seeding in 2026 — GRIN](https://grin.co/blog/product-seeding-in-2026-the-influencer-marketing-strategy-thats-quietly-outperforming-paid-campaigns/)
- [Micro Influencers in 2026: Playbook — Shopify](https://www.shopify.com/enterprise/blog/micro-influencers-instagram)
- [How to Build a Viral Referral Program for Your Waitlist (2026 Guide) — Waitlister](https://waitlister.me/growth-hub/guides/how-to-build-a-viral-referral-program-for-your-waitlist)
- [Best Startup Launch Campaigns 2026 — Flowjam](https://www.flowjam.com/blog/best-startup-launch-campaigns-9-case-studies-you-can-copy-today)
- [Smol Launch: How to Launch on Product Hunt in 2026](https://smollaunch.com/guides/launching-on-product-hunt)
- [Product Hunt Launch Strategy 2026 — Siift](https://siift.ai/blog/launching-on-product-hunt-your-2026-strategy-guide)
- [What Are the Ethical Concerns of Digital Avatars? — Sustainability Directory](https://fashion.sustainability-directory.com/question/what-are-the-ethical-concerns-of-digital-avatars/)
- [Is Your AI Avatar Secure? Privacy and Ethical Concerns — AI Kit Studio](https://aikitstudio.com/blogs/is-your-avatar-secure/)
- [State of Subscription Apps 2026 — RevenueCat](https://www.revenuecat.com/state-of-subscription-apps)
- [App Monetization Models 2026: A Decision Framework — FWC](https://fwctecnologia.com/en/blog/post/app-monetization-models-2026)
- [Pinterest Statistics 2026 — Searchlab](https://searchlab.nl/en/statistics/pinterest-statistics-2026)
- [How Gen Z is Taking Back Their Taste from AI — Pinterest Business](https://business.pinterest.com/blog/how-gen-z-is-taking-back-their-taste-from-ai/)
- [Pinterest predicts the biggest Gen Z trends of 2026 — Campaign Asia](https://www.campaignasia.com/article/pinterest-predicts-the-biggest-gen-z-trends-of-2026/bht17d4oaffu1qooc7i1scs8wc)
- [Gen-Z Fashion: 30 Trends Dominating 2026 for Brands — Kittl](https://www.kittl.com/blogs/gen-z-fashion-trends-style-guide-dsi/)
- [Grow Without Paid Ads: The Spotify Wrapped System](https://thestrategysignal.com/p/how-to-answer-the-client-who-asks)
- [Monzo, Depop and Strava Wrapped — who did it better? — UX Collective](https://uxdesign.cc/monzo-depop-and-strava-wrapped-who-did-it-better-33f50c63f351)
