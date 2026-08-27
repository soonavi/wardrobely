/**
 * Pure validation + unit conversion for the OPTIONAL height/weight fields on
 * the profile screen (LAUNCH_CHECKLIST.md §3, "Height/weight profile fields
 * tolerate edge-case input").
 *
 * These are reference-only fields. Since the character-creator pivot they no
 * longer drive the avatar's shape — `avatars.customization` does (see
 * `legal/DATA_HANDLING.md`, "Avatar approach (updated)"). So everything here
 * is input sanity and graceful failure, NOT avatar fidelity: the goal is that
 * a typo produces a clear sentence instead of a broken layout, and that no
 * value the UI is willing to display can be rejected when it is saved back.
 *
 * Split out of ProfileScreen so the boundaries are unit-testable without a
 * renderer, matching the convention in jest.config.js.
 *
 * ## Why these bounds
 *
 * The metric range is the single source of truth; the imperial range is
 * derived from it at module load so the two can never drift apart.
 *
 * 90–250 cm / 30–300 kg is deliberately wider than
 * `features/avatar3d/bodyModel.ts`'s MEASUREMENT_RANGES (130–220 / 30–200).
 * That module's range feeds a 3D mesh, where an extreme value visibly breaks
 * the model; this one only guards a number the user typed about themselves.
 * Rejecting a 135 cm adult, or a 13-year-old (Selv's minimum age — see
 * `legal/PRIVACY_POLICY.md` §12), would be a body-positivity failure
 * (`MARKETING_STRATEGY.md` §11) in service of nothing. The bounds are set
 * only tight enough to catch the one mistake that actually happens: entering
 * a value in the other unit system (68 typed into a cm field, or 175 typed
 * into an inches field, are both rejected).
 */

export type Units = "imperial" | "metric";

/** Exact, by definition. */
export const CM_PER_INCH = 2.54;
/** Exact, by definition (international pound). */
export const KG_PER_LB = 0.45359237;

export type BodyMetricField = "height" | "weight";

export interface Range {
  min: number;
  max: number;
}

/**
 * The canonical range. Everything else in this module is derived from it, and
 * every accepted input converts to a value inside it.
 */
export const METRIC_RANGES: Record<BodyMetricField, Range> = {
  height: { min: 90, max: 250 },
  weight: { min: 30, max: 300 },
};

/**
 * Convert a metric bound into the imperial bound that is *inside* it.
 *
 * Rounding inward (ceil the minimum, floor the maximum) is what guarantees
 * the round trip: every value we advertise as valid in inches/lbs converts
 * and rounds back to a value inside METRIC_RANGES. Rounding to nearest would
 * not — 90 cm is 35.43 in, and 35 in rounds back to 89 cm, one below the
 * floor, which is exactly the "displayed a value it then refused to save"
 * bug this avoids.
 */
function inwardMin(metricMin: number, perUnit: number): number {
  return Math.ceil(metricMin / perUnit);
}

function inwardMax(metricMax: number, perUnit: number): number {
  return Math.floor(metricMax / perUnit);
}

/** Derived: height in whole inches, weight in whole pounds. */
export const IMPERIAL_RANGES: Record<BodyMetricField, Range> = {
  height: {
    min: inwardMin(METRIC_RANGES.height.min, CM_PER_INCH),
    max: inwardMax(METRIC_RANGES.height.max, CM_PER_INCH),
  },
  weight: {
    min: inwardMin(METRIC_RANGES.weight.min, KG_PER_LB),
    max: inwardMax(METRIC_RANGES.weight.max, KG_PER_LB),
  },
};

/** The range a field is validated against in the unit system on screen. */
export function rangeFor(field: BodyMetricField, units: Units): Range {
  return units === "metric" ? METRIC_RANGES[field] : IMPERIAL_RANGES[field];
}

/** The unit word used in user-facing copy. */
export function unitLabel(field: BodyMetricField, units: Units): string {
  if (units === "metric") return field === "height" ? "cm" : "kg";
  return field === "height" ? "inches" : "lbs";
}

const FIELD_LABEL: Record<BodyMetricField, string> = {
  height: "Height",
  weight: "Weight",
};

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

/** Convert a whole value in the on-screen units to the stored metric value. */
export function toMetric(
  field: BodyMetricField,
  value: number,
  units: Units
): number {
  if (units === "metric") return value;
  return Math.round(value * (field === "height" ? CM_PER_INCH : KG_PER_LB));
}

function clamp(value: number, { min, max }: Range): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Convert a stored metric value into the whole number to show in an input.
 *
 * Clamped into the on-screen range, so the field never displays something the
 * save path would then reject — a stored 90 cm is 35.4 in, which would round
 * to 35 and fail validation, so it is shown as the 36 in floor instead. The
 * ≤1 cm of drift that introduces is invisible in a reference-only field and
 * strictly better than an error the user cannot act on.
 */
