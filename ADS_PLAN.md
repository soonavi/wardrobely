# Selv — Paid + Organic Ad Media Plan (Pre-Launch)

Companion doc to the 7 ad creatives in production (5 statics + 2 videos). Covers strategy, targeting, copy, tracking, testing, and budget for the waitlist push. Read alongside `HANDOFF_MARKETING.md` and `MARKETING_STRATEGY.md` — this doc doesn't repeat brand/competitive background, it operationalizes it into a media plan.

**Window:** today = Jul 14, 2026. Waitlist is live at **https://selv-waitlist.vercel.app**. Target app ship ≈ Jul 24, 2026. This plan covers the Jul 14–27 pre-launch + launch-week arc (matches Weeks 1–2 of the 4-week timeline in `MARKETING_STRATEGY.md` §7).

**Platforms:** TikTok + Instagram Reels/Stories only, 9:16 vertical, organic + light paid (TikTok Spark Ads, Meta paid Reels/Stories). No feed/Pinterest ad units in this round.

**Guardrails baked into every creative below:** avatar = styling tool, never body-evaluation (no scoring, no before/after body language, no weight-loss framing); Free tier caps at 25 wardrobe items — never say "unlimited wardrobe" without "Selv+"; Phase-2 social feed never implied as live.

---

## 1. Objectives & KPIs

**North-star:** waitlist signups (rows in Supabase `waitlist`, attributed by `source`).

**Secondary KPIs:**

| Metric | What it tells us | Target range (lean pre-launch test) |
|---|---|---|
| 3-second video view rate | Hook is working | 40–60% of video starts |
| Average watch-through / completion | Content holds past the hook | ≥25% full-length completions on 6–10s videos |
| Saves + shares (organic) | Content is worth re-finding / sending — best proxy for the share-card loop pre-launch | 2–5% of views |
| CTR to waitlist link (bio link / paid CTA button) | Creative-to-intent conversion | Organic bio link: 0.5–2%. Paid CTA button: 1–3% (TikTok), 0.8–2% (IG) |
| Cost per waitlist signup (paid only) | Efficiency of spend | $0.50–$2.00 TikTok Spark, $1–$3 IG paid |
| Reach / impressions | Awareness half of the objective | 50k–250k combined reach over the 2-week window on $500–$2,000 total spend |
| Follower growth (TikTok + IG) | Compounding audience for future organic pushes | Directional only — track, don't target |

These are **planning ranges, not guarantees** — Gen Z app benchmarks vary widely by hook quality and whether a video catches a trend wave. Calibrate hard against real Day 1–3 numbers and reforecast.

---

## 2. Funnel

```
COLD REACH (organic FYP/Reels + paid Spark/boosted Reels)
        ↓
     HOOK (first 2s: avatar reveal shock, messy-closet relatability, outfit-swap spectacle)
        ↓
  WAITLIST LANDING PAGE  (selv-waitlist.vercel.app — already live, already has hero copy,
                          3-step explainer, pricing table, and a signup form)
        ↓
  EMAIL CAPTURE → referral_code issued automatically
        ↓
  REFERRAL LOOP (already live: ?ref=<code> URL param → stored as referred_by on the next
                 signup → position-jump mechanic per MARKETING_STRATEGY §6.4)
```

Nothing new needs to be built for the funnel itself — the landing page and referral mechanic already exist and work (confirmed in `landing/index.html`: the form posts to Supabase, issues a `referral_code`, reads an incoming `?ref=` param into `referred_by`, and shows a copyable invite link on success). The ad job is purely to drive cold reach into that existing hook → landing → referral chain, and to make sure paid traffic is tagged so it's distinguishable from organic once it lands.

**One real gap this plan surfaces:** the landing page currently hardcodes `source: 'landing'` for every signup (see `landing/index.html` line ~525) — it does not read `utm_source`/`utm_medium`/`utm_content` from the URL. That means today, Supabase can't natively tell an organic TikTok signup from a paid IG signup. Section 6 below gives the exact fix and a manual workaround if the code patch isn't shipped in time.

---

## 3. Audience & Targeting

### Organic

