/**
 * Unit tests for src/features/avatar3d/bodyModel.ts — the measurement ->
 * shape calibration and the unit helpers around it.
 *
 * The four numbered "Example" blocks below are the hand-worked traces from
 * `bodyModel.test-notes.md`, converted into real assertions. That doc existed
 * because there was no test runner; now there is, so these are the executable
 * version and the doc is the commentary.
 *
 * Beyond reproducing the traces, the properties asserted here are the ones the
 * module's header promises and that a retune of the calibration constants must
 * not break: monotonicity (taller in -> taller shape), clamping to -1..1, and
 * the chest/hip axes carrying information *beyond* height+BMI rather than
 * restating it.
 */
import {
  MEASUREMENT_RANGES,
  cmToInches,
  computeBmi,
  estimateMeasurements,
  formatHeight,
  formatWeightLb,
  inchesToCm,
  kgToLb,
  lbToKg,
  measurementsToShapeParams,
  validateMeasurements,
} from "../bodyModel";
import type { Measurements } from "../bodyModel";

// ---------------------------------------------------------------------------
// Unit conversion helpers
// ---------------------------------------------------------------------------

describe("cm <-> inch conversion", () => {
  it("uses the exact 2.54 cm/inch definition", () => {
    expect(inchesToCm(1)).toBe(2.54);
    expect(cmToInches(2.54)).toBe(1);
    expect(inchesToCm(12)).toBeCloseTo(30.48, 10);
    expect(cmToInches(100)).toBeCloseTo(39.3700787, 6);
  });

  it("round-trips without drift", () => {
    for (const cm of [150, 160, 168, 173, 190, 220]) {
      expect(cmToInches(inchesToCm(cmToInches(cm)))).toBeCloseTo(cmToInches(cm), 10);
      expect(inchesToCm(cmToInches(cm))).toBeCloseTo(cm, 10);
    }
  });

  it("maps zero to zero and is sign-preserving", () => {
    expect(cmToInches(0)).toBe(0);
    expect(inchesToCm(0)).toBe(0);
    expect(cmToInches(-10)).toBeLessThan(0);
  });
});

describe("kg <-> lb conversion", () => {
  it("uses the exact international-pound definition (0.45359237 kg)", () => {
    expect(lbToKg(1)).toBe(0.45359237);
    expect(kgToLb(0.45359237)).toBe(1);
  });

  it("converts the familiar reference points", () => {
    expect(kgToLb(68)).toBeCloseTo(149.914, 3);
    expect(kgToLb(100)).toBeCloseTo(220.462, 3);
    expect(lbToKg(150)).toBeCloseTo(68.039, 3);
  });

  it("round-trips without drift", () => {
    for (const kg of [30, 45, 62, 68, 100, 200]) {
      expect(lbToKg(kgToLb(kg))).toBeCloseTo(kg, 10);
    }
  });
});

describe("formatHeight", () => {
  // The doc comment's own example.
  it("renders 173cm as 5'8\"", () => {
    expect(formatHeight(173)).toBe(`5'8"`);
  });

  it("renders the range endpoints sensibly", () => {
    expect(formatHeight(152.4)).toBe(`5'0"`); // exactly 60 inches
    expect(formatHeight(182.88)).toBe(`6'0"`); // exactly 72 inches
    expect(formatHeight(168)).toBe(`5'6"`); // 66.14in -> 66in
  });

  // Rounding happens on TOTAL inches before the divmod, so 11.5in worth of
  // remainder must roll over into the next foot rather than printing 5'12".
  it("never prints twelve inches", () => {
    for (let cm = 130; cm <= 220; cm += 0.25) {
      const formatted = formatHeight(cm);
      const inches = Number(formatted.split("'")[1].replace('"', ""));
      expect(inches).toBeGreaterThanOrEqual(0);
      expect(inches).toBeLessThanOrEqual(11);
    }
  });

  it("is monotonic across the input range", () => {
    let previousTotalInches = -1;
    for (let cm = 130; cm <= 220; cm += 1) {
      const [feet, rest] = formatHeight(cm).split("'");
      const total = Number(feet) * 12 + Number(rest.replace('"', ""));
      expect(total).toBeGreaterThanOrEqual(previousTotalInches);
      previousTotalInches = total;
    }
  });
});

describe("formatWeightLb", () => {
  it("renders 68kg as 150 lb", () => {
    expect(formatWeightLb(68)).toBe("150 lb");
  });

  it("rounds to whole pounds and keeps the unit suffix", () => {
    expect(formatWeightLb(100)).toBe("220 lb");
    expect(formatWeightLb(45)).toBe("99 lb");
    expect(formatWeightLb(0)).toBe("0 lb");
  });
});

