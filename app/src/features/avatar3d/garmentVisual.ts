/**
 * Pure data/logic module (no React, no three.js, no Supabase) that turns a
 * wardrobe `GarmentRow` — or a Shop `ProductWithBrand` — into the small
 * `GarmentVisual` shape CharacterAvatar.tsx renders: a slot
 * ("top" | "bottom" | "shoes" | "accessory"), a hex color that tints that
 * slot's procedural mesh, and (when we have one) the URL of the garment's
 * **actual photo**, which CharacterAvatar planar-projects onto the front of
 * that slot.
 *
 * The color is no longer the whole story, but it is still load-bearing: it is
 * what renders while the photo downloads, what renders if the download fails,
 * and what fills the sides and back of the garment where a single flat-lay
 * photo has nothing to say. Per PRODUCT_SPEC §5b this is explicitly a
 * "preview, not an exact replica" — your photo skinned onto the closest
 * stylized shape, not a reconstruction of the garment's real cut.
 *
 * Texture *loading* deliberately does not live here (see garmentTexture.ts):
 * this module stays synchronous and dependency-free so it can be reasoned
 * about and unit-tested on its own — see __tests__/garmentVisual.test.ts.
 */
import type { GarmentCategory, GarmentRow } from "../../lib/database.types";
// Type-only, and it must stay that way: `api/shop` pulls in the Supabase
// client, which would drag a network singleton into this pure module. TS and
// Babel both erase `import type` entirely, so nothing from shop.ts survives
// into the bundle.
import type { ProductWithBrand } from "../../lib/api/shop";

/** The body slots CharacterAvatar can actually render a garment onto. */
export type EquipSlot = "top" | "bottom" | "shoes" | "accessory";

/**
 * Category -> renderable slot. `top`/`outerwear` both dress the torso+arms
 * slot; `dress` ALSO uses the `top` slot (`garmentToVisual`/`productToVisual`
 * additionally mark it `long: true` so CharacterAvatar hangs a skirt panel
 * over the legs, and so a dress photo projects across the whole silhouette
 * rather than stopping at the hip); `accessory` dresses the character's
 * neckline (see CharacterAvatar's buildNeckAccessory).
 *
 * Every `GarmentCategory` maps to a real slot today — the `null` return is
 * kept as the exhaustiveness valve for a category added to the DB enum
 * (`garment_category` in supabase/schema.sql) before it is modelled on the
 * character. Callers must treat `null` as "this piece is part of the outfit
 * but cannot be worn in 3D" and carry it rather than discard it (see
 * `resolveOutfitSlots`'s `hidden`), never as "equip nothing".
 */
export function mapCategoryToSlot(category: GarmentCategory): EquipSlot | null {
  switch (category) {
    case "top":
    case "outerwear":
    case "dress":
      return "top";
    case "bottom":
      return "bottom";
    case "shoes":
      return "shoes";
    case "accessory":
      return "accessory";
    default:
      return null;
  }
}

/**
 * The minimum shape `resolveOutfitSlots` needs from an outfit item. Declared
 * structurally rather than importing `OutfitItemWithGarment` from
 * `lib/api/outfits`, which would pull the Supabase client into this
 * deliberately dependency-free module — and which would stop the rule being
 * testable without building whole DB rows.
 */
export interface LayeredOutfitItem {
  layer_order: number;
  garment: { category: GarmentCategory };
}

/**
 * Resolve a saved outfit — a flat, layer-ordered list of garments — into what
 * a body with a handful of slots can actually wear.
 *
 * THE SHARED RULE. Two surfaces need this and must never disagree:
 * `CharacterTryOnScreen` (which equips the result onto the 3D character) and
 * `OutfitsScreen` (which tints the share-card preview from it). When they
 * drifted, the Outfits grid showed a different outfit than opening it in
 * try-on produced.
 *
 * Two things fall out of the list, and both are still genuinely part of the
 * user's outfit — hence `hidden` rather than a discard pile:
 *   * **slot collisions.** An outfit that layers a shirt under a jacket has
 *     two `top` items; only the top-most layer can dress the torso. This is
 *     the same "keep the top-most layer" tie-break `createOutfit` already
 *     applies when writing outfit_items.
 *   * **unrenderable categories.** None today, but `mapCategoryToSlot` can
 *     return `null` for a category added to the DB enum ahead of the model.
 *
 * The dress rule rides along because it is the same question — which item
 * actually gets worn: a dress dresses the torso AND the legs, so it can't
 * coexist with separate bottoms (pants poking through a hem). The bottom
 * stays in the outfit, it just isn't worn.
 *
 * Callers that persist an edited outfit MUST write `hidden` back (see
 * CharacterTryOnScreen's `carriedItems`): `updateOutfit` replaces an outfit's
 * items wholesale, so anything omitted is deleted.
 */
