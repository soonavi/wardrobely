# Avatar pivot — photo → character creator

**Decision (this session):** users no longer upload a photo or rely on measurements. They **design a customizable character** (skin, face, eyes, hair, brows, facial hair, body type, accessories). This is a better product on three axes: it kills the photo→3D realism problem, removes the biggest privacy/body-image risk, and is far more buildable than a photoreal twin.

---

## Why this is the right call

- **Realism:** a photo→`image_to_3d` mesh is lumpy, has no real morph targets, and never looked like the user. A stylized, art-directed character always looks intentional and on-brand.
- **Privacy:** no face photo, no biometric-adjacent data. The avatar is a user-authored set of choices — a huge simplification for the privacy policy and App Store review (see "Docs to update" below).
- **Tech reality (researched July 2026):** Ready Player Me shut down its avatar platform Jan 31 2026 (now Netflix-internal). Its successors — Avatar SDK / MetaPerson, Avaturn — are all *selfie-to-3D*, i.e. the exact photo flow we're dropping. There is no free, drop-in, customization-first 3D avatar SDK. So the right architecture is a **self-owned modular avatar** driven by our own creator UI.

## What's built now (shipped this session)

- **`src/features/creator/customization.ts`** — the data model + option catalogs (10 skin tones, 12 hair colors incl. lavender/pink, 8 eye colors, 12 hair styles, brow/facial-hair/face-shape/eye-shape/body-type/accessory sets), `DEFAULT_CUSTOMIZATION`, `mergeCustomization()`.
- **`src/features/creator/AvatarPreview.tsx`** — a **live 2D SVG character** that re-renders as you change options (face shape, skin, hair style + color, eyes, brows, facial hair, glasses/earrings, body-type torso). This is the immediate, satisfying "it looks like me" payoff — no 3D assets required.
- **`src/features/creator/CharacterCreatorScreen.tsx`** + route `app/create-avatar.tsx` — the creator UI: preview pinned on top, 8 category tabs, swatch/chip pickers, Save.
- **Onboarding rewired:** new users go straight into the creator (no photo/measurement step). Save persists `customization` and syncs `profiles.build` from the chosen body type so the app gate lets them in. Re-openable later from Profile → "Edit your character."
- **Backend:** `avatars.customization jsonb` column added; `height_cm`/`weight_kg` made nullable (measurements no longer required). `saveCustomization()` API + types updated. Schema file synced.

### The data model
`Customization = { skinTone, faceShape, eyeColor, eyeShape, eyebrows, eyebrowColor, hairStyle, hairColor, facialHair, facialHairColor, bodyType, accessories[] }`, stored in `avatars.customization`. `bodyType` shares the exact enum as `profiles.build`.

---

## The one open decision: the 3D rendering backend

The 2D SVG character is the identity/preview and works today. The remaining question is **how the customization renders as a 3D character for try-on**. This is the only genuinely asset-gated piece — it needs either authored 3D assets or a vendor, both of which are budget/direction calls for you:

| Option | What it is | Effort / cost | Look | Verdict |
|---|---|---|---|---|
| **A. Self-owned modular avatar** | One rigged base humanoid GLB with facial + body **morph targets**, separable eye meshes, and a **hair-mesh library** to swap; our creator maps choices → morphs/materials/hair. | High — needs Blender authoring or a commissioned asset pack (~$1–5k or a 3D artist). Full control, no vendor lock, no per-user cost. | Whatever we art-direct (can be semi-realistic). | **Best long-term.** |
| **B. Stylized open base (VRM / CC0)** | Build on an open stylized base (e.g. VRoid/VRM anime-leaning, or a CC0 character) + a hair library. | Medium — still need a hair/asset set, but a base exists. | Stylized / Zepeto–Genies energy (very Gen-Z). | **Good, cheaper middle path.** |
| **C. Paid selfie SDK** (Avatar SDK/MetaPerson) | Vendor avatars. | $$ + it's selfie-first. | Photoreal-ish. | **Skip** — contradicts the no-photo decision. |
| **D. 2.5D / ship SVG as v1** | Keep the SVG character as the avatar; render try-on on a generic 3D body tinted by skin tone; upgrade to A/B later. | Low — mostly done. | 2D character + simple 3D try-on. | **Fastest to launch.** |

**Recommendation:** ship **D for v1** (the SVG character is genuinely good and unblocks launch), and commission/source a **stylized modular 3D avatar (B, trending toward A)** as the Phase-2 realism upgrade. The creator UI and data model already output exactly the params a modular avatar needs, so plugging one in later is a mapping layer, not a rewrite.

The seam is ready in `src/features/avatar3d/` — `applyShapeToObject`/material code already consume shape + can consume `customization` (skin tone → material tint is trivial now; hair/eye meshes need the asset from B/A).

---

## Docs to update to match the pivot (flagged, not yet changed)

- **`PRODUCT_SPEC.md`** — replace "parametric avatar from a photo + measurements" with "customizable character creator." Avatar generation section changes substantially.
- **`legal/PRIVACY_POLICY.md` + `DATA_HANDLING.md`** — a *win*: remove face-photo/measurement collection for the avatar; the avatar is now user-authored appearance choices (not biometric). App Privacy nutrition label gets simpler.
- **`MARKETING_STRATEGY.md` / ad creatives** — the "avatar reveal / is this actually me?" hook shifts to "**design your 3D self**" / "make your character." Still a strong, arguably more shareable hook (character-creator content performs well). "Dress up as yourself" still works.
- **`APP_STORE_LISTING.md`** — screenshots + copy: the "avatar reveal" screen becomes the "character creator" screen.

## Known follow-ups / minor risks

- The SVG hair/face paths are hand-tuned and may need small visual tweaks once seen on-device.
- The creator now owns `profiles.build`; an older BuildPicker edit path in Profile still exists and could drift — consider removing it so the creator is the single source of body type.
- Next: decide the 3D backend (A/B/D above), then wire skin-tone/body-type onto the try-on body and, in Phase 2, the modular hair/eye meshes.
