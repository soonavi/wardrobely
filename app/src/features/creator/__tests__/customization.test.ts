/**
 * Unit tests for src/features/creator/customization.ts.
 *
 * Two things matter here:
 *
 *  1. `mergeCustomization` is the DB boundary. `avatars.customization` is
 *     untyped jsonb, so anything can come back out of it — a row written by an
 *     older build, a half-migrated shape, a null. Every caller assumes it gets
 *     a fully-populated Customization, and AvatarPreview switches on these
 *     values to decide what to draw, so a leaked `undefined` is a blank face.
 *
 *  2. Catalog integrity. The creator UI `.map()`s over these arrays, and
 *     DEFAULT_CUSTOMIZATION has to point at entries that actually exist in
 *     them — otherwise a brand-new character opens with no swatch selected.
 */
import {
  ACCESSORIES,
  BODY_TYPES,
  DEFAULT_CUSTOMIZATION,
  EYEBROW_STYLES,
  EYE_COLORS,
  EYE_SHAPES,
  FACE_SHAPES,
  FACIAL_HAIR_STYLES,
  HAIR_COLORS,
  HAIR_STYLES,
  SKIN_TONES,
  mergeCustomization,
} from "../customization";
import type { Customization } from "../customization";

const SWATCH_CATALOGS = {
  SKIN_TONES,
  HAIR_COLORS,
  EYE_COLORS,
} as const;

const CHIP_CATALOGS = {
  HAIR_STYLES,
  EYEBROW_STYLES,
  FACIAL_HAIR_STYLES,
  FACE_SHAPES,
  EYE_SHAPES,
  BODY_TYPES,
  ACCESSORIES,
} as const;

const ALL_CATALOGS: Record<string, ReadonlyArray<{ id: string; label: string }>> = {
  ...SWATCH_CATALOGS,
  ...CHIP_CATALOGS,
};

// ---------------------------------------------------------------------------
// Catalog integrity
// ---------------------------------------------------------------------------

