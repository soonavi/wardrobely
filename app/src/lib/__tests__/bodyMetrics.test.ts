/**
 * Unit tests for src/lib/bodyMetrics.ts — the optional height/weight fields on
 * the profile screen (LAUNCH_CHECKLIST.md §3).
 *
 * Three things are actually at stake, and each has its own block below:
 *
 * 1. A typo produces a sentence, not a broken screen. So the boundaries are
 *    walked exhaustively — at, one below, and one above every limit, in both
 *    unit systems, plus empty/zero/negative/fractional/overflow input.
 *
 * 2. The two unit systems agree. The imperial range is derived from the metric
 *    one, so the dangerous failure is a rounding gap: a value the UI offers in
 *    inches that converts to a metric value the save path rejects. That is
 *    checked as a property over every integer in both ranges, not by sampling.
 *
 * 3. Nothing reaches the avatar silhouette as NaN. `buildWidthScale` is
 *    imported for real here rather than re-implemented, because the NaN path
 *    being guarded is a property of that function, and a copy of it would not
 *    prove anything about the code that actually runs.
 */
import { buildWidthScale } from "../../features/avatar/avatars";
import {
  CM_PER_INCH,
  IMPERIAL_RANGES,
  KG_PER_LB,
  METRIC_RANGES,
  NEUTRAL_WIDTH_SCALE,
  bodyMetricsErrorMessage,
  parseBodyMetrics,
  rangeFor,
  rangeHint,
  safeMetric,
  safeWidthScale,
  toDisplayValue,
  toMetric,
  unitLabel,
  type Units,
} from "../bodyMetrics";

/** Convenience: a value that is always valid, for isolating the other field. */
const OK = {
  metric: { height: "175", weight: "70" },
  imperial: { height: "69", weight: "154" },
} as const;

function parse(height: string, weight: string, units: Units) {
  return parseBodyMetrics(height, weight, units);
}

/** Parse with only the height under test; weight is held valid. */
function parseHeight(height: string, units: Units) {
  return parse(height, OK[units].weight, units);
}

/** Parse with only the weight under test; height is held valid. */
function parseWeight(weight: string, units: Units) {
  return parse(OK[units].height, weight, units);
}

// ---------------------------------------------------------------------------
// Range derivation
// ---------------------------------------------------------------------------

describe("range derivation", () => {
  it("uses the documented metric bounds", () => {
    expect(METRIC_RANGES.height).toEqual({ min: 90, max: 250 });
    expect(METRIC_RANGES.weight).toEqual({ min: 30, max: 300 });
  });

  it("derives the imperial bounds by rounding inward", () => {
    // ceil(90 / 2.54) = 36, floor(250 / 2.54) = 98
    expect(IMPERIAL_RANGES.height).toEqual({ min: 36, max: 98 });
    // ceil(30 / 0.45359237) = 67, floor(300 / 0.45359237) = 661
    expect(IMPERIAL_RANGES.weight).toEqual({ min: 67, max: 661 });
  });

  it("keeps the imperial bounds strictly inside the metric ones", () => {
    expect(IMPERIAL_RANGES.height.min * CM_PER_INCH).toBeGreaterThanOrEqual(
      METRIC_RANGES.height.min
    );
    expect(IMPERIAL_RANGES.height.max * CM_PER_INCH).toBeLessThanOrEqual(
      METRIC_RANGES.height.max
    );
    expect(IMPERIAL_RANGES.weight.min * KG_PER_LB).toBeGreaterThanOrEqual(
      METRIC_RANGES.weight.min
    );
    expect(IMPERIAL_RANGES.weight.max * KG_PER_LB).toBeLessThanOrEqual(
      METRIC_RANGES.weight.max
    );
  });

  it("exposes the right range and unit word per system", () => {
    expect(rangeFor("height", "metric")).toEqual(METRIC_RANGES.height);
    expect(rangeFor("height", "imperial")).toEqual(IMPERIAL_RANGES.height);
    expect(unitLabel("height", "metric")).toBe("cm");
    expect(unitLabel("height", "imperial")).toBe("inches");
    expect(unitLabel("weight", "metric")).toBe("kg");
    expect(unitLabel("weight", "imperial")).toBe("lbs");
  });
});

