/**
 * ============================================================================
 * Human base mesh — the asset slot.
 * ============================================================================
 * The avatar the app ships today is `CharacterAvatar.tsx`: ~50 three.js
 * primitives (22 spheres, 15 cylinders, 7 capsules, 4 tori, 2 boxes). It is
 * well-built and it will never read as human, because a stack of primitives
 * has no human topology to find. No parameter change fixes that; the fix is a
 * real rigged mesh.
 *
 * This module is the seam. It answers one question — "do we have a human base
 * mesh?" — and everything downstream branches on the answer, so the primitive
 * avatar stays the working fallback until an asset actually lands and becomes
 * dead the moment one does.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO GLB HERE YET
 * ---------------------------------------------------------------------------
 * Because choosing one is a licensing decision, not a coding one. A human base
 * mesh ships with terms attached, and the wrong choice is expensive to undo
 * once avatars are saved against its blendshape names. The candidates differ
 * on exactly the axes that matter here — redistribution rights, whether
 * blendshapes are included or must be authored, and file size on a mobile
 * bundle. That is Ben's call to make, not something to settle by picking
 * whichever asset downloads first.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE ASSET MUST SATISFY
 * ---------------------------------------------------------------------------
 * Everything below is a hard requirement of code that already exists — these
 * are not preferences.
 *
 *  1. **Format `.glb`** (single binary, textures embedded). Metro is already
 *     configured to treat `.glb`/`.gltf`/`.bin` as assets (`metro.config.js`),
 *     so dropping the file in needs no build change.
 *
 *  2. **Blendshapes for four axes: height, volume, chest, hip.**
 *     `applyShapeToObject` in `../bodyModel.ts` matches rig morph-target names
 *     against `MORPH_TARGET_NAME_CANDIDATES` case- and separator-insensitively,
 *     so `Chest_Width`, `chestSize` and `Bust` all resolve. A rig with no
 *     morph targets silently falls back to whole-mesh axis scaling — which is
 *     what the primitives already do, i.e. the upgrade would buy nothing.
 *     Verify with `hasMorphTargets(scene)` or `ApplyShapeResult.usedMorphTargets`.
 *
 *  3. **One-directional 0..1 blendshapes, 0.5 as rest.** `applyShapeToObject`
 *     assumes a single slider per axis. A rig authored as opposing pairs
 *     (separate `Thin`/`Heavy` targets) needs a documented extension in
 *     `bodyModel.ts` — see the note at the end of `../gltf/index.ts`.
 *
 *  4. **A skeleton garments can be skinned to.** The primitive avatar's
 *     axis-scale fallback scales a shared parent group, so anything parented
 *     under it follows body shape for free. Morph targets do not work that
 *     way — they deform only the mesh they are authored on. A garment that
 *     must follow a morph-driven body has to share the skeleton, not merely
 *     sit under the same group. This is the single most likely thing to be
 *     discovered late and be expensive.
 *
 *  5. **Y-up, facing +Z, feet near the origin.** `normalizeSceneToHeight`
 *     re-scales and grounds the model, but it does not rotate it.
 *
 *  6. **A mobile-sane budget.** `SHIP_READINESS.md` flags 3D render
 *     performance on a real mid-range device as untested, with no crash
 *     reporting in place to notice when it fails. Treat anything much past
 *     ~5MB or ~50k triangles as needing a measured device test before it
 *     ships, not after.
 *
 * ---------------------------------------------------------------------------
 * HOW TO TURN IT ON
 * ---------------------------------------------------------------------------
 * Drop the file at `assets/avatar/base-human.glb` and change
 * `HUMAN_BASE_SOURCE` below from `null` to the `require(...)`. That is the
 * whole change — `HumanBaseAvatar` picks it up, `preloadGltf` warms it, and
 * `applyShapeToObject` starts driving morph targets instead of scaling boxes.
 */

import type { GltfSource } from "../gltf";

/**
 * The base mesh, or `null` while none is licensed.
 *
 * A literal `require()` and not a dynamic path: Metro resolves `require` at
 * build time, so a computed specifier would not bundle the asset. Keeping the
 * slot as an explicit `null` — rather than a `require` of a placeholder file —
 * means `isHumanBaseAvailable()` reports the truth and the app renders the
 * primitive avatar rather than a broken load.
 *
 * When the asset lands:
 *   export const HUMAN_BASE_SOURCE: GltfSource | null =
 *     require("../../../../assets/avatar/base-human.glb");
 */
export const HUMAN_BASE_SOURCE: GltfSource | null = null;

/**
 * Whether a human base mesh is bundled.
 *
 * Callers branch on this to choose between the mesh avatar and the primitive
 * one. It is a function rather than a bare constant so the check reads as a
 * capability question at the call site, and so a future version that resolves
 * the asset remotely (per-user body scans, say) can make it async without
 * changing every caller's shape.
 */
export function isHumanBaseAvailable(): boolean {
  return HUMAN_BASE_SOURCE !== null;
}

/**
 * Which avatar implementation should render.
 *
 * Split out as a pure function so the decision is unit-testable without
 * mounting a `<Canvas>` — the same reason `bodyModel.ts` keeps its maths free
 * of React and R3F.
 *
 * `preferPrimitive` exists for the settings escape hatch: if the mesh avatar
 * turns out to be too slow on a given device, a user (or a remote kill switch)
 * can force the primitive one without an app update. Given that 3D performance
 * on mid-range hardware is explicitly untested and unmonitored, shipping the
 * mesh without a way back to the known-cheap renderer would be careless.
 */
export type AvatarRenderMode = "human-mesh" | "primitive";

export function selectAvatarRenderMode(options?: {
  preferPrimitive?: boolean;
  humanBaseAvailable?: boolean;
}): AvatarRenderMode {
  const available = options?.humanBaseAvailable ?? isHumanBaseAvailable();
  if (options?.preferPrimitive) return "primitive";
  return available ? "human-mesh" : "primitive";
}