// ---------------------------------------------------------------------------
// computeBmi
// ---------------------------------------------------------------------------

describe("computeBmi", () => {
  it("is weight(kg) / height(m)^2", () => {
    expect(computeBmi(168, 62)).toBeCloseTo(21.97, 2);
    expect(computeBmi(190, 100)).toBeCloseTo(27.7, 2);
    expect(computeBmi(150, 45)).toBeCloseTo(20.0, 6);
    expect(computeBmi(160, 58)).toBeCloseTo(22.66, 2);
  });

  // Guarded, not thrown: a half-entered form must not produce Infinity and
  // then a NaN shape vector persisted to avatars.shape_params.
  it("does not divide by zero on a zero or negative height", () => {
    expect(Number.isFinite(computeBmi(0, 70))).toBe(true);
    expect(Number.isFinite(computeBmi(-50, 70))).toBe(true);
    // Height clamps to 1cm = 0.01m, so BMI is huge but finite.
    expect(computeBmi(0, 70)).toBe(computeBmi(1, 70));
  });
});

// ---------------------------------------------------------------------------
// measurementsToShapeParams — the worked examples from bodyModel.test-notes.md
// ---------------------------------------------------------------------------

describe("measurementsToShapeParams — worked examples", () => {
  // Example 1: "population average," no tape measurements.
  it("Example 1: 168cm / 62kg lands essentially at the neutral shape", () => {
    const shape = measurementsToShapeParams({ heightCm: 168, weightKg: 62 });

    expect(shape.height).toBe(0);
    // bmi 21.97 -> volume -0.0047: essentially neutral, and confirms 168cm +
    // BMI 22 really is the zero point rather than only being documented as one.
    expect(Math.abs(shape.volume)).toBeLessThan(0.01);
    expect(shape.volume).toBeLessThan(0); // marginally below the BMI 22 midpoint
    expect(shape.chest).toBe(0);
    expect(shape.hip).toBe(0);
  });

  // Example 2: tall + heavier, with tape measurements diverging from the BMI
  // prediction in OPPOSITE directions — the whole reason chest/hip are their
  // own axes rather than being folded into volume.
  it("Example 2: 190cm / 100kg / chest 112 / hip 108", () => {
    const shape = measurementsToShapeParams({
      heightCm: 190,
      weightKg: 100,
      chestCm: 112,
      hipCm: 108,
    });

    expect(shape.height).toBe(1); // raw 1.83, clamped
    expect(shape.volume).toBeCloseTo(0.81, 2);
    expect(shape.chest).toBeCloseTo(0.77, 2);
    expect(shape.hip).toBeCloseTo(-0.65, 2);

    // Fuller through the chest, leaner through the hips, at the same overall
    // size: the axes must be able to disagree in sign.
    expect(shape.chest).toBeGreaterThan(0);
    expect(shape.hip).toBeLessThan(0);
  });

  // Example 3: short + light, no tape measurements.
  it("Example 3: 150cm / 45kg clamps height at -1 without saturating volume", () => {
    const shape = measurementsToShapeParams({ heightCm: 150, weightKg: 45 });

    expect(shape.height).toBe(-1); // raw -1.50, clamped
    expect(shape.volume).toBeCloseTo(-0.29, 2);
    expect(shape.volume).toBeGreaterThan(-1); // BMI 20 is well inside "normal"
    expect(shape.chest).toBe(0);
    expect(shape.hip).toBe(0);
  });

  // Example 4: hip swings to its extreme while volume stays near neutral.
  it("Example 4: 160cm / 58kg / hip 100 pushes hip to +1 on a near-neutral volume", () => {
    const shape = measurementsToShapeParams({
      heightCm: 160,
      weightKg: 58,
      hipCm: 100,
    });

    expect(shape.height).toBeCloseTo(-0.67, 2);
    expect(shape.volume).toBeCloseTo(0.09, 2);
    expect(shape.chest).toBe(0); // omitted
    expect(shape.hip).toBe(1); // raw 1.06, clamped

    // The point of the example: hip reaches its extreme even though the
    // overall build is barely above average.
    expect(Math.abs(shape.volume)).toBeLessThan(0.2);
  });
});

