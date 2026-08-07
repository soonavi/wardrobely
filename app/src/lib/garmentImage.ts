import { useMemo } from "react";
import { isBundledArtUri } from "../features/shop/productImagery";
import { getGarmentImageUrl } from "./api/garments";
import type { GarmentRow } from "./database.types";
import { useSignedImageUrl } from "./hooks/useSignedImageUrl";

/**
 * One place that answers "where does this garment's picture actually live?".
 *
 * Since the commerce migration a garment row can come from three completely
 * different places, and they need different handling:
 *
 *   * `source: "upload"` — the user photographed it. The bytes sit in our
 *     **private** `garments` storage bucket, so `image_path` must be traded
 *     for a short-lived signed URL before an <Image> can render it.
 *   * `source: "catalog"` — saved from the Shop. The bytes sit on the
 *     partner's public CDN, `image_path` is NULL, and `image_url` is already
 *     renderable. Asking storage to sign it would 404, and there is nothing
 *     private to protect.
 *   * `source: "catalog"`, but the url names **bundled artwork**. The demo
 *     catalog in supabase/seed/001_brands_products.sql has no CDN because its
 *     six brands do not exist, so its rows carry `selv-asset:` uris that mean
 *     "draw the bundled category tile". `saveProductToWardrobe`
 *     (src/lib/api/shop.ts) copies `image_url` verbatim into `garments`, so
 *     that uri walks straight out of the Shop and into the wardrobe.
 *
 * Before this module every screen reached for `garment.image_path` directly,
 * which stopped compiling the moment that column went nullable. The fix is
 * deliberately a *resolver* rather than a null check sprinkled at each call
 * site: the branch is a domain rule ("catalog imagery is public", "bundled art
 * is not fetched"), not a defensive one, and it should be stated once.
 */

/** A garment's image, narrowed to how it has to be fetched. */
export type GarmentImageSource =
  | { kind: "external"; url: string }
  | { kind: "storage"; path: string }
  /**
   * Bundled artwork — nothing to fetch, and nothing a URL can express.
   *
   * Modelled as its own kind rather than folded into `null` because those are
   * different facts: `null` means the row has no image, this means it has one
   * and it is already in the binary. Collapsing them here would make this
   * function — whose entire job is to say *where* the picture lives — say
   * "nowhere" about the one case where the answer is "right here", and would
   * push every future caller into re-detecting the scheme itself, which is the
   * duplication this module exists to prevent.
   *
   * The `uri` is carried through unparsed. It is the seed `categoryTile()`
   * hashes to pick a colourway, so a caller that renders the tile gets the
   * same variant the Shop showed for the same product.
   */
  | { kind: "bundled"; uri: string };

/**
 * The minimum a caller must supply. Structural rather than the full
 * `GarmentRow` so an outfit item's embedded garment, a partial select, or a
 * test fixture all work without casting.
 */
export type GarmentImageRef = Pick<
  GarmentRow,
  "source" | "image_path" | "image_url"
>;

/**
 * Where a garment's picture lives, or `null` if it has none.
 *
 * `image_url` is never handed back as an `external` url without going through
 * `externalOrBundled` first: a `selv-asset:` uri is a perfectly ordinary value
 * for that column since the Shop started seeding a demo catalog, and it is not
 * a URL anything can fetch.
 */
export function garmentImageSource(
  g: GarmentImageRef
): GarmentImageSource | null {
  if (g.source === "catalog") {
    // Catalog imagery is public partner CDN content — render it directly.
    // There is no object in our bucket to sign, so a missing url means the
    // row has no image at all rather than "sign it and see".
    return externalOrBundled(g.image_url);
  }

  if (g.image_path) {
    return { kind: "storage", path: g.image_path };
  }

  // Unreachable for well-formed rows — the `garments_image_present` check
  // constraint guarantees one of the two columns is set. Kept because a row
  // that somehow carries only a url is still renderable, and silently showing
  // nothing would be a worse outcome than trusting the column that is there.
  return externalOrBundled(g.image_url);
}

/**
 * Classify an `image_url`: bundled artwork, a fetchable url, or nothing.
 *
 * The scheme test comes from the Shop's `productImagery`, which owns
 * `selv-asset:` (it defines the scheme, the tiles, and `BUNDLED_ART_SCHEME`),
 * rather than being re-implemented here against a copied string literal. One
 * definition means the seed data, the Shop's `<ProductImage>` and the wardrobe
 * cannot drift into disagreeing about what a demo image is.
 */