- **Hashtags (rotate 5–8 per post, mix broad + niche, never all 15 slots):** `#selv #fitcheck #ootd #genzfashion #digitaltwin #3davatar #virtualcloset #stylehack #capsulewardrobe #outfitideas #getreadywithme #newapp #waitlist #comingsoon #thrifted`
- **Sounds:** always trend-led, never silent product demo (per MARKETING_STRATEGY §8). Video A (avatar reveal) rides "wait for it" / reveal-transformation audio; Video B rides whatever the current live variant of the **"change clothes" trend sound** is that week — check TikTok's Trending Sounds tab day-of-posting, don't pre-lock an audio track since trend sounds cycle in days. Statics repurposed as a 3-slide carousel should use a low-key trending instrumental, captions still on.
- **Posting behavior:** 2–3x/day across TikTok + IG Reels during the Jul 14–27 window (see calendar, §9). Stagger to Gen Z peak windows: ~7–9am, ~12–1pm, ~7–10pm local. Reply to every comment in the first hour (algorithm signal). Build in duet/stitch bait even pre-social-feed — Video B and any "fit battle" cutdown are explicitly stitchable formats.
- **Account behavior:** post from the brand TikTok/IG, not a personal account, so early followers land somewhere durable pre-launch.

### Paid — TikTok Spark Ads