describe("measurementsToShapeParams — properties", () => {
  const AVERAGE: Measurements = { heightCm: 168, weightKg: 62 };

  it("clamps every axis to -1..1 for absurd input", () => {
    const extremes: Measurements[] = [
      { heightCm: 300, weightKg: 400, chestCm: 400, hipCm: 400 },
      { heightCm: 1, weightKg: 1, chestCm: 1, hipCm: 1 },
      { heightCm: 220, weightKg: 30, chestCm: 60, hipCm: 170 },
    ];

    for (const m of extremes) {
      const shape = measurementsToShapeParams(m);
      for (const axis of ["height", "volume", "chest", "hip"] as const) {
        expect(shape[axis]).toBeGreaterThanOrEqual(-1);
        expect(shape[axis]).toBeLessThanOrEqual(1);
        expect(Number.isFinite(shape[axis])).toBe(true);
      }
    }
  });

  it("is monotonic in height", () => {
    let previous = -Infinity;
    for (let heightCm = 156; heightCm <= 180; heightCm += 2) {
      const { height } = measurementsToShapeParams({ heightCm, weightKg: 62 });
      expect(height).toBeGreaterThan(previous);
      previous = height;
    }
  });

  it("is monotonic in weight at a fixed height (below the clamp)", () => {
    let previous = -Infinity;
    // Stops at 80kg: at 168cm that is BMI 28.3 -> volume 0.91, and ~85kg
    // saturates the axis at +1, where monotonicity legitimately stops.
    for (let weightKg = 45; weightKg <= 80; weightKg += 5) {
      const { volume } = measurementsToShapeParams({ heightCm: 168, weightKg });
      expect(volume).toBeGreaterThan(previous);
      previous = volume;
    }
  });

  // volume comes from BMI, not raw weight, specifically so build — not size —
  // drives it. A 150cm/45kg person and a 190cm/72.2kg person are both BMI 20.
  it("gives the same volume to two people of the same build at different sizes", () => {
    const short = measurementsToShapeParams({ heightCm: 150, weightKg: 45 }); // BMI 20
    const tall = measurementsToShapeParams({ heightCm: 190, weightKg: 72.2 }); // BMI 20

    expect(tall.volume).toBeCloseTo(short.volume, 2);
    // ...while still reading as very different heights.
    expect(tall.height).toBeGreaterThan(short.height + 1.5);
  });

  // Feeding the height+BMI estimate back in as a "measurement" would
  // double-count the same signal the height/volume axes already encode, so an
  // omitted tape measurement means a neutral axis, NOT a derived one.
  it("leaves chest/hip neutral when the tape measurements are omitted", () => {
    const shape = measurementsToShapeParams({ heightCm: 190, weightKg: 100 });
    expect(shape.chest).toBe(0);
    expect(shape.hip).toBe(0);
    // ...even though volume is strongly positive for the same person.
    expect(shape.volume).toBeGreaterThan(0.5);
  });

  it("puts a supplied measurement equal to the estimate at exactly 0", () => {
    const estimated = estimateMeasurements(AVERAGE);
    const shape = measurementsToShapeParams({
      ...AVERAGE,
      chestCm: estimated.chestCm,
      hipCm: estimated.hipCm,
    });

    expect(shape.chest).toBeCloseTo(0, 10);
    expect(shape.hip).toBeCloseTo(0, 10);
  });

  it("moves chest and hip independently of each other", () => {
    const base = { heightCm: 170, weightKg: 65 };
    const est = estimateMeasurements(base);

    const fullerChest = measurementsToShapeParams({
      ...base,
      chestCm: est.chestCm + 4.5,
      hipCm: est.hipCm,
    });

    expect(fullerChest.chest).toBeCloseTo(0.5, 6);
    expect(fullerChest.hip).toBeCloseTo(0, 10);
  });
});

// ---------------------------------------------------------------------------
// estimateMeasurements
// ---------------------------------------------------------------------------