function externalOrBundled(url: string | null): GarmentImageSource | null {
  if (!url) return null;
  if (isBundledArtUri(url)) return { kind: "bundled", uri: url };
  return { kind: "external", url };
}

/**
 * Resolve one garment to a URL an <Image> can use, or null if it has no
 * usable image / signing failed. Async only because the storage branch is;
 * the external branch resolves immediately.
 *
 * **Bundled art resolves to `null`, deliberately.** This function's contract
 * is a string a `<Image source={{ uri }}>` can fetch, and there is no such
 * string for an asset that lives in the binary — `require()` yields an opaque
 * module id, not a url. Returning the raw `selv-asset:` uri instead would
 * satisfy the type and hand every caller something guaranteed to fail, which
 * is precisely the broken-image square this change exists to remove; every
 * caller already branches on a falsy url and draws its own placeholder, so
 * `null` routes a demo garment to intentional artwork instead. (avatar3d's
 * `productToVisual` independently reached the same conclusion — it refuses any
 * texture url that isn't http(s).)
 *
 * Callers that want to draw the *tile* rather than a generic placeholder
 * should read `garmentImageSource` and handle `kind: "bundled"`; see the note
 * on `GarmentImageSource`.
 */
export async function resolveGarmentImageUrl(
  g: GarmentImageRef
): Promise<string | null> {
  const source = garmentImageSource(g);
  if (!source) return null;
  if (source.kind === "external") return source.url;
  if (source.kind === "bundled") return null;

  const { data } = await getGarmentImageUrl(source.path);
  return data ?? null;
}

/**
 * Batch version for thumbnail grids, **keyed by garment id**.
 *
 * The old helper this replaces keyed its cache by `image_path`, which a
 * catalog garment doesn't have (and `undefined` as an object key silently
 * collapses every catalog item onto one entry). Ids are already unique per
 * row and exist for both sources, so they're the only sane key.
 *
 * Garments that resolve to nothing are simply absent from the result, so a
 * caller can keep using `urls[garment.id] ? <Image/> : <Placeholder/>`. That
 * now includes demo garments saved out of the Shop, whose bundled-art uri is
 * not a fetchable url — see `resolveGarmentImageUrl`.
 */
export async function resolveGarmentImageUrls<
  T extends GarmentImageRef & { id: string }
>(garments: readonly T[]): Promise<Record<string, string>> {
  // The same garment can legitimately appear more than once in the input
  // (e.g. one wardrobe item worn in several outfits on the Outfits grid) —
  // dedupe so it isn't signed twice per load.
  const unique = new Map<string, T>();
  for (const garment of garments) {
    if (!unique.has(garment.id)) unique.set(garment.id, garment);
  }

  const entries = await Promise.all(
    Array.from(unique.values()).map(
      async (garment) =>
        [garment.id, await resolveGarmentImageUrl(garment)] as const
    )
  );

  const result: Record<string, string> = {};
  for (const [id, url] of entries) {
    if (url) result[id] = url;
  }
  return result;
}

/**
 * Hook form of the above, for screens that render a single garment.
 *
 * Signs only when the garment's image lives in our bucket; a catalog
 * garment's CDN url is returned synchronously with `loading: false`, so its
 * detail screen never flashes a spinner for an image it already has. A bundled
 * demo garment resolves the same way but to `null` — settled, not loading, not
 * an error — because there is nothing to wait for and nothing went wrong.
 */
export function useGarmentImageUrl(
  garment: GarmentImageRef | null | undefined
): { url: string | null; loading: boolean; error: string | null } {
  const source = useMemo(
    () => (garment ? garmentImageSource(garment) : null),
    // Depend on the three fields rather than object identity: callers
    // typically hold the row in state, and a re-fetch producing an equal row
    // shouldn't re-sign the image.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [garment?.source, garment?.image_path, garment?.image_url]
  );

  // Hooks can't be called conditionally, so the signing hook always runs and
  // is handed `null` (a documented no-op for it) on the external branch.
  const signed = useSignedImageUrl(
    source?.kind === "storage" ? source.path : null
  );

  if (source?.kind === "external") {
    return { url: source.url, loading: false, error: null };
  }

  if (source?.kind === "bundled") {
    return { url: null, loading: false, error: null };
  }

  return signed;
}
