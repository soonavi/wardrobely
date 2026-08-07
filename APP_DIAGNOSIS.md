# Selv (app/) — Diagnosis & Build Plan

Read-only audit of the Expo/React Native app against `PRODUCT_SPEC.md` and
`BUILD_ROADMAP_10DAY.md`. No code was changed to produce this document.

---

## 1. Current state — screen by screen

**Auth — real, functional.** `src/features/auth/SignInScreen.tsx` +
`src/lib/api/auth.ts`. Email OTP via `supabase.auth.signInWithOtp` /
`verifyOtp`, with a friendly error-message translator, resend cooldown, and
"use a different email" escape hatch. This is solid — no stub code here.

**Onboarding — real, but branded wrong.** `src/features/onboarding/OnboardingScreen.tsx`
collects height/weight (imperial/metric toggle) + a general "build" (slim/
average/athletic/curvy/broad via `BuildPicker`), writes to `profiles`
(`updateBodyMetrics` in `src/lib/api/profiles.ts`). Functional and gates
correctly in `app/_layout.tsx` (`!profile?.build` → redirect to onboarding).
**Bug:** line 124 hardcodes `wardrobe<Text>Spec</Text>` — the pre-rename
brand name — as the screen's title, not `Selv`/the `Wordmark` component used
elsewhere.

