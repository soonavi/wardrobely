import {
  ALL_AXES,
  AXES_BY_CATEGORY,
  axesFor,
  axisLabel,
  describeMeasurement,
  estimateGarmentMeasurements,
  measurementSetFromUser,
  summarizeMeasurements,
  type GarmentCategory,
  type MeasurementSet,
} from "../garmentMeasurements";

const CATEGORIES: GarmentCategory[] = [
  "top",
  "bottom",
  "dress",
  "outerwear",
  "shoes",
  "accessory",
];

/** The calibration reference the estimation table is built around. */
const REFERENCE = { heightCm: 170, weightKg: 63.6 }; // BMI ~22.0

describe("axesFor", () => {
  it("gives every category at least one axis", () => {
    for (const category of CATEGORIES) {
      expect(axesFor(category).length).toBeGreaterThan(0);
    }
  });

  it("never returns an axis outside the known set", () => {
    for (const category of CATEGORIES) {
      for (const axis of axesFor(category)) {
        expect(ALL_AXES).toContain(axis);
      }
    }
  });

  it("does not give shoes a waist", () => {
    // The specific nonsense this table exists to prevent: a form field the
    // user can only answer by inventing a number.
    expect(axesFor("shoes")).toEqual(["length"]);
    expect(axesFor("shoes")).not.toContain("waist");
  });

  it("gives bottoms an inseam and tops none", () => {
    expect(axesFor("bottom")).toContain("inseam");
    expect(axesFor("top")).not.toContain("inseam");
  });

  it("gives a dress the union of top and bottom girths", () => {
    const dress = axesFor("dress");
    expect(dress).toContain("chest");
    expect(dress).toContain("waist");
    expect(dress).toContain("hip");
  });
});

