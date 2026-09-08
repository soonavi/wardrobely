/**
 * Unit tests for src/features/avatar3d/garmentVisual.ts.
 *
 * Ported from the hand-run `_garmentVisual_smoke.ts` script. This is the one
 * piece of the 3D try-on pipeline checkable without a GPU: it is pure (no
 * React, no three.js, no Supabase, no network), so its whole contract is
 * "given a row, produce a colour, a length flag and maybe a texture url".
 *
 * The texture-url rules are the reason the original smoke file was written.
 * They fail *silently* when wrong: a private storage path handed to three's
 * TextureLoader renders nothing rather than erroring, and a product that falls
 * back to its non-cutout photo still "works", just worse.
 */
import type {
  BrandProductRow,
  BrandRow,
  GarmentCategory,
  GarmentRow,
} from "../../../lib/database.types";
import type { ProductWithBrand } from "../../../lib/api/shop";
import {
  garmentToVisual,
  mapCategoryToSlot,
  productToVisual,
  resolveGarmentColor,
  resolveOutfitSlots,
} from "../garmentVisual";
import type { EquipSlot, LayeredOutfitItem } from "../garmentVisual";

// ---------------------------------------------------------------------------
// Fixtures. Full rows rather than casts, so adding a required column to
// GarmentRow / BrandProductRow breaks these tests loudly instead of letting
// them drift out of sync with the schema.
// ---------------------------------------------------------------------------

function garment(overrides: Partial<GarmentRow> = {}): GarmentRow {
  return {
    id: "garment-1",
    user_id: "user-1",
    image_path: "user-1/garment-1.jpg",
    category: "top",
    name: null,
    color: null,
    brand: null,
    tags: [],
    created_at: "2026-01-01T00:00:00.000Z",
    template_id: null,
    texture_path: null,
    source: "upload",
    processing_status: "ready",
    // Migration 008. Null here rather than a sample measurement: the default
    // fixture is an unmeasured garment, which is what most of a real wardrobe
    // looks like, and a test that wants measurements should say so explicitly.
    measurement_source: null,
    chest_cm: null,
    waist_cm: null,
    hip_cm: null,
    length_cm: null,
    shoulder_cm: null,
    sleeve_cm: null,
    inseam_cm: null,
    product_id: null,
    image_url: null,
    ...overrides,
  };
}

