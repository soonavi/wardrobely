import type { Object3D } from "three";

import {
  applyShapeToObject,
  type MorphAxisBinding,
  type ShapeParams,
} from "../bodyModel";

/**
 * ============================================================================
 * Human base mesh — asset validation.
 * ============================================================================
 * `humanBaseAsset.ts` documents six hard requirements a GLB has to satisfy.
 * Every one of them is checkable in code, and checking them in code is the
 * difference between "the avatar looks wrong" and "requirement 4 is not met".
 *
 * WHY THIS IS NOT OPTIONAL TOOLING
 * The requirements fail in ways that do not announce themselves:
 *
 *   * **No blendshapes** → `applyShapeToObject` silently falls back to
 *     whole-mesh axis scaling. The avatar still moves when a slider moves, so
 *     it looks like it works. It is doing exactly what the primitive avatar
 *     already did, which means the upgrade bought nothing and nobody can tell.
 *   * **No skeleton** → garments parent fine and follow the body under the
 *     *fallback*, so this only breaks once blendshapes start working. The
 *     failure arrives later than the change that caused it.
 *   * **Wrong up-axis** → `normalizeSceneToHeight` scales and grounds but does
 *     not rotate, so a Z-up asset is scaled to the height of its own depth and
 *     laid on its side at a plausible size.
 *
 * All three produce a plausible-looking render. That is what makes a validator
 * worth more here than a careful look.
 *
 * Pure three.js — no React, no R3F, no Supabase — so every rule is unit
 * testable against a hand-built scene graph, which is how it is tested.
 */

/** A problem found in a candidate asset. */
export interface HumanBaseFinding {
  /**
   * `blocking` — the mesh will not do the job the swap exists to do.
   * `warning` — it will work, but worse than intended, or untested at this size.
   */
  severity: "blocking" | "warning";
  /** Which requirement in humanBaseAsset.ts this maps to (1-6). */
  requirement: number;
  message: string;
}

export interface HumanBaseReport {
  ok: boolean;
  findings: HumanBaseFinding[];
  /** What `applyShapeToObject` concluded about the rig. */
  bindings: MorphAxisBinding[];
  unmatchedAxes: (keyof ShapeParams)[];
  usedMorphTargets: boolean;
  /** Geometry budget, for requirement 6. */
  meshCount: number;
  triangleCount: number;
  morphTargetCount: number;
  /** True when at least one SkinnedMesh carries a skeleton — requirement 4. */
  hasSkeleton: boolean;
  /** Raw bounding box extents in asset units, before normalization. */
  extents: { x: number; y: number; z: number };
}

/**
 * Budget thresholds. Warnings, never blocking — a heavy mesh is a measurement
 * problem, not a correctness one, and the only honest verdict on "is this too
 * heavy" comes from a real device. `SHIP_READINESS.md` flags 3D performance on
 * mid-range hardware as untested with no crash reporting, which is why these
 * are set to prompt a measurement rather than to pass judgement.
 */
const TRIANGLE_WARN = 50_000;
const MORPH_WARN = 60;

/** The four axes the app drives. Neutral params, since we only want bindings. */
const NEUTRAL: ShapeParams = { height: 0, volume: 0, chest: 0, hip: 0 };

interface GeometryLike {
  index?: { count: number } | null;
  attributes?: { position?: { count: number } };
}

interface MeshLike extends Object3D {
  isMesh?: boolean;
  isSkinnedMesh?: boolean;
  skeleton?: unknown;
  geometry?: GeometryLike;
  morphTargetDictionary?: { [name: string]: number };
}

/**
 * Triangle count for one geometry.
 *
 * Indexed geometry counts indices, non-indexed counts positions; both divide
 * by three. Returns 0 rather than throwing on a geometry carrying neither,
 * because a scene graph can legitimately contain an empty placeholder mesh and
 * a validator that crashes on one is less useful than one that reports zero.
 */
function trianglesOf(geometry: GeometryLike | undefined): number {
  if (!geometry) return 0;
  const indexed = geometry.index?.count;
  if (typeof indexed === "number") return Math.floor(indexed / 3);
  const positions = geometry.attributes?.position?.count;
  if (typeof positions === "number") return Math.floor(positions / 3);
  return 0;
}

/**
 * Inspect a loaded GLB scene against the requirements in `humanBaseAsset.ts`.
 *
 * NOTE: this *drives* the rig as a side effect — `applyShapeToObject` is the
 * only honest way to find out which axes a rig really binds, because the
 * answer depends on the same fuzzy name matching production uses. It applies
 * neutral params, so the mesh is left in its rest pose rather than a random
 * one; callers inspecting an asset they are about to render should still
 * re-apply the user's real params afterwards.
 */
