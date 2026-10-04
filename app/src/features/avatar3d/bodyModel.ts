import type { Mesh, Object3D } from "three";

/**
 * ============================================================================
 * Body model — measurement -> normalized shape params -> 3D mesh shape.
 * BUILD_ROADMAP_10DAY.md Day 2/3: "drive the avatar with data" +
 * "define the measurement->shape formula."
 * ============================================================================
 *
 * This module is deliberately pure (no React, no Supabase, no
 * @react-three/fiber) so the calibration math in `measurementsToShapeParams`
 * and the morph-target-matching logic in `applyShapeToObject` can be unit
 * tested / hand-verified in isolation. The only external dependency is
 * `three`, for the `Object3D`/`Mesh` types `applyShapeToObject` operates on
 * — that's a 3D math library, not a framework, so it doesn't compromise
 * testability.
 *
 * See `bodyModel.test-notes.md` for hand-worked input -> output examples
 * covering the calibration below.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Raw user-entered measurements, always stored/passed in metric units
 * (cm/kg) regardless of what unit the UI displayed for entry — matches the
 * convention already used by OnboardingScreen/ProfileScreen. Chest/waist/
 * hip/inseam are optional "tape measurements"; when omitted, they're
 * estimated from height + BMI (see `estimateMeasurements`).
 */
export type Measurements = {
  heightCm: number;
  weightKg: number;
  chestCm?: number;
  waistCm?: number;
  hipCm?: number;
  inseamCm?: number;
};

/**
 * The compact shape vector actually driving the 3D avatar — the "4
 * dimensions" scope cut from BUILD_ROADMAP_10DAY.md ("Blendshape scope
 * cut... height, weight/volume, chest/bust, hip"). Each axis is normalized
 * to roughly -1..1, where 0 means "population average" per the reference
 * constants below, -1/+1 mean "at or beyond the low/high edge of the
 * typical adult range," and values are clamped so they never exceed that
 * range even for extreme inputs. This is the shape of value that gets
 * persisted to `avatars.shape_params` and fed to `applyShapeToObject`.
 */
export type ShapeParams = {
  height: number;
  volume: number;
  chest: number;
  hip: number;
};

// ---------------------------------------------------------------------------
// Unit helpers
// ---------------------------------------------------------------------------

const CM_PER_INCH = 2.54;
const KG_PER_LB = 0.45359237;

export function cmToInches(cm: number): number {
  return cm / CM_PER_INCH;
}

export function inchesToCm(inches: number): number {
  return inches * CM_PER_INCH;
}

export function kgToLb(kg: number): number {
  return kg / KG_PER_LB;
}

export function lbToKg(lb: number): number {
  return lb * KG_PER_LB;
}

/** Formats a height in cm as a feet'inches" string, e.g. `173` -> `5'8"`. */
export function formatHeight(heightCm: number): string {
  const totalInches = Math.round(cmToInches(heightCm));
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return `${feet}'${inches}"`;
}