export function resolveOutfitSlots<T extends LayeredOutfitItem>(
  items: readonly T[]
): { bySlot: Partial<Record<EquipSlot, T>>; hidden: T[] } {
  const bySlot: Partial<Record<EquipSlot, T>> = {};
  const hidden: T[] = [];

  for (const item of items) {
    const slot = mapCategoryToSlot(item.garment.category);
    if (!slot) {
      hidden.push(item);
      continue;
    }

    const current = bySlot[slot];
    if (!current) {
      bySlot[slot] = item;
    } else if (item.layer_order > current.layer_order) {
      bySlot[slot] = item;
      hidden.push(current);
    } else {
      hidden.push(item);
    }
  }

  const top = bySlot.top;
  const bottom = bySlot.bottom;
  if (top && bottom && top.garment.category === "dress") {
    delete bySlot.bottom;
    hidden.push(bottom);
  }

  return { bySlot, hidden };
}

/**
 * Keyword -> hex lookup used to derive a color from free-text (garment.color
 * is a plain TextInput field on AddGarmentScreen/GarmentDetailScreen, e.g.
 * "navy", "olive green", "off white" — not guaranteed to be a hex code or a
 * valid CSS color keyword). Ordered most-specific-first so multi-word
 * phrases ("light blue") match before their generic substring ("blue").
 * Values are deliberately a bit muted/desaturated to match the character's
 * existing soft, non-shiny-plastic material roughness band.
 */
const COLOR_KEYWORDS: ReadonlyArray<readonly [string, string]> = [
  ["off white", "#F0E6D2"],
  ["ivory", "#F4F1E8"],
  ["cream", "#F0E6D2"],
  ["white", "#F4F1E8"],
  ["black", "#232028"],
  ["navy", "#2B3358"],
  ["light blue", "#8FB6D9"],
  ["sky blue", "#8FB6D9"],
  ["denim", "#5B7A9D"],
  ["blue", "#4C6FA5"],
  ["teal", "#3F8C82"],
  ["turquoise", "#3F8C82"],
  ["olive", "#6B7150"],
  ["green", "#5A8A5E"],
  ["khaki", "#B9A97C"],
  ["beige", "#D9C7A3"],
  ["camel", "#B98D57"],
  ["tan", "#C6A579"],
  ["brown", "#6B4A34"],
  ["burgundy", "#722F37"],
  ["maroon", "#7A2E33"],
  ["wine", "#722F37"],
  ["red", "#B84C3E"],
  ["coral", "#E08370"],
  ["rust", "#A85732"],
  ["orange", "#D98A3D"],
  ["mustard", "#C9A227"],
  ["gold", "#C9A227"],
  ["yellow", "#E1C24A"],
  ["blush", "#E7BFC7"],
  ["pink", "#E1A0B8"],
  ["magenta", "#B94C82"],
  ["lavender", "#B7A6F2"],
  ["violet", "#7A5FA8"],
  ["purple", "#7A5FA8"],
  ["charcoal", "#4A4458"],
  ["silver", "#C7C4D1"],
  ["grey", "#8A8794"],
  ["gray", "#8A8794"],
];

/** A small, pleasant, desaturated palette used ONLY when neither `color` nor `name` yields a keyword match — see `resolveGarmentColor`'s doc comment for the full fallback order. */
const NEUTRAL_GARMENT_PALETTE: readonly string[] = [
  "#B9AFE0", // soft lavender-gray
  "#9CB8A8", // sage
  "#D8B98F", // warm sand
  "#A8909E", // dusty mauve
  "#8FA5C2", // muted denim blue
  "#C2A98F", // taupe
];

/** Deterministic (non-cryptographic) string hash — used only to pick a stable index into NEUTRAL_GARMENT_PALETTE per garment id, never for anything security-sensitive. */
function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function matchColorKeyword(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [keyword, hex] of COLOR_KEYWORDS) {
    if (lower.includes(keyword)) return hex;
  }
  return null;
}

/**
 * Resolve a display color for a garment, in order:
 *  1. `garment.color` IS already a hex string (`#abc`/`#aabbcc`) -> used as-is.
 *  2. `garment.color` matches a known color-name keyword (see
 *     COLOR_KEYWORDS) -> that keyword's hex.
 *  3. `garment.name` matches a color-name keyword (garments are often named
 *     like "Navy Oxford Shirt") -> that keyword's hex.
 *  4. Otherwise, a deterministic pick from NEUTRAL_GARMENT_PALETTE keyed off
 *     the garment's id, so an uncolored garment still gets a stable, varied,
 *     pleasant tint instead of every uncolored item looking identical.
 */
