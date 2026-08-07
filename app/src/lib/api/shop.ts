import { supabase } from "../supabase";
import type {
  BrandProductRow,
  BrandRow,
  GarmentCategory,
  GarmentRow,
} from "../database.types";
import { canAddGarment, getCurrentPlan, wardrobeLimitMessage } from "../pricing";

/**
 * Read path for the Shop tab: partner brands, their catalog, the user's
 * wishlist, and the bridge that copies a shop product into a wardrobe.
 *
 * Everything here is a *read* or a user-owned bookmark. The money path — the
 * tracked click-out and the conversions it produces — lives in
 * api/affiliate.ts, deliberately split off so that a change to how the Shop
 * lists products can never accidentally alter how a click is attributed.
 */

/** Local re-declaration, matching the convention in outfits.ts and garments.ts. */
export interface ApiResult<T> {
  data: T | null;
  error: string | null;
}

// Re-exported so Shop screens can import their row types from the same module
// as the functions that return them, instead of reaching into database.types.
export type { BrandProductRow, BrandRow };

/**
 * A product row with its brand attached. The brand is non-optional because
 * every query below uses an inner join — a product whose brand is hidden
 * isn't a product with a missing brand, it's a product that should not have
 * been returned at all. Downstream code (pricing, commission, the Buy button)
 * needs the brand's rate and URL template, so making it non-nullable here
 * saves every one of those call sites a null check.
 */
export interface ProductWithBrand extends BrandProductRow {
  brand: BrandRow;
}

/**
 * `!inner` matters: without it PostgREST would return catalog rows with a
 * null brand once RLS hides a paused partner, instead of dropping the row.
 * The `brand_products` RLS policy already gates on the parent brand's status,
 * so this is a second, client-side expression of the same rule — cheap
 * insurance against a policy regression silently exposing a paused brand's
 * catalog with no brand name attached.
 */
const PRODUCT_SELECT = "*, brand:brands!inner(*)";

/** Page size when a caller doesn't specify one — roughly three screens of grid. */
const DEFAULT_PRODUCT_LIMIT = 40;

/** Hard ceiling on a single page, so a bad caller can't pull the whole catalog over cellular. */
const MAX_PRODUCT_LIMIT = 100;

export interface SearchProductsOptions {
  /** Free-text search, run against the DB's generated `search_tsv` column. */
  query?: string;
  category?: GarmentCategory;
  brandId?: string;
  maxPriceCents?: number;
  onSaleOnly?: boolean;
  sort?: "newest" | "price_asc" | "price_desc";
  limit?: number;
  offset?: number;
}

/**
 * The row shape PostgREST actually returns for `PRODUCT_SELECT`.
 *
 * The hand-written `Database` type declares `Relationships: []` for every
 * table, so supabase-js can't infer embedded-resource shapes and types the
 * result of any joined select as an error/unknown. Casting through `unknown`
 * into this explicit shape keeps the rest of the file honestly typed without
 * an `any` — the same problem outfits.ts solves with `(row: any)`, handled
 * here in one place rather than at every map callback.
 */
type JoinedProductRow = BrandProductRow & { brand: BrandRow | null };

/** Narrow raw PostgREST output to fully-formed products, dropping any row whose join came back empty. */
function toProductsWithBrand(data: unknown): ProductWithBrand[] {
  const rows = (data ?? []) as JoinedProductRow[];
  return rows.filter((row): row is ProductWithBrand => row.brand !== null);
}

/**
 * All live partner brands, alphabetical. RLS restricts this to
 * `status = 'active'`, so a paused or not-yet-launched partner simply isn't
 * in the result — there is no client-side status filter to forget.
 */
export async function listBrands(): Promise<ApiResult<BrandRow[]>> {
  const { data, error } = await supabase
    .from("brands")
    .select("*")
    .order("name", { ascending: true });

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: (data ?? []) as BrandRow[], error: null };
}

/**
 * Fetch one brand for its storefront header. Uses `maybeSingle` rather than
 * `single` because "brand went paused while the user was looking at it" is a
 * normal outcome that RLS turns into zero rows, and that should read as a
 * missing brand, not as a database error.
 */
export async function getBrand(brandId: string): Promise<ApiResult<BrandRow>> {
  const { data, error } = await supabase
    .from("brands")
    .select("*")
    .eq("id", brandId)
    .maybeSingle();

  if (error) {
    return { data: null, error: error.message };
  }

  if (!data) {
    return { data: null, error: "Brand not found" };
  }

  return { data: data as BrandRow, error: null };
}

