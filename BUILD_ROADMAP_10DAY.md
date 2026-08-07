# Selv — 10-Day Build Roadmap (TestFlight MVP)

> ## ⚠️ HISTORICAL PLAN — the build diverged from it
>
> **Status as of 2026-08-07.** This is the 10-day plan as written *before* the
> 3D character-creator pivot. It is kept because the **sequencing logic** is
> still the valuable part — spike the riskiest 3D assumption on Day 1, gate on
> it, and cut scope at a named checkpoint instead of letting it slip silently.
> The **task list is not a current to-do list.** Do not work items off it
> without checking the code first.
>
> Three of its premises recur throughout the days below and are now false:
>
> 1. **Onboarding takes no measurements.** Day 4 has been rewritten below to
>    describe what actually shipped. Every *other* measurement reference —
>    Day 3's measurement→shape formula, Day 10's "body measurement data"
>    privacy-label note, and the Definition of Done — describes a flow that no
>    longer exists. Height/weight survive only as *optional* profile fields;
>    they do not drive the avatar's shape.
> 2. **remove.bg was never integrated.** It is not a dependency in
>    `app/package.json`, and there is no `garment-ingest` Edge Function. The
>    Edge Functions that do exist and are source-controlled are
>    `affiliate-postback`, `product-feed-ingest`, and `delete-account`
>    (`app/supabase/functions/`). Garments are stored as uploaded photos with
>    metadata, so Day 5's background-removal step is **unbuilt, not done**.
> 3. **"Automated test suite" is no longer cut.** The repo has a jest-expo
>    harness — 6 suites, 244 tests passing as of 2026-08-07, `npm test` in
>    `app/` — so ignore its appearance in "What We Cut" below. Crash reporting
>    and analytics (Day 9, and the last line of the Definition of Done)
>    genuinely *are* still unwired.
>
> For current state read `PRODUCT_SPEC.md`, `AVATAR_CREATOR_PLAN.md`, and the
> code. Anything below that contradicts them loses.

Companion to `PRODUCT_SPEC.md`. This is a day-by-day plan to ship an installable iOS TestFlight build in 10 working days.

## Assumptions