export function inspectHumanBase(root: Object3D): HumanBaseReport {
  const findings: HumanBaseFinding[] = [];

  let meshCount = 0;
  let triangleCount = 0;
  let morphTargetCount = 0;
  let hasSkeleton = false;

  root.traverse((obj) => {
    const mesh = obj as MeshLike;
    if (!mesh.isMesh) return;
    meshCount += 1;
    triangleCount += trianglesOf(mesh.geometry);
    if (mesh.morphTargetDictionary) {
      morphTargetCount += Object.keys(mesh.morphTargetDictionary).length;
    }
    if (mesh.isSkinnedMesh && mesh.skeleton) hasSkeleton = true;
  });

  // Requirement 2/3: blendshapes, and what they bind to.
  const shape = applyShapeToObject(root, NEUTRAL);

  if (!shape.usedMorphTargets) {
    findings.push({
      severity: "blocking",
      requirement: 2,
      message:
        "No morph targets found. applyShapeToObject has fallen back to " +
        "whole-mesh axis scaling — the same thing the primitive avatar " +
        "already does, so this asset would change how the avatar looks but " +
        "not how it responds to the body. Needs blendshapes for height, " +
        "volume, chest and hip.",
    });
  } else if (shape.unmatchedAxes.length > 0) {
    findings.push({
      severity: "warning",
      requirement: 2,
      message:
        `Rig binds ${shape.bindings.length} of 4 axes; nothing matched for ` +
        `${shape.unmatchedAxes.join(", ")}. Those dimensions of the user's ` +
        "body cannot be reflected. If the rig does have blendshapes for them " +
        "under other names, extend MORPH_TARGET_NAME_CANDIDATES in " +
        "bodyModel.ts rather than renaming the asset.",
    });
  }

  // Requirement 4: a skeleton garments can skin to. The expensive one.
  if (!hasSkeleton) {
    findings.push({
      severity: "blocking",
      requirement: 4,
      message:
        "No SkinnedMesh with a skeleton. Morph targets deform only the mesh " +
        "they are authored on, so garments cannot follow a morph-driven body " +
        "by being parented to it — they have to share this skeleton. Without " +
        "one, try-on breaks the moment blendshapes start working, which is " +
        "later than the change that caused it.",
    });
  }

  // Requirement 5: Y-up. A human is taller than they are wide or deep, so the
  // dominant extent names the up axis. This is a heuristic and says so: an
  // asset in a T-pose with arms out can be wider than tall, which is why a
  // failure here is a warning to look rather than a refusal.
  const extents = measureExtents(root);
  const tallest = Math.max(extents.x, extents.y, extents.z);
  if (tallest > 0 && extents.y < tallest) {
    const axis = extents.x === tallest ? "X" : "Z";
    findings.push({
      severity: "warning",
      requirement: 5,
      message:
        `Largest extent is on ${axis}, not Y — this asset may not be Y-up. ` +
        "normalizeSceneToHeight scales and grounds but does not rotate, so a " +
        "mis-oriented asset renders lying down at a plausible size. Verify " +
        "visually; a T-pose can legitimately be wider than tall.",
    });
  }

  // Requirement 6: budget.
  if (triangleCount > TRIANGLE_WARN) {
    findings.push({
      severity: "warning",
      requirement: 6,
      message:
        `${triangleCount.toLocaleString()} triangles exceeds the ` +
        `${TRIANGLE_WARN.toLocaleString()} soft budget. Not wrong — but ` +
        "measure on a real mid-range device before shipping, because there " +
        "is no crash reporting to notice if it fails there.",
    });
  }
  if (morphTargetCount > MORPH_WARN) {
    findings.push({
      severity: "warning",
      requirement: 6,
      message:
        `${morphTargetCount} morph targets across ${meshCount} mesh(es). ` +
        "Each one is a full vertex-delta set held in memory; a face rig's " +
        "worth of expressions costs real megabytes for shapes this app never " +
        "drives. Consider stripping to the four body axes.",
    });
  }

  if (meshCount === 0) {
    findings.push({
      severity: "blocking",
      requirement: 1,
      message: "Scene contains no meshes. The asset is empty or failed to parse.",
    });
  }

  return {
    ok: !findings.some((f) => f.severity === "blocking"),
    findings,
    bindings: shape.bindings,
    unmatchedAxes: shape.unmatchedAxes,
    usedMorphTargets: shape.usedMorphTargets,
    meshCount,
    triangleCount,
    morphTargetCount,
    hasSkeleton,
    extents,
  };
}

/**
 * Bounding-box extents over the whole graph.
 *
 * Computed from raw position attributes rather than `THREE.Box3`, so this
 * module needs only the `three` types and not its runtime — keeping it
 * importable from a test or a script without pulling in a renderer.
 */
function measureExtents(root: Object3D): { x: number; y: number; z: number } {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let sawVertex = false;

  root.traverse((obj) => {
    const mesh = obj as MeshLike & {
      geometry?: { attributes?: { position?: { getX(i: number): number; getY(i: number): number; getZ(i: number): number; count: number } } };
    };
    if (!mesh.isMesh) return;
    const position = mesh.geometry?.attributes?.position;
    if (!position || typeof position.getX !== "function") return;

    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const y = position.getY(i);
      const z = position.getZ(i);
      sawVertex = true;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
  });

  if (!sawVertex) return { x: 0, y: 0, z: 0 };
  return { x: maxX - minX, y: maxY - minY, z: maxZ - minZ };
}

/**
 * The report as lines a human reads — for a dev screen or a console check when
 * an asset first lands, which is the moment the answer is cheapest to act on.
 */
export function formatHumanBaseReport(report: HumanBaseReport): string {
  const lines: string[] = [];

  lines.push(report.ok ? "USABLE — no blocking findings" : "NOT USABLE");
  lines.push(
    `${report.meshCount} mesh(es), ${report.triangleCount.toLocaleString()} triangles, ` +
      `${report.morphTargetCount} morph target(s), skeleton: ${report.hasSkeleton ? "yes" : "NO"}`,
  );

  if (report.bindings.length > 0) {
    lines.push("Axis bindings:");
    for (const b of report.bindings) {
      lines.push(`  ${b.axis}: ${b.mode} via ${b.keys.join(" + ")}`);
    }
  }
  if (report.unmatchedAxes.length > 0) {
    lines.push(`Unbound axes: ${report.unmatchedAxes.join(", ")}`);
  }

  for (const f of report.findings) {
    lines.push(`[${f.severity}] req ${f.requirement}: ${f.message}`);
  }

  return lines.join("\n");
}