export function toDisplayValue(
  field: BodyMetricField,
  metricValue: number,
  units: Units
): number {
  const raw =
    units === "metric"
      ? Math.round(metricValue)
      : Math.round(metricValue / (field === "height" ? CM_PER_INCH : KG_PER_LB));
  return clamp(raw, rangeFor(field, units));
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface BodyMetricsIssue {
  field: BodyMetricField;
  message: string;
}

export type ParseBodyMetricsResult =
  | { ok: true; heightCm: number; weightKg: number }
  | { ok: false; issues: BodyMetricsIssue[] };

/**
 * Validate one field's raw text in the units currently on screen.
 *
 * Messages name the accepted range rather than characterising the number the
 * user typed — "Height should be between 90 and 250 cm." states a limit of
 * the tool, where "that looks out of range" invites the reader to hear a
 * judgement about their body (`MARKETING_STRATEGY.md` §11).
 */
function validateField(
  field: BodyMetricField,
  raw: string,
  units: Units
): { value: number } | { issue: BodyMetricsIssue } {
  const label = FIELD_LABEL[field];
  const unit = unitLabel(field, units);
  const trimmed = raw.trim();

  if (trimmed === "") {
    return {
      issue: { field, message: `Enter your ${field} in ${unit}.` },
    };
  }

  // Whole digits only. Rejects "-5", "5.5", "1e3", "١٢٣" and any stray text,
  // so parseInt never gets a chance to salvage a prefix out of nonsense.
  if (!/^\d+$/.test(trimmed)) {
    return {
      issue: {
        field,
        message: `${label} should be a whole number in ${unit}.`,
      },
    };
  }

  const value = parseInt(trimmed, 10);
  const range = rangeFor(field, units);

  // Number.isFinite guards a digit string long enough to overflow to
  // Infinity, which would otherwise slip past a bare `> max` comparison in
  // some orderings and reach the avatar math.
  if (!Number.isFinite(value) || value < range.min || value > range.max) {
    return {
      issue: {
        field,
        message: `${label} should be between ${range.min} and ${range.max} ${unit}.`,
      },
    };
  }

  return { value };
}

/**
 * Validate and convert both fields together.
 *
 * Both fields are always checked, so a user who mistyped both is told about
 * both at once instead of fixing one and being stopped again by the other.
 */
export function parseBodyMetrics(
  heightInput: string,
  weightInput: string,
  units: Units
): ParseBodyMetricsResult {
  const height = validateField("height", heightInput, units);
  const weight = validateField("weight", weightInput, units);

  const issues: BodyMetricsIssue[] = [];
  if ("issue" in height) issues.push(height.issue);
  if ("issue" in weight) issues.push(weight.issue);
  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    heightCm: toMetric("height", (height as { value: number }).value, units),
    weightKg: toMetric("weight", (weight as { value: number }).value, units),
  };
}

/** Flatten issues into the single error string the profile screen renders. */
export function bodyMetricsErrorMessage(issues: BodyMetricsIssue[]): string {
  return issues.map((i) => i.message).join(" ");
}

/** Short, always-visible guidance for the input row. */
export function rangeHint(units: Units): string {
  const h = rangeFor("height", units);
  const w = rangeFor("weight", units);
  return units === "metric"
    ? `Height ${h.min}–${h.max} cm · weight ${w.min}–${w.max} kg.`
    : `Height in total inches (5'8" = 68), ${h.min}–${h.max} · weight ${w.min}–${w.max} lbs.`;
}

// ---------------------------------------------------------------------------
// Defensive guards for the avatar silhouette
// ---------------------------------------------------------------------------

/** A silhouette drawn at its neutral, unscaled proportions. */
export const NEUTRAL_WIDTH_SCALE = 1;

/**
 * Narrow a stored value to a positive finite number, or null.
 *
 * `buildWidthScale` (features/avatar/avatars.tsx) already returns 1 for null,
 * undefined, 0 and NaN, because each is falsy. A NEGATIVE weight is not
 * falsy: it makes `bmi` negative, `Math.sqrt` of it NaN, and both clamps pass
 * NaN straight through — which lands in an SVG `scale()` transform and blanks
 * the silhouette. Nothing in the app writes a negative today (the input
 * regex only accepts digits), but `height_cm`/`weight_kg` are plain nullable
 * numbers in the database, so the screen sanitises rather than trusting them.
 */
export function safeMetric(value: number | null | undefined): number | null {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/** Last line of defence: never hand a non-finite scale to the renderer. */
export function safeWidthScale(scale: number): number {
  return Number.isFinite(scale) ? scale : NEUTRAL_WIDTH_SCALE;
}