- **Team:** 1 engineer full-time (founder), optionally + 1 part-time 3D contractor for Days 1–3 to source/author the base avatar mesh and template garments (this is the single highest-leverage place to buy time back — sculpting a clean rigged mesh from scratch is a specialized skill most solo engineer-founders don't have).
- **Platform:** iOS-first. Code is written cross-platform (Expo/React Native), but only iOS gets a polished TestFlight build by Day 10. Android is not submitted or fully QA'd.
- **Stack:** Expo managed workflow + EAS dev client, `expo-gl` + `expo-three` + `@react-three/fiber`, Supabase (Postgres/Auth/Storage), remove.bg API. This matches the recommendation in `PRODUCT_SPEC.md`.
- **Starting point:** the repo already has a scaffolded Expo app with Supabase wired up (auth, a basic `garments`/`outfits`/`outfit_items` schema, garment upload-to-storage flow). This roadmap builds the 3D pipeline on top of that and extends the schema — it does not start from zero.
- **Avatar rig:** sourced/adapted, not sculpted from scratch. Buy or adapt a pre-rigged humanoid base mesh with a small set of blendshapes (commercial-license asset from CGTrader/Sketchfab, or a MakeHuman/Anny-derived export) rather than authoring one in Blender from a blank canvas — 10 days is not enough time to become a character artist.
- **Blendshape scope cut:** 4 dimensions, not the full ~10 described in the product spec — **height, weight/volume, chest/bust, hip**. This is the single biggest scope cut that makes the avatar spike achievable in 3 days.

## Day-by-Day Plan

### Day 1 — Spike: get ONE textured, rotatable, garment-wearing avatar on screen
**Goal:** prove the riskiest technical assumption in the whole product — that a GLB avatar with morph targets + a skinned garment can render and rotate performantly inside Expo — before anything else is built.
- Set up `expo-gl`, `expo-three`, `@react-three/fiber`, `@react-three/drei` in the existing Expo app; confirm it builds in an EAS dev client on a physical iPhone (not just simulator).
- Source ONE pre-rigged humanoid base mesh (neutral pose, ≤15k tris) with at least a couple of morph targets, and ONE simple template garment (t-shirt) skinned to the same skeleton. Buy from CGTrader/Sketchfab with a verified commercial license, or adapt a MakeHuman/Anny export.
- Load both GLBs in a bare-bones screen, render the avatar wearing the shirt, enable orbit-style rotate/zoom.
- **Deliverable/checkpoint:** a rotatable 3D avatar wearing a shirt, running at an acceptable frame rate on a real iPhone, inside the Expo dev client. If this doesn't work by end of day, escalate immediately — this is the go/no-go risk for the whole 10 days.

### Day 2 — Spike: drive the avatar with data, prove garment re-texturing
**Goal:** prove the two mechanics the rest of the app depends on: (1) blendshape weights change the avatar's shape, and (2) a garment's texture can be swapped at runtime.
- Build a throwaway debug screen with 4 sliders (height, weight, chest, hip) that write directly to the avatar's morph target weights in real time.
- Confirm the shirt (skinned to the same skeleton/bones) scales and follows the avatar's shape changes without manual per-garment code.
- Swap the shirt's texture at runtime using a test JPEG, to prove the "apply user's photo as a texture" mechanic works before wiring it to real uploads.
- **Deliverable/checkpoint:** moving sliders visibly reshapes the avatar and the shirt follows; tapping a "swap texture" debug button changes the shirt's appearance without reloading the scene.

### Day 3 — Lock the pipeline, define the measurement→shape formula, go/no-go gate
**Goal:** close out the spike with a real (if rough) measurement-to-shape mapping and a performance sanity check, then decide the final scope for the rest of the build.
- Write the height/weight/chest/hip → blendshape-weight mapping function (simple calibrated linear formulas; doesn't need to be scientifically rigorous for MVP — "looks proportionally right" is the bar).
- Lock the final template garment set needed for MVP categories: 1 top, 1 bottom, 1 pair of shoes (skip dress/outerwear variety for now — add only if time allows later).
- Performance pass: check poly count, compress textures, confirm frame rate on a mid-tier reference device (not just your dev phone).
- **Go/no-go decision:** if the pipeline is solid, proceed as planned. If blendshapes or garment-skinning are still unreliable, cut further — ship with a small set of **fixed pre-set body types** (e.g. 3–5 discrete avatar presets picked by silhouette, no continuous sliders) instead of continuous measurement-driven shape. Write this decision down; don't silently let it slip into Day 4.
- **Deliverable/checkpoint:** final avatar pipeline decision made and documented; base mesh + 3 template garments locked as production assets.

### Day 4 — Auth, schema, onboarding flow
**Goal:** wire the real user flow around the proven 3D pipeline.
- Extend the existing Supabase schema: add `avatars`, `garment_templates` (the 3 locked templates from Day 3), and add `template_id`/`texture_path`/`source`/`processing_status` columns to the existing `garments` table. Apply RLS consistent with the existing owner-only pattern. (*Shipped as:* `avatars` exists in `app/supabase/schema.sql` with an owner-only `"own avatar"` policy, but it carries a **`customization` jsonb** — the character-creator selections — as the live source of the avatar. The measurement columns and `shape_params` are nullable legacy fields. `garment_templates` was never created.)
- Confirm Supabase Auth sign-up/sign-in works end-to-end (already scaffolded — verify, don't rebuild). (*Shipped as:* email OTP via `signInWithOtp`/`verifyOtp`, not email/password.)
- Build the onboarding UI: sign up → **character creator** (skin tone, face shape, eye shape + color, hair style + color, brows, facial hair, body type, accessories) → the character re-renders live as it's edited, using Day 1–3's pipeline. **No photo, no scan, no measurement form, no tape measure.** This is what shipped: `app/src/features/creator/CharacterCreatorScreen.tsx`, routed at `app/app/onboarding.tsx`; option sets live in `app/src/features/creator/customization.ts`. Saving writes the `customization` jsonb via `saveCustomization()` and syncs `profiles.build` from the chosen body type, which is the gate `app/app/_layout.tsx` checks before letting a user into the tabs. The measurement-based `OnboardingScreen` was deleted, not just unrouted.
- **Deliverable/checkpoint:** a brand-new user can sign up, design a character, and see their own rotatable avatar.

### Day 5 — Garment upload pipeline
**Goal:** get a real user photo turned into a wardrobe item.
- Photo picker (camera/library) with a simple capture guide overlay ("plain background works best").
- Call remove.bg API (directly from client for MVP simplicity, or via a thin Supabase Edge Function if you want the API key server-side — recommended for key safety) to background-remove the uploaded photo.
- Manual category picker (top/bottom/shoes to match the 3 locked templates); store the cleaned texture in the `garments` Storage bucket, insert the `garments` row with `template_id` set from category.
- Wardrobe grid screen listing uploaded garments with thumbnails.
- **Deliverable/checkpoint:** user uploads a real garment photo, sees it background-removed, and it appears in their wardrobe grid.

### Day 6 — Equip a garment on the avatar (single slot)
**Goal:** close the loop from "photo in wardrobe" to "garment on my avatar."
- Try-On screen: tapping a wardrobe garment applies its stored texture onto the matching template GLB and attaches it to the avatar's skeleton (reusing Day 2's texture-swap mechanic with real data instead of test JPEGs).
- Handle the one real edge case likely to bite: texture aspect ratio / UV mapping mismatches from arbitrary user photos — add a basic center-crop/fit step so textures don't stretch badly.
- **Deliverable/checkpoint:** tap a real uploaded top in the wardrobe grid → avatar renders wearing it, rotatable.

### Day 7 — Multi-slot outfit builder + saving
**Goal:** ship the actual "mix garments, save outfits" core loop.
- Extend the Try-On screen to support multiple simultaneous slots (top, bottom, shoes) with layering order.
- "Save outfit" flow: name it, render/store a snapshot thumbnail, write to `outfits`/`outfit_items` (extend `outfit_items` with `slot` and nullable `catalog_item_id` per the data model in `PRODUCT_SPEC.md`).
- Saved Outfits list screen with thumbnails; tap to reload an outfit onto the avatar.
- **Deliverable/checkpoint:** build a full top+bottom+shoes outfit, save it by name, close and reopen the app, confirm it's still there and reloads correctly onto the avatar.

### Day 8 — Catalog stub + try-before-you-buy
**Goal:** ship the "try something I don't own" feature without building a real catalog pipeline.
- Seed 30–50 `catalog_items` rows by hand (JSON seed script → Postgres insert), reusing the same 3 locked templates with a handful of different textures/colors so this doesn't require new 3D assets.
- Simple browse/search screen: category filter + basic text search (`ilike` on name/brand — full-text search infrastructure from the product spec is a nice-to-have, not required for 30–50 rows).
- "Try it on" from a catalog item reuses the exact same equip mechanic as owned garments (via `catalog_item_id` instead of `garment_id`), plus an "Add to wardrobe" button that copies it into the user's owned `garments`.
- **Deliverable/checkpoint:** browse the stub catalog, try an unowned item on your avatar, add it to your wardrobe, use it in a saved outfit.

### Day 9 — Polish, error handling, performance, instrumentation
**Goal:** turn a working demo into something that survives a real tester's hands.
- Loading/empty/error states across every screen (especially avatar generation and garment upload, which have real failure modes: network timeout, remove.bg failure, bad photo).
- App icon, splash screen, onboarding copy pass — set honest expectations ("your outfit preview," not "photorealistic you").
- Crash reporting (Sentry free tier) and basic analytics (PostHog free tier) wired into key events: sign-up, avatar generated, garment uploaded, outfit saved.
- Run the full user journey on a real mid-tier device end to end at least 5 times, fix anything that crashes or visibly breaks.
- Quick sanity pass on Android (even though not submitting) to confirm nothing is silently iOS-only in a way that blocks the Phase 2 Android launch.
- **Deliverable/checkpoint:** the full core loop (sign up → avatar → upload garment → try catalog item → save outfit) runs without crashes on a real device, 5/5 attempts.

### Day 10 — TestFlight ship
**Goal:** get it into testers' hands.
- EAS Build production profile; App Store Connect app record set up (bundle ID, screenshots, privacy nutrition label — flag photo upload and body measurement data collection accurately).
- Submit build via EAS Submit; set up a TestFlight internal testing group.
- Smoke-test the actual TestFlight build (not the dev client) end to end — dev-client and production builds can behave differently (asset bundling, environment variables).
- Write a one-page tester script covering the core loop, invite testers.
- **Deliverable/checkpoint:** TestFlight build is live, at least one tester outside the founder has installed it and completed the full core loop.

## What We Cut to Make 10 Days

- **Android submission.** Code stays cross-platform-safe; no Play Console submission or Android-specific polish.
- **True photo→3D garment reconstruction.** Template + auto-texture only, as explained in `PRODUCT_SPEC.md` §5b — not real garment cut/silhouette reconstruction.
- **Real-time cloth physics.** Garments are skinned to the avatar skeleton, not simulated.
- **Continuous full avatar shape space.** 4 blendshape dimensions (height, weight, chest, hip) instead of the ~10 described as the fuller MVP target in the product spec; falls back to discrete body-type presets if the Day 3 go/no-go gate fails.
- **Garment variety.** 3 locked templates (1 top, 1 bottom, 1 shoes) instead of the 15–25-template library described in the product spec — dresses/outerwear are a fast-follow, not Day-10 scope.
- **Automatic garment classification.** Manual category picker only; no CLIP/ML classifier.
- **Real catalog feed.** 30–50 hand-seeded rows, not a partner/affiliate integration.
- **Social, entirely.** No follows, sharing, or feed UI. (Schema fields from the product spec's `follows`/`shared_outfits` tables are not created in this 10-day scope — add them when Phase 2 actually starts.)
- **Photo-based measurement estimation.** Manual number entry only; no 3DLook/Bodygram/Meshcapade integration.
- **Sign in with Apple/Google polish.** Email/password only unless time allows; add Apple Sign-In only if App Store review flags it as required (it's only mandatory if another third-party login is offered).
- **Push notifications, deep linking, offline support, automated test suite.** None of these block a TestFlight MVP.

## Definition of Done (End of Day 10)

- TestFlight build is installable by internal testers.
- A brand-new user can, without help: sign up → enter measurements → see a rotatable parametric avatar → upload a garment photo (background removed, auto-textured onto a template) → browse the stub catalog and try on an item they don't own → build an outfit combining an owned garment and a catalog item across at least two slots → save it by name → close and reopen the app and see it persisted.
- No crashes across that core flow on a real mid-tier iPhone, verified across multiple runs.
- The avatar+garment scene renders at a usable frame rate (~30fps target) on that reference device.
- Supabase RLS is verified with a second test account: it cannot read the first account's garments, avatar, or outfits.
- Crash reporting and basic event analytics are wired and confirmed to be receiving data.