describe("option catalogs", () => {
  it.each(Object.keys(ALL_CATALOGS))("%s is non-empty", (name) => {
    expect(ALL_CATALOGS[name].length).toBeGreaterThan(0);
  });

  it.each(Object.keys(ALL_CATALOGS))("%s has unique ids", (name) => {
    const ids = ALL_CATALOGS[name].map((option) => option.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(Object.keys(ALL_CATALOGS))("%s has a non-empty label for every entry", (name) => {
    for (const option of ALL_CATALOGS[name]) {
      expect(typeof option.id).toBe("string");
      expect(option.id.length).toBeGreaterThan(0);
      expect(typeof option.label).toBe("string");
      expect(option.label.trim().length).toBeGreaterThan(0);
    }
  });

  it.each(Object.keys(SWATCH_CATALOGS))("%s has a valid 6-digit hex for every swatch", (name) => {
    for (const swatch of SWATCH_CATALOGS[name as keyof typeof SWATCH_CATALOGS]) {
      expect(swatch.hex).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it.each(Object.keys(SWATCH_CATALOGS))("%s has no duplicate hex values", (name) => {
    const hexes = SWATCH_CATALOGS[name as keyof typeof SWATCH_CATALOGS].map((s) =>
      s.hex.toUpperCase()
    );
    expect(new Set(hexes).size).toBe(hexes.length);
  });

  it("offers an inclusive skin tone range, light through deep", () => {
    expect(SKIN_TONES.length).toBeGreaterThanOrEqual(8);
    // Ordered fair -> deep, so the picker reads as a gradient rather than a
    // shuffled set: luminance must decrease monotonically.
    const luminance = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
    };
    for (let i = 1; i < SKIN_TONES.length; i += 1) {
      expect(luminance(SKIN_TONES[i].hex)).toBeLessThan(luminance(SKIN_TONES[i - 1].hex));
    }
  });

  it("keeps BODY_TYPES in sync with the profiles.build vocabulary", () => {
    expect(BODY_TYPES.map((b) => b.id)).toEqual([
      "slim",
      "average",
      "athletic",
      "curvy",
      "broad",
    ]);
    for (const option of BODY_TYPES) {
      expect(option.hint.trim().length).toBeGreaterThan(0);
    }
  });

  it("offers 'none' as the first facial hair and accessory option", () => {
    expect(FACIAL_HAIR_STYLES[0].id).toBe("none");
    expect(ACCESSORIES[0].id).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_CUSTOMIZATION integrity
// ---------------------------------------------------------------------------

describe("DEFAULT_CUSTOMIZATION", () => {
  it("picks colors that exist in their swatch catalogs", () => {
    expect(SKIN_TONES.map((s) => s.hex)).toContain(DEFAULT_CUSTOMIZATION.skinTone);
    expect(EYE_COLORS.map((s) => s.hex)).toContain(DEFAULT_CUSTOMIZATION.eyeColor);
    expect(HAIR_COLORS.map((s) => s.hex)).toContain(DEFAULT_CUSTOMIZATION.hairColor);
    expect(HAIR_COLORS.map((s) => s.hex)).toContain(DEFAULT_CUSTOMIZATION.eyebrowColor);
    expect(HAIR_COLORS.map((s) => s.hex)).toContain(DEFAULT_CUSTOMIZATION.facialHairColor);
  });

  it("picks ids that exist in their option catalogs", () => {
    expect(HAIR_STYLES.map((o) => o.id)).toContain(DEFAULT_CUSTOMIZATION.hairStyle);
    expect(FACE_SHAPES.map((o) => o.id)).toContain(DEFAULT_CUSTOMIZATION.faceShape);
    expect(EYE_SHAPES.map((o) => o.id)).toContain(DEFAULT_CUSTOMIZATION.eyeShape);
    expect(EYEBROW_STYLES.map((o) => o.id)).toContain(DEFAULT_CUSTOMIZATION.eyebrows);
    expect(FACIAL_HAIR_STYLES.map((o) => o.id)).toContain(DEFAULT_CUSTOMIZATION.facialHair);
    expect(BODY_TYPES.map((o) => o.id)).toContain(DEFAULT_CUSTOMIZATION.bodyType);
  });

  it("starts with no accessories rather than the 'none' sentinel in the array", () => {
    expect(DEFAULT_CUSTOMIZATION.accessories).toEqual([]);
  });

  it("has no undefined or null field", () => {
    for (const [key, value] of Object.entries(DEFAULT_CUSTOMIZATION)) {
      expect(value).toBeDefined();
      expect(value).not.toBeNull();
      expect(`${key}=${String(value)}`).not.toContain("undefined");
    }
  });

  it("keeps eyebrow and facial hair color consistent with the default hair color", () => {
    expect(DEFAULT_CUSTOMIZATION.eyebrowColor).toBe(DEFAULT_CUSTOMIZATION.hairColor);
    expect(DEFAULT_CUSTOMIZATION.facialHairColor).toBe(DEFAULT_CUSTOMIZATION.hairColor);
  });
});

// ---------------------------------------------------------------------------
// mergeCustomization
// ---------------------------------------------------------------------------

describe("mergeCustomization", () => {
  const EVERY_KEY = Object.keys(DEFAULT_CUSTOMIZATION) as (keyof Customization)[];

  it("returns the full defaults for undefined, null and {}", () => {
    expect(mergeCustomization(undefined)).toEqual(DEFAULT_CUSTOMIZATION);
    expect(mergeCustomization(null)).toEqual(DEFAULT_CUSTOMIZATION);
    expect(mergeCustomization({})).toEqual(DEFAULT_CUSTOMIZATION);
    expect(mergeCustomization()).toEqual(DEFAULT_CUSTOMIZATION);
  });

  it("always returns every key, whatever the input", () => {
    for (const input of [undefined, null, {}, { hairStyle: "afro" }]) {
      const merged = mergeCustomization(input as Partial<Customization>);
      expect(Object.keys(merged).sort()).toEqual([...EVERY_KEY].sort());
      for (const key of EVERY_KEY) {
        expect(merged[key]).toBeDefined();
      }
    }
  });

  it("returns a fresh object, not DEFAULT_CUSTOMIZATION itself", () => {
    const merged = mergeCustomization({});
    expect(merged).not.toBe(DEFAULT_CUSTOMIZATION);
    merged.hairStyle = "afro";
    expect(DEFAULT_CUSTOMIZATION.hairStyle).toBe("short");
  });

  it("returns a fresh accessories array when the caller supplied one", () => {
    const supplied = ["glasses"];
    const merged = mergeCustomization({ accessories: supplied });
    // `.filter()` on the supplied array already gives a copy, so mutating the
    // result can't reach back into the caller's array.
    expect(merged.accessories).not.toBe(supplied);
    expect(merged.accessories).toEqual(["glasses"]);
  });

  /**
   * REGRESSION GUARD (was customization.ts:206-208, fixed) — the `accessories`
   * default branch used to return `DEFAULT_CUSTOMIZATION.accessories` by
   * reference, not a copy. Every merge that didn't supply an accessories array
   * handed the caller the one shared module-level array. A single in-place
   * `push`/`splice` anywhere (`customization.accessories.push("glasses")`)
   * would permanently change the default for every character created for the
   * rest of the session — presenting as "new characters mysteriously start
   * with glasses on", miles from the code that caused it.
   *
   * It was latent rather than live (CharacterCreatorScreen rebuilds the array
   * immutably; CharacterAvatar/AvatarPreview only read it), but it was the
   * kind of aliasing every other field in that function avoids by
   * construction, and the contract — "callers always get a fully-populated
   * Customization back" — reads as returning an owned value.
   *
   * Now spread: `: [...DEFAULT_CUSTOMIZATION.accessories]`. This test exists
   * to stop that spread being "simplified" away again.
   */
  it("returns a fresh accessories array when defaulting too", () => {
    expect(mergeCustomization({}).accessories).not.toBe(
      DEFAULT_CUSTOMIZATION.accessories
    );
    expect(mergeCustomization(null).accessories).not.toBe(
      mergeCustomization(undefined).accessories
    );
  });

  it("keeps every supplied field", () => {
    const full: Customization = {
      skinTone: "#3C2116",
      faceShape: "heart",
      eyeColor: "#3E6FA8",
      eyeShape: "hooded",
      eyebrows: "bold",
      eyebrowColor: "#1B1712",
      hairStyle: "braids",
      hairColor: "#F2A6C9",
      facialHair: "goatee",
      facialHairColor: "#1B1712",
      bodyType: "athletic",
      accessories: ["glasses", "earrings"],
    };

    expect(mergeCustomization(full)).toEqual(full);
  });

  it("fills only the missing fields of a partial row", () => {
    const merged = mergeCustomization({ hairStyle: "afro", bodyType: "curvy" });

    expect(merged.hairStyle).toBe("afro");
    expect(merged.bodyType).toBe("curvy");
    expect(merged.skinTone).toBe(DEFAULT_CUSTOMIZATION.skinTone);
    expect(merged.eyeShape).toBe(DEFAULT_CUSTOMIZATION.eyeShape);
  });

  // The DB boundary is untyped jsonb, so the string fields are actively
  // type-checked rather than trusted.
  describe("hostile jsonb from the database", () => {
    it("replaces a non-string color with the default", () => {
      const merged = mergeCustomization({
        skinTone: 42,
        hairColor: null,
        eyeColor: { r: 1 },
        eyebrowColor: [],
        facialHairColor: true,
      } as unknown as Partial<Customization>);

      expect(merged.skinTone).toBe(DEFAULT_CUSTOMIZATION.skinTone);
      expect(merged.hairColor).toBe(DEFAULT_CUSTOMIZATION.hairColor);
      expect(merged.eyeColor).toBe(DEFAULT_CUSTOMIZATION.eyeColor);
      expect(merged.eyebrowColor).toBe(DEFAULT_CUSTOMIZATION.eyebrowColor);
      expect(merged.facialHairColor).toBe(DEFAULT_CUSTOMIZATION.facialHairColor);
    });

    it("replaces a non-string hairStyle with the default", () => {
      expect(
        mergeCustomization({ hairStyle: 7 } as unknown as Partial<Customization>).hairStyle
      ).toBe(DEFAULT_CUSTOMIZATION.hairStyle);
      expect(
        mergeCustomization({ hairStyle: null } as unknown as Partial<Customization>).hairStyle
      ).toBe(DEFAULT_CUSTOMIZATION.hairStyle);
    });

    it("replaces a non-array accessories value with the default", () => {
      for (const bad of ["glasses", 3, null, { 0: "glasses" }, true]) {
        expect(
          mergeCustomization({ accessories: bad } as unknown as Partial<Customization>)
            .accessories
        ).toEqual([]);
      }
    });

    it("drops non-string entries from an accessories array instead of rejecting it", () => {
      const merged = mergeCustomization({
        accessories: ["glasses", 3, null, "earrings", undefined, { id: "hat" }],
      } as unknown as Partial<Customization>);

      expect(merged.accessories).toEqual(["glasses", "earrings"]);
    });

    it("preserves an explicitly empty accessories array rather than re-defaulting it", () => {
      expect(mergeCustomization({ accessories: [] }).accessories).toEqual([]);
    });

    it("passes an explicitly-set empty-string color through (it is still a string)", () => {
      // Documenting the boundary of the `typeof === "string"` guard: emptiness
      // is not validated, only the type. AvatarPreview receives "" and the
      // guard's job — never handing it `undefined` — is still met.
      expect(mergeCustomization({ skinTone: "" }).skinTone).toBe("");
    });

    it("ignores unknown extra keys rather than copying them through", () => {
      const merged = mergeCustomization({
        hairStyle: "bun",
        tattoos: ["dragon"],
        skinTone_OLD: "#000000",
      } as unknown as Partial<Customization>);

      expect(merged).not.toHaveProperty("tattoos");
      expect(merged).not.toHaveProperty("skinTone_OLD");
      expect(merged.hairStyle).toBe("bun");
      expect(Object.keys(merged).sort()).toEqual([...EVERY_KEY].sort());
    });
  });

  it("is idempotent — merging its own output changes nothing", () => {
    const once = mergeCustomization({ hairStyle: "afro", accessories: ["glasses"] });
    expect(mergeCustomization(once)).toEqual(once);
  });

  it("round-trips through JSON, the way the jsonb column stores it", () => {
    const merged = mergeCustomization({ hairStyle: "bob", accessories: ["earrings"] });
    expect(mergeCustomization(JSON.parse(JSON.stringify(merged)))).toEqual(merged);
  });
});