// ---------------------------------------------------------------------------
// Boundaries — metric
// ---------------------------------------------------------------------------

describe("metric boundaries", () => {
  const h = METRIC_RANGES.height;
  const w = METRIC_RANGES.weight;

  it("accepts height exactly at the minimum and maximum", () => {
    expect(parseHeight(String(h.min), "metric")).toMatchObject({
      ok: true,
      heightCm: 90,
    });
    expect(parseHeight(String(h.max), "metric")).toMatchObject({
      ok: true,
      heightCm: 250,
    });
  });

  it("accepts height just inside both limits", () => {
    expect(parseHeight(String(h.min + 1), "metric").ok).toBe(true);
    expect(parseHeight(String(h.max - 1), "metric").ok).toBe(true);
  });

  it("rejects height one unit outside either limit", () => {
    expect(parseHeight(String(h.min - 1), "metric").ok).toBe(false);
    expect(parseHeight(String(h.max + 1), "metric").ok).toBe(false);
  });

  it("accepts weight exactly at the minimum and maximum", () => {
    expect(parseWeight(String(w.min), "metric")).toMatchObject({
      ok: true,
      weightKg: 30,
    });
    expect(parseWeight(String(w.max), "metric")).toMatchObject({
      ok: true,
      weightKg: 300,
    });
  });

  it("accepts weight just inside both limits", () => {
    expect(parseWeight(String(w.min + 1), "metric").ok).toBe(true);
    expect(parseWeight(String(w.max - 1), "metric").ok).toBe(true);
  });

  it("rejects weight one unit outside either limit", () => {
    expect(parseWeight(String(w.min - 1), "metric").ok).toBe(false);
    expect(parseWeight(String(w.max + 1), "metric").ok).toBe(false);
  });

  it("stores metric input unchanged", () => {
    expect(parse("183", "82", "metric")).toEqual({
      ok: true,
      heightCm: 183,
      weightKg: 82,
    });
  });
});

// ---------------------------------------------------------------------------
// Boundaries — imperial
// ---------------------------------------------------------------------------

describe("imperial boundaries", () => {
  const h = IMPERIAL_RANGES.height;
  const w = IMPERIAL_RANGES.weight;

  it("accepts height exactly at the minimum and maximum", () => {
    expect(parseHeight(String(h.min), "imperial")).toMatchObject({
      ok: true,
      heightCm: 91, // round(36 * 2.54) = round(91.44)
    });
    expect(parseHeight(String(h.max), "imperial")).toMatchObject({
      ok: true,
      heightCm: 249, // round(98 * 2.54) = round(248.92)
    });
  });

  it("accepts height just inside both limits", () => {
    expect(parseHeight(String(h.min + 1), "imperial").ok).toBe(true);
    expect(parseHeight(String(h.max - 1), "imperial").ok).toBe(true);
  });

  it("rejects height one inch outside either limit", () => {
    // 35 in is the rounding trap: it converts to 88.9 -> 89 cm, below the
    // 90 cm floor. Rounding the imperial bound inward is what excludes it.
    expect(parseHeight("35", "imperial").ok).toBe(false);
    expect(parseHeight(String(h.max + 1), "imperial").ok).toBe(false);
  });

  it("accepts weight exactly at the minimum and maximum", () => {
    expect(parseWeight(String(w.min), "imperial")).toMatchObject({
      ok: true,
      weightKg: 30, // round(67 * 0.45359237) = round(30.39)
    });
    expect(parseWeight(String(w.max), "imperial")).toMatchObject({
      ok: true,
      weightKg: 300, // round(661 * 0.45359237) = round(299.82)
    });
  });

  it("accepts weight just inside both limits", () => {
    expect(parseWeight(String(w.min + 1), "imperial").ok).toBe(true);
    expect(parseWeight(String(w.max - 1), "imperial").ok).toBe(true);
  });

  it("rejects weight one pound outside either limit", () => {
    expect(parseWeight(String(w.min - 1), "imperial").ok).toBe(false);
    expect(parseWeight(String(w.max + 1), "imperial").ok).toBe(false);
  });

  it("converts a typical imperial entry to metric", () => {
    // 5'9" = 69 in -> 175.26 -> 175 cm; 154 lb -> 69.85 -> 70 kg
    expect(parse("69", "154", "imperial")).toEqual({
      ok: true,
      heightCm: 175,
      weightKg: 70,
    });
  });
});

