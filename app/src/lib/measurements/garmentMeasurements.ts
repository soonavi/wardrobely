/**
 * ============================================================================
 * Garment measurements — which axes a category has, how to estimate them,
 * and how to say out loud where a number came from.
 * ============================================================================
 *
 * Mirrors `migrations/008_garment_measurements.sql`. The database enforces
 * plausibility and the source/value invariant; this module owns the two things
 * SQL cannot express — which axes are *meaningful* for a category, and what a
 * garment probably measures when the user would rather not fetch a tape.
 *
 * Deliberately pure: no React, no Supabase, no `three`. Everything here is a
 * function of its arguments, so the estimation table can be unit-tested and
 * argued with directly.
 *
 * THE RULE THIS MODULE EXISTS TO ENFORCE
 * An estimate is never returned bare. `estimateGarmentMeasurements` returns a
 * `MeasurementSet` carrying `source: "estimated"`, and `describeMeasurement`
 * refuses to render a value without consulting it. A user deciding whether a
 * dress will fit needs to know the difference between "we measured this" and
 * "we guessed from your height" — the whole reason for letting them enter real
 * numbers is that our guess is not good enough for the decision they are
 * making with it.
 */

import { CM_PER_INCH, type Units } from "../bodyMetrics";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Matches the `garment_category` enum in schema.sql. */
export type GarmentCategory =
  | "top"
  | "bottom"
  | "dress"
  | "outerwear"
  | "shoes"
  | "accessory";

/** Matches the `garment_measurement_source` enum in 008. */
export type MeasurementSource = "user" | "estimated" | "brand";

/**
 * One measurable axis. Every value is a length in centimetres — the column
 * type in 008 — regardless of what unit the UI collected it in, matching the
 * metric-storage convention `bodyMetrics` already established for the body.
 */
export type MeasurementAxis =
  | "chest"
  | "waist"
  | "hip"
  | "length"
  | "shoulder"
  | "sleeve"
  | "inseam";

export const ALL_AXES: readonly MeasurementAxis[] = [
  "chest",
  "waist",
  "hip",
  "length",
  "shoulder",
  "sleeve",
  "inseam",
] as const;

export type MeasurementValues = Partial<Record<MeasurementAxis, number>>;

export interface MeasurementSet {
  source: MeasurementSource;
  values: MeasurementValues;
}

/**
 * The wearer's body, as far as we know it. Both fields optional because the
 * profile allows either to be null — `estimateGarmentMeasurements` degrades to
 * a category-typical garment rather than refusing, since a rough silhouette is
 * still more useful than nothing when it is labelled as a guess.
 */
export interface WearerMetrics {
  heightCm?: number | null;
  weightKg?: number | null;
}

// ---------------------------------------------------------------------------
// Which axes belong to which category
// ---------------------------------------------------------------------------

/**
 * A shoe has no waist. Asking for one produces either a blank field the user
 * has to skip past on every upload, or — worse — a number they invent to make
 * the form stop nagging, which then feeds the recommendation engine as though
 * it were measured.
 *
 * `shoes` and `accessory` deliberately map to `length` only. For a shoe that
 * is the insole length, which is what shoe sizing actually is; for an
 * accessory it is the single dimension a belt, scarf or bag has in common.
 * Neither gets a bespoke axis until a real fit decision depends on one.
 */
export const AXES_BY_CATEGORY: Record<GarmentCategory, readonly MeasurementAxis[]> = {
  top: ["chest", "waist", "length", "shoulder", "sleeve"],
  bottom: ["waist", "hip", "length", "inseam"],
  dress: ["chest", "waist", "hip", "length", "shoulder", "sleeve"],
  outerwear: ["chest", "waist", "length", "shoulder", "sleeve"],
  shoes: ["length"],
  accessory: ["length"],
};

export function axesFor(category: GarmentCategory): readonly MeasurementAxis[] {
  return AXES_BY_CATEGORY[category] ?? [];
}

/** Human label for an axis, category-aware where the plain word would mislead. */
export function axisLabel(axis: MeasurementAxis, category: GarmentCategory): string {
  if (axis === "length") {
    if (category === "shoes") return "Insole length";
    if (category === "accessory") return "Length";
    return "Garment length";
  }
  const labels: Record<Exclude<MeasurementAxis, "length">, string> = {
    chest: "Chest",
    waist: "Waist",
    hip: "Hip",
    shoulder: "Shoulder width",
    sleeve: "Sleeve length",
    inseam: "Inseam",
  };
  return labels[axis as Exclude<MeasurementAxis, "length">];
}

// ---------------------------------------------------------------------------
// Estimation
// ---------------------------------------------------------------------------