/**
 * The one query behind the whole Shop tab: browse, category tabs, brand
 * storefronts, the search box and the sale rail all call this with different
 * options rather than each getting a bespoke function that drifts.
 *
 * `is_active` is filtered unconditionally and is not exposed as an option —
 * there is no legitimate client reason to see a delisted product, and making
 * it a parameter would eventually get passed `false` by a debugging screen
 * that then ships.
 */
export async function searchProducts(
  opts: SearchProductsOptions = {}
): Promise<ApiResult<ProductWithBrand[]>> {
  const limit = Math.min(
    Math.max(opts.limit ?? DEFAULT_PRODUCT_LIMIT, 1),
    MAX_PRODUCT_LIMIT
  );
  const offset = Math.max(opts.offset ?? 0, 0);

  let query = supabase
    .from("brand_products")
    .select(PRODUCT_SELECT)
    .eq("is_active", true);

  const trimmedQuery = opts.query?.trim();
  if (trimmedQuery) {
    // `websearch` accepts what a shopper actually types — quoted phrases,
    // `-excluded` terms, bare words — without us having to sanitise it into
    // tsquery syntax. The alternative (`plain`) would make a stray quote
    // character a 400 from PostgREST.
    query = query.textSearch("search_tsv", trimmedQuery, { type: "websearch" });
  }

  if (opts.category) {
    query = query.eq("category", opts.category);
  }

  if (opts.brandId) {
    query = query.eq("brand_id", opts.brandId);
  }

  if (typeof opts.maxPriceCents === "number") {
    query = query.lte("price_cents", opts.maxPriceCents);
  }

  if (opts.onSaleOnly) {
    // PostgREST can't compare two columns, so this can only assert that a
    // sale price exists — it can't assert that it's actually lower. Rows with
    // a stale sale price equal to the list price slip through, which is why
    // the UI must still render through `isOnSale`/`effectivePriceCents`
    // rather than trusting this filter to mean "discounted".
    query = query.not("sale_price_cents", "is", null);
  }

  switch (opts.sort) {
    case "price_asc":
    case "price_desc":
      // Ordered on list price, not effective (sale) price. Sorting on the
      // discounted price would need a stored generated column, and computing
      // it client-side would only fix the ordering *within* a page while
      // silently changing which rows land in it. A discounted item therefore
      // sorts by what it was, not what it costs — accepted for now; the fix
      // is an `effective_price_cents` generated column, not a client patch.
      query = query.order("price_cents", {
        ascending: opts.sort === "price_asc",
      });
      break;
    case "newest":
    default:
      query = query.order("created_at", { ascending: false });
      break;
  }

  // Deterministic tiebreak. Without it, rows sharing a sort value can come
  // back in a different order per page and pagination duplicates or skips
  // products as the user scrolls.
  query = query.order("id", { ascending: true }).range(offset, offset + limit - 1);

  const { data, error } = await query;

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: toProductsWithBrand(data), error: null };
}

/** Fetch one product with its brand, for the product detail screen. */
export async function getProduct(
  productId: string
): Promise<ApiResult<ProductWithBrand>> {
  const { data, error } = await supabase
    .from("brand_products")
    .select(PRODUCT_SELECT)
    .eq("id", productId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    return { data: null, error: error.message };
  }

  // Covers three cases that are indistinguishable to the client and should
  // all read the same way: no such product, it was delisted, or its brand was
  // paused (RLS drops it, and the inner join drops it again).
  const product = toProductsWithBrand(data ? [data] : [])[0];
  if (!product) {
    return { data: null, error: "Product not available" };
  }

  return { data: product, error: null };
}

/**
 * The user's saved products, newest save first.
 *
 * Wishlist rows outlive the products they point at — a partner can pause or
 * delist at any time — so the inner joins here deliberately drop entries that
 * are no longer buyable instead of surfacing a tombstone the user can't act
 * on. The `wishlist_items` row itself is left alone; if the brand comes back,
 * so does the saved product.
 */
export async function listWishlist(
  userId: string
): Promise<ApiResult<ProductWithBrand[]>> {
  const { data, error } = await supabase
    .from("wishlist_items")
    .select(`product:brand_products!inner(${PRODUCT_SELECT})`)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    return { data: null, error: error.message };
  }

  // No `is_active` filter is needed: the "public active brand products" RLS
  // policy already hides delisted rows, and the inner join then drops the
  // wishlist entry that pointed at one.
  const rows = (data ?? []) as unknown as {
    product: JoinedProductRow | null;
  }[];

  const products = rows
    .map((row) => row.product)
    .filter((product): product is JoinedProductRow => product !== null);

  return { data: toProductsWithBrand(products), error: null };
}

