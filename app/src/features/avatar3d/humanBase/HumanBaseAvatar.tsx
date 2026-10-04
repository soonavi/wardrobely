import React, { Suspense, useEffect } from "react";

import { CharacterAvatar, type EquippedGarments } from "../CharacterAvatar";
import { applyShapeToObject, type ApplyShapeResult, type ShapeParams } from "../bodyModel";
import { GltfErrorBoundary, useNormalizedGltf } from "../gltf";
import type { Customization } from "../../creator/customization";
import { HUMAN_BASE_SOURCE, selectAvatarRenderMode } from "./humanBaseAsset";

/**
 * ============================================================================
 * HumanBaseAvatar — renders the rigged human mesh, or the primitives.
 * ============================================================================
 * The one component screens mount. It picks a renderer via
 * `selectAvatarRenderMode` and keeps the call sites free of the question, so
 * dropping an asset into `humanBaseAsset.ts` changes what every screen renders
 * without touching any of them.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ UNVERIFIED AGAINST A REAL ASSET.                                     │
 * │                                                                       │
 * │ `HUMAN_BASE_SOURCE` is still null, so the mesh branch below has never │
 * │ executed. The pieces it leans on are tested — `applyShapeToObject`    │
 * │ has 24 tests covering every authoring convention, `inspectHumanBase`  │
 * │ has 25 — but the wiring between them and R3F has not run once.        │
 * │                                                                       │
 * │ When an asset lands: run `inspectHumanBase` on it FIRST (that is what │
 * │ it is for), fix whatever it blocks on, and only then expect this to   │
 * │ render. Treat a visual problem here as this file's fault before       │
 * │ suspecting the asset — the asset has a validator and this does not.   │
 * └──────────────────────────────────────────────────────────────────────┘
 */

export interface HumanBaseAvatarProps {
  /** Appearance presets — used by the primitive renderer. */
  customization: Customization;
  /**
   * Body shape, driving blendshapes on the mesh path.
   *
   * Ignored entirely by the primitive renderer, which shapes itself from
   * `customization` internally. That asymmetry is why both props exist: the
   * two renderers genuinely take different inputs, and collapsing them would
   * mean inventing a conversion in whichever direction was lossier.
   */
  shape?: ShapeParams;
  equipped?: EquippedGarments;
  animate?: boolean;
  /**
   * Force the primitive renderer regardless of what is bundled.
   *
   * The escape hatch for a device the mesh is too heavy for. 3D performance on
   * mid-range hardware is untested and there is no crash reporting to notice
   * when it fails, so a way back to the known-cheap renderer has to exist
   * before the heavier one ships, not after.
   */
  preferPrimitive?: boolean;
  /**
   * Called once the rig has been driven, with what the shape pass concluded.
   *
   * The hook a diagnostics surface reads: `usedMorphTargets: false` means the
   * asset loaded but is being whole-mesh scaled, which looks like it works and
   * is the single most important thing to be able to see.
   */
  onShapeApplied?: (result: ApplyShapeResult) => void;
}

const NEUTRAL_SHAPE: ShapeParams = { height: 0, volume: 0, chest: 0, hip: 0 };

/**
 * The mesh branch: load, normalize, drive the blendshapes.
 *
 * Separate from `HumanBaseAvatar` because it calls `useNormalizedGltf`, which
 * suspends. A suspending hook has to sit below the `<Suspense>` boundary, so it
 * cannot live in the component that renders the boundary.
 */
function ShapedHumanMesh({
  shape,
  equipped,
  onShapeApplied,
  children,
}: {
  shape: ShapeParams;
  equipped?: EquippedGarments;
  onShapeApplied?: (result: ApplyShapeResult) => void;
  children?: React.ReactNode;
}) {
  // Non-null asserted: this subtree only mounts when selectAvatarRenderMode
  // returned "human-mesh", which requires HUMAN_BASE_SOURCE to be set.
  const scene = useNormalizedGltf(HUMAN_BASE_SOURCE!);

  useEffect(() => {
    const result = applyShapeToObject(scene, shape);
    onShapeApplied?.(result);
    // Re-runs whenever the body changes. `applyShapeToObject` is idempotent and
    // reversible (both asserted in applyShapeToObject.test.ts), so re-applying
    // on every shape change — rather than diffing — is safe and keeps the
    // slider responsive.
  }, [scene, shape, onShapeApplied]);

  // Garments parent under the mesh. NOTE, and this is requirement 4 in
  // humanBaseAsset.ts: parenting alone makes a garment follow the body only
  // under the axis-scale fallback, which scales the shared parent. Morph
  // targets deform only the mesh they are authored on, so a garment that must
  // follow a morph-driven body has to be skinned to this asset's skeleton.
  // `equipped` is accepted here so the signature is stable, but wiring it to
  // the skeleton is the real work and is not done.
  void equipped;

  return <primitive object={scene}>{children}</primitive>;
}

export function HumanBaseAvatar({
  customization,
  shape,
  equipped,
  animate = true,
  preferPrimitive,
  onShapeApplied,
}: HumanBaseAvatarProps) {
  const mode = selectAvatarRenderMode({ preferPrimitive });

  if (mode === "primitive") {
    return (
      <CharacterAvatar
        customization={customization}
        equipped={equipped}
        animate={animate}
      />
    );
  }

  return (
    <GltfErrorBoundary
      onError={(error) => {
        // Swallowed deliberately rather than rethrown: a failed avatar load
        // should not blank the screen the avatar sits on. The boundary renders
        // nothing, and the caller's own loading/error chrome — driven by
        // `useGltfLoadState` outside the Canvas — is what tells the user.
        console.warn("[HumanBaseAvatar] mesh failed to load", error);
      }}
    >
      <Suspense fallback={null}>
        <ShapedHumanMesh
          shape={shape ?? NEUTRAL_SHAPE}
          equipped={equipped}
          onShapeApplied={onShapeApplied}
        />
      </Suspense>
    </GltfErrorBoundary>
  );
}