/** Formats a weight in kg as a whole-number pounds string, e.g. `68` -> `150 lb`. */
export function formatWeightLb(weightKg: number): string {
  return `${Math.round(kgToLb(weightKg))} lb`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Clamp every axis of a ShapeParams to -1..1 (defensive — see applyShapeToObject). */
function clampShapeParams(s: ShapeParams): ShapeParams {
  return {
    height: clamp(s.height, -1, 1),
    volume: clamp(s.volume, -1, 1),
    chest: clamp(s.chest, -1, 1),
    hip: clamp(s.hip, -1, 1),
  };
}

// ---------------------------------------------------------------------------
// Sensible input ranges (used for slider bounds + form validation)
// ---------------------------------------------------------------------------

/**
 * Loose "a human could plausibly have entered this" bounds — generous
 * enough to not reject real (if unusual) bodies, tight enough to catch
 * typos (e.g. height entered in inches while the form is set to cm).
 * Not a medical or garment-sizing standard, just input sanity.
 */
export const MEASUREMENT_RANGES = {
  heightCm: { min: 130, max: 220 },
  weightKg: { min: 30, max: 200 },
  chestCm: { min: 60, max: 160 },
  waistCm: { min: 50, max: 160 },
  hipCm: { min: 60, max: 170 },
  inseamCm: { min: 50, max: 110 },
} as const;

/**
 * Validates a Measurements object against MEASUREMENT_RANGES. Returns a
 * list of human-readable error strings (empty = valid). Height/weight are
 * required; chest/waist/hip/inseam are only checked when present.
 */
export function validateMeasurements(m: Measurements): string[] {
  const errors: string[] = [];

  const { heightCm, weightKg, chestCm, waistCm, hipCm, inseamCm } = MEASUREMENT_RANGES;

  if (!Number.isFinite(m.heightCm) || m.heightCm < heightCm.min || m.heightCm > heightCm.max) {
    errors.push(`Height should be between ${heightCm.min} and ${heightCm.max} cm.`);
  }
  if (!Number.isFinite(m.weightKg) || m.weightKg < weightKg.min || m.weightKg > weightKg.max) {
    errors.push(`Weight should be between ${weightKg.min} and ${weightKg.max} kg.`);
  }

  const checkOptional = (
    label: string,
    value: number | undefined,
    range: { min: number; max: number }
  ) => {
    if (value === undefined) return;
    if (!Number.isFinite(value) || value < range.min || value > range.max) {
      errors.push(`${label} should be between ${range.min} and ${range.max} cm.`);
    }
  };
  checkOptional("Chest", m.chestCm, chestCm);
  checkOptional("Waist", m.waistCm, waistCm);
  checkOptional("Hip", m.hipCm, hipCm);
  checkOptional("Inseam", m.inseamCm, inseamCm);

  return errors;
}

// ---------------------------------------------------------------------------
// Calibration constants — FIRST PASS, NOT ANTHROPOMETRIC GOSPEL.
// ---------------------------------------------------------------------------
/**
 * Every number below is a rough, defensible starting point loosely
 * anchored to published adult population ranges (the same spirit as
 * ANSUR II / CDC BMI brackets — see PRODUCT_SPEC.md §9,
 * "Measurement->blendshape mapping accuracy"), NOT a medically or
 * anthropometrically precise model. They exist to make the shape mapping
 * *plausible* and *monotonic* (taller inputs -> taller shape, heavier
 * inputs -> more volume, etc.), so it can ship now and get tuned against
 * real users post-launch. Treat every constant here as a knob, not a fact.
 */

// Height: a roughly sex-neutral adult mean (blends a typical adult male
// reference mean ~176cm and female reference mean ~162cm), used as the
// "shape.height = 0" point. HEIGHT_SPREAD_CM is the distance from that
// mean that maps to a full +-1 on the height axis — someone ~12cm below
// or above 168cm sits at the edge of the normalized range; anyone further
// out just clamps to +-1 rather than exploding the mesh.
const HEIGHT_MEAN_CM = 168;
const HEIGHT_SPREAD_CM = 12;

// BMI: 22 is the same "neutral" BMI already used elsewhere in this repo
// (see buildWidthScale in features/avatar/avatars.tsx) and sits in the
// middle of the standard 18.5-25 "normal" bracket. BMI_SPREAD is tuned
// so a BMI ~15 (very underweight) clamps near -1 and a BMI ~29 (entering
// the "obese" CDC bracket) clamps near +1 — deliberately tighter than the
// full clinical BMI range so the shape response feels meaningful across
// what most users will actually enter, instead of saturating rarely.
const BMI_MEAN = 22;
const BMI_SPREAD = 7;

// Circumference-to-height ratios used to *estimate* chest/waist/hip/inseam
// when the user skips the optional tape measurements. Rough adult ratios
// (circumference-or-length / height), not a garment-industry sizing chart.
// At the reference height/BMI (168cm, BMI 22) these resolve to chest
// ~87cm, waist ~79cm, hip ~94cm, inseam ~76cm — all plausible average-adult
// figures, which is the sanity check these ratios were picked against.
const CHEST_TO_HEIGHT_RATIO = 0.52;
const WAIST_TO_HEIGHT_RATIO = 0.47;
const HIP_TO_HEIGHT_RATIO = 0.56;
const INSEAM_TO_HEIGHT_RATIO = 0.45;

// How many cm of estimated circumference shift per BMI point above/below
// BMI_MEAN. Waist responds most to adiposity, hip and chest less so;
// inseam (leg length) doesn't track BMI at all, so it has no term below.
const CHEST_CM_PER_BMI = 1.1;
const WAIST_CM_PER_BMI = 1.6;
const HIP_CM_PER_BMI = 1.3;

// Once we know a user's *actual* chest/hip tape measurement, this is the
// spread (cm) of "actual minus what height+BMI alone would predict" that
// maps to a full +-1 on that shape axis. E.g. an actual chest 9cm bigger
// than the height+BMI estimate sits at the +1 edge of shape.chest.
const CHEST_DEVIATION_SPREAD_CM = 9;
const HIP_DEVIATION_SPREAD_CM = 9;

/** BMI = weight(kg) / height(m)^2. Guards against a zero/negative height. */
export function computeBmi(heightCm: number, weightKg: number): number {
  const heightM = Math.max(heightCm, 1) / 100;
  return weightKg / (heightM * heightM);
}

interface ExpectedCircumferences {
  chestCm: number;
  waistCm: number;
  hipCm: number;
  inseamCm: number;
}

/**
 * "What would we expect chest/waist/hip/inseam to be, given only this
 * person's height and BMI?" Shared by `estimateMeasurements` (fills in
 * missing tape measurements for display/estimation) and
 * `measurementsToShapeParams` (the baseline that an *actual* tape
 * measurement is compared against to produce the chest/hip shape axes).
 */
function expectedCircumferences(heightCm: number, bmi: number): ExpectedCircumferences {
  const bmiDelta = bmi - BMI_MEAN;
  return {
    chestCm: heightCm * CHEST_TO_HEIGHT_RATIO + bmiDelta * CHEST_CM_PER_BMI,
    waistCm: heightCm * WAIST_TO_HEIGHT_RATIO + bmiDelta * WAIST_CM_PER_BMI,
    hipCm: heightCm * HIP_TO_HEIGHT_RATIO + bmiDelta * HIP_CM_PER_BMI,
    inseamCm: heightCm * INSEAM_TO_HEIGHT_RATIO,
  };
}

export interface EstimatedMeasurements {
  chestCm: number;
  waistCm: number;
  hipCm: number;
  inseamCm: number;
  /** True for any field the caller didn't supply, i.e. this value is estimated from height+BMI, not measured. */
  estimated: {
    chest: boolean;
    waist: boolean;
    hip: boolean;
    inseam: boolean;
  };
}

/**
 * Fills in any missing chest/waist/hip/inseam from height + BMI, and
 * reports which fields were estimated vs. user-supplied so UI can label
 * them honestly (e.g. "92cm (estimated)"). Supplied values pass through
 * unchanged.
 */
export function estimateMeasurements(m: Measurements): EstimatedMeasurements {
  const bmi = computeBmi(m.heightCm, m.weightKg);
  const expected = expectedCircumferences(m.heightCm, bmi);

  return {
    chestCm: m.chestCm ?? expected.chestCm,
    waistCm: m.waistCm ?? expected.waistCm,
    hipCm: m.hipCm ?? expected.hipCm,
    inseamCm: m.inseamCm ?? expected.inseamCm,
    estimated: {
      chest: m.chestCm === undefined,
      waist: m.waistCm === undefined,
      hip: m.hipCm === undefined,
      inseam: m.inseamCm === undefined,
    },
  };
}

/**
 * The core calibrated mapping: raw measurements -> normalized ShapeParams.
 *
 *   - `height` is a straight (height - mean) / spread normalization.
 *   - `volume` is derived from BMI, not raw weight, specifically so a tall
 *     heavy person and a short heavy person with the same *build* land at
 *     similar volume (raw weight would double-count height — a tall person
 *     is heavier at the same relative build just by being bigger overall).
 *   - `chest`/`hip` capture "fuller/leaner in this region than your
 *     overall height+BMI would predict." If chest/hip weren't supplied,
 *     there is no such extra information (the estimate IS the prediction),
 *     so the axis is neutral (0) rather than reusing the raw estimated
 *     circumference — feeding the estimate back in would double-count the
 *     same height/BMI signal the height and volume axes already encode.
 *
 * All four outputs are clamped to -1..1.
 */
export function measurementsToShapeParams(m: Measurements): ShapeParams {
  const bmi = computeBmi(m.heightCm, m.weightKg);
  const expected = expectedCircumferences(m.heightCm, bmi);

  const height = clamp((m.heightCm - HEIGHT_MEAN_CM) / HEIGHT_SPREAD_CM, -1, 1);
  const volume = clamp((bmi - BMI_MEAN) / BMI_SPREAD, -1, 1);

  const chest =
    m.chestCm === undefined
      ? 0
      : clamp((m.chestCm - expected.chestCm) / CHEST_DEVIATION_SPREAD_CM, -1, 1);
  const hip =
    m.hipCm === undefined
      ? 0
      : clamp((m.hipCm - expected.hipCm) / HIP_DEVIATION_SPREAD_CM, -1, 1);

  return { height, volume, chest, hip };
}

// ---------------------------------------------------------------------------
// Applying shape to a loaded 3D mesh — the morph-target seam
// ---------------------------------------------------------------------------

/**
 * Morph target key candidates per shape axis, split by what the name implies
 * about the blendshape's *polarity*. Matching is case-insensitive and tolerant
 * of separators (a key is normalized by lowercasing and stripping everything
 * but [a-z0-9] before comparison), because rig authors are wildly inconsistent
 * about naming — Mixamo, MakeHuman, Anny, and hand-authored rigs all use
 * different words for the same concept (e.g. "Bust", "Chest_Width",
 * "chestSize").
 *
 * WHY POLARITY MATTERS, AND WHY THIS IS SPLIT THREE WAYS
 * -----------------------------------------------------
 * There are two incompatible authoring conventions in the wild, and reading a
 * rig with the wrong one produces a body that cannot be posed neutrally:
 *
 *   * **Bidirectional slider** — one morph spanning both extremes, rest at
 *     influence 0.5 (e.g. "Weight" where 0 = thinnest, 1 = heaviest). These
 *     names are listed under `neutral`.
 *   * **Opposing pair / single direction** — morphs named for one direction,
 *     each 0 = off, 1 = full (e.g. separate "Thin" and "Heavy"). These are
 *     listed under `negative` / `positive`.
 *
 * Driving a directional morph as though it were bidirectional sets it to 0.5
 * at rest, which renders a permanently half-heavy avatar that no input can
 * neutralize. That is the bug this split fixes; `pickAxisBinding` below is
 * where the convention is inferred.
 *
 * PRECEDENCE IS `neutral` FIRST, AND THAT IS NOT ARBITRARY. An undriven morph
 * sits at its default influence of 0 — which is *neutral* for a directional
 * morph but a hard *extreme* for a bidirectional one. So when a rig offers
 * both, driving the bidirectional one and leaving the pair at 0 is safe, while
 * the reverse leaves a slider pinned at its thinnest extreme. Prefer the
 * option whose failure mode is invisible.
 */
interface AxisCandidates {
  /** Bidirectional slider names — rest at influence 0.5. */
  neutral: string[];
  /** Names implying "more of this axis" — rest at influence 0. */
  positive: string[];
  /** Names implying "less of this axis" — rest at influence 0. */
  negative: string[];
}

const MORPH_TARGET_NAME_CANDIDATES: Record<keyof ShapeParams, AxisCandidates> = {
  height: {
    neutral: ["height", "stature"],
    positive: ["tall"],
    negative: ["short"],
  },
  volume: {
    // "bodyfat" precedes "fat" across the two lists deliberately: matching is
    // name-contains-candidate, so a morph called "BodyFat" has to be claimed
    // by the neutral list before the positive list's "fat" can reach it, while
    // a morph called plainly "Fat" still falls through to positive.
    neutral: ["volume", "weight", "mass", "bmi", "bodyfat"],
    positive: ["heavy", "chubby", "fat", "overweight", "obese"],
    negative: ["thin", "slim", "skinny", "lean", "underweight"],
  },
  chest: {
    neutral: ["chest", "bust", "pecs"],
    positive: ["chestlarge", "bustlarge"],
    negative: ["chestsmall", "bustsmall", "flatchest"],
  },
  hip: {
    neutral: ["hip", "hips", "glute", "buttock"],
    positive: ["hipwide", "hipslarge"],
    negative: ["hipnarrow", "hipssmall"],
  },
};

function normalizeMorphName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Finds the first morph target key in `dict` matching any candidate for one axis, trying candidates in priority order. */
function findMorphTarget(
  dict: { [name: string]: number },
  candidates: string[]
): { key: string; index: number } | undefined {
  const keys = Object.keys(dict);
  for (const candidate of candidates) {
    const key = keys.find((k) => normalizeMorphName(k).includes(candidate));
    if (key !== undefined) {
      return { key, index: dict[key] };
    }
  }
  return undefined;
}

/**
 * How one axis is expressed by the rig currently loaded, and which morph keys
 * carry it. Reported out through `ApplyShapeResult.bindings` so a diagnostic
 * screen can show what was inferred — the inference is a heuristic over
 * author-chosen names, and a heuristic nobody can see is a heuristic nobody
 * can correct.
 */
export interface MorphAxisBinding {
  axis: keyof ShapeParams;
  /**
   * `bidirectional` — one slider, rest at 0.5.
   * `pair` — two opposing directional morphs, both rest at 0.
   * `unipolar` — one directional morph; the opposite direction is unavailable,
   *   so that half of the axis simply cannot be expressed by this rig.
   */
  mode: "bidirectional" | "pair" | "unipolar";
  /** Morph keys driven. For `pair`, ordered [negative, positive]. */
  keys: string[];
}

/** Which morph key, if any, each polarity list claims for one axis. */
function matchPolarities(
  dict: { [name: string]: number },
  candidates: AxisCandidates,
): {
  neutral?: { key: string; index: number };
  positive?: { key: string; index: number };
  negative?: { key: string; index: number };
} {
  return {
    neutral: findMorphTarget(dict, candidates.neutral),
    positive: findMorphTarget(dict, candidates.positive),
    negative: findMorphTarget(dict, candidates.negative),
  };
}

/**
 * Decide how to drive one axis on one mesh, and do it.
 *
 * Returns the binding it settled on, or `undefined` when the rig expresses
 * nothing for this axis — which is a legitimate outcome, not a failure: a rig
 * may simply have no hip blendshape, and the honest response is to leave that
 * axis alone rather than force it onto an unrelated morph.
 */
function driveAxis(
  dict: { [name: string]: number },
  influences: number[],
  axis: keyof ShapeParams,
  value: number,
): MorphAxisBinding | undefined {
  const { neutral, positive, negative } = matchPolarities(
    dict,
    MORPH_TARGET_NAME_CANDIDATES[axis],
  );

  // Bidirectional first — see the precedence note on the candidate table.
  if (neutral) {
    influences[neutral.index] = (value + 1) / 2;
    return { axis, mode: "bidirectional", keys: [neutral.key] };
  }

  // Opposing pair: each pole carries its own half of the range and both sit at
  // 0 when the axis is neutral, so the rest pose is genuinely rest.
  if (negative && positive) {
    influences[negative.index] = Math.max(0, -value);
    influences[positive.index] = Math.max(0, value);
    return { axis, mode: "pair", keys: [negative.key, positive.key] };
  }

  // One direction only. Drive it over its own half and leave it at 0 for the
  // other — deliberately NOT (value+1)/2, which is the bug: a morph named for
  // a direction conventionally means 0 = off, so a 0.5 rest pose would show a
  // permanently half-applied body.
  const single = positive ?? negative;
  if (single) {
    const direction = positive ? 1 : -1;
    influences[single.index] = Math.max(0, value * direction);
    return { axis, mode: "unipolar", keys: [single.key] };
  }

  return undefined;
}

/**
 * Sets morphTargetInfluences on every mesh that has a matching morph target,
 * for every ShapeParams axis.
 *
 * Note: if the same morph key happens to match more than one axis' candidate
 * list (an unusually-named rig), the later axis in iteration order (height,
 * volume, chest, hip) wins — an accepted simplification, now visible in the
 * returned bindings rather than silent.
 */
function applyMorphTargets(
  meshes: Mesh[],
  s: ShapeParams,
): { matched: string[]; bindings: MorphAxisBinding[] } {
  const matched: string[] = [];
  const bindings: MorphAxisBinding[] = [];

  for (const mesh of meshes) {
    const dict = mesh.morphTargetDictionary;
    const influences = mesh.morphTargetInfluences;
    if (!dict || !influences) continue;

    (Object.keys(MORPH_TARGET_NAME_CANDIDATES) as (keyof ShapeParams)[]).forEach(
      (axis) => {
        const binding = driveAxis(dict, influences, axis, s[axis]);
        if (!binding) return;
        matched.push(...binding.keys);
        bindings.push(binding);
      },
    );
  }

  return { matched, bindings };
}

// Whole-mesh non-uniform scale stand-in, used only when no morph targets
// are present at all (see applyShapeToObject). These ranges are how far a
// full +-1 on each axis moves the scale factor away from 1.0 (neutral) —
// deliberately modest so the stand-in stays plausible-looking rather than
// cartoonish. Ported from the Day 1 spike's bodyScale formula (chest
// nudges X, hip nudges Z, on top of an overall volume scale) — see
// AvatarSpikeScreen.tsx's original file-level "Shape control" comment.
const HEIGHT_SCALE_RANGE = 0.16;
const VOLUME_SCALE_RANGE = 0.22;
const CHEST_SCALE_RANGE = 0.08;
const HIP_SCALE_RANGE = 0.08;

function applyAxisScaleFallback(root: Object3D, s: ShapeParams): void {
  const heightScale = 1 + s.height * HEIGHT_SCALE_RANGE;
  const volumeScale = 1 + s.volume * VOLUME_SCALE_RANGE;
  const chestScale = volumeScale * (1 + s.chest * CHEST_SCALE_RANGE);
  const hipScale = volumeScale * (1 + s.hip * HIP_SCALE_RANGE);

  root.scale.set(chestScale, heightScale, hipScale);
}

export interface ApplyShapeResult {
  /** True if at least one real morph target was found and driven; false if the axis-scale stand-in was used instead. */
  usedMorphTargets: boolean;
  /** Morph target key names that were actually set (empty when usedMorphTargets is false). */
  matchedMorphTargets: string[];
  /**
   * What was inferred about each axis the rig *does* express — which morph
   * keys carry it and under which authoring convention. Empty when the
   * axis-scale stand-in was used.
   */
  bindings: MorphAxisBinding[];
  /**
   * Axes the rig expresses nothing for, left entirely undriven.
   *
   * A legitimate outcome rather than a failure — a rig may genuinely have no
   * hip blendshape — but one worth surfacing: an axis in here is a dimension
   * of the user's body the avatar silently cannot reflect, and the only way to
   * notice from the outside is that the slider does nothing. All four axes
   * appear here when the stand-in was used.
   */
  unmatchedAxes: (keyof ShapeParams)[];
}

/**
 * Applies a ShapeParams to a loaded GLB scene graph — THE seam production
 * swaps on. Preference order:
 *
 *   1. Real morph targets / blendshapes: if any mesh under `root` exposes
 *      a `morphTargetDictionary` (i.e. the GLB was authored with
 *      blendshapes — the production case per PRODUCT_SPEC.md §5a/§8),
 *      match our 4 shape axes to its morph target names (see
 *      MORPH_TARGET_NAME_CANDIDATES) and drive `morphTargetInfluences`
 *      directly. This is real, per-region reshaping.
 *   2. Axis-scale stand-in: if NO mesh under `root` has any morph targets
 *      at all — true today, because the Day 1 spike's generated GLB is a
 *      raw image-to-3D export with no blendshapes — fall back to
 *      non-uniformly scaling `root` itself (mirrors the Day 1 spike's
 *      bodyScale hack). This is not anatomically isolated (there's no rig
 *      to isolate a "chest" region on), just a whole-mesh multiplier, and
 *      is explicitly a stand-in, not a claim of real reshaping.
 *
 * The two paths are mutually exclusive on purpose: mixing "scale the
 * whole root" with "also morph individual meshes under it" would
 * double-apply shape wherever both happened to touch the same region.
 *
 * `root` should be a shared parent of both the avatar mesh AND any
 * sibling objects (e.g. a placeholder garment) that should visually
 * follow body-shape changes — the axis-scale fallback scales `root`
 * itself, so anything parented under it inherits the scale for free via
 * ordinary scene-graph parenting, same mechanism as the Day 1 spike's
 * BodyGroup. (Morph targets, by contrast, only affect the specific mesh
 * they're authored on — a sibling that isn't itself morphed or skinned to
 * the same rig will NOT follow shape changes in that path. That's a real
 * limitation of today's un-skinned placeholder garment, not a bug here;
 * PRODUCT_SPEC.md §5c's skinned-garment plan is what fixes it.)
 */
export function applyShapeToObject(
  root: Object3D,
  shapeParams: ShapeParams
): ApplyShapeResult {
  const s = clampShapeParams(shapeParams);

  const morphMeshes: Mesh[] = [];
  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (mesh.isMesh && mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
      morphMeshes.push(mesh);
    }
  });

  if (morphMeshes.length > 0) {
    // Real rig found. Reset any leftover stand-in scale from a previous
    // call (defensive/idempotent — e.g. relevant if `root` were ever
    // reused across a GLB swap without a full remount) before driving
    // morph targets instead.
    root.scale.set(1, 1, 1);
    const { matched, bindings } = applyMorphTargets(morphMeshes, s);
    const bound = new Set(bindings.map((b) => b.axis));
    const unmatchedAxes = (
      Object.keys(MORPH_TARGET_NAME_CANDIDATES) as (keyof ShapeParams)[]
    ).filter((axis) => !bound.has(axis));
    return {
      usedMorphTargets: true,
      matchedMorphTargets: matched,
      bindings,
      unmatchedAxes,
    };
  }

  applyAxisScaleFallback(root, s);
  // Every axis is "unmatched" here in the sense that matters: none is driven
  // by a blendshape. The stand-in still moves the whole mesh, so the avatar
  // responds to all four — it just does so by stretching geometry rather than
  // deforming a body, which is exactly the difference the mesh upgrade exists
  // to close.
  return {
    usedMorphTargets: false,
    matchedMorphTargets: [],
    bindings: [],
    unmatchedAxes: Object.keys(MORPH_TARGET_NAME_CANDIDATES) as (keyof ShapeParams)[],
  };
}
