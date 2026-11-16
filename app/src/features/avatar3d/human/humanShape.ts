/**
 * Body shape for the human avatar: the sliders a person understands, resolved
 * into the morph-target weights the asset understands.
 *
 * Two ways to say how big someone is, and both are supported:
 *
 * - **relative** — `height: 0.5` means "half a unit taller than this frame's
 *   average". One unit is 12 cm of stature, 7 BMI points, or 9 cm of girth:
 *   the same units `measurementsToShapeParams` in `bodyModel.ts` has always
 *   produced, so `ShapeParams` drops straight in.
 * - **absolute** — `heightCm` and `weightKg`. The asset's targets are
 *   calibrated in physical units and the manifest records what each one does
 *   to stature and BMI, so a real height and weight are solved for, not
 *   eyeballed. This is what makes the avatar *yours* rather than a preset.
 */
import type { HumanManifest, ShapeWeights } from "./humanRig";

export type FaceShapeId = "oval" | "round" | "square" | "heart" | "long";
export type EyeShapeId = "almond" | "round" | "hooded" | "upturned";

export type HumanShape = {
  /** -1 feminine frame … 0 … +1 masculine frame. */
  frame: number;
  /** Relative stature, units of 12 cm. Ignored when `heightCm` is set. */
  height: number;
  /** Relative volume, units of 7 BMI. Ignored when `weightKg` + a height are set. */
  volume: number;
  /** Girths, units of 9 cm. */
  chest: number;
  waist: number;
  hip: number;
  /** -1 narrow … +1 broad. */
  shoulders: number;
  /** -1 soft … +1 toned. */
  muscle: number;
  /** -1 … +1; only shows on feminine frames. */
  cup: number;
  face: FaceShapeId;
  eyes: EyeShapeId;
  /** Blend of the three facial-feature families; all zero is the even mix. */
  features: [number, number, number];
  heightCm?: number;
  weightKg?: number;
};

export const DEFAULT_HUMAN_SHAPE: HumanShape = {
  frame: 0,
  height: 0,
  volume: 0,
  chest: 0,
  waist: 0,
  hip: 0,
  shoulders: 0,
  muscle: 0,
  cup: 0,
  face: "oval",
  eyes: "almond",
  features: [0, 0, 0],
};

const clamp = (v: number, lo: number, hi: number): number => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0);

/** How far each target may be pushed before the mesh stops looking like a body. */
const LIMIT = { tall: 3, short: 2.6, heavy: 3.5, thin: 1.15, girth: 2, unit: 1 } as const;

const FACE_TARGET: Record<FaceShapeId, string | null> = {
  oval: "FaceOval",
  round: "FaceRound",
  square: "FaceSquare",
  heart: "FaceHeart",
  long: "FaceLong",
};
const EYE_TARGET: Record<EyeShapeId, string | null> = {
  almond: null,
  round: "EyesRound",
  hooded: "EyesHooded",
  upturned: "EyesUpturned",
};

function metricSum(weights: ShapeWeights, manifest: HumanManifest, key: "stature" | "bmi"): number {
  let total = manifest.metrics[key];
  for (const [name, w] of Object.entries(weights)) {
    const t = manifest.targets[name];
    if (t) total += w * t.metrics[key];
  }
  return total;
}

function setPair(w: ShapeWeights, value: number, pos: string, neg: string, limit: number): void {
  const v = clamp(value, -limit, limit);
  if (v > 0) w[pos] = v;
  else if (v < 0) w[neg] = -v;
}

/**
 * Resolve a `HumanShape` into target weights for `HumanRig.setShape`.
 *
 * Order matters: frame, face and build are set first because they move stature
 * and BMI too; height is then solved against what is left, and volume last,
 * because a taller body at the same weight is a thinner one.
 */
