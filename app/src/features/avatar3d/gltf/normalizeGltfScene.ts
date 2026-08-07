import * as THREE from "three";

/**
 * Scene normalization + material conditioning for a loaded GLB — the "make
 * an arbitrary export renderable at a predictable size and look" half of the
 * preserved GLTF pipeline. See ./index.ts for the module-level story.
 *
 * Deliberately pure three.js: no React, no @react-three/fiber, no drei. That
 * keeps this hand-verifiable in isolation and reusable from an imperative
 * three.js context as well as from R3F.
 */

/**
 * Default target height, in the arbitrary "world units" the rest of a scene
 * (ground plane, camera distance, lights) is laid out against. Not meters —
 * just a shared scale everything agrees on. 1.7 reads as roughly
 * "human-sized" against a camera placed a couple of units back.
 */
export const DEFAULT_TARGET_HEIGHT_UNITS = 1.7;

/**
 * Normalizes an arbitrary loaded GLB scene so it renders at a predictable
 * size and position regardless of how the source asset was authored.
 * Image-to-3D pipelines and hand-authored exports rarely agree on scale, and
 * almost never put the origin at the feet.
 *
 * Steps:
 *   1. Reset any existing transform to identity BEFORE measuring. This is
 *      the subtle one: drei's `useGLTF` caches the loaded scene by path, so
 *      this function can run again against the very SAME object — on a Fast
 *      Refresh, on a remount after a retry, or from a second mount of the
 *      same source. Measuring without resetting first would compound the
 *      previous normalization on top of itself instead of recomputing it,
 *      and the model would shrink (or grow) a little more on every remount.
 *   2. Measure the object-space bounding box.
 *   3. Scale uniformly so the model is `targetHeight` tall.
 *   4. Re-measure after scaling and translate so the model is centered on
 *      X/Z with its lowest point sitting exactly on the ground plane (y = 0).
 *
 * MUTATES the object in place and returns it. That is fine as long as only
 * one instance of a given source is mounted at a time. If a screen ever
 * needs several simultaneous instances of the same GLB, clone per instance
 * with three-stdlib's `SkeletonUtils.clone()` (which, unlike `Object3D.clone()`,
 * correctly rebinds skinned meshes to the cloned skeleton) instead of
 * mutating the shared cached object.
 */
export function normalizeSceneToHeight(
  scene: THREE.Object3D,
  targetHeight: number = DEFAULT_TARGET_HEIGHT_UNITS
): THREE.Object3D {
  scene.position.set(0, 0, 0);
  scene.scale.set(1, 1, 1);
  scene.updateMatrixWorld(true);

  const rawBox = new THREE.Box3().setFromObject(scene);
  // Guard against a degenerate/empty mesh producing a divide-by-zero.
  const rawHeight = rawBox.max.y - rawBox.min.y || 1;

  scene.scale.setScalar(targetHeight / rawHeight);
  scene.updateMatrixWorld(true);

  const scaledBox = new THREE.Box3().setFromObject(scene);
  scene.position.x -= (scaledBox.min.x + scaledBox.max.x) / 2;
  scene.position.z -= (scaledBox.min.z + scaledBox.max.z) / 2;
  scene.position.y -= scaledBox.min.y;

  return scene;
}

// ---------------------------------------------------------------------------
// Material conditioning
// ---------------------------------------------------------------------------

/**
 * three.js's `MeshStandardMaterial` constructor defaults. A raw, untouched
 * image-to-3D export commonly leaves its materials sitting exactly here,
 * which reads as dull chrome/plastic under real (non-flat) lighting rather
 * than as skin or fabric. Detecting "both are still at the default" is how
 * `tuneMaterial` distinguishes an unauthored export from a material whose
 * PBR values someone deliberately chose.
 */
const DEFAULT_STANDARD_ROUGHNESS = 1;
const DEFAULT_STANDARD_METALNESS = 1;

export interface MaterialRealismOptions {
  /** 0.6-0.75 reads as soft skin: not shiny plastic, not chalky. */
  roughness?: number;
  /** Only visible once an environment map is actually assigned; pre-tuned. */
  envMapIntensity?: number;
  /** Enable cast/receive shadows on every mesh. Default true. */
  shadows?: boolean;
}

const DEFAULT_SKIN_ROUGHNESS = 0.68;
const DEFAULT_SKIN_ENV_MAP_INTENSITY = 0.35;