describe("estimateMeasurements", () => {
  // The figures the ratio constants were sanity-checked against, quoted in
  // bodyModel.test-notes.md's closing section for Example 1's input.
  it("produces plausible average-adult circumferences at 168cm / 62kg", () => {
    const est = estimateMeasurements({ heightCm: 168, weightKg: 62 });

    // Tolerance is 0.05cm; the notes doc quotes these to 2dp.
    expect(est.chestCm).toBeCloseTo(87.32, 1);
    expect(est.waistCm).toBeCloseTo(78.91, 1);
    expect(est.hipCm).toBeCloseTo(94.04, 1);
    expect(est.inseamCm).toBeCloseTo(75.6, 6); // pure ratio, no BMI term
  });

  it("flags every field it had to estimate", () => {
    const est = estimateMeasurements({ heightCm: 168, weightKg: 62 });
    expect(est.estimated).toEqual({
      chest: true,
      waist: true,
      hip: true,
      inseam: true,
    });
  });

  it("passes supplied values through untouched and marks them as measured", () => {
    const est = estimateMeasurements({
      heightCm: 168,
      weightKg: 62,
      chestCm: 101,
      inseamCm: 80,
    });

    expect(est.chestCm).toBe(101);
    expect(est.inseamCm).toBe(80);
    expect(est.estimated.chest).toBe(false);
    expect(est.estimated.inseam).toBe(false);
    // The two that weren't supplied are still estimated.
    expect(est.estimated.waist).toBe(true);
    expect(est.estimated.hip).toBe(true);
    expect(est.waistCm).toBeCloseTo(78.91, 1);
  });

  it("keeps hip > chest > waist at the reference body, as the ratios intend", () => {
    const est = estimateMeasurements({ heightCm: 168, weightKg: 62 });
    expect(est.hipCm).toBeGreaterThan(est.chestCm);
    expect(est.chestCm).toBeGreaterThan(est.waistCm);
  });

  // Waist responds most to adiposity, hip and chest less so, and inseam is
  // leg length so it must not track BMI at all.
  it("moves waist more than hip more than chest as BMI rises, and leaves inseam alone", () => {
    const lean = estimateMeasurements({ heightCm: 170, weightKg: 60 });
    const heavier = estimateMeasurements({ heightCm: 170, weightKg: 90 });

    const dWaist = heavier.waistCm - lean.waistCm;
    const dHip = heavier.hipCm - lean.hipCm;
    const dChest = heavier.chestCm - lean.chestCm;

    expect(dWaist).toBeGreaterThan(dHip);
    expect(dHip).toBeGreaterThan(dChest);
    expect(dChest).toBeGreaterThan(0);
    expect(heavier.inseamCm).toBe(lean.inseamCm);
  });
});

// ---------------------------------------------------------------------------
// validateMeasurements
// ---------------------------------------------------------------------------

describe("validateMeasurements", () => {
  it("accepts a body inside every range", () => {
    expect(validateMeasurements({ heightCm: 168, weightKg: 62 })).toEqual([]);
    expect(
      validateMeasurements({
        heightCm: 168,
        weightKg: 62,
        chestCm: 92,
        waistCm: 80,
        hipCm: 96,
        inseamCm: 76,
      })
    ).toEqual([]);
  });

  it("accepts the exact range endpoints (inclusive bounds)", () => {
    expect(
      validateMeasurements({
        heightCm: MEASUREMENT_RANGES.heightCm.min,
        weightKg: MEASUREMENT_RANGES.weightKg.min,
      })
    ).toEqual([]);
    expect(
      validateMeasurements({
        heightCm: MEASUREMENT_RANGES.heightCm.max,
        weightKg: MEASUREMENT_RANGES.weightKg.max,
      })
    ).toEqual([]);
  });

  // The typo this range exists to catch: 68 *inches* typed into a cm field.
  it("rejects a height entered in inches", () => {
    const errors = validateMeasurements({ heightCm: 68, weightKg: 62 });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/Height/);
    expect(errors[0]).toContain("130");
    expect(errors[0]).toContain("220");
  });

  it("rejects a weight entered in pounds", () => {
    const errors = validateMeasurements({ heightCm: 168, weightKg: 220 });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/Weight/);
  });

  it("reports every failing field at once rather than stopping at the first", () => {
    const errors = validateMeasurements({
      heightCm: 10,
      weightKg: 1000,
      chestCm: 5,
      waistCm: 5,
      hipCm: 5,
      inseamCm: 5,
    });
    expect(errors).toHaveLength(6);
  });

  it("ignores optional fields that were not supplied", () => {
    expect(validateMeasurements({ heightCm: 168, weightKg: 62 })).toEqual([]);
    expect(
      validateMeasurements({ heightCm: 168, weightKg: 62, chestCm: undefined })
    ).toEqual([]);
  });

  it("rejects non-finite values rather than letting NaN through as 'in range'", () => {
    expect(
      validateMeasurements({ heightCm: Number.NaN, weightKg: 62 })
    ).toHaveLength(1);
    expect(
      validateMeasurements({ heightCm: 168, weightKg: Number.POSITIVE_INFINITY })
    ).toHaveLength(1);
    expect(
      validateMeasurements({ heightCm: 168, weightKg: 62, hipCm: Number.NaN })
    ).toHaveLength(1);
  });

  it("keeps every range low < high and plausible", () => {
    for (const range of Object.values(MEASUREMENT_RANGES)) {
      expect(range.min).toBeLessThan(range.max);
      expect(range.min).toBeGreaterThan(0);
    }
  });
});