**Wardrobe (upload + 25-item cap) — real CRUD, no digitization pipeline.**
`WardrobeGridScreen.tsx` + `AddGarmentScreen.tsx` + `src/lib/api/garments.ts`.
Camera/library picker → raw JPEG uploaded straight to the private `garments`
Storage bucket → row inserted with manual category/name/color/brand/tags.
The 25-item free cap (`FREE_WARDROBE_LIMIT` in `src/lib/pricing.ts`) is
enforced twice — client-side gate before navigating to Add Garment, and a
defensive re-check inside `createGarment` right before insert — which is
good practice. **But**: `garments` has `template_id`/`texture_path`/
`processing_status` columns (schema.sql lines 47-53) built for the
PRODUCT_SPEC §5b "background removal → auto-texture onto template" pipeline,
and none of it is wired — `createGarment` never sets `template_id`, and
there is no `remove.bg`/`garment-ingest` Edge Function anywhere in the repo
(`supabase/functions/` doesn't exist). Garments are just photos with
metadata, not textures on a 3D template.

**Try-on (2D collage) — the actual, working core loop.**
`src/features/tryon/TryOnStudioScreen.tsx` + `GarmentLayer.tsx` +
`src/features/avatar/avatars.tsx`. This is a paper-doll compositor: a flat
`react-native-svg` body silhouette (6 build shapes × BMI-derived width
scale) with draggable/pinchable/rotatable *raster garment photos* layered on
top (`react-native-gesture-handler` + `reanimated`). Tap a garment in the
drawer → it's added at a category-based anchor point → drag/pinch/rotate →
"Save outfit." This is real and it works end to end, including reloading a
saved outfit's layers. It is **not 3D** and never claims to be — it's a
flat sticker collage over an SVG silhouette.

**Outfits — real.** `src/features/outfits/OutfitsScreen.tsx` +
`src/lib/api/outfits.ts`: list/rename/delete/reopen, stacked garment-photo
previews. Functional, with one real bug (see §4).

**Profile + account deletion — mostly real, deletion unverifiable.**
`ProfileScreen.tsx`: view/edit height+weight+build (same `profiles` table as
onboarding — consistent), sign out, and a "Delete account" flow that calls
a Supabase Edge Function named `delete-account`
(`src/lib/api/account.ts`). **That function does not exist anywhere in this
repo** (no `supabase/functions/` directory at all). Either it was deployed
by hand directly against the live Supabase project (unverifiable, un-diffable,
disaster if the project is ever recreated), or account deletion silently
404s today. This is an Apple Guideline 5.1.1(v) compliance feature — it
needs to exist in source control, not just "somewhere in the dashboard."

**3D avatar spike — a real, honestly-labeled spike, not a product.**
`src/features/avatar3d/AvatarSpikeScreen.tsx` + `bodyModel.ts` +
`MeasurementsScreen.tsx` + `src/lib/api/avatars.ts`. Reachable only via a
"Open 3D avatar spike →" button on the Profile screen (explicitly commented
as a temporary dev entrypoint), pushed as a stack screen — **not a tab, not
in the main nav.** It renders a remote GLB (a CloudFront-hosted,
`image_to_3d`-generated mesh, no morph targets) with rotate/pinch gestures,
4 measurement sliders (height/weight/chest/hip) backed by their own
`avatars` table row, and a semi-transparent acid-green capsule standing in
for a garment. Every limitation is documented in code comments and
`SPIKE_README.md` — this is good, disciplined spike work, but it is Day
1-2-of-10 quality, not launch quality.

---

## 2. The core gap — two try-on experiences, not unified

Today the app effectively ships **two unrelated try-on products**:

| | 2D collage (`TryOnStudioScreen`, the "Try On" tab) | 3D spike (`AvatarSpikeScreen`, Profile → dev button) |
|---|---|---|
| Reachable via | Main tab bar | Hidden button on Profile |
| Body model | Flat SVG silhouette, driven by `profiles.height_cm/weight_kg/build` | Remote GLB, driven by a **separate** `avatars` table (height/weight/chest/waist/hip/inseam) |
| Garment | Real uploaded photo, draggable sticker | One hardcoded green capsule |
| Data written | `outfits`/`outfit_items` | `avatars.shape_params` |
| Status | Working core loop | Engineering spike |

They don't share a body model, a measurement source, or a data model. A
user who does onboarding gets a 2D silhouette; if they also poke the hidden
3D button, they're asked to re-enter measurements into a *second*,
non-overlapping form (chest/waist/hip/inseam vs. just a "build" pick), and
nothing keeps the two in sync. Right now that's fine because the 3D screen
is a hidden spike — but it means **there is no path from today's code to
"the 3D avatar is what onboarding produces" without real integration work**:

1. **Unify the measurement model.** Either extend `profiles` to carry the
   avatar-grade measurements (chest/waist/hip/inseam, skin tone) and retire
   the separate `avatars` table, or make onboarding write both rows in one
   transaction. Right now they're two independent sources of truth with two
   independent screens (`OnboardingScreen` vs `MeasurementsScreen`) that
   duplicate the unit-conversion logic slightly differently.
2. **Decide what "Try On" means in the tab bar.** Either (a) the 3D viewer
   replaces `TryOnStudioScreen` as the tab, and the 2D garment-layering UX
   is ported to place garments on the 3D avatar instead of an SVG silhouette
   (a real rewrite of the interaction model, not a reskin), or (b) 2D stays
   for v1 and the 3D work is explicitly Phase 2, in which case the spike
   button should come out of Profile before any TestFlight build (a hidden,
   half-working 3D screen reachable by any curious tester is a bad look and
   a crash-report magnet for something you don't intend to ship yet).
3. **Garments need a 3D representation before they can appear on the 3D
   avatar at all.** The 2D collage's "garment" is just the user's uploaded
   photo. The 3D pipeline needs a *template mesh* per category (per
   PRODUCT_SPEC §5b/§7 — `garment_templates` table already exists in
   `schema.sql` but is never populated or referenced from any screen) before
   a real garment can be equipped in 3D. This is a bigger lift than it looks
   from the UI: it's not "swap the capsule for the shirt," it's "build the
   template library, wire `template_id` assignment into the upload flow, and
   build a texture-projection step" — none of which exists today.

**Recommendation:** given the current build maturity (2D loop fully works;
3D is a 2-day spike), treat 3D as an explicit Phase 2/v1.1 target, not
something to force into the v1 ship. Pull the spike entry point from
Profile for the TestFlight build, keep building it in parallel/branch, and
re-evaluate "3D replaces 2D" once tier (b) below (real blendshapes) lands —
before that, 3D literally cannot do per-region reshaping, so shipping it as
the primary experience would be a downgrade from the 2D silhouette, which at
least has 6 distinct, recognizable body shapes.

---

## 3. The realism problem (priority)

**Why the avatar looks unrealistic today, concretely:**

- The base mesh (`AVATAR_GLB_URL` in `AvatarSpikeScreen.tsx`) is a **single
  reference-image → 3D export**. This class of generator produces lumpy,
  undefined geometry (soft/melted facial features, no clean topology, no
  loop-based mesh you could rig by hand) — it was never modeled with
  clothing-fit or animation in mind.
- It has **no morph targets and no named skeleton**. `bodyModel.ts`'s
  `applyShapeToObject` is written correctly — it actively looks for
  `morphTargetDictionary` on any mesh and prefers real blendshapes the
  moment they exist — but finds none today, so every "shape" edit falls
  back to `applyAxisScaleFallback`: a **non-uniform scale on the entire
  mesh** (height → Y, weight → X+Z, chest/hip → extra X/Z nudges on top).
  That's not reshaping a body, it's squashing/stretching one rigid blob —
  the single biggest driver of "why does moving the weight slider make the
  avatar look weird" today.
- The "garment" is a **primitive capsule** (`PlaceholderGarment` in
  `AvatarSpikeScreen.tsx`), acid-green and semi-transparent by design, not
  clothing geometry.
- Lighting is flat: one ambient + two directional lights, no shadows (real-
  time shadow maps are called out as an `expo-gl`/OpenGL ES perf risk in
  PRODUCT_SPEC §9), no environment reflection, no tone-mapping pass.

**Fix path, in tiers — honest about effort and ceiling:**

**(a) Quick wins available now — rendering quality.** *(already in progress
in parallel — task #23/#24 on this project.)* Studio 3-point lighting or an
HDRI environment (`@react-three/drei`'s `<Environment>`), PBR material
tuning (`meshStandardMaterial`/`meshPhysicalMaterial` roughness/metalness
instead of flat `meshStandardMaterial` defaults), soft/baked shadows
(`<ContactShadows>` or an AO blob under the feet, *not* real-time shadow
maps — those are the specific perf risk PRODUCT_SPEC flags for this
renderer), and a tone-mapping pass (`ACESFilmicToneMapping` on the R3F
`gl` config). **Effort: low, days not weeks. Ceiling: moderate** — this
makes the *render* look like a polished product shot, but it does not fix
the underlying mesh: the same lumpy geometry will still read as slightly
warped/uncanny under great lighting, the shape sliders will still squash a
rigid blob rather than reshape a body, and the garment is still a capsule.
Lighting polish cannot manufacture anatomy or clothing that isn't there.

**(b) A proper parametric base mesh with real blendshapes.** Replace the
`image_to_3d` GLB with a MakeHuman/Anny-derived rig per PRODUCT_SPEC §5a:
~10-15k tris, Mixamo-compatible skeleton, curated blendshapes for at least
the roadmap's 4 axes (height, weight/volume, chest, hip — ideally the
spec's fuller ~10). This is the **highest-leverage fix available**, because
`bodyModel.ts`'s `applyShapeToObject`/`MORPH_TARGET_NAME_CANDIDATES`
machinery is *already written and waiting* for exactly this asset — the
code has nothing to change, it just needs a GLB with named morph targets
matching (or extending) its candidate-name lists (`chest`, `bust`, `pecs`,
`hip`, `hips`, `glute`, etc.). **Effort: medium** — this is asset sourcing/
authoring work (buy a commercially-licensed rig from CGTrader/Sketchfab, or
derive one from Anny's Apache-2.0 assets in Blender), which is exactly why
`BUILD_ROADMAP_10DAY.md` assumed a part-time 3D contractor for Days 1-3
rather than solo engineering time. **Ceiling: high** — this is the real
production path the spec recommends, gives genuine per-region reshaping
instead of a squashed blob, and costs nothing per-avatar since the mesh is
shared/bundled (only the small `shape_params` JSON vector is per-user).

**(c) Real skinned garment templates instead of the capsule.** Author or
license a small template library (spec: 15-25 items; roadmap's realistic
cut: 1 top / 1 bottom / 1 shoes) skinned to the *same* skeleton as the base
mesh from tier (b), replacing `PlaceholderGarment`. This **must come after**
(b) — skinning requires bones to bind to, so it's sequenced, not parallel.
**Effort: medium-high** — garment topology + UV layout for photo-texture
projection is specialized 3D work and the piece most likely to blow a solo
timeline; buying/adapting commercially-licensed templates is far more
realistic than sculpting from scratch. **Ceiling: bounded by design, not
just effort** — even done well, garments remain "your photo skinned onto
the closest-shaped template," not a true reconstruction of cut/silhouette;
PRODUCT_SPEC §5e already calls this an accepted MVP limitation, not
something tier (c) is meant to solve. Separately, note that runtime texture-
swapping (projecting a *real* uploaded garment photo onto a template, not a
test JPEG) is still unproven anywhere in the codebase — that's necessary
glue work regardless of which tier the garment work lands in.

---

## 4. Bugs / risks / tech debt

- **Two disconnected measurement systems.** `profiles.height_cm/weight_kg/build`
  (onboarding, 2D avatar, Profile screen) vs. `avatars.height_cm/weight_kg/
  chest_cm/waist_cm/hip_cm/inseam_cm/shape_params` (3D spike only,
  `src/lib/api/avatars.ts`). Editing one never updates the other — the 2D
  and 3D avatars can silently diverge. See §2.
- **Outfit edit always creates a duplicate.** `TryOnStudioScreen.handleSaveOutfit`
  calls `createOutfit` even when `outfitId` is set from a loaded outfit;
  `updateOutfit` in `src/lib/api/outfits.ts` is fully implemented, tested-
  looking, and **never called**. Documented in `PLAN.md` ("Known MVP
  limitation: re-saving a loaded outfit creates a new outfit") and in
  `outfits.ts`'s own doc comment on `updateOutfit` — a real, known,
  unfixed bug, not a hidden one.
- **`delete-account` Edge Function doesn't exist in the repo.**
  `src/lib/api/account.ts` invokes it via `supabase.functions.invoke`, but
  there is no `supabase/functions/` directory anywhere. Either it's deployed
  out-of-band against the live project (unaudited, unreproducible) or
  account deletion is currently broken. This is an App Store review
  requirement (Guideline 5.1.1(v)) — needs to be a real, source-controlled
  function.
- **No garment digitization pipeline.** `garments.template_id`/
  `texture_path`/`processing_status`/`garment_templates` all exist in
  `schema.sql` for the background-removal + template-texture flow in
  PRODUCT_SPEC §5b, but nothing populates or reads them — no `remove.bg`
  call, no Edge Function, no template seeding. The schema promises a
  pipeline the app doesn't build.
- **Leftover "Twinit" branding post-rename.** `src/lib/pricing.ts`'s
  user-facing `wardrobeLimitMessage()` ("Upgrade to Twinit+ for an unlimited
  wardrobe") and TODO comments in `WardrobeGridScreen.tsx`/
  `AddGarmentScreen.tsx` still reference the pre-Selv brand name shown at
  the wardrobe-cap paywall — a real user-facing string, not just internal
  comments.
- **`OnboardingScreen.tsx` hardcodes "wardrobeSpec"** (line 124) as the
  screen's brand text instead of `Selv`/`Wordmark` — the very first screen
  after signup shows the old product name.
- **Wardrobe paywall is a dead end.** `getCurrentPlan()` in `pricing.ts` is
  hardcoded to always return `"free"`; the "Upgrade" button in both
  `WardrobeGridScreen` and `AddGarmentScreen` is a `// TODO` no-op. There is
  no RevenueCat integration at all in `package.json`, so once a user hits
  25 items there is currently no way to ever add more.
- **3D spike's single point of failure.** `AVATAR_GLB_URL` points at one
  hardcoded CloudFront URL with no bundled local fallback; `SPIKE_README.md`
  itself flags remote GLB loading via `useGLTF` as a known-fragile path on
  RN/three.js. (Also: the URL in `SPIKE_README.md` no longer matches the
  one actually in `AvatarSpikeScreen.tsx` — minor doc drift.)
  Production guidance already exists in the same file (bundle the GLB via
  `require()`) but hasn't been applied yet.
  
- **Hand-rolled UUID generator.** `generateUuid()` in `garments.ts` uses
  `Math.random()` instead of `crypto.randomUUID()`/`expo-crypto` — low risk
  in practice, but non-standard and worth swapping for a real UUID source.
- **No crash reporting or analytics wired.** `package.json` has no Sentry/
  PostHog dependency despite `BUILD_ROADMAP_10DAY.md` Day 9 explicitly
  calling for both before shipping — currently no visibility into crashes
  or funnel drop-off (sign-up → avatar → upload → outfit) once testers are
  using the TestFlight build.
- **No automated tests.** Only a hand-written notes file
  (`bodyModel.test-notes.md`) and ad hoc `_smoke.ts`/`_pricing_smoke.ts`
  scripts; no test runner (no `jest`/`jest-expo` in `package.json`). The
  measurement→shape calibration math in `bodyModel.ts` is exactly the kind
  of pure-function logic that should have real unit tests given how much
  the product's credibility depends on it looking "proportionally right."
- **Dead schema column.** `profiles.body_type` is explicitly marked
  "Legacy enum — column still exists in the DB but the app no longer uses
  it" in `database.types.ts` — harmless but worth cleaning up eventually.
- **Duplicated unit-conversion logic.** `OnboardingScreen.tsx` does its own
  inline ft/in/lb↔cm/kg math while `MeasurementsScreen.tsx` uses
  `bodyModel.ts`'s `cmToInches`/`inchesToCm`/`kgToLb`/`lbToKg` helpers —
  same job, two implementations, drift risk if one is ever tweaked without
  the other.

---

## 5. Prioritized roadmap to a shippable v1

**P0 — blocking**
- [ ] Decide and document: 2D stays as v1's "Try On" tab, 3D moves fully to
      Phase 2/branch (recommended given current maturity — see §2).
- [ ] Pull the "Open 3D avatar spike →" button off `ProfileScreen.tsx`
      before any TestFlight build if 3D isn't v1 scope.
- [ ] Fix outfit save: wire `updateOutfit` into `TryOnStudioScreen.handleSaveOutfit`
      when `outfitId` is set, so editing a saved outfit updates instead of
      duplicating.
- [ ] Re-create `delete-account` as a real, source-controlled Supabase Edge
      Function (`supabase/functions/delete-account`) and verify it actually
      runs — App Store review will test this.
- [ ] Remove all "Twinit" strings (`pricing.ts`, wardrobe/add-garment TODOs)
      and fix `OnboardingScreen.tsx`'s hardcoded "wardrobeSpec" — replace
      with Selv branding throughout.
- [ ] Reconcile or explicitly scope-cut the `profiles` vs `avatars`
      measurement duplication so the two body models can't silently diverge.
- [ ] Decide the garment pipeline's real v1 scope: either implement
      background removal end-to-end (even a minimal on-device crop, per
      `PLAN.md`'s original "Phase 2" note) or strip the unused
      `template_id`/`texture_path`/`garment_templates` machinery so the
      schema stops promising something unbuilt.

**P1 — important**
- [ ] Wire Sentry (crash reporting) + PostHog (funnel analytics) per
      `BUILD_ROADMAP_10DAY.md` Day 9 — currently zero production visibility.
- [ ] Wire RevenueCat so the wardrobe-cap "Upgrade" button does something,
      or remove the paywall UI until it's real.
- [ ] Add a jest/jest-expo test harness and cover `bodyModel.ts`'s
      calibration math with real unit tests (replacing the hand-written
      notes file).
- [ ] Bundle the 3D avatar GLB as a local asset (`require(...)`) instead of
      a single remote CloudFront URL, per `SPIKE_README.md`'s own guidance.
- [ ] Swap `generateUuid()` for `crypto.randomUUID()`/`expo-crypto`.
- [ ] Drop the dead `profiles.body_type` column and dedupe the two
      unit-conversion implementations (`OnboardingScreen` vs `bodyModel.ts`
      helpers).

**P2 — nice-to-have / phase 2**
- [ ] Tier (a): studio lighting/PBR/soft shadows/tone-mapping for the 3D
      spike (in progress in parallel).
- [ ] Tier (b): parametric MakeHuman/Anny-derived base mesh with real
      blendshapes, replacing the `image_to_3d` GLB (highest-leverage 3D fix,
      the code already supports it).
- [ ] Tier (c): real skinned garment templates replacing the capsule
      (sequenced after tier (b)).
- [ ] Unify 2D and 3D into one try-on experience once tier (b) lands.
- [ ] Photo-based measurement refinement (3DLook/Bodygram/Meshcapade),
      affiliate catalog feed, Android launch polish, social schema — all
      already correctly deferred to Phase 2 per `PRODUCT_SPEC.md` §11.