export function resolveShapeWeights(shape: HumanShape, manifest: HumanManifest): ShapeWeights {
  const w: ShapeWeights = {};
  const f = clamp(shape.frame, -1, 1);
  if (f !== 0) w.Masculine = f;
  const feminine = (1 - f) / 2;

  const m = clamp(shape.muscle, -1, 1);
  if (m > 0) {
    w.Toned = m;
    if (f !== 0) w.X_Tone = f * m;
  } else if (m < 0) {
    w.Soft = -m;
    if (f !== 0) w.X_Soft = f * -m;
  }

  setPair(w, shape.chest, "ChestLarge", "ChestSmall", LIMIT.girth);
  setPair(w, shape.waist, "WaistWide", "WaistNarrow", LIMIT.girth);
  setPair(w, shape.hip, "HipWide", "HipNarrow", LIMIT.girth);
  setPair(w, shape.shoulders, "ShouldersBroad", "ShouldersNarrow", LIMIT.unit);

  const cup = clamp(shape.cup, -1, 1) * feminine;
  if (cup > 0) w.CupLarge = cup;
  else if (cup < 0) w.CupSmall = -cup;

  const face = FACE_TARGET[shape.face];
  if (face) w[face] = 0.85;
  const eyes = EYE_TARGET[shape.eyes];
  if (eyes) w[eyes] = 1;
  (["FeatA", "FeatB", "FeatC"] as const).forEach((name, i) => {
    const v = clamp(shape.features[i] ?? 0, 0, 1);
    if (v > 0) w[name] = v;
  });

  // -- stature ---------------------------------------------------------------
  const tall = manifest.targets.Tall?.metrics.stature ?? 0.12;
  const short = manifest.targets.Short?.metrics.stature ?? -0.12;
  let h: number;
  if (shape.heightCm && shape.heightCm > 0) {
    const need = shape.heightCm / 100 - metricSum(w, manifest, "stature");
    h = need >= 0 ? need / tall : -need / short;
  } else {
    h = shape.height;
  }
  setPair(w, h, "Tall", "Short", h >= 0 ? LIMIT.tall : LIMIT.short);

  // -- volume ----------------------------------------------------------------
  const gain = (manifest.targets.Heavy?.metrics.bmi ?? 7) + f * (manifest.targets.X_Gain?.metrics.bmi ?? 0);
  const loss = (manifest.targets.Thin?.metrics.bmi ?? -7) + f * (manifest.targets.X_Loss?.metrics.bmi ?? 0);
  let v: number;
  const statureNow = metricSum(w, manifest, "stature");
  if (shape.weightKg && shape.weightKg > 0 && statureNow > 0) {
    const targetBmi = shape.weightKg / (statureNow * statureNow);
    const need = targetBmi - metricSum(w, manifest, "bmi");
    v = need >= 0 ? need / gain : need / -loss;
  } else {
    v = shape.volume;
  }
  if (v > 0) {
    const k = clamp(v, 0, LIMIT.heavy);
    w.Heavy = k;
    if (f !== 0) w.X_Gain = f * k;
  } else if (v < 0) {
    const k = clamp(-v, 0, LIMIT.thin);
    w.Thin = k;
    if (f !== 0) w.X_Loss = f * k;
  }
  return w;
}

/** Stature and BMI the linear model predicts for a set of weights. */
export function predictMetrics(weights: ShapeWeights, manifest: HumanManifest): { statureM: number; bmi: number } {
  return { statureM: metricSum(weights, manifest, "stature"), bmi: metricSum(weights, manifest, "bmi") };
}

export type BodyTypeId = "slim" | "average" | "athletic" | "curvy" | "broad";

/**
 * The five build presets the creator has always offered, as starting points on
 * the real sliders. They replace the fixed radii table the primitive avatar
 * used, and unlike it they compose with frame, height and everything else.
 */
export const BODY_TYPE_PRESETS: Record<BodyTypeId, Partial<HumanShape>> = {
  slim: { volume: -0.45, muscle: 0, chest: -0.2, waist: -0.2, hip: -0.2, shoulders: -0.1 },
  average: { volume: 0, muscle: 0, chest: 0, waist: 0, hip: 0, shoulders: 0 },
  athletic: { volume: -0.05, muscle: 0.8, chest: 0.2, waist: -0.35, hip: -0.1, shoulders: 0.45 },
  curvy: { volume: 0.3, muscle: -0.1, chest: 0.35, waist: -0.35, hip: 0.75, shoulders: 0, cup: 0.5 },
  broad: { volume: 0.35, muscle: 0.25, chest: 0.5, waist: 0.2, hip: 0.1, shoulders: 0.9 },
};
