/**
 * ============================================================================
 * GLB / GLTF loading pipeline — DEFERRED BUT PRESERVED INFRASTRUCTURE.
 * ============================================================================
 *
 * NOTHING IN THE APP RENDERS THIS TODAY. That is intentional, and it is not
 * dead code left behind by accident.
 *
 * The product pivoted to a PROCEDURAL three.js character (`CharacterAvatar.tsx`,
 * built entirely from primitives — no external 3D asset, nothing to download,
 * nothing to rig). Real GLB assets are DEFERRED, not cancelled. This module is
 * the working loading machinery from the original asset-based avatar spike,
 * extracted and kept as code rather than as prose, so that whoever ships real
 * assets imports it instead of re-deriving it. Every non-obvious constraint
 * below cost real debugging time to find.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS MODULE GIVES YOU
 * ---------------------------------------------------------------------------
 *   ./gltfSource.ts
 *     - `GltfSource`            a Metro `require()`d asset (number) or a URL
 *     - `preloadGltf`           module-scope prefetch, before first render
 *     - `clearGltfCache`        cache eviction — REQUIRED for retry to work
 *     - `useGltfScene`          raw, unnormalized load
 *     - and the long-form explanation of why every import in here comes from
 *       `@react-three/drei/native` and not `@react-three/drei`
 *
 *   ./normalizeGltfScene.ts   (pure three.js — no React, no R3F)
 *     - `normalizeSceneToHeight`   consistent size + feet-on-the-floor pose
 *     - `applyRealisticMaterials`  non-PBR -> MeshStandardMaterial, sane PBR
 *     - `hasMorphTargets`          readiness check for a real rig
 *
 *   ./GltfModel.tsx
 *     - `useNormalizedGltf`     load + normalize in one hook
 *     - `GltfModel`             `<primitive>` wrapper
 *     - `GltfErrorBoundary`     catches a Suspense rejection INSIDE `<Canvas>`
 *     - `useGltfLoadState`      loading / error / retry, wired correctly
 *     - `GltfAsset`             all of the above composed in the right order
 *
 * ---------------------------------------------------------------------------
 * THE FOUR THINGS THAT ARE EASY TO GET WRONG
 * ---------------------------------------------------------------------------
 *   1. Import from `@react-three/drei/native`, never `@react-three/drei`. The
 *      native graph is what installs the `THREE.FileLoader` / `TextureLoader`
 *      polyfills that route loads through expo-asset/expo-file-system; the web
 *      entry also drags in DOM-only components. Full detail in ./gltfSource.ts.
 *   2. Retry needs a cache clear AND a remount. `useGLTF` caches rejections,
 *      not just successes. Detail in `useGltfLoadState`.
 *   3. The error boundary must live inside `<Canvas>`, and may only render
 *      R3F JSX. RN error UI goes in a sibling of the Canvas. Detail on
 *      `GltfErrorBoundary`.
 *   4. Bundle the GLB with `require()` in production; do not fetch a remote
 *      URL. Remote loading on RN is a known-fragile path. `metro.config.js`
 *      already registers glb/gltf/bin as Metro asset extensions FOR THIS
 *      MODULE — leave that config in place.
 *
 * ---------------------------------------------------------------------------
 * WHEN A RIG WITH MORPH TARGETS ARRIVES — WHAT TO DO
 * ---------------------------------------------------------------------------
 *   1. Drop the `.glb` into `assets/avatar/` and define the source once:
 *
 *          const AVATAR_SOURCE: GltfSource =
 *            require("../../../assets/avatar/base-avatar.glb");
 *          preloadGltf(AVATAR_SOURCE);   // at module scope
 *
 *      No Metro config change is needed — see point 4 above.
 *
 *   2. Render it inside a `<Canvas>` from `@react-three/fiber/native`:
 *
 *          const gltf = useGltfLoadState(AVATAR_SOURCE);
 *          <GltfAsset source={AVATAR_SOURCE}
 *                     retryKey={gltf.retryKey}
 *                     onError={gltf.onError} />
 *
 *      with the spinner / error / Retry UI as RN views beside the Canvas,
 *      driven by `gltf.loading`, `gltf.error`, `gltf.retry`.
 *
 *   3. Drive body shape through `applyShapeToObject` in `../bodyModel.ts`.
 *      IT IS ALREADY WRITTEN FOR THIS AND NEEDS NO CHANGES. It traverses the
 *      scene graph, and if any mesh exposes a `morphTargetDictionary` it
 *      matches our four shape axes (height / volume / chest / hip) against
 *      the rig's morph target names via `MORPH_TARGET_NAME_CANDIDATES` — a
 *      deliberately fuzzy, separator- and case-insensitive match, because rig
 *      authors name blendshapes inconsistently ("Bust", "Chest_Width",
 *      "chestSize") — and drives `morphTargetInfluences` directly. Only when
 *      NO mesh under the root has morph targets does it fall back to the
 *      whole-mesh axis scale it uses today. Call `hasMorphTargets(scene)` (or
 *      read `ApplyShapeResult.usedMorphTargets`) to confirm which path is
 *      live; if it still reports the fallback, the rig's blendshapes are
 *      missing or named outside the candidate lists — extend those lists in
 *      `bodyModel.ts` rather than changing anything here.
 *
 *      One known gap worth checking against the real rig: `applyShapeToObject`
 *      assumes each blendshape is a single one-directional 0..1 slider with
 *      0.5 as the rest pose. A rig authored as two opposite morphs (separate
 *      "Thin"/"Heavy" targets) needs a small extension there.
 *
 *   4. Garments: the axis-scale fallback scales the shared parent group, so
 *      anything parented under it follows body shape for free. Morph targets
 *      do NOT work that way — they only affect the mesh they are authored on.
 *      A garment that should follow a morph-driven body must be skinned to
 *      the same skeleton, not merely parented.
 * ============================================================================
 */

export {
  type GltfSource,
  REMOTE_URL_CAVEAT,
  preloadGltf,
  clearGltfCache,
  useGltfScene,
} from "./gltfSource";

export {
  DEFAULT_TARGET_HEIGHT_UNITS,
  type MaterialRealismOptions,
  normalizeSceneToHeight,
  applyRealisticMaterials,
  hasMorphTargets,
} from "./normalizeGltfScene";

export {
  type UseNormalizedGltfOptions,
  type GltfModelProps,
  type GltfLoadState,
  type GltfAssetProps,
  useNormalizedGltf,
  GltfModel,
  GltfErrorBoundary,
  useGltfLoadState,
  GltfAsset,
} from "./GltfModel";