/**
 * Converts any non-PBR material (Basic/Lambert/Phong/Toon — as an older or
 * hand-rolled export might use) into a `MeshStandardMaterial`, so that
 * directional/hemisphere lighting actually shades it, while preserving
 * whatever color / map / normalMap / alphaMap / transparency it already had.
 * `MeshStandardMaterial` and `MeshPhysicalMaterial` pass through untouched —
 * they are already PBR.
 */
function toStandardMaterial(material: THREE.Material): THREE.MeshStandardMaterial {
  if (
    material instanceof THREE.MeshStandardMaterial ||
    material instanceof THREE.MeshPhysicalMaterial
  ) {
    return material;
  }

  // Duck-type the properties shared across Basic/Lambert/Phong, so this works
  // regardless of which one the source export happened to use.
  const source = material as THREE.Material & {
    color?: THREE.Color;
    map?: THREE.Texture | null;
    normalMap?: THREE.Texture | null;
    alphaMap?: THREE.Texture | null;
  };

  const standard = new THREE.MeshStandardMaterial({
    color: source.color ? source.color.clone() : new THREE.Color(0xffffff),
    map: source.map ?? null,
    normalMap: source.normalMap ?? null,
    alphaMap: source.alphaMap ?? null,
    transparent: source.transparent,
    opacity: source.opacity,
    side: source.side,
    alphaTest: source.alphaTest,
    name: source.name,
  });

  // The replaced material has no further use — release its GPU program
  // binding rather than leaking it.
  material.dispose();

  return standard;
}

/**
 * Nudges one material's roughness/metalness/envMapIntensity into
 * skin-plausible territory, in place.
 *
 * Idempotent, guarded by `material.userData.__realismTuned`, because this
 * runs against drei's SHARED cached scene — the same seam
 * `normalizeSceneToHeight` has to defend against. Re-running on a Fast
 * Refresh or retry remount must not re-tune an already-tuned material.
 */
function tuneMaterial(
  material: THREE.MeshStandardMaterial,
  roughness: number,
  envMapIntensity: number
): void {
  if (material.userData.__realismTuned) return;
  material.userData.__realismTuned = true;

  const looksUntouched =
    material.roughness === DEFAULT_STANDARD_ROUGHNESS &&
    material.metalness === DEFAULT_STANDARD_METALNESS;

  if (looksUntouched) {
    // Default/unset — the common case for a raw export. Give it sensible
    // skin-like PBR values.
    material.roughness = roughness;
    material.metalness = 0;
  } else if (!material.metalnessMap) {
    // Someone deliberately authored roughness/metalness (the case for a
    // properly textured production GLB) — respect that. But skin and fabric
    // still should not read as metallic unless a metalnessMap says otherwise.
    material.metalness = Math.min(material.metalness, 0.05);
  }

  material.envMapIntensity = envMapIntensity;
  material.needsUpdate = true;
}

/**
 * Traverses a loaded GLB scene once, upgrading every mesh's material(s) to a
 * `MeshStandardMaterial` with skin-plausible PBR values, and (by default)
 * enabling cast/receive shadow so a shadow-casting key light and any
 * contact-shadow pass have real geometry to work from.
 *
 * Idempotent — safe to call on every mount of the same cached scene.
 */
export function applyRealisticMaterials(
  root: THREE.Object3D,
  options: MaterialRealismOptions = {}
): void {
  const roughness = options.roughness ?? DEFAULT_SKIN_ROUGHNESS;
  const envMapIntensity = options.envMapIntensity ?? DEFAULT_SKIN_ENV_MAP_INTENSITY;
  const shadows = options.shadows ?? true;

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;

    if (shadows) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }

    const wasArray = Array.isArray(mesh.material);
    const materials = wasArray
      ? (mesh.material as THREE.Material[])
      : [mesh.material as THREE.Material];

    const tuned = materials.map((mat) => {
      const standard = toStandardMaterial(mat);
      tuneMaterial(standard, roughness, envMapIntensity);
      return standard;
    });

    mesh.material = wasArray ? tuned : tuned[0];
  });
}

/**
 * Reports whether any mesh under `root` carries morph targets (blendshapes).
 *
 * This is the readiness check for the whole deferred plan: `bodyModel.ts`'s
 * `applyShapeToObject` drives real per-region morph targets when they exist
 * and silently falls back to a whole-mesh axis scale when they don't. When a
 * rigged GLB finally arrives through this pipeline, this returning `true` is
 * the signal that the fallback is no longer in play — and nothing in
 * `bodyModel.ts` needs to change for that to happen.
 */
export function hasMorphTargets(root: THREE.Object3D): boolean {
  let found = false;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh && mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
      found = true;
    }
  });
  return found;
}
