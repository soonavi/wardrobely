import { DEFAULT_CUSTOMIZATION, mergeCustomization } from "../../../creator/customization";
import { pickGarmentTemplate } from "../garmentTemplates";
import { buildHumanLook, shapeFromCustomization } from "../humanLook";
import { resolveShapeWeights } from "../humanShape";

describe("pickGarmentTemplate", () => {
  const cases: [string, string | null, string | null][] = [
    ["top", "White tee", "tee"],
    ["top", "Olive hoodie", "hoodie"],
    ["top", "Cropped cami", "tank"],
    ["top", "Linen button-up shirt", "shirt"],
    ["top", "Oversized knit jumper", "sweater"],
    ["top", "Striped long sleeve", "longsleeve"],
    ["top", null, "tee"],
    ["outerwear", "Denim jacket", "jacket"],
    ["outerwear", "Camel trench coat", "coat"],
    ["outerwear", "Something warm", "jacket"],
    ["bottom", "Blue jeans", "jeans"],
    ["bottom", "Wide-leg trousers", "trousers"],
    ["bottom", "Running shorts", "shorts"],
    ["bottom", "Black midi skirt", "skirt_midi"],
    ["bottom", "Mini skirt", "skirt_mini"],
    ["bottom", "Pleated maxi skirt", "skirt_maxi"],
    ["bottom", "", "jeans"],
    ["dress", "Red midi dress", "dress_midi"],
    ["dress", "Floor length gown", "dress_maxi"],
    ["dress", "Little black dress", "dress_midi"],
    ["shoes", "White sneakers", "sneakers"],
    ["shoes", "Chelsea boots", "boots"],
    ["shoes", "Leather loafers", "flats"],
    ["accessory", "Tote bag", null],
  ];
  it.each(cases)("%s / %s -> %s", (category, name, expected) => {
    expect(pickGarmentTemplate({ category, name })).toBe(expected);
  });

  it("lets an explicit template win, and ignores one that does not exist", () => {
    expect(pickGarmentTemplate({ category: "top", name: "White tee", template: "hoodie" })).toBe("hoodie");
    expect(pickGarmentTemplate({ category: "top", name: "White tee", template: "cape" })).toBe("tee");
  });

  it("treats a legacy `long` top as a dress when the category is unknown", () => {
    expect(pickGarmentTemplate({ slot: "top", long: true, name: "Sundress" })).toBe("dress_midi");
    expect(pickGarmentTemplate({ slot: "bottom", name: null })).toBe("jeans");
  });

  it("does not mistake a denim jacket for jeans, or a t-shirt for a shirt", () => {
    expect(pickGarmentTemplate({ category: "top", name: "Denim jacket" })).toBe("jacket");
    expect(pickGarmentTemplate({ category: "top", name: "Graphic t-shirt" })).toBe("tee");
  });
});

describe("buildHumanLook", () => {
  const base = DEFAULT_CUSTOMIZATION;

  it("dresses a bare character in the base layer", () => {
    const look = buildHumanLook(base);
    expect(look.worn).toEqual(expect.arrayContaining(["G_base_top", "G_base_bottom", "Hair_short", "Brows_natural"]));
    expect(look.garments).toEqual([]);
  });

  it("keeps the base bottom under a skirt but not under trousers", () => {
    const skirt = buildHumanLook(base, { bottom: { color: "#000", name: "Midi skirt", category: "bottom" } });
    expect(skirt.worn).toContain("G_base_bottom");
    expect(skirt.worn).toContain("G_skirt_midi");
    const jeans = buildHumanLook(base, { bottom: { color: "#000", name: "Jeans", category: "bottom" } });
    expect(jeans.worn).not.toContain("G_base_bottom");
    expect(jeans.worn).toContain("G_base_top");
  });

  it("lets a dress win over trousers, as the outfit resolver does", () => {
    const look = buildHumanLook(base, {
      top: { color: "#B00", name: "Red midi dress", category: "dress" },
      bottom: { color: "#000", name: "Jeans", category: "bottom" },
    });
    expect(look.worn).toContain("G_dress_midi");
    expect(look.worn).not.toContain("G_jeans");
    expect(look.worn).toContain("G_base_bottom");
  });

  it("wears no hair mesh when bald and reports an accessory it cannot draw", () => {
    const look = buildHumanLook({ ...base, hairStyle: "bald" }, { accessory: { color: "#333", name: "Tote" } });
    expect(look.worn.some((p) => p.startsWith("Hair_"))).toBe(false);
    expect(look.undrawn).toEqual(["accessory"]);
  });

  it("puts an outer layer over a top", () => {
    const look = buildHumanLook(base, {
      top: { color: "#fff", name: "White tee", category: "top" },
      outer: { color: "#a85", name: "Camel coat", category: "outerwear" },
    });
    expect(look.worn).toEqual(expect.arrayContaining(["G_tee", "G_coat"]));
  });
});

describe("shape from a saved character", () => {
  it("gives a character saved before the sliders existed its preset build", () => {
    const old = mergeCustomization({ bodyType: "athletic" } as never);
    expect(old.body.muscle).toBeGreaterThan(0.5);
    expect(old.body.frame).toBe(0);
  });

  it("drops stored slider values that are not numbers and clamps the rest", () => {
    const c = mergeCustomization({ body: { frame: "wide", height: 99, volume: -0.3 } } as never);
    expect(c.body.frame).toBe(0);
    expect(c.body.height).toBe(2.5);
    expect(c.body.volume).toBe(-0.3);
  });

  it("lets real measurements override the height and build sliders", () => {
    const c = { ...DEFAULT_CUSTOMIZATION, body: { ...DEFAULT_CUSTOMIZATION.body, height: 2, volume: 2 } };
    const shape = shapeFromCustomization(c, { heightCm: 165, weightKg: 60 });
    expect(shape.heightCm).toBe(165);
    expect(shape.weightKg).toBe(60);
  });

  it("only applies cup on a feminine frame, and the cross terms follow the frame", () => {
    const manifest = {
      formatVersion: 1,
      joints: [],
      parts: [],
      metrics: { stature: 1.66, bmi: 20, chest: 0.9, waist: 0.7, hip: 0.94 },
      targets: Object.fromEntries(
        ["Masculine", "Heavy", "X_Gain", "Thin", "X_Loss", "Tall", "Short", "CupLarge", "CupSmall", "FaceOval"].map((n) => [
          n,
          { metrics: { stature: n === "Tall" ? 0.12 : n === "Short" ? -0.12 : 0, bmi: n === "Heavy" ? 7 : n === "Thin" ? -6 : 0, chest: 0, waist: 0, hip: 0 }, joints: [] },
        ])
      ),
    };
    const masc = resolveShapeWeights({ ...shapeFromCustomization(DEFAULT_CUSTOMIZATION), frame: 1, cup: 1, volume: 1 }, manifest);
    expect(masc.CupLarge).toBeUndefined();
    expect(masc.X_Gain).toBe(1);
    const fem = resolveShapeWeights({ ...shapeFromCustomization(DEFAULT_CUSTOMIZATION), frame: -1, cup: 1, volume: 1 }, manifest);
    expect(fem.CupLarge).toBe(1);
    expect(fem.X_Gain).toBe(-1);
  });
});