export function resolveGarmentColor(
  garment: Pick<GarmentRow, "id" | "color" | "name">
): string {
  const rawColor = garment.color?.trim();
  if (rawColor) {
    if (HEX_COLOR_RE.test(rawColor)) {
      return rawColor;
    }
    const matchedFromColor = matchColorKeyword(rawColor);
    if (matchedFromColor) return matchedFromColor;
  }

  const rawName = garment.name?.trim();
  if (rawName) {
    const matchedFromName = matchColorKeyword(rawName);
    if (matchedFromName) return matchedFromName;
  }

  return NEUTRAL_GARMENT_PALETTE[hashString(garment.id) % NEUTRAL_GARMENT_PALETTE.length];
}

/** A GarmentVisual-shaped plain object (mirrors CharacterAvatar's GarmentVisual without importing three.js-adjacent code into this dependency-light module). */
export interface ResolvedGarmentVisual {
  color: string;
  name?: string;
  long?: boolean;
  /**
   * Remote image of the actual garment, planar-projected onto the front of
   * the slot's mesh by CharacterAvatar. Undefined means "no photo available"
   * — the slot renders as a flat `color` tint exactly as it did before
   * texturing existed. Must be a directly-fetchable http(s) URL: the renderer
   * hands it to three's TextureLoader as-is and cannot sign a storage path.
   */
  textureUrl?: string;
}

/**
 * The only URL shape the 3D renderer can consume directly.
 *
 * Deliberately narrower than lib/garmentImage.ts's resolver: that one also
 * handles `source: "upload"` garments, whose bytes sit in a **private**
 * Supabase bucket and need a short-lived signed URL. Signing is async and
 * needs the Supabase client, so it cannot happen in this module without
 * breaking its no-dependencies promise — hence uploads get `undefined` here.
 * That is not a dead end: a caller that has already signed the path (e.g. via
 * `resolveGarmentImageUrl`) is free to spread the result and set `textureUrl`
 * itself, and the renderer will texture it just the same.
 *
 * Matches garmentImage.ts in accepting any row carrying a usable `image_url`
 * rather than gating on `source === "catalog"`. In practice they're the same
 * set — the `garments_image_present` check constraint means an upload row
 * never has one — but keeping the two resolvers in agreement is worth more
 * than a redundant guard that would silently drop a renderable image.
 */
function usableTextureUrl(raw: string | null | undefined): string | undefined {
  const url = raw?.trim();
  if (!url) return undefined;
  return /^https?:\/\//i.test(url) ? url : undefined;
}

function externalImageUrl(
  garment: Pick<GarmentRow, "image_url">
): string | undefined {
  return usableTextureUrl(garment.image_url);
}

/** Build the {color, name, long, textureUrl} CharacterAvatar needs directly from a GarmentRow. */
export function garmentToVisual(garment: GarmentRow): ResolvedGarmentVisual {
  return {
    color: resolveGarmentColor(garment),
    name: garment.name ?? undefined,
    long: garment.category === "dress",
    textureUrl: externalImageUrl(garment),
  };
}

/**
 * The same shape, built from a Shop product the user tapped "Try it on" for —
 * i.e. an item that is *not* in their wardrobe yet.
 *
 * This is the case texturing exists for. Someone considering a $148 jacket has
 * to see that jacket, so the photo is chosen in the order that produces the
 * most convincing result:
 *
 *  1. `tryon_image_url` — a transparent cutout PNG when the partner supplied
 *     one. Strongly preferred: its alpha channel is what lets the garment's
 *     real silhouette read on the character instead of a rectangular photo
 *     card floating on the torso.
 *  2. `image_url` — the standard product shot. Always present, but usually
 *     opaque-on-white, so it renders as a photo panel rather than a cutout.
 *     Still far better than a flat tint.
 *
 * The choice is made on **usability, not on blankness**. `tryon_image_url`
 * arrives from partner catalog feeds we do not control, which is exactly where
 * a non-empty but malformed value ("not-a-url", a bare storage path, a
 * protocol-relative url) comes from. Selecting the cutout first and only then
 * testing the protocol let such a value win the choice and *then* fail, so a
 * perfectly good `image_url` was thrown away and the garment rendered as a
 * flat tint. Each candidate is now validated before it can win.
 *
 * `color` is resolved through the same `resolveGarmentColor` path a wardrobe
 * garment uses, so there is always a sensible tint underneath the photo — for
 * the sides and back of the mesh, and for the moments before the image lands
 * or after it fails to.
 *
 * Slotting is unchanged and stays the caller's call: pair this with
 * `mapCategoryToSlot(product.category)`, which sends `dress` to the `top`
 * slot (matched here by `long: true`, which hangs the skirt panel) and
 * `accessory` to the neckline slot.
 */
export function productToVisual(product: ProductWithBrand): ResolvedGarmentVisual {
  return {
    color: resolveGarmentColor({
      id: product.id,
      color: product.color,
      name: product.name,
    }),
    name: product.name,
    long: product.category === "dress",
    textureUrl:
      usableTextureUrl(product.tryon_image_url) ??
      usableTextureUrl(product.image_url),
  };
}