- **Structure:** boost the organic post directly via Spark Ads (keeps existing likes/comments/shares — more credible than a cold ad unit).
- **Interest targeting (keep lean, 2–3 stacked interest categories max):** Fashion & Beauty > Fashion; sub-interests: thrifting/resale, Shein/Zara/Depop/Urban Outfitters shoppers, outfit-inspo content, TikTok Shop fashion browsers.
- **Behavioral:** users who've engaged with fashion/style creator content in the last 30 days.
- **Age:** 18–24 core (TikTok's ad platform enforces an 18+ minimum for ad delivery regardless of the brand's organic 16+ audience — expected and fine, just don't expect ad reach to include the youngest slice of the organic audience).
- **Lookalikes:** none available yet (no pixel installed, no custom audience built). Start with a **video-engagement custom audience** (viewers who watched ≥50% of the top organic post) — available without any pixel — before investing in pixel-based lookalikes.

### Paid — Instagram (Meta Ads Manager)

- **Placements:** Reels + Stories only, no feed/Explore in this round.
- **Objective:** Traffic (link clicks) as the safe default since no Meta Pixel is installed on the landing page yet; switch to Conversions once the pixel is added (see §6).
- **Interests:** Fashion, Shein, Depop, Pinterest-fashion-board affinity, "online shopping - clothing," lookalike-adjacent interest stacking (competitor-app audiences like Whering/Acloset users aren't directly targetable as an interest, so approximate via fashion-app + shopping-app usage signals).
- **Custom audience (available immediately, no pixel needed):** upload the Supabase waitlist email list as a Customer List once it clears ~500–1,000 rows, to seed a genuine lookalike. Below that size Meta won't build a reliable lookalike — don't burn budget trying before the list is big enough.
- **Age:** 18–24 core, 25–29 secondary (catches the "Jordan, 24" persona).

---

## 4. Creative Matrix

| # | Creative | Format | Platform(s) | Content Pillar | Funnel Stage | Primary Hook |
|---|---|---|---|---|---|---|
| S1 | Avatar reveal | Static 9:16 | TikTok + IG | Pillar 2 — avatar reveal / "is this actually me" | Cold reach (top-of-funnel scroll-stopper) | "wait… this is actually me??" |
| S2 | Closet → 3D wardrobe | Static 9:16 | TikTok + IG | Pillar 1 — digitize-my-closet transformation | Cold reach | "your closet, but make it 3D." |
| S3 | Try-before-you-buy | Static 9:16 | TikTok + IG | Pillar 3 — try-before-you-buy saves | Consideration / conversion (direct benefit + CTA-forward) | "try it on before you buy it." |
| S4 | Turn closet into an app | Static 9:16 | TikTok + IG | Pillar 1 — digitize-my-closet (utility framing) | Consideration (mid-funnel education) | "turn your whole closet into an app." |
| S5 | Brand hero | Static 9:16 | TikTok + IG | Brand / positioning anchor (spans Pillars 2 & 4) | Cold reach / awareness anchor, also best retargeting-still if pixel added later | "dress up as yourself." |
| V-A | Avatar reveal video | Video 9:16, 6–10s | TikTok + IG Reels | Pillar 2 — avatar reveal | Cold reach + hook, top Spark Ad candidate | Upload → reveal → genuine reaction |
| V-B | Outfit-swap / "change clothes" | Video 9:16, 6–10s | TikTok + IG Reels | Pillar 4 — outfit remix / capsule math (trend format from Pillar 5's energy) | Hook → consideration (proves the product live, mid-video) | Beat-drop rapid outfit swaps |

Read across the row for how each of the 7 creatives should be scheduled, boosted, and reported on — statics for scroll-stopping + explainer duty, videos for reach + credibility (a video "proving" the product works reads more trustworthy than a static claim).

---

## 5. Full Creative Copy

### S1 — Avatar reveal

- **On-screen headline:** "wait… this is actually me??"
- **Caption:** "the reveal never misses 😭 build your own 3D twin — free to start. waitlist is open, link in bio. #selv #avatarreveal #digitaltwin #3davatar #fitcheck #genzfashion #newapp #waitlist"
- **CTA:** "Join the waitlist" (organic: bio link / paid: CTA button → tagged URL)

### S2 — "your closet, but make it 3D."

- **On-screen headline:** "your closet, but make it 3D."
- **Visual note:** messy real-closet pile (left/before) → clean organized 3D wardrobe grid (right/after), single frame split or diagonal wipe.
- **Caption:** "closet chaos → 3D wardrobe. every piece you own, mixed into outfits in seconds. selv's almost here — join the waitlist. #selv #virtualcloset #closetorganization #outfitideas #capsulewardrobe #genzapp #waitlist"
- **CTA:** "Join the waitlist"

### S3 — Try-before-you-buy

- **On-screen headline:** "try it on before you buy it."
- **Visual note:** avatar wearing an item with a subtle "try on" tag/toggle graphic — never a price-comparison or scored-fit visual.
- **Caption:** "no more guessing if it'll actually look right. try it on your own 3D twin before you buy it — fewer regret hauls, fewer returns. selv waitlist is open. #selv #tryonhaul #shopthelook #onlineshoppingtips #genzshopping #waitlist"
- **CTA:** "See it before you buy — join the waitlist"

### S4 — "turn your whole closet into an app."

- **On-screen headline:** "turn your whole closet into an app."
- **Visual note:** phone camera scanning a clothing rack → app UI populating with digitized 3D items.
- **Caption:** "photograph what you already own. we turn it into a wardrobe you can actually play with. free to start (25 items), unlimited if you're obsessed. selv — join the waitlist. #selv #digitizeyourcloset #wardrobeapp #closetgoals #genzapp #waitlist"
- **CTA:** "Turn your closet into an app — join the waitlist"
- **Claim check:** copy explicitly says "free to start (25 items)" — never drop the qualifier on this one, it's the creative most likely to get read as an unlimited-wardrobe promise if trimmed.

### S5 — Brand hero

- **On-screen headline:** "dress up as yourself."
- **Visual note:** the existing hero render (avatar in lavender→acid gradient light) — reuse the already-generated hero image as the base plate.
- **Caption:** "selv: your closet, but make it 3D. dress up as yourself — literally. waitlist is open now. #selv #dressupasyourself #digitaltwin #3davatar #genzapp #comingsoon #waitlist"
- **CTA:** "Join the waitlist"

### V-A — Avatar reveal (video, 6–10s, sound-led, captioned)

| Time | Shot | On-screen caption |
|---|---|---|
| 0:00–0:01 | Hand holds phone, taps "upload photo"; jump-cut to face about to react | "I let an app build a 3D me—" |
| 0:01–0:03 | Screen-record of upload processing — lavender/acid gradient loading animation | "wait for it" |
| 0:03–0:05 | 3D avatar materializes — glow/particle reveal, snaps into a full-body pose in an outfit | (no text — let the visual land) |
| 0:05–0:07 | Cut to creator's genuine reaction (gasp/laugh), native selfie-cam framing, unpolished | — |
| 0:07–0:09 | Side-by-side: creator + avatar twin | "…this is actually me??" |
| 0:09–0:10 | CTA card: acid-green button graphic, logo lockup, cream background, 1s hold | "join the waitlist" |

- **Suggested sound:** trending reveal/transformation audio (suspense-to-payoff structure); re-check TikTok's Trending Sounds day-of-post rather than pre-locking a track.
- **Caption:** "wait for the avatar reveal 😭 this is actually me?? selv waitlist is open — link in bio. #selv #avatarreveal #digitaltwin #3davatar #fyp #waitlist"

### V-B — Outfit-swap / "change clothes" trend (video, 6–10s, sound-led, captioned)

| Time | Shot | On-screen caption |
|---|---|---|
| 0:00–0:01 | Avatar standing center frame in outfit 1 | "rating my fits… it's not even me 👀" |
| 0:01–0:02 | Beat drop — snap-transition to outfit 2 | — |
| 0:02–0:03 | Snap-transition to outfit 3 | — |
| 0:03–0:04 | Snap-transition to outfit 4 | — |
| 0:04–0:05 | Snap-transition to outfit 5 (hero fit), held half a beat longer | — |
| 0:05–0:07 | Cut to phone screen: real app UI, thumb tapping through the closet grid — proves it's a real product, not just an edit | "all from my own closet" |
| 0:07–0:09 | Final outfit hold | "no laundry required" |
| 0:09–0:10 | CTA card, logo lockup | "join the waitlist" |

- **Suggested sound:** the live/current version of the viral "change clothes" trend audio — this only works if it's genuinely the trending cut that week, don't substitute an off-trend track.
- **Caption:** "same closet, 5 different outfits, zero effort 👀 selv waitlist is open — link in bio. #selv #changeclothes #outfitideas #capsulewardrobe #genzfashion #waitlist"

---

## 6. CTA & Tracking

**Base URL:** `https://selv-waitlist.vercel.app`

### UTM scheme

| Param | Values used |
|---|---|
| `utm_source` | `tiktok` \| `instagram` |
| `utm_medium` | `organic_bio` (TikTok/IG bio link) \| `paid_spark` (TikTok Spark Ads) \| `paid_reels` \| `paid_stories` (Meta paid) |
| `utm_campaign` | `prelaunch_waitlist_jul2026` (single campaign value for this whole flight — no need to fragment further while volume is low) |
| `utm_content` | creative ID from the naming convention below |

### Naming convention

`platform_format_concept_variant` — lowercase, underscores, no spaces:

- `tt_static_avatarreveal_v1`, `ig_static_avatarreveal_v1`
- `tt_static_closet3d_v1`, `tt_static_trybeforebuy_v1`, `tt_static_digitizeapp_v1`, `tt_static_brandhero_v1`
- `tt_video_avatarreveal_v1`, `tt_video_outfitswap_v1` (swap `tt_` → `ig_` for the IG-served version of the same asset)

Full paid CTA link example (S3 on TikTok Spark): `https://selv-waitlist.vercel.app?utm_source=tiktok&utm_medium=paid_spark&utm_campaign=prelaunch_waitlist_jul2026&utm_content=tt_static_trybeforebuy_v1`

### The tracking gap and the fix

**Problem:** `landing/index.html`'s submit handler currently hardcodes `source: 'landing'` on every insert (it never reads the incoming query string beyond `?ref=`). So today, every signup — organic, paid, whatever creative — lands in Supabase indistinguishable by channel.

**Recommended fix (small patch to `landing/index.html`):** on page load, read `utm_source`/`utm_medium`/`utm_content` from `window.location.search` the same way `getIncomingRef()` already reads `ref`, and build the `source` value from them (e.g., join non-empty parts with `_` → `tiktok_paid_spark_tt_static_trybeforebuy_v1`), falling back to `'landing'` only when no UTM params are present (direct/organic-bio traffic with no link tool in front of it). This is a same-shape change to the existing `getIncomingRef()` function — low risk, ships in one deploy.

**Interim workaround if the patch isn't shipped before the first ads go live:** stand up a free link-in-bio tool (Linktree/Beacons) with one button per active creative, each pointing at the UTM-tagged URL above; even without the code patch, this at least separates *paid button clicks* from *organic scroll-through visits* by referrer in Vercel/host analytics, even though Supabase `source` itself stays flat until the patch lands.

### Reading results in Supabase

- **Raw count:** `select count(*) from waitlist;` or call the existing `waitlist_count` RPC (same one the landing page polls for the live counter).
- **By channel (after the fix above ships):** `select source, count(*) from waitlist group by source order by count(*) desc;`
- **Referral virality:** `select referred_by, count(*) from waitlist where referred_by is not null group by referred_by order by count(*) desc;` — surfaces your best organic distributors; cross-reference top `referred_by` codes against which creative first brought that referrer in (via their own `source`) to see which creative produces the most *referring* signups, not just the most signups.
- **Daily pace:** `select date_trunc('day', created_at) as day, count(*) from waitlist group by 1 order by 1;` — the basic read for whether a boosted post moved the needle on a given day.

---

## 7. A/B Testing Plan

Keep every test a straight **A/B (2 variants), never multivariate** — the budget in §8 can't support statistically clean 3+-way splits.

**Test order (run sequentially, not all at once):**

1. **Hook** (highest leverage, test first): 2 opening-2-second variants on the strongest concept (Video A). E.g., "I let an app build a 3D me—" vs. a cold-open straight into the reveal with no setup line. Run both as organic posts 1–2 days apart before spending a dollar on paid — organic 3-second-view-rate comparison is free signal.
2. **Thumbnail / cover frame** (paid only — this is the still image shown pre-tap in feed): test the reveal-moment frame vs. the reaction-shot frame as the static cover for V-A's Spark Ad.
3. **CTA copy**: "Join the waitlist" vs. "See your twin first" vs. "Skip the line" — test on whichever static is already the CTR leader, since CTA copy differences are second-order compared to hook differences.

**How to read a winner on a small budget:** don't wait for textbook statistical significance — the spend here can't support it. Use a practical trigger: after each variant hits **~$50–100 spend or ~1,000–3,000 impressions** (whichever comes first), compare CTR and cost-per-signup directly. If one variant is **>20% better on cost-per-signup**, kill the loser and reallocate its remaining budget to the winner immediately — don't let a test run to a fixed end date if the gap is already obvious. Queue the next test in the order above only after the current one has a called winner.

---

## 8. Budget Tiers

| Tier | What runs | Expected rough outcome (2-week window) |
|---|---|---|
| **$0 — organic only** | All 7 creatives cycled through the 2–3x/day organic cadence (§9) on TikTok + IG Reels, hashtag/sound rotation per §3, referral loop pushed hard in every caption/bio. Pairs with the free micro-creator seeding motion already planned in `MARKETING_STRATEGY.md` §6.2 (this costs product access, not media dollars). | Highly variable — anywhere from a few hundred to low thousands of signups depending entirely on whether one video catches a genuine trend wave. No guaranteed floor; this tier is a bet on creative quality and trend timing, not spend. |
| **~$500 — test** | Boost the 2–3 organic posts with the best early 3-second-view-rate as TikTok Spark Ads (~$300) + one IG boosted Reel/Story (~$200), 5–7 day flight, narrow interest targeting (§3), one A/B hook test running inside it. | Roughly 150–500 incremental signups from paid alone (on top of organic), at the $0.50–$3 CPA range from §1 — treat this tier as a calibration run to find real CPA, not a scale run. |
| **~$2,000 — scale** | ~70% TikTok Spark (proven organic winners + 1 dedicated paid-only variant) / ~30% Meta paid Reels+Stories, running the remaining launch window (10–14 days). Before scaling into this tier, install a **TikTok Pixel and Meta Pixel** on the landing page (neither exists today) so this spend can build real lookalikes and get credit for Conversions-objective delivery instead of Traffic-objective guessing. | Plausibly 800–3,000+ incremental signups and 300k–1M+ combined impressions, but this range is wide on purpose — it moves a lot based on whether the pixel is installed in time and whether the $500 test tier already found a clear creative winner to pour the majority of spend behind. |

Every number above is a directional estimate, not a commitment — re-forecast after the $500 test tier actually runs.

---

## 9. 2-Week Posting / Launch Calendar (Jul 14–27)

Cadence: 2–3 organic posts/day across TikTok + IG Reels throughout. Boosting starts once a post shows an early 3-second-view-rate signal (don't wait for a fixed day if a post is clearly over-performing sooner).

| Day | Date | Organic posts (rotate the 7 creatives + re-cuts) | Paid / boost action |
|---|---|---|---|
| 1 | Jul 14 | S5 brand hero (intro/announcement framing) + V-A avatar reveal | — |
| 2 | Jul 15 | S1 avatar reveal + S2 closet→3D | — |
| 3 | Jul 16 | S3 try-before-you-buy + V-B outfit swap | Review Day 1–2 3s-view-rate; flag a boost candidate |
| 4 | Jul 17 | S4 digitize-into-app + re-cut of best-performing video with alt hook (A/B test #1) | Start $500 test tier if a clear early winner exists |
| 5 | Jul 18 | Re-post best static with new caption/hashtag set + V-A alt cut | Spark Ad live on winning video |
| 6 | Jul 19 | S2 re-cut + S5 hero | IG boosted Reel live on winning static |
| 7 | Jul 20 | Recap/UGC-style "1 week to launch" post (repurpose S1 or V-A framing) + referral-push caption | Read Day 4–7 CPA; decide scale-tier go/no-go |
| 8 | Jul 21 | Launch-week kickoff post (V-B or new hero cut) + S3 | Begin scale-tier spend if data supports it (§8) |
| 9 | Jul 22 | S4 + V-A | Continue scale spend on proven winner(s) |
| 10 | Jul 23 | "1 day to launch" hype post + best-performing static re-cut | Increase Spark budget on top performer |
| 11 | Jul 24 | **Launch day** — real reveal/launch post, all channels, heaviest posting day (aim 3–4x) | Peak paid spend window opens |
| 12 | Jul 25 | Founder/BTS "we shipped" post + user-generated reaction repost (with consent) | Sustain spend |
| 13 | Jul 26 | S1 or V-A re-cut using a real early-user avatar reveal (with consent) if available | Sustain spend, run CTA-copy A/B test #3 |
| 14 | Jul 27 | Week recap post ("first week of selv") + thank-you/referral-milestone shoutout | Wind down test-tier spend, reforecast into Week 3 sustain phase per `MARKETING_STRATEGY.md` §7 |

---

## 10. Creative Best-Practices Cheat Sheet

- **Hook in the first 2 seconds, always.** If the first frame doesn't force a stop, nothing after it matters — every storyboard above front-loads the hook line before any explanation.
- **Native, not polished.** Reaction shots, phone-in-hand framing, and screen-recordings should look like they came from a phone, not a studio — over-produced reads as an ad and gets scrolled past.
- **Captions on, always.** Majority of viewing is sound-off; every on-screen line in the storyboards above is load-bearing, not decorative.
- **Trending sound over original audio**, especially in the first two weeks — discoverability rides the sound, not the brand's own track. Re-check trend status day-of-post; a sound that was trending last week can already be dead.
- **One idea per video.** Each of V-A and V-B does exactly one thing (reveal; swap) — resist the urge to cram the reveal *and* the try-before-you-buy pitch *and* the pricing into one clip.
- **No body language, ever.** No before/after framing, no "glow up," no numeric scores, no comparison shots between two people's bodies — every creative sells the *outfit/avatar-as-you* experience, never a body outcome. This is a hard guardrail, not a style preference.
- **Say the real price when price comes up.** "Free to start" or "free (25 items)" — never bare "unlimited wardrobe" without the subscription qualifier attached in the same breath.
- **Diverse bodies/skin tones across the creative set as a whole** — not token, structural: by the time all 7 creatives are in rotation, the set should visibly represent a range, not one body type repeated seven times.