describe("axisLabel", () => {
  it("calls shoe length an insole length", () => {
    expect(axisLabel("length", "shoes")).toBe("Insole length");
  });

  it("distinguishes garment length from accessory length", () => {
    expect(axisLabel("length", "top")).toBe("Garment length");
    expect(axisLabel("length", "accessory")).toBe("Length");
  });

  it("labels every axis of every category without throwing", () => {
    for (const category of CATEGORIES) {
      for (const axis of axesFor(category)) {
        const label = axisLabel(axis, category);
        expect(typeof label).toBe("string");
        expect(label.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("estimateGarmentMeasurements", () => {
  it("always reports itself as an estimate", () => {
    // The core guarantee: there is no argument combination that launders a
    // guess into a measurement.
    for (const category of CATEGORIES) {
      expect(estimateGarmentMeasurements(category, REFERENCE).source).toBe("estimated");
      expect(estimateGarmentMeasurements(category, {}).source).toBe("estimated");
      expect(
        estimateGarmentMeasurements(category, { heightCm: null, weightKg: null }).source,
      ).toBe("estimated");
    }
  });

  it("only fills axes the category actually has", () => {
    for (const category of CATEGORIES) {
      const { values } = estimateGarmentMeasurements(category, REFERENCE);
      const allowed = new Set(axesFor(category));
      for (const axis of Object.keys(values)) {
        expect(allowed.has(axis as never)).toBe(true);
      }
    }
  });

  it("produces whole centimetres, because the column is a smallint", () => {
    for (const category of CATEGORIES) {
      const { values } = estimateGarmentMeasurements(category, REFERENCE);
      for (const value of Object.values(values)) {
        expect(Number.isInteger(value)).toBe(true);
      }
    }
  });

  it("stays inside the range 008's constraint permits", () => {
    // A produced value outside 1..400 would be rejected at write time, turning
    // an estimate into a save failure.
    const extremes = [
      { heightCm: 90, weightKg: 30 },
      { heightCm: 250, weightKg: 300 },
      { heightCm: 250, weightKg: 30 },
      { heightCm: 90, weightKg: 300 },
    ];
    for (const category of CATEGORIES) {
      for (const wearer of extremes) {
        const { values } = estimateGarmentMeasurements(category, wearer);
        for (const value of Object.values(values)) {
          expect(value).toBeGreaterThanOrEqual(1);
          expect(value).toBeLessThanOrEqual(400);
        }
      }
    }
  });

  it("falls back to the reference build when the wearer is unknown", () => {
    const known = estimateGarmentMeasurements("top", REFERENCE);
    const unknown = estimateGarmentMeasurements("top", {});
    // Not asserting equality of every axis — asserting the fallback produces a
    // usable set rather than an empty one.
    expect(Object.keys(unknown.values).length).toBe(Object.keys(known.values).length);
  });

  it("scales vertical axes with height", () => {
    const short = estimateGarmentMeasurements("bottom", { heightCm: 150, weightKg: 50 });
    const tall = estimateGarmentMeasurements("bottom", { heightCm: 195, weightKg: 85 });
    expect(tall.values.inseam!).toBeGreaterThan(short.values.inseam!);
    expect(tall.values.length!).toBeGreaterThan(short.values.length!);
  });

  it("widens the waist more than the hip as BMI rises", () => {
    // The per-axis damping is what stops a heavier estimate reading as a
    // uniformly scaled-up person. If these sensitivities were equal this test
    // would fail, which is the point.
    const lean = estimateGarmentMeasurements("dress", { heightCm: 170, weightKg: 55 });
    const heavy = estimateGarmentMeasurements("dress", { heightCm: 170, weightKg: 95 });

    const waistDelta = heavy.values.waist! - lean.values.waist!;
    const hipDelta = heavy.values.hip! - lean.values.hip!;

    expect(waistDelta).toBeGreaterThan(0);
    expect(hipDelta).toBeGreaterThan(0);
    expect(waistDelta).toBeGreaterThan(hipDelta);
  });

  it("cuts outerwear with more ease than a bottom", () => {
    // Outerwear is worn over other layers; estimating it at body girth would
    // recommend a coat that will not close.
    const coat = estimateGarmentMeasurements("outerwear", REFERENCE);
    const top = estimateGarmentMeasurements("top", REFERENCE);
    expect(coat.values.chest!).toBeGreaterThan(top.values.chest!);
  });

  it("lands the reference wearer in a believable place", () => {
    // Guards the calibration itself. A 170cm / BMI 22 wearer in a t-shirt
    // should get a chest in the high 90s, not 60 and not 140.
    const top = estimateGarmentMeasurements("top", REFERENCE);
    expect(top.values.chest!).toBeGreaterThan(90);
    expect(top.values.chest!).toBeLessThan(110);

    const shoes = estimateGarmentMeasurements("shoes", REFERENCE);
    expect(shoes.values.length!).toBeGreaterThan(23);
    expect(shoes.values.length!).toBeLessThan(29);
  });

  it("treats zero and negative wearer metrics as unknown, not as zero", () => {
    // A 0cm wearer must not produce a 0cm garment — that would violate the
    // constraint and, worse, look like a real measurement of nothing.
    const zeroed = estimateGarmentMeasurements("top", { heightCm: 0, weightKg: 0 });
    for (const value of Object.values(zeroed.values)) {
      expect(value).toBeGreaterThan(0);
    }
  });
});

describe("measurementSetFromUser", () => {
  it("returns null when nothing usable was entered", () => {
    // Returning an empty set with a source would be rejected by 008's
    // source/value invariant, turning a form problem into a database error.
    expect(measurementSetFromUser("top", {})).toBeNull();
    expect(measurementSetFromUser("top", { chest: 0 })).toBeNull();
    expect(measurementSetFromUser("top", { chest: -5 })).toBeNull();
    expect(measurementSetFromUser("top", { chest: Number.NaN })).toBeNull();
    expect(measurementSetFromUser("top", { chest: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it("drops axes that do not belong to the category", () => {
    const set = measurementSetFromUser("shoes", { length: 27, waist: 80 });
    expect(set).not.toBeNull();
    expect(set!.values.length).toBe(27);
    expect(set!.values.waist).toBeUndefined();
  });

  it("returns null when every entered axis was dropped", () => {
    // Only a waist, on a shoe. Nothing survives the filter, so there is no set.
    expect(measurementSetFromUser("shoes", { waist: 80 })).toBeNull();
  });

  it("marks the set as user-sourced by default", () => {
    expect(measurementSetFromUser("top", { chest: 100 })!.source).toBe("user");
  });

  it("can record a brand-supplied spec without calling it the user's", () => {
    expect(measurementSetFromUser("top", { chest: 100 }, "brand")!.source).toBe("brand");
  });

  it("rounds to whole centimetres", () => {
    expect(measurementSetFromUser("top", { chest: 99.6 })!.values.chest).toBe(100);
  });
});

describe("describeMeasurement", () => {
  const measured: MeasurementSet = { source: "user", values: { waist: 80 } };
  const guessed: MeasurementSet = { source: "estimated", values: { waist: 80 } };
  const fromBrand: MeasurementSet = { source: "brand", values: { waist: 80 } };

  it("hedges an estimate and does not hedge a measurement", () => {
    expect(describeMeasurement(measured, "waist", "metric")).toBe("80 cm");
    expect(describeMeasurement(guessed, "waist", "metric")).toBe(
      "about 80 cm (estimated)",
    );
  });

  it("does not hedge a brand spec sheet", () => {
    // A partner's stated measurement is not our inference. It stays
    // distinguishable in the data, but the user is not told we guessed it.
    expect(describeMeasurement(fromBrand, "waist", "metric")).toBe("80 cm");
  });

  it("converts to inches without losing the qualifier", () => {
    expect(describeMeasurement(measured, "waist", "imperial")).toBe("31.5 in");
    expect(describeMeasurement(guessed, "waist", "imperial")).toBe(
      "about 31.5 in (estimated)",
    );
  });

  it("returns null for an axis the set does not carry", () => {
    expect(describeMeasurement(measured, "inseam", "metric")).toBeNull();
  });
});

describe("summarizeMeasurements", () => {
  it("says so plainly when there is nothing", () => {
    expect(summarizeMeasurements(null, "top", "metric")).toBe("No measurements yet");
    expect(
      summarizeMeasurements({ source: "user", values: {} }, "top", "metric"),
    ).toBe("No measurements yet");
  });

  it("marks an estimated summary as estimated", () => {
    const set = estimateGarmentMeasurements("bottom", REFERENCE);
    expect(summarizeMeasurements(set, "bottom", "metric")).toMatch(/estimated$/);
  });

  it("does not mark a measured summary", () => {
    const set = measurementSetFromUser("bottom", { waist: 80, inseam: 78 })!;
    expect(summarizeMeasurements(set, "bottom", "metric")).not.toMatch(/estimated/);
  });

  it("omits axes the set does not carry", () => {
    const set = measurementSetFromUser("bottom", { waist: 80 })!;
    const summary = summarizeMeasurements(set, "bottom", "metric");
    expect(summary).toContain("Waist");
    expect(summary).not.toContain("Inseam");
  });
});

describe("AXES_BY_CATEGORY", () => {
  it("covers every category in the garment_category enum", () => {
    // If schema.sql gains a category and this table does not, uploads of that
    // category silently offer no measurement fields at all.
    expect(Object.keys(AXES_BY_CATEGORY).sort()).toEqual([...CATEGORIES].sort());
  });

  it("lists no duplicate axes within a category", () => {
    for (const category of CATEGORIES) {
      const axes = axesFor(category);
      expect(new Set(axes).size).toBe(axes.length);
    }
  });
});