/**
 * Body-circumference estimates from height and BMI, in centimetres.
 *
 * These are the *wearer's* dimensions, not the garment's — the garment is
 * derived from them by adding ease below. Anthropometric regressions on height
 * alone are weak, so BMI does the heavy lifting for girth while height sets
 * the vertical axes.
 *
 * Calibrated against a 170cm / BMI 22 reference wearer: chest 92, waist 78,
 * hip 96. Those are mid-range values for that build and are deliberately not
 * sex-specific — Selv collects no sex or gender, the character creator is a
 * preset chooser, and inventing a split here would mean inferring one from
 * body data, which MARKETING_STRATEGY.md §11 commits against.
 */
const REFERENCE_HEIGHT_CM = 170;
const REFERENCE_BMI = 22;
const REFERENCE_CHEST_CM = 92;
const REFERENCE_WAIST_CM = 78;
const REFERENCE_HIP_CM = 96;

/**
 * How strongly each girth axis follows BMI. Waist responds most to body mass,
 * hip least — that ordering is the stable part of the relationship and is what
 * keeps a heavier estimate from reading as a uniformly scaled-up person.
 */
const BMI_SENSITIVITY: Record<"chest" | "waist" | "hip", number> = {
  chest: 0.7,
  waist: 1.0,
  hip: 0.55,
};

/**
 * Ease: how much bigger than the body the garment is cut, per category, in
 * centimetres added to the relevant girth.
 *
 * Outerwear carries the most because it is worn over other layers — that is
 * the entire point of the category, and an outer layer estimated at body
 * girth would be recommended as a fit when it would not close.
 */
const EASE_CM: Record<GarmentCategory, number> = {
  top: 8,
  bottom: 4,
  dress: 6,
  outerwear: 16,
  shoes: 0,
  accessory: 0,
};

/**
 * Vertical axes as a fraction of the wearer's height. Proportion holds far
 * better across body sizes than absolute lengths do, which is why these are
 * ratios rather than a lookup table of centimetres.
 */
const HEIGHT_RATIO: Partial<
  Record<GarmentCategory, Partial<Record<MeasurementAxis, number>>>
> = {
  top: { length: 0.4, shoulder: 0.26, sleeve: 0.34 },
  bottom: { length: 0.59, inseam: 0.45 },
  dress: { length: 0.62, shoulder: 0.26, sleeve: 0.3 },
  outerwear: { length: 0.44, shoulder: 0.28, sleeve: 0.36 },
  // A foot is close enough to a fixed fraction of height for an estimate that
  // is going to be labelled as one; 0.152 is the long-standing anthropometric
  // rule of thumb and lands a 170cm wearer at ~26cm, a men's US 8.
  shoes: { length: 0.152 },
};

/**
 * Plausible human BMI band, used to clamp the derived ratio.
 *
 * WHY THIS IS NEEDED AND NOT PARANOIA. `profiles` range-checks height
 * (90–250cm) and weight (30–300kg) *independently*, so their quotient is not
 * bounded by either constraint: 90cm paired with 300kg is accepted by both
 * columns and yields a BMI of 370. Feeding that through the girth formula
 * produced an 817cm chest — a value 008's `garments_measurements_plausible`
 * check rejects, so the user would have hit a save failure on a garment they
 * did nothing wrong with.
 *
 * The bounds are wide on purpose. This is not a judgement about bodies; it is
 * the range over which the girth regression means anything at all. Outside it
 * the honest answer is "we cannot estimate this", and the nearest edge of the
 * band is a better stand-in than a number the database will refuse.
 *
 * Precedent: `buildWidthScale` in features/avatar/avatars.tsx already clamps
 * its own BMI-derived scale to 0.85–1.25 for the same reason.
 */
const MIN_PLAUSIBLE_BMI = 12;
const MAX_PLAUSIBLE_BMI = 60;

/** Matches the 1..400 bounds in 008's `garments_measurements_plausible`. */
const MIN_MEASUREMENT_CM = 1;
const MAX_MEASUREMENT_CM = 400;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function bmiOf(heightCm: number, weightKg: number): number {
  return clamp(
    weightKg / Math.pow(heightCm / 100, 2),
    MIN_PLAUSIBLE_BMI,
    MAX_PLAUSIBLE_BMI,
  );
}

/**
 * Round to a whole centimetre — the column is `smallint` — and hold the value
 * inside the range 008 will accept.
 *
 * The clamp is a backstop, not the primary defence: `bmiOf` already bounds the
 * dominant term. It stays because the two limits are enforced in different
 * places (a ratio here, a `check` constraint in SQL) and nothing but this line
 * keeps them from drifting apart the next time a ratio in the tables above is
 * retuned. A clamped estimate is wrong; a rejected INSERT is a bug report.
 */
function cm(value: number): number {
  return clamp(Math.round(value), MIN_MEASUREMENT_CM, MAX_MEASUREMENT_CM);
}

/**
 * Best-effort garment measurements for a category, given whatever we know
 * about the wearer.
 *
 * Always returns `source: "estimated"`. There is no argument that makes this
 * return `"user"`; a caller wanting that must build the set from values the
 * user actually typed. That asymmetry is deliberate — it means no code path
 * can accidentally launder a guess into a measurement.
 *
 * With no wearer metrics at all it falls back to the reference build, so a
 * signed-out-of-onboarding user still gets a shaped garment rather than an
 * empty one. That is a weaker guess and the label is the same, because the
 * honest distinction the user needs is measured/not-measured, not
 * guessed-well/guessed-badly.
 */