/**
 * Save a product for later. Upserts rather than inserts so double-tapping
 * the heart is a no-op instead of a primary-key violation the UI would have
 * to translate back into "already saved".
 */
export async function addToWishlist(
  userId: string,
  productId: string
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("wishlist_items")
    .upsert(
      { user_id: userId, product_id: productId },
      { onConflict: "user_id,product_id", ignoreDuplicates: true }
    );

  return { error: error ? error.message : null };
}

/** Remove a product from the wishlist. Deleting a row that isn't there is not an error. */
export async function removeFromWishlist(
  userId: string,
  productId: string
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("wishlist_items")
    .delete()
    .eq("user_id", userId)
    .eq("product_id", productId);

  return { error: error ? error.message : null };
}

/**
 * Whether this product is already saved. Uses a `head: true` count so the
 * product detail screen can render its heart in the correct state without
 * pulling a row body it has no use for.
 */
export async function isWishlisted(
  userId: string,
  productId: string
): Promise<ApiResult<boolean>> {
  const { count, error } = await supabase
    .from("wishlist_items")
    .select("product_id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("product_id", productId);

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: (count ?? 0) > 0, error: null };
}

/**
 * Log that the user put this product on their avatar.
 *
 * Fire-and-forget by contract: this is analytics feeding the try-on ->
 * click-out conversion ratio, and nothing the user sees depends on it. It
 * returns void and swallows every failure — including a thrown network error,
 * which is why the whole body sits in a try/catch rather than only checking
 * the returned `error`. A dropped analytics row is invisible; a rejected
 * promise from a call site that reasonably didn't `await` it is a red screen.
 */
export async function recordProductTryOn(
  userId: string,
  productId: string
): Promise<void> {
  try {
    await supabase
      .from("product_try_ons")
      .insert({ user_id: userId, product_id: productId });
  } catch {
    // Intentionally ignored — see the doc comment above.
  }
}

/**
 * Copy a shop product into the user's wardrobe so it can be styled into
 * outfits alongside garments they photographed themselves.
 *
 * Three things this has to get right:
 *
 * 1. **No duplicates.** Checked first, before the plan cap, so a user who is
 *    at their limit and taps Save on something they already saved gets their
 *    existing garment back rather than an upgrade prompt for a row that
 *    already exists. A partial unique index on `(user_id, product_id)` backs
 *    this up in the DB, because this read-then-write can be raced by two
 *    fast taps.
 * 2. **The free-tier cap.** Re-checked here against a live server-side count
 *    for the same reason `createGarment` does it: the Shop is a second entry
 *    point into wardrobe creation, and a cap enforced only at the original
 *    entry point isn't enforced at all.
 * 3. **Imagery.** Catalog garments have no object in our private storage
 *    bucket, so `image_path` is null and `image_url` carries a partner CDN
 *    url instead. The transparent cutout is preferred when the partner
 *    supplied one, since that's what the 2D try-on collage needs; otherwise
 *    the standard product shot stands in.
 */
export async function saveProductToWardrobe(
  userId: string,
  product: ProductWithBrand
): Promise<ApiResult<GarmentRow>> {
  const { data: existing, error: existingError } = await supabase
    .from("garments")
    .select("*")
    .eq("user_id", userId)
    .eq("product_id", product.id)
    .maybeSingle();

  if (existingError) {
    return { data: null, error: existingError.message };
  }

  if (existing) {
    return { data: existing as GarmentRow, error: null };
  }

  const { count, error: countError } = await supabase
    .from("garments")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (countError) {
    return { data: null, error: countError.message };
  }

  if (!canAddGarment(count ?? 0, getCurrentPlan())) {
    return { data: null, error: wardrobeLimitMessage() };
  }

  const { data, error } = await supabase
    .from("garments")
    .insert({
      user_id: userId,
      image_path: null,
      image_url: product.tryon_image_url ?? product.image_url,
      product_id: product.id,
      category: product.category,
      name: product.name,
      brand: product.brand.name,
      color: product.color,
      tags: product.tags,
      // `source: 'catalog'` is what tells the wardrobe and try-on screens to
      // render `image_url` directly instead of asking storage to sign a path.
      source: "catalog",
      // Carried over so a catalog garment can be textured onto the shared 3D
      // mesh immediately, without waiting for the template matcher to run.
      template_id: product.template_id,
      // Partner imagery is already cut out and colour-corrected — there is no
      // background-removal pass to wait on, unlike an uploaded photo.
      processing_status: "ready",
    })
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as GarmentRow, error: null };
}