const BRAND: BrandRow = {
  id: "brand-1",
  slug: "atelier",
  name: "Atelier",
  tagline: null,
  description: null,
  logo_url: null,
  website_url: null,
  network: "direct",
  commission_rate_bps: 800,
  affiliate_url_template: null,
  status: "active",
  contact_email: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

function product(overrides: Partial<BrandProductRow> = {}): ProductWithBrand {
  return {
    id: "product-1",
    brand_id: BRAND.id,
    external_id: "SKU-1",
    name: "Field Jacket",
    description: null,
    category: "outerwear",
    color: null,
    price_cents: 14800,
    sale_price_cents: null,
    currency: "USD",
    image_url: "https://cdn.example.com/field-jacket.jpg",
    extra_image_urls: [],
    tryon_image_url: null,
    template_id: null,
    product_url: "https://example.com/p/field-jacket",
    commission_rate_bps: null,
    sizes: [],
    tags: [],
    in_stock: true,
    is_active: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
    brand: BRAND,
  };
}

// ---------------------------------------------------------------------------
// mapCategoryToSlot
// ---------------------------------------------------------------------------

describe("mapCategoryToSlot", () => {
  const CASES: [GarmentCategory, EquipSlot | null][] = [
    ["top", "top"],
    ["outerwear", "top"],
    ["dress", "top"],
    ["bottom", "bottom"],
    ["shoes", "shoes"],
    ["accessory", "accessory"],
  ];

  it.each(CASES)("maps %s to %s", (category, slot) => {
    expect(mapCategoryToSlot(category)).toBe(slot);
  });

  it("covers every GarmentCategory, so a new category can't be silently forgotten", () => {
    const ALL_CATEGORIES: GarmentCategory[] = [
      "top",
      "bottom",
      "dress",
      "outerwear",
      "shoes",
      "accessory",
    ];
    expect(CASES.map(([category]) => category).sort()).toEqual(
      [...ALL_CATEGORIES].sort()
    );
  });

  // Accessories used to map to `null`, and that single null was the whole
  // reason the legacy 2D collage studio stayed alive — it was the only surface
  // that could style them. The character now has a neckline accessory slot, so
  // the contract is a real slot, and the studio is gone.
  it("gives accessory a real slot of its own, not null and not a garment slot", () => {
    const slot = mapCategoryToSlot("accessory");
    expect(slot).toBe("accessory");
    expect(slot).not.toBeNull();
    expect(slot).not.toBe(mapCategoryToSlot("top"));
    expect(slot).not.toBe(mapCategoryToSlot("bottom"));
    expect(slot).not.toBe(mapCategoryToSlot("shoes"));
  });

  // The `null` branch survives only as the exhaustiveness valve for a category
  // added to the DB enum before it is modelled on the character. No *current*
  // category may take it — an accessory silently going unworn again is exactly
  // the regression this guards.
  it("maps every current category to a slot, leaving null unreachable", () => {
    for (const [category] of CASES) {
      expect(mapCategoryToSlot(category)).not.toBeNull();
    }
  });

  it("sends dress and outerwear to the torso slot, sharing it with top", () => {
    expect(mapCategoryToSlot("dress")).toBe(mapCategoryToSlot("top"));
    expect(mapCategoryToSlot("outerwear")).toBe(mapCategoryToSlot("top"));
  });
});

// ---------------------------------------------------------------------------
// resolveGarmentColor — the tint that renders while the photo downloads, if
// the photo fails, and on the sides/back the photo can't cover. It has to
// always produce something usable, for every input.
// ---------------------------------------------------------------------------

describe("resolveGarmentColor", () => {
  it("passes an explicit hex color through untouched", () => {
    expect(resolveGarmentColor(garment({ id: "a", color: "#1A2B3C" }))).toBe("#1A2B3C");
    expect(resolveGarmentColor(garment({ id: "a", color: "#abc" }))).toBe("#abc");
  });

  it("maps a color keyword to its palette hex", () => {
    expect(resolveGarmentColor(garment({ id: "a", color: "Navy" }))).toBe("#2B3358");
    expect(resolveGarmentColor(garment({ id: "a", color: "black" }))).toBe("#232028");
  });

  // Ordered most-specific-first, so "light blue" must not be swallowed by the
  // generic "blue" entry.
  it("matches multi-word keywords before their generic substring", () => {
    expect(resolveGarmentColor(garment({ id: "a", color: "light blue" }))).toBe("#8FB6D9");
    expect(resolveGarmentColor(garment({ id: "a", color: "blue" }))).toBe("#4C6FA5");
    expect(resolveGarmentColor(garment({ id: "a", color: "blue" }))).not.toBe(
      resolveGarmentColor(garment({ id: "a", color: "light blue" }))
    );
    expect(resolveGarmentColor(garment({ id: "a", color: "off white" }))).toBe("#F0E6D2");
    expect(resolveGarmentColor(garment({ id: "a", color: "white" }))).toBe("#F4F1E8");
  });

  it("is case-insensitive and tolerates surrounding text", () => {
    expect(resolveGarmentColor(garment({ id: "a", color: "OLIVE" }))).toBe("#6B7150");
    expect(resolveGarmentColor(garment({ id: "a", color: "olive green" }))).toBe("#6B7150");
  });

  it("falls back to the name when color is empty or whitespace", () => {
    expect(
      resolveGarmentColor(garment({ id: "a", color: "   ", name: "Olive Chore Coat" }))
    ).toBe("#6B7150");
    expect(
      resolveGarmentColor(garment({ id: "a", color: null, name: "Navy Oxford Shirt" }))
    ).toBe("#2B3358");
  });

  it("prefers the color field over the name when both match", () => {
    expect(
      resolveGarmentColor(garment({ id: "a", color: "black", name: "Navy Oxford Shirt" }))
    ).toBe("#232028");
  });

  describe("palette fallback when nothing matches", () => {
    const uncolored = garment({ id: "stable-id", color: null, name: "Untitled" });

    it("always yields a usable hex color", () => {
      expect(resolveGarmentColor(uncolored)).toMatch(/^#[0-9A-F]{6}$/i);
      expect(
        resolveGarmentColor(garment({ id: "", color: null, name: null }))
      ).toMatch(/^#[0-9A-F]{6}$/i);
    });

    it("is stable for the same id across calls", () => {
      const first = resolveGarmentColor(uncolored);
      expect(resolveGarmentColor(uncolored)).toBe(first);
      expect(resolveGarmentColor({ ...uncolored })).toBe(first);
    });

    it("varies across ids instead of making every uncolored item identical", () => {
      const picks = new Set(
        Array.from({ length: 24 }, (_, i) =>
          resolveGarmentColor(garment({ id: `id-${i}`, color: null, name: "Untitled" }))
        )
      );
      expect(picks.size).toBeGreaterThan(1);
    });

    it("never produces undefined for a long id (the hash must stay in range)", () => {
      for (const id of ["", "a", "x".repeat(500), "🙂🙂🙂", "0"]) {
        expect(
          resolveGarmentColor(garment({ id, color: null, name: null }))
        ).toMatch(/^#[0-9A-F]{6}$/i);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// garmentToVisual — wardrobe rows.
// ---------------------------------------------------------------------------

describe("garmentToVisual", () => {
  // The critical rule: a private-bucket upload must NOT get a textureUrl,
  // because its `image_path` needs an async signed URL this module can't
  // produce. Handing the loader a raw path renders nothing, silently.
  it("gives an uploaded garment a tint but no textureUrl", () => {
    const uploaded = garmentToVisual(
      garment({ source: "upload", image_path: "user-1/shirt.jpg", image_url: null })
    );

    expect(uploaded.textureUrl).toBeUndefined();
    expect(typeof uploaded.color).toBe("string");
  });

  it("textures a catalog garment from its CDN url", () => {
    const catalogued = garmentToVisual(
      garment({
        source: "catalog",
        image_path: null,
        image_url: "https://cdn.example.com/shirt.png",
        name: "Oxford Shirt",
        category: "top",
      })
    );

    expect(catalogued.textureUrl).toBe("https://cdn.example.com/shirt.png");
    expect(catalogued.name).toBe("Oxford Shirt");
    expect(catalogued.long).toBe(false);
  });

  it("trims whitespace around a url", () => {
    expect(
      garmentToVisual(
        garment({
          source: "catalog",
          image_path: null,
          image_url: "  https://cdn.example.com/a.png  ",
        })
      ).textureUrl
    ).toBe("https://cdn.example.com/a.png");
  });

  it("accepts http as well as https", () => {
    expect(
      garmentToVisual(
        garment({ source: "catalog", image_path: null, image_url: "http://cdn.example.com/a.png" })
      ).textureUrl
    ).toBe("http://cdn.example.com/a.png");
  });

  it.each([
    ["a storage path masquerading as image_url", "user-1/shirt.jpg"],
    ["an empty image_url", "   "],
    ["a protocol-relative url", "//cdn.example.com/a.png"],
    ["a data uri", "data:image/png;base64,iVBORw0KGgo="],
  ])("refuses %s", (_label, imageUrl) => {
    expect(
      garmentToVisual(garment({ source: "catalog", image_path: null, image_url: imageUrl }))
        .textureUrl
    ).toBeUndefined();
  });

  it("marks a dress as long so the skirt panel hangs over the legs", () => {
    expect(garmentToVisual(garment({ category: "dress" })).long).toBe(true);
    expect(garmentToVisual(garment({ category: "top" })).long).toBe(false);
    expect(garmentToVisual(garment({ category: "outerwear" })).long).toBe(false);
    expect(garmentToVisual(garment({ category: "bottom" })).long).toBe(false);
  });

  it("normalises a null name to undefined rather than passing null through", () => {
    expect(garmentToVisual(garment({ name: null })).name).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// productToVisual — Shop products, the case texturing exists for.
// ---------------------------------------------------------------------------

describe("productToVisual", () => {
  // The cutout PNG's alpha channel is what lets the garment's real silhouette
  // read on the character instead of a rectangular photo card on the torso, so
  // it must win whenever the partner supplied one.
  it("prefers the transparent cutout over the standard product shot", () => {
    expect(
      productToVisual(
        product({
          tryon_image_url: "https://cdn.example.com/cutout.png",
          image_url: "https://cdn.example.com/photo.jpg",
        })
      ).textureUrl
    ).toBe("https://cdn.example.com/cutout.png");
  });

  it("falls back to the product shot when there is no cutout", () => {
    expect(
      productToVisual(
        product({ tryon_image_url: null, image_url: "https://cdn.example.com/photo.jpg" })
      ).textureUrl
    ).toBe("https://cdn.example.com/photo.jpg");
  });

  it("treats a blank cutout url as absent and falls through", () => {
    expect(
      productToVisual(
        product({ tryon_image_url: "   ", image_url: "https://cdn.example.com/photo.jpg" })
      ).textureUrl
    ).toBe("https://cdn.example.com/photo.jpg");
  });

  // The fallback is on *usability*, not on blankness. `tryon_image_url` comes
  // from partner catalog feeds we don't control, so a non-empty but malformed
  // value is the realistic failure — and it must not beat a perfectly good
  // product shot into the `||` and then fail the protocol test, which is what
  // used to happen and left the garment rendering as a flat tint.
  it.each([
    ["a bare word", "not-a-url"],
    ["a storage path", "brands/atelier/jacket.png"],
    ["a protocol-relative url", "//cdn.example.com/cutout.png"],
    ["a data uri", "data:image/png;base64,iVBORw0KGgo="],
    ["whitespace", "   "],
  ])("falls through to the product shot when the cutout url is %s", (_label, cutout) => {
    expect(
      productToVisual(
        product({
          tryon_image_url: cutout,
          image_url: "https://cdn.example.com/photo.jpg",
        })
      ).textureUrl
    ).toBe("https://cdn.example.com/photo.jpg");
  });

  it("yields no texture when neither url is usable", () => {
    expect(
      productToVisual(product({ tryon_image_url: null, image_url: "//cdn.example.com/x.jpg" }))
        .textureUrl
    ).toBeUndefined();
    expect(
      productToVisual(product({ tryon_image_url: "not-a-url", image_url: "also-not-a-url" }))
        .textureUrl
    ).toBeUndefined();
  });

  it("carries name, length and keyword-resolved color through", () => {
    const dress = productToVisual(
      product({ category: "dress", name: "Wrap Dress", color: "burgundy" })
    );

    expect(dress.long).toBe(true);
    expect(dress.color).toBe("#722F37");
    expect(dress.name).toBe("Wrap Dress");
    expect(productToVisual(product({ category: "outerwear" })).long).toBe(false);
  });

  it("falls back to the product name for color, then to the palette", () => {
    expect(productToVisual(product({ color: null, name: "Camel Wool Coat" })).color).toBe(
      "#B98D57"
    );
    expect(productToVisual(product({ color: null, name: "Field Jacket" })).color).toMatch(
      /^#[0-9A-F]{6}$/i
    );
  });
});

// ---------------------------------------------------------------------------
// resolveOutfitSlots — the shared "top-most layer wins the slot" tie-break.
// CharacterTryOnScreen and OutfitsScreen both call it; when they each had
// their own copy, the Outfits grid preview could show a different outfit than
// opening that outfit in try-on actually equipped.
// ---------------------------------------------------------------------------

describe("resolveOutfitSlots", () => {
  function outfitItem(category: GarmentCategory, layer_order: number): LayeredOutfitItem {
    return { layer_order, garment: { category } };
  }

  it("puts one item per slot and hides nothing when there are no collisions", () => {
    const items = [
      outfitItem("bottom", 0),
      outfitItem("top", 1),
      outfitItem("shoes", 2),
      outfitItem("accessory", 3),
    ];
    const { bySlot, hidden } = resolveOutfitSlots(items);

    expect(hidden).toEqual([]);
    expect(bySlot.top).toBe(items[1]);
    expect(bySlot.bottom).toBe(items[0]);
    expect(bySlot.shoes).toBe(items[2]);
    expect(bySlot.accessory).toBe(items[3]);
  });

  it("gives the slot to the highest layer and hides the loser", () => {
    const shirt = outfitItem("top", 0);
    const jacket = outfitItem("outerwear", 1);

    expect(resolveOutfitSlots([shirt, jacket]).bySlot.top).toBe(jacket);
    expect(resolveOutfitSlots([shirt, jacket]).hidden).toEqual([shirt]);
    // Same answer regardless of the order the rows arrive in.
    expect(resolveOutfitSlots([jacket, shirt]).bySlot.top).toBe(jacket);
    expect(resolveOutfitSlots([jacket, shirt]).hidden).toEqual([shirt]);
  });

  // An accessory used to land in `hidden` for every outfit, which is what the
  // 2D studio existed to rescue. It now takes a slot of its own and never
  // collides with a garment.
  it("never hides an accessory just for being an accessory", () => {
    const accessory = outfitItem("accessory", 0);
    const { bySlot, hidden } = resolveOutfitSlots([accessory, outfitItem("top", 1)]);

    expect(bySlot.accessory).toBe(accessory);
    expect(hidden).toEqual([]);
  });

  it("still collides two accessories against each other, top layer winning", () => {
    const scarf = outfitItem("accessory", 0);
    const belt = outfitItem("accessory", 1);
    const { bySlot, hidden } = resolveOutfitSlots([scarf, belt]);

    expect(bySlot.accessory).toBe(belt);
    expect(hidden).toEqual([scarf]);
  });

  // A dress dresses the torso AND the legs, so separate bottoms would poke
  // through its hem. The bottom stays in the outfit, it just isn't worn.
  it("drops the bottom when a dress holds the top slot", () => {
    const pants = outfitItem("bottom", 0);
    const dress = outfitItem("dress", 1);
    const { bySlot, hidden } = resolveOutfitSlots([pants, dress]);

    expect(bySlot.top).toBe(dress);
    expect(bySlot.bottom).toBeUndefined();
    expect(hidden).toEqual([pants]);
  });

  it("keeps the bottom when the top slot holds a non-dress", () => {
    const pants = outfitItem("bottom", 0);
    const shirt = outfitItem("top", 1);
    const { bySlot, hidden } = resolveOutfitSlots([pants, shirt]);

    expect(bySlot.bottom).toBe(pants);
    expect(hidden).toEqual([]);
  });

  // `updateOutfit` replaces an outfit's items wholesale, so a caller that
  // re-saves must write `hidden` back. Losing an item here means opening an
  // outfit in try-on and saving it silently deleted part of it.
  it("accounts for every input item exactly once, across bySlot and hidden", () => {
    const items = [
      outfitItem("top", 0),
      outfitItem("outerwear", 1),
      outfitItem("bottom", 2),
      outfitItem("dress", 3),
      outfitItem("shoes", 4),
      outfitItem("accessory", 5),
    ];
    const { bySlot, hidden } = resolveOutfitSlots(items);
    const accountedFor = [...Object.values(bySlot), ...hidden];

    expect(accountedFor).toHaveLength(items.length);
    expect(new Set(accountedFor).size).toBe(items.length);
  });

  it("handles an empty outfit", () => {
    expect(resolveOutfitSlots([])).toEqual({ bySlot: {}, hidden: [] });
  });
});

// ---------------------------------------------------------------------------
// Cross-path contract
// ---------------------------------------------------------------------------

describe("garment and product paths produce the same shape", () => {
  // CharacterAvatar reads one `GarmentVisual` regardless of whether the item
  // came from the wardrobe or the Shop; a missing key on one path would only
  // show up at render time on a device.
  it("emits exactly {color, long, name, textureUrl} from both entry points", () => {
    const fromGarment = Object.keys(garmentToVisual(garment())).sort();
    const fromProduct = Object.keys(productToVisual(product())).sort();

    expect(fromGarment).toEqual(fromProduct);
    expect(fromGarment).toEqual(["color", "long", "name", "textureUrl"]);
  });

  it("always produces a color, whatever the input", () => {
    expect(garmentToVisual(garment()).color).toMatch(/^#[0-9A-F]{3,6}$/i);
    expect(productToVisual(product()).color).toMatch(/^#[0-9A-F]{3,6}$/i);
  });
});
