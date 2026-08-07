import React, { useCallback, useState } from "react";
import {
  Image,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import type { GarmentCategory } from "../../lib/database.types";
import { colors, type } from "../../lib/theme";

/**
 * Every image the Shop renders, and what to draw when it isn't there.
 *
 * Product and brand artwork is the one part of the Shop we do not control:
 * it lives on a partner's CDN, behind a url we were handed in a feed. Those
 * urls rot. A brand re-platforms and every path 404s; a CDN edge times out on
 * hotel wifi; a feed ships a typo'd hostname that never resolved in the first
 * place. That is not an edge case to be tolerated once at launch — it is the
 * steady state of running an affiliate catalog, so the failure path here is
 * built to be *the* path, not a sad fallback bolted onto it.
 *
 * Three rules, enforced by the two components below and by nothing else in
 * the Shop touching `<Image>` directly:
 *
 *   1. **Never a blank void.** Something intentional always occupies the box.
 *   2. **Never a layout jump.** The placeholder and the real image fill the
 *      exact same frame, so a load that resolves late, early, or never at all
 *      produces identical geometry. The placeholder sits *underneath* the
 *      remote image rather than beside it, so there is no swap — the photo
 *      simply paints over the tile when (if) it arrives.
 *   3. **Never an infinite spinner.** A spinner is a promise that something
 *      is coming. For an image on a dead host nothing is coming, and there is
 *      no reliable "gave up" event from `<Image>` to dismiss it with. A
 *      finished-looking placeholder is honest at every point in time.
 */

// ---------------------------------------------------------------------------
// Bundled artwork
// ---------------------------------------------------------------------------

/**
 * URI scheme meaning "there is no partner artwork for this row; draw the
 * bundled placeholder instead". Used by `supabase/seed/001_brands_products.sql`
 * for its six invented brands, which have no CDN because they have no
 * existence — see that file's header for why the demo catalog ships this way.
 *
 * It is deliberately *not* an `https://` url. A fake https host is
 * indistinguishable from a real one that is merely down, so it burns a network
 * round trip and a timeout on every render before failing; a scheme we own is
 * recognised synchronously and never hits the network at all. It also fails
 * loudly rather than quietly if something downstream mistakes seed data for a
 * real feed — `productToVisual` in avatar3d, for instance, already refuses any
 * texture url that isn't http(s).
 */
export const BUNDLED_ART_SCHEME = "selv-asset:";

/** True for a url that names bundled artwork rather than a partner CDN object. */
export function isBundledArtUri(uri: string | null | undefined): boolean {
  return typeof uri === "string" && uri.trim().startsWith(BUNDLED_ART_SCHEME);
}

/**
 * Category tiles, two colourways each.
 *
 * Generated (not photographed, not licensed, not scraped): a soft diagonal
 * gradient drawn from the palette in `lib/theme.ts` with a flat garment
 * pictogram over it. They are unmistakably placeholders while still looking
 * like part of this app, which is the whole point — a grid of them reads as a
 * design decision rather than as thirty broken images.
 *
 * `require` paths must be static literals: Metro resolves them at build time,
 * which is exactly why these end up in the binary and work with the radio off.
 */
const CATEGORY_TILES: Record<
  GarmentCategory,
  readonly [ImageSourcePropType, ImageSourcePropType]
> = {
  top: [
    require("../../../assets/shop/tile-top-a.png"),
    require("../../../assets/shop/tile-top-b.png"),
  ],
  bottom: [
    require("../../../assets/shop/tile-bottom-a.png"),
    require("../../../assets/shop/tile-bottom-b.png"),
  ],
  dress: [
    require("../../../assets/shop/tile-dress-a.png"),
    require("../../../assets/shop/tile-dress-b.png"),
  ],
  outerwear: [
    require("../../../assets/shop/tile-outerwear-a.png"),
    require("../../../assets/shop/tile-outerwear-b.png"),
  ],
  shoes: [
    require("../../../assets/shop/tile-shoes-a.png"),
    require("../../../assets/shop/tile-shoes-b.png"),
  ],
  accessory: [
    require("../../../assets/shop/tile-accessory-a.png"),
    require("../../../assets/shop/tile-accessory-b.png"),
  ],
};

/** Shown when `category` is a value this build doesn't know — a newer feed, an older app. */
const UNKNOWN_CATEGORY_TILE = CATEGORY_TILES.top[0];

/**
 * Picks a colourway from `seed` so the choice is stable across re-renders and
 * across app launches (a tile that flickered between variants on every render
 * would be worse than no variation at all), but still varies between images.
 *
 * The variation earns its keep in two places: five tops from one brand no
 * longer render as five identical squares down a storefront, and a product's
 * hero and its thumbnail strip no longer look like the same photo repeated.
 */
function variantIndex(seed: string): 0 | 1 {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    // Cheap FNV-ish rolling hash. `| 0` keeps it in int32 so the arithmetic
    // stays exact instead of drifting into float territory on long urls.
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 2 === 0 ? 0 : 1;
}

/** The bundled tile for a category, seeded so repeats in a grid don't line up. */
export function categoryTile(
  category: GarmentCategory,
  seed = ""
): ImageSourcePropType {
  const pair = CATEGORY_TILES[category];
  if (!pair) return UNKNOWN_CATEGORY_TILE;
  return pair[variantIndex(seed || category)];
}

// ---------------------------------------------------------------------------
// ProductImage
// ---------------------------------------------------------------------------

export interface ProductImageProps {
  /**
   * Whatever the feed gave us: a real CDN url, a `selv-asset:` demo uri, an
   * empty string, or null. All four are handled; none of them are trusted.
   */
  uri: string | null | undefined;
  /** Chooses the pictogram. Always known — `brand_products.category` is not null. */
  category: GarmentCategory;
  /** The frame. Both layers fill it absolutely, so it must have a resolved size. */
  style?: StyleProp<ViewStyle>;
  /**
   * Screen-level failure memory, for surfaces that render the same url twice
   * (product detail's hero and its thumbnails). Without it each copy would
   * discover the 404 on its own, so tapping a dead thumbnail would flash a
   * broken hero before settling. `false` is fine for a lone image.
   */
  failed?: boolean;
  /** Fired once per url that fails, so the parent can populate `failed`. */
  onFailed?: (uri: string) => void;
}

/**
 * A product photo with the category tile permanently behind it.
 *
 * Note there is no `resizeMode` prop: product imagery is always `cover`.
 * Letting callers choose would let one screen letterbox a photo that another
 * crops, and the point of routing every product image through here is that a
 * product looks the same wherever it is found.
 */
export function ProductImage({
  uri,
  category,
  style,
  failed = false,
  onFailed,
}: ProductImageProps) {
  /**
   * Remembers *which* url failed rather than a bare boolean. The hero swaps
   * its uri as the user taps through the thumbnail strip, and a boolean would
   * make one dead image poison every later one in the same component.
   */
  const [failedUri, setFailedUri] = useState<string | null>(null);

  const trimmed = typeof uri === "string" ? uri.trim() : "";

  const handleError = useCallback(() => {
    setFailedUri(trimmed);
    if (trimmed.length > 0) onFailed?.(trimmed);
  }, [onFailed, trimmed]);

  const remoteUsable =
    trimmed.length > 0 &&
    !isBundledArtUri(trimmed) &&
    !failed &&
    failedUri !== trimmed;

  return (
    <View style={[styles.frame, style]}>
      <Image
        source={categoryTile(category, trimmed)}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
        // Decorative. The pressable/screen around it already carries the
        // product's accessible name, and announcing "image" after it is noise.
        accessible={false}
      />
      {remoteUsable && (
        <Image
          source={{ uri: trimmed }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onError={handleError}
          accessible={false}
        />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// BrandLogo
// ---------------------------------------------------------------------------

export interface BrandLogoProps {
  /** Drives the monogram. `brands.name` is not null, so there is always one letter. */
  name: string;
  /** Partner logo url, a `selv-asset:` demo uri, or null for a brand that never sent one. */
  logoUrl: string | null | undefined;
  /** The circular frame — the caller owns the diameter (rail: 56, storefront: 76). */
  style?: StyleProp<ViewStyle>;
  /** Monogram size, so the same component works at both diameters. */
  textStyle?: StyleProp<TextStyle>;
}

/**
 * A brand's logo, falling back to its monogram.
 *
 * Brands get a letter rather than one of the category tiles on purpose: a
 * monogram is different for every brand, so a rail of six of them still reads
 * as six distinct partners, where six identical grey tiles would read as a
 * failed fetch. `resizeMode="contain"` because a logo is artwork with its own
 * margins — cropping one to fill a circle mangles it.
 */
export function BrandLogo({ name, logoUrl, style, textStyle }: BrandLogoProps) {
  const [failed, setFailed] = useState(false);

  const trimmed = typeof logoUrl === "string" ? logoUrl.trim() : "";
  const remoteUsable = trimmed.length > 0 && !isBundledArtUri(trimmed) && !failed;

  // `•` only shows for a whitespace-only name, which the schema forbids — but
  // an empty circle is precisely the blank void this module exists to prevent.
  const monogram = name.trim().slice(0, 1).toUpperCase() || "•";

  return (
    <View style={[styles.logoFrame, style]}>
      <Text style={[styles.monogram, textStyle]} accessible={false}>
        {monogram}
      </Text>
      {remoteUsable && (
        <Image
          source={{ uri: trimmed }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
          onError={() => setFailed(true)}
          accessible={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    // The tile is opaque and fills the frame, so this only shows for the one
    // frame before the first paint. `surfaceAlt` keeps even that neutral.
    backgroundColor: colors.surfaceAlt,
    // Android does not clip children to a parent's borderRadius without it,
    // which would square off a rounded card's corners.
    overflow: "hidden",
  },
  logoFrame: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  monogram: {
    fontFamily: type.title.fontFamily,
    fontSize: 20,
    color: colors.accent,
  },
});