// ---------------------------------------------------------------------------
// The rounding invariant, checked over every value in range
// ---------------------------------------------------------------------------

describe("imperial -> metric rounding never escapes the metric range", () => {
  it("holds for every accepted height in inches", () => {
    const escaped: number[] = [];
    for (let i = IMPERIAL_RANGES.height.min; i <= IMPERIAL_RANGES.height.max; i++) {
      const cm = toMetric("height", i, "imperial");
      if (cm < METRIC_RANGES.height.min || cm > METRIC_RANGES.height.max) {
        escaped.push(i);
      }
    }
    expect(escaped).toEqual([]);
  });

  it("holds for every accepted weight in pounds", () => {
    const escaped: number[] = [];
    for (let i = IMPERIAL_RANGES.weight.min; i <= IMPERIAL_RANGES.weight.max; i++) {
      const kg = toMetric("weight", i, "imperial");
      if (kg < METRIC_RANGES.weight.min || kg > METRIC_RANGES.weight.max) {
        escaped.push(i);
      }
    }
    expect(escaped).toEqual([]);
  });

  it("never displays a stored value the save path would reject", () => {
    // The bug this guards: a stored 90 cm shows as 35 in, which fails
    // validation the moment the user taps Save without touching anything.
    const rejected: string[] = [];
    for (let cm = METRIC_RANGES.height.min; cm <= METRIC_RANGES.height.max; cm++) {
      for (const units of ["metric", "imperial"] as const) {
        const shown = String(toDisplayValue("height", cm, units));
        if (!parseHeight(shown, units).ok) rejected.push(`${cm}cm/${units}`);
      }
    }
    for (let kg = METRIC_RANGES.weight.min; kg <= METRIC_RANGES.weight.max; kg++) {
      for (const units of ["metric", "imperial"] as const) {
        const shown = String(toDisplayValue("weight", kg, units));
        if (!parseWeight(shown, units).ok) rejected.push(`${kg}kg/${units}`);
      }
    }
    expect(rejected).toEqual([]);
  });

  it("clamps an out-of-range stored value into the displayable range", () => {
    expect(toDisplayValue("height", 90, "imperial")).toBe(36); // not 35
    expect(toDisplayValue("height", 10_000, "metric")).toBe(250);
    expect(toDisplayValue("weight", 1, "metric")).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// Empty, zero, and malformed input
// ---------------------------------------------------------------------------

describe("empty and zero input", () => {
  it.each(["metric", "imperial"] as const)("rejects both empty (%s)", (units) => {
    const result = parse("", "", units);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Both fields reported at once, so the user is not stopped twice.
    expect(result.issues).toHaveLength(2);
    expect(result.issues.map((i) => i.field)).toEqual(["height", "weight"]);
  });

  it.each(["metric", "imperial"] as const)(
    "rejects whitespace-only input (%s)",
    (units) => {
      expect(parseHeight("   ", units).ok).toBe(false);
      expect(parseWeight("\t", units).ok).toBe(false);
    }
  );

  it.each(["metric", "imperial"] as const)("rejects zero (%s)", (units) => {
    expect(parseHeight("0", units).ok).toBe(false);
    expect(parseWeight("0", units).ok).toBe(false);
    expect(parseHeight("000", units).ok).toBe(false);
  });

  it("reports only the field that is wrong", () => {
    const result = parseWeight("", "metric");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].field).toBe("weight");
  });
});

describe("malformed input", () => {
  const bad = [
    "-5", // negative — the only input that can make buildWidthScale NaN
    "-175",
    "5.5", // fractional
    "175.0",
    "1e3", // exponent notation
    "0x10", // hex
    "abc",
    "68cm", // value with a unit stuck on
    "68 70", // two numbers
    "+68",
    " 68 70 ",
    "١٧٥", // non-ASCII digits
    "Infinity",
    "NaN",
  ];

  it.each(bad)("rejects %p as a height in both systems", (input) => {
    expect(parseHeight(input, "metric").ok).toBe(false);
    expect(parseHeight(input, "imperial").ok).toBe(false);
  });

  it.each(bad)("rejects %p as a weight in both systems", (input) => {
    expect(parseWeight(input, "metric").ok).toBe(false);
    expect(parseWeight(input, "imperial").ok).toBe(false);
  });

  it("tolerates surrounding whitespace on an otherwise valid value", () => {
    expect(parse("  175  ", " 70 ", "metric")).toEqual({
      ok: true,
      heightCm: 175,
      weightKg: 70,
    });
  });

  it("accepts leading zeros", () => {
    expect(parse("0175", "070", "metric")).toEqual({
      ok: true,
      heightCm: 175,
      weightKg: 70,
    });
  });

  it("rejects absurdly large values without overflowing", () => {
    for (const units of ["metric", "imperial"] as const) {
      expect(parseHeight("99999", units).ok).toBe(false);
      expect(parseWeight("99999", units).ok).toBe(false);
      // Long enough that parseInt saturates to Infinity.
      const huge = "9".repeat(400);
      expect(parseHeight(huge, units).ok).toBe(false);
      expect(parseWeight(huge, units).ok).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Message quality
// ---------------------------------------------------------------------------

describe("error messages", () => {
  it("names the accepted range in the units on screen", () => {
    const metric = parseHeight("300", "metric");
    expect(metric.ok).toBe(false);
    if (!metric.ok) {
      expect(metric.issues[0].message).toBe(
        "Height should be between 90 and 250 cm."
      );
    }

    const imperial = parseHeight("120", "imperial");
    expect(imperial.ok).toBe(false);
    if (!imperial.ok) {
      expect(imperial.issues[0].message).toBe(
        "Height should be between 36 and 98 inches."
      );
    }

    const lbs = parseWeight("900", "imperial");
    expect(lbs.ok).toBe(false);
    if (!lbs.ok) {
      expect(lbs.issues[0].message).toBe(
        "Weight should be between 67 and 661 lbs."
      );
    }
  });

  it("distinguishes a non-number from an out-of-range number", () => {
    const notANumber = parseHeight("tall", "metric");
    if (!notANumber.ok) {
      expect(notANumber.issues[0].message).toBe(
        "Height should be a whole number in cm."
      );
    }
    const empty = parseWeight("", "imperial");
    if (!empty.ok) {
      expect(empty.issues[0].message).toBe("Enter your weight in lbs.");
    }
  });

  it("joins both issues into one line for the screen", () => {
    const result = parse("2", "2", "metric");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(bodyMetricsErrorMessage(result.issues)).toBe(
      "Height should be between 90 and 250 cm. Weight should be between 30 and 300 kg."
    );
  });

  it("stays non-judgemental — MARKETING_STRATEGY.md §11", () => {
    // Every message the module can produce, collected by brute force.
    const messages = new Set<string>();
    for (const units of ["metric", "imperial"] as const) {
      for (const v of ["", "  ", "0", "-1", "1.5", "abc", "1", "99999"]) {
        const a = parseHeight(v, units);
        if (!a.ok) a.issues.forEach((i) => messages.add(i.message));
        const b = parseWeight(v, units);
        if (!b.ok) b.issues.forEach((i) => messages.add(i.message));
      }
      messages.add(rangeHint(units));
    }
    expect(messages.size).toBeGreaterThan(0);

    // Language that grades the body rather than the input.
    const forbidden = [
      "too heavy",
      "too light",
      "too tall",
      "too short",
      "overweight",
      "underweight",
      "obese",
      "unhealthy",
      "normal",
      "ideal",
      "realistic",
      "believable",
      "impossible",
      "invalid",
    ];
    for (const message of messages) {
      const lower = message.toLowerCase();
      for (const word of forbidden) {
        expect(lower).not.toContain(word);
      }
    }
  });

  it("gives a hint that matches the range actually enforced", () => {
    expect(rangeHint("metric")).toContain("90–250 cm");
    expect(rangeHint("metric")).toContain("30–300 kg");
    expect(rangeHint("imperial")).toContain("36–98");
    expect(rangeHint("imperial")).toContain("67–661 lbs");
  });
});

// ---------------------------------------------------------------------------
// The silhouette can never be handed a NaN
// ---------------------------------------------------------------------------

describe("safeMetric", () => {
  it("passes through a usable number", () => {
    expect(safeMetric(175)).toBe(175);
    expect(safeMetric(0.5)).toBe(0.5);
  });

  it.each([null, undefined, 0, -0, -1, -175, NaN, Infinity, -Infinity])(
    "nulls out %p",
    (value) => {
      expect(safeMetric(value as number | null | undefined)).toBeNull();
    }
  );

  it("nulls out a non-number that slipped through the type system", () => {
    expect(safeMetric("175" as unknown as number)).toBeNull();
  });
});

describe("safeWidthScale", () => {
  it("passes a finite scale through untouched", () => {
    expect(safeWidthScale(0.85)).toBe(0.85);
    expect(safeWidthScale(1.25)).toBe(1.25);
  });

  it.each([NaN, Infinity, -Infinity])("falls back to neutral for %p", (v) => {
    expect(safeWidthScale(v)).toBe(NEUTRAL_WIDTH_SCALE);
  });
});

describe("buildWidthScale is never handed something that makes it NaN", () => {
  // The real function, not a copy — this is the contract being relied on.
  it("already returns neutral for absent values", () => {
    expect(buildWidthScale(null, null)).toBe(1);
    expect(buildWidthScale(undefined, undefined)).toBe(1);
    expect(buildWidthScale(175, null)).toBe(1);
    expect(buildWidthScale(null, 70)).toBe(1);
  });

  it("produces NaN for a negative weight — which is why sanitising matters", () => {
    // Documents the latent hazard in features/avatar/avatars.tsx: a negative
    // weight makes bmi negative, Math.sqrt of it NaN, and both clamps pass
    // NaN straight through. Nothing writes a negative today, but the column
    // is a plain nullable number. If this ever starts failing because
    // buildWidthScale grew its own guard, delete this test — do not "fix" it
    // by loosening the sanitising in ProfileScreen.
    expect(Number.isNaN(buildWidthScale(175, -70))).toBe(true);
  });

  it("is finite and in range for every hostile input once sanitised", () => {
    const hostile: (number | null | undefined)[] = [
      null,
      undefined,
      0,
      -0,
      1,
      -1,
      -70,
      -175,
      NaN,
      Infinity,
      -Infinity,
      0.0001,
      90,
      175,
      250,
      300,
      99999,
      Number.MAX_SAFE_INTEGER,
      Number.MIN_SAFE_INTEGER,
    ];

    const bad: string[] = [];
    for (const h of hostile) {
      for (const w of hostile) {
        // Exactly what ProfileScreen does.
        const scale = safeWidthScale(buildWidthScale(safeMetric(h), safeMetric(w)));
        if (!Number.isFinite(scale) || scale < 0.85 || scale > 1.25) {
          bad.push(`h=${String(h)} w=${String(w)} -> ${scale}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("still scales normally for real measurements", () => {
    // Sanitising must not flatten every user to the neutral silhouette.
    const light = safeWidthScale(buildWidthScale(safeMetric(180), safeMetric(55)));
    const heavy = safeWidthScale(buildWidthScale(safeMetric(180), safeMetric(110)));
    expect(light).toBeLessThan(1);
    expect(heavy).toBeGreaterThan(1);
    expect(light).toBeLessThan(heavy);
  });
});

// ---------------------------------------------------------------------------
// Unit toggling
// ---------------------------------------------------------------------------

describe("switching units mid-edit", () => {
  it("round-trips a value through the other system and back", () => {
    // What ProfileScreen's convertInputsToUnits does, twice.
    const startCm = 175;
    const inches = toDisplayValue("height", startCm, "imperial");
    const backToCm = toDisplayValue(
      "height",
      toMetric("height", inches, "imperial"),
      "metric"
    );
    expect(Math.abs(backToCm - startCm)).toBeLessThanOrEqual(1);
  });

  it("keeps every in-range value saveable across a toggle", () => {
    const broken: number[] = [];
    for (let cm = METRIC_RANGES.height.min; cm <= METRIC_RANGES.height.max; cm++) {
      const inches = toDisplayValue("height", cm, "imperial");
      if (!parseHeight(String(inches), "imperial").ok) broken.push(cm);
    }
    expect(broken).toEqual([]);
  });
});
