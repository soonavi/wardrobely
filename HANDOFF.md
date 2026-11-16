# Handoff

Written 2026-11-16. Read this first; it is a runbook, not a status report.

---

## 1. What Selv is

**Design a character that is actually your size, put your real wardrobe on
it, and see an outfit before you wear it or buy it.**

Three things have to be true for that sentence to be honest, and they are the
order of work:

1. **The character is a person.** A human body with your skin, face, hair and
   build — and, when you give your height and weight, your proportions.
2. **Your clothes go on it.** Every garment you add shows up on that body in a
   believable silhouette and its real colour.
3. **It is worth opening tomorrow.** Outfits you saved, things you might buy
   shown on you, a share card of a look.

Until 2026-11-16 the first of these was false: the "3D character" was about
fifty spheres and capsules, and the first thing a new user saw was a flat SVG
bust. That is fixed (§2). The second is true at silhouette-and-colour level.
The third is partly built and unevenly finished (§4).

No photo of the user is ever taken. The avatar is authored choices plus,
optionally, two numbers. That is a product decision as much as a privacy one
(see `AVATAR_CREATOR_PLAN.md`) and nothing below changes it.

---

## 2. What changed on 2026-11-16

| | Before | Now |
|---|---|---|
| Avatar | ~50 three.js primitives | Human mesh, 53-bone rig, 33 calibrated shape targets |
| First screen for a new user | 2D SVG bust | Live 3D character in the creator |
| Body | 5 fixed presets | Presets + 8 sliders; profile height/weight solved onto the mesh |
| Garments on the avatar | Tinted primitives | 22 fitted templates chosen from category + name, over a base layer |
| Hair / brows / beard / glasses | Sphere caps and boxes | 11 hairstyles, 4 brows, 4 beards, glasses, earrings |
| Web | Could not build | Builds and runs (`react-native-web` added) |
| Proof it renders | None (159 tests, no model ever loaded) | Tests load the real `.glb`; `tools/webcheck` screenshots the real screens |

Where things live:

- `tools/avatar-build/` — builds `app/assets/avatar/selv-human.glb` from
  MakeHuman's CC0 data. **Read its README**: it covers the licence position
  and answers the "non-commercial assets" question the last handoff left open.
- `app/src/features/avatar3d/human/` — the runtime: `HumanRig` (shape, binding,
  skeleton), `humanShape` (sliders and real measurements → target weights),
  `humanLook` (character + outfit → parts and colours), `garmentTemplates`,
  `HumanAvatar` (the component), `HumanStage` (canvas + lights + camera).
- `tools/webcheck/` — runs the exported web build against a mocked Supabase in
  headless Chromium and screenshots each screen.

### How to check it yourself

```bash
cd app && npm ci
npm run typecheck && npm test -- --ci && npm run lint     # 493 tests

# see the screens
EXPO_PUBLIC_SUPABASE_URL=https://selvtest.supabase.co EXPO_PUBLIC_SUPABASE_ANON_KEY=test-anon-key \
  npx expo export --platform web --output-dir /tmp/selv-web
node ../tools/webcheck/run.mjs --dist /tmp/selv-web --out /tmp/selv-shots
node ../tools/webcheck/run.mjs --dist /tmp/selv-web --out /tmp/selv-shots --scenario new-user

# run it for real (needs app/.env with the project URL and anon key)
npx expo start --web        # or --ios / --android
```

---

## 3. Not verified — do this before believing anything else

**Nothing here has run on a physical iOS or Android device.** Everything was
verified in headless Chromium (software GL) and in Jest. The web renderer and
the native one share the runtime but not the GL stack. Specifically unproven on
expo-gl:

- loading a 13 MB `.glb` through expo-asset on a mid-range phone (time, memory);
- skinned meshes with alpha-blended parts (brows, lashes, beards);
- frame rate with a full outfit.

The asset was built to minimise that risk — no textures, no compressed
geometry, no GPU morph targets — and `HumanAvatar` falls back to the old
primitive avatar if the mesh fails to load, so the worst case is the old app,
not a blank screen. But that is a design intention, not a measurement.

---

