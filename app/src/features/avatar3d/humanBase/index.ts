/**
 * ============================================================================
 * Human base mesh — the rigged-avatar path.
 * ============================================================================
 * Replaces the ~50-primitive `CharacterAvatar` with a real humanoid GLB.
 * Nothing here renders a mesh yet: `HUMAN_BASE_SOURCE` is null until one is
 * licensed, and `HumanBaseAvatar` delegates to the primitive renderer until
 * then. Dropping an asset in is the only change needed to switch every screen.
 *
 * ORDER OF OPERATIONS WHEN AN ASSET ARRIVES
 *   1. `inspectHumanBase(scene)` — check it against the six requirements in
 *      humanBaseAsset.ts BEFORE wiring it up. Every one of those requirements
 *      fails in a way that still renders something plausible, which is why
 *      looking at it is not a substitute.
 *   2. Fix whatever it reports as `blocking`. The expensive one is the
 *      skeleton: garments parent fine under the axis-scale fallback, so a
 *      missing skeleton only breaks once blendshapes start working.
 *   3. Set `HUMAN_BASE_SOURCE`, then confirm `usedMorphTargets: true` through
 *      `HumanBaseAvatar`'s `onShapeApplied`. False means the asset loaded and
 *      is being whole-mesh scaled — i.e. doing what the primitives already did.
 */

export {
  HUMAN_BASE_SOURCE,
  isHumanBaseAvailable,
  selectAvatarRenderMode,
  type AvatarRenderMode,
} from "./humanBaseAsset";

export {
  inspectHumanBase,
  formatHumanBaseReport,
  type HumanBaseReport,
  type HumanBaseFinding,
} from "./inspectHumanBase";

export { HumanBaseAvatar, type HumanBaseAvatarProps } from "./HumanBaseAvatar";