export function estimateGarmentMeasurements(
  category: GarmentCategory,
  wearer: WearerMetrics = {},
): MeasurementSet {
  const heightCm =
    typeof wearer.heightCm === "number" && wearer.heightCm > 0
      ? wearer.heightCm
      : REFERENCE_HEIGHT_CM;

  const bmi =
    typeof wearer.weightKg === "number" && wearer.weightKg > 0
      ? bmiOf(heightCm, wearer.weightKg)
      : REFERENCE_BMI;

  const heightScale = heightCm / REFERENCE_HEIGHT_CM;
  const bmiRatio = bmi / REFERENCE_BMI;
  const ease = EASE_CM[category] ?? 0;

  // Girth scales with height (a taller frame is broader) and with BMI, the
  // latter damped per axis. `Math.sqrt(heightScale)` rather than heightScale:
  // circumference grows sub-linearly with stature, and scaling it linearly
  // makes tall wearers comically barrel-chested.
  const girth = (reference: number, axis: "chest" | "waist" | "hip") =>
    cm(
      reference *
        Math.sqrt(heightScale) *
        (1 + (bmiRatio - 1) * BMI_SENSITIVITY[axis]) +
        ease,
    );

  const values: MeasurementValues = {};
  const axes = axesFor(category);
  const ratios = HEIGHT_RATIO[category] ?? {};

  for (const axis of axes) {
    if (axis === "chest") values.chest = girth(REFERENCE_CHEST_CM, "chest");
    else if (axis === "waist") values.waist = girth(REFERENCE_WAIST_CM, "waist");
    else if (axis === "hip") values.hip = girth(REFERENCE_HIP_CM, "hip");
    else {
      const ratio = ratios[axis];
      if (typeof ratio === "number") values[axis] = cm(heightCm * ratio);
    }
  }

  return { source: "estimated", values };
}

// ---------------------------------------------------------------------------
// Building a set from user input
// ---------------------------------------------------------------------------

/**
 * Build a `MeasurementSet` from values the user typed.
 *
 * Returns `null` when nothing usable was entered, rather than an empty set
 * with a source — that shape is exactly what 008's
 * `garments_measurement_source_consistent` constraint rejects, so returning it
 * would push a database error into a screen that could have said "enter at
 * least one measurement" itself.
 *
 * Axes not belonging to the category are dropped rather than stored. A waist
 * on a shoe is a mis-wired form, and persisting it would leave a value no
 * screen renders and no query expects.
 */
export function measurementSetFromUser(
  category: GarmentCategory,
  values: MeasurementValues,
  source: Extract<MeasurementSource, "user" | "brand"> = "user",
): MeasurementSet | null {
  const allowed = new Set(axesFor(category));
  const kept: MeasurementValues = {};

  for (const axis of ALL_AXES) {
    const value = values[axis];
    if (!allowed.has(axis)) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
    kept[axis] = cm(value);
  }

  return Object.keys(kept).length > 0 ? { source, values: kept } : null;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/**
 * Render one measurement for a human, in their chosen units, always carrying
 * its provenance.
 *
 * The `set` argument is required and the source is read from it every time.
 * A signature taking a bare number would let a caller render "32in waist" for
 * a value nobody measured, which is the single failure this whole feature is
 * built to prevent.
 */
export function describeMeasurement(
  set: MeasurementSet,
  axis: MeasurementAxis,
  units: Units,
): string | null {
  const valueCm = set.values[axis];
  if (typeof valueCm !== "number") return null;

  const display =
    units === "metric"
      ? `${Math.round(valueCm)} cm`
      : `${(valueCm / CM_PER_INCH).toFixed(1)} in`;

  // "brand" is not hedged: a partner feed's spec sheet is a stated
  // measurement, not our inference. It is still distinguished from "user" in
  // the data because a feed can be wrong in ways a tape measure cannot.
  return set.source === "estimated" ? `about ${display} (estimated)` : display;
}

/** One-line summary for a card or a list row. */
export function summarizeMeasurements(
  set: MeasurementSet | null,
  category: GarmentCategory,
  units: Units,
): string {
  if (!set) return "No measurements yet";

  const parts: string[] = [];
  for (const axis of axesFor(category)) {
    const valueCm = set.values[axis];
    if (typeof valueCm !== "number") continue;
    const value =
      units === "metric"
        ? `${Math.round(valueCm)}`
        : `${(valueCm / CM_PER_INCH).toFixed(1)}`;
    parts.push(`${axisLabel(axis, category)} ${value}`);
  }

  if (parts.length === 0) return "No measurements yet";

  const unit = units === "metric" ? "cm" : "in";
  const body = `${parts.join(" · ")} ${unit}`;
  return set.source === "estimated" ? `${body} — estimated` : body;
}