## 4. Known gaps, in order of how much they hurt

1. **The share card and the Outfits grid still draw the old 2D figure.**
   `ShareCard.tsx` and `OutfitsScreen` use `AvatarPreview` (SVG). Sharing a
   look is the growth loop; it should be a snapshot of the 3D canvas.
2. **Garment photos do not reach the avatar.** Garments are tinted with a
   colour resolved from the colour field, then the name, then a hash. A
   garment with no colour word gets an arbitrary neutral. Either extract a
   dominant colour at upload or ask for a swatch in `AddGarmentScreen`.
3. **The template is guessed and cannot be corrected.** `pickGarmentTemplate`
   reads category + name. `GarmentVisual.template` is the hook for an explicit
   choice; no screen sets it and nothing stores it.
4. **Accessories are not drawn** (bag, belt, hat share one category and no
   shape). `buildHumanLook` reports them as `undrawn`; the slot chip still
   shows them as worn.
5. **Outerwear replaces the top instead of layering over it.** The mesh
   supports an `outer` slot (`HumanEquipped.outer`); the try-on screen has four
   slots and puts outerwear in `top`.
6. **Garment measurements and the wardrobe assistant have no UI.** Code,
   migrations and an Edge Function exist; no screen reaches them. The assistant
   stays off by default until the privacy policy names Anthropic as a
   processor (`ASSISTANT_PRIVACY_IMPACT.md`) — that decision stands.
7. **Selv+ is a waitlist and the shop is seeded demo data.** Unchanged.
8. **Launch blockers that are not engineering** — Apple Developer enrolment,
   attorney review of the privacy policy and Terms, account deletion proven on
   a device. `SHIP_READINESS.md` lists them; none has moved.

---

## 5. Decisions made without the vault

`CLAUDE.md` requires searching the `om` obsidian-mind vault before proposing
an architecture or a dependency. **It was not reachable in this session, as in
every session before it.** These were decided without it; if the vault records
any as rejected, that is a revert:

- a MakeHuman-derived mesh, read as CC0 files (rather than Anny's runtime,
  a commissioned asset, or a vendor SDK);
- shape applied on the CPU and garments bound to the body, rather than GPU
  morph targets on every mesh;
- `react-native-web` as a dependency, and the web build it enables;
- removing `avatar3d/humanBase` and `tools/avatar-export`.

---

## 6. Corrections to the previous handoff

- **Migrations `008` and `009` are already applied** (as `garment_measurements`
  20261004083127 and `assistant` 20261004091445). The old §1 said to apply
  them first; do not.
- **"3D try-on … Live. Do not rebuild — it already exists"** described the
  primitive avatar. The affiliate system is real and audited and should still
  be left alone; the try-on rendering has now been rebuilt.

---

## 7. Things that will bite you

- **The `.glb` is generated.** Edit `tools/avatar-build`, rebuild, run the
  tests. `humanAvatar.test.ts` checks the file against the creator's options
  and the garment template list, so adding a hairstyle or a template to one
  side and not the other fails CI.
- **Target names are a contract.** The original eight (Short/Tall, Thin/Heavy,
  ChestSmall/ChestLarge, HipNarrow/HipWide) are kept; the build refuses a new
  name that contains a word the legacy fuzzy matcher in `bodyModel.ts` would
  claim.
- **Never call `skeleton.calculateInverses()` on the rig.** It reads world
  matrices, and the avatar lives on a turntable. `HumanRig.reseatSkeleton`
  writes the inverses in the rig's own space; there is a regression test.
- **`Alert` comes from `src/lib/alert`**, not `react-native`: React Native's is
  a no-op on web.
- **Canvas and hooks come from `avatar3d/r3f`**, which resolves to the native
  or the web renderer. Importing `@react-three/fiber/native` directly breaks
  the web build.
- **`storage.objects` is DELETE-protected by the platform.** Do not disable
  the trigger.
- **The container is ephemeral.** After an idle gap, `cd app && npm ci`.
- **Connectors are read at session start.** Reconnecting one mid-session does
  not help that session.
- **Do not rebuild the affiliate system.** It exists and is audited.
