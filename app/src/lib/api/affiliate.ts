import { supabase } from "../supabase";
import type {
  AffiliateClickRow,
  AffiliateConversionRow,
  BrandProductRow,
  BrandRow,
  ClickSource,
} from "../database.types";
import {
  commissionCents,
  effectivePriceCents,
  resolveCommissionRateBps,
} from "../commerce/commission";
import type { ProductWithBrand } from "./shop";

/**
 * The money path: turning a Buy tap into a tracked handoff, and reading back
 * the conversions those handoffs produced.
 *
 * The whole business model narrows to one moment — the user leaves the app
 * for a partner's product page. At that instant we must (a) mint a token the
 * network will echo back to us on a sale, and (b) write down the commercial
 * terms as they stand right now, because by the time the postback arrives
 * days or weeks later the brand's rate and the product's price may both have
 * changed. Everything in this file exists to make that moment durable.
 *
 * Both of those happen in the database, not here. `createCheckoutLink` calls
 * the `create_affiliate_click` RPC and receives a finished click row; this
 * file never states a rate, a price, a brand or a token. That split is the
 * point: the client decides *that* a click happened, the server decides what
 * it is worth. See the affiliate_clicks RLS comment in supabase/schema.sql.
 *
 * Kept apart from api/shop.ts on purpose: browsing is a read path that can be
 * loosened, cached and retried freely, while this one writes revenue-bearing
 * records and must not be.
 */

/** Local re-declaration, matching the convention in outfits.ts and garments.ts. */
export interface ApiResult<T> {
  data: T | null;
  error: string | null;
}

/**
 * A conversion joined to what was bought. Both joins are nullable and not
 * inner: `product_id` is `on delete set null` (the product may be long gone),
 * and a brand that has since been paused is hidden by RLS. An order the user
 * genuinely placed must still appear in their history even when we can no
 * longer say much about the item, so the UI falls back to the stored order
 * total rather than the row disappearing.
 */
export interface ConversionWithProduct extends AffiliateConversionRow {
  product: BrandProductRow | null;
  brand: BrandRow | null;
}

export interface CreateCheckoutLinkInput {
  /**
   * Kept for call-site compatibility, but no longer sent anywhere: the click
   * row's `user_id` is taken from `auth.uid()` inside the RPC, because a
   * client-supplied owner on a revenue-bearing row is exactly the sort of
   * thing this path stopped trusting. Passing someone else's id here has no
   * effect.
   */
  userId: string;
  product: ProductWithBrand;
  /** Where in the app the Buy tap happened; drives attribution reporting. Defaults to `"shop"`. */
  source?: ClickSource;
}

export interface CheckoutLink {
  /** The tracked URL to open in the browser / in-app browser. */
  url: string;
  /** The subid embedded in `url`; the join key a postback will come back on. */
  clickToken: string;
  /** Primary key of the `affiliate_clicks` row this call created. */
  clickId: string;
}

/**
 * Build the tracked outbound URL for a product.
 *
 * Pure and exported separately from `createCheckoutLink` so it can be unit
 * tested and — more importantly — so the service-role edge functions that
 * re-derive a link (for a re-sent email, or for a partner-facing preview) use
 * byte-identical logic instead of a second implementation that drifts.
 *
 * Two shapes exist because affiliate networks disagree about who owns the
 * URL. Most hand you a wrapper you must send the user through, expressed here
 * as a template with `{URL}` and `{SUBID}` placeholders; the `{URL}` value is
 * URI-encoded because it becomes a query parameter *inside* the wrapper, and
 * an un-encoded `?` or `&` in the product url would truncate it. Direct
 * partners have no wrapper at all, so we append our own subid plus utm params
 * to the product url instead and they read it off their own analytics.
 *
 * A malformed `productUrl` returns unchanged rather than throwing. A Buy
 * button that opens an untracked page is a lost commission; a Buy button that
 * throws is a broken app, and the product url came from a partner feed we
 * don't control.
 */
export function buildAffiliateUrl(
  productUrl: string,
  clickToken: string,
  template: string | null
): string {
  if (template && template.trim().length > 0) {
    return template
      .replace(/\{URL\}/g, encodeURIComponent(productUrl))
      .replace(/\{SUBID\}/g, encodeURIComponent(clickToken));
  }

  try {
    // `URL` is guaranteed present in the RN runtime: lib/supabase.ts imports
    // react-native-url-polyfill/auto, and this module depends on it.
    const url = new URL(productUrl);
    // `set`, not `append`, so re-linking an already-tagged url replaces the
    // stale token instead of sending two conflicting subids to the partner.
    url.searchParams.set("selv_subid", clickToken);
    url.searchParams.set("utm_source", "selv");
    url.searchParams.set("utm_medium", "affiliate");
    return url.toString();
  } catch {
    return productUrl;
  }
}

/** Shown when we can't mint a click, so the Buy tap fails visibly rather than silently. */
const GENERIC_CLICK_ERROR = "Couldn't open this item right now. Please try again.";

/** Shown when the catalog row is gone, withdrawn, or its brand isn't live. */
const UNAVAILABLE_CLICK_ERROR = "This item is no longer available.";

/**
 * Turn a `create_affiliate_click` failure into something a shopper can read.
 *
 * The RPC signals with SQLSTATEs rather than message text so this mapping
 * doesn't depend on wording: `42501` for an unauthenticated caller, `P0002`
 * for a product that doesn't exist, has been withdrawn, or belongs to a brand
 * that isn't `active`. The three unavailability cases collapse to one message
 * on purpose — the distinction matters in our logs, not to the user, who only
 * needs to know the item can't be bought.
 *
 * `error.message` is deliberately not surfaced: it carries internal ids and
 * partner status, and the raw text of an RLS or constraint failure is noise
 * in a Buy sheet. The `PostgrestError` still reaches the console/telemetry via
 * the caller if they want it.
 */
function describeClickError(error: { code?: string | null }): string {
  switch (error.code) {
    case "42501":
      return "Please sign in to shop.";
    case "P0002":
      return UNAVAILABLE_CLICK_ERROR;
    default:
      return GENERIC_CLICK_ERROR;
  }
}

/**
 * Normalise the RPC payload to a single row.
 *
 * `create_affiliate_click` returns a non-SETOF composite, which PostgREST
 * renders as a bare object — but the same schema-cache/version quirk that
 * makes a to-one embed come back as a single-element array elsewhere in this
 * codebase applies here too. Accepting both costs three lines and removes an
 * entire class of "worked in staging" failure on the one path where failing
 * means losing a commission.
 */
function firstClickRow(
  data: AffiliateClickRow | AffiliateClickRow[] | null
): AffiliateClickRow | null {
  if (!data) return null;
  const row = Array.isArray(data) ? (data[0] ?? null) : data;
  return row && typeof row.click_token === "string" && row.click_token.length > 0
    ? row
    : null;
}

/**
 * Record a click-out and return the tracked URL to open.
 *
 * Delegates to the `create_affiliate_click` RPC rather than inserting into
 * `affiliate_clicks`, because the two numbers this row snapshots — the
 * commission rate and the price at click time — are what we later invoice a
 * brand for, and a client must not be able to state them. The RPC resolves
 * both server-side from the catalog with the same precedence as
 * `resolveCommissionRateBps` / `effectivePriceCents`, along with the owning
 * brand and the click token; `affiliate_clicks` has no client insert policy
 * at all, so there is no second path to keep in sync. See the RLS comment in
 * supabase/schema.sql for the full reasoning, and do not "optimise" this back
 * into a direct insert.
 *
 * The product object is still read locally for `product_url` and the brand's
 * `affiliate_url_template`, which is fine and not an oversight: those decide
 * only *where the user is sent*, never what we bill. A tampered template
 * sends the tamperer to a page of their choosing without a valid token
 * attached, which costs them the purchase and costs us nothing.
 *
 * If the call fails we return the error and **no URL**, rather than falling
 * back to opening an untracked link. That is a deliberate trade of
 * conversions for correctness: an untracked click-out earns nothing, teaches
 * us nothing, and looks to the user exactly like a successful purchase we'll
 * never see — so it produces silent, permanent revenue loss that no metric
 * reveals. A visible "couldn't open this right now, try again" is recoverable
 * in a way that a missing commission is not. If we ever want the opposite
 * behaviour it must be an explicit opt-in flag, never the default.
 */
export async function createCheckoutLink(
  input: CreateCheckoutLinkInput
): Promise<ApiResult<CheckoutLink>> {
  const { product, source = "shop" } = input;

  const { data, error } = await supabase.rpc("create_affiliate_click", {
    p_product_id: product.id,
    p_source: source,
  });

  if (error) {
    return { data: null, error: describeClickError(error) };
  }

  const click = firstClickRow(data);
  if (!click) {
    // The RPC raises on every failure it knows about, so an empty success
    // body means something upstream (a proxy, a schema-cache miss) mangled
    // the response. Treat it exactly like a failed insert: no token means no
    // attribution, and an untracked handoff is worse than none.
    return { data: null, error: GENERIC_CLICK_ERROR };
  }

  // The authoritative token, minted by the database — never one this client
  // chose.
  const url = buildAffiliateUrl(
    product.product_url,
    click.click_token,
    product.brand.affiliate_url_template
  );

  return {
    data: { url, clickToken: click.click_token, clickId: click.id },
    error: null,
  };
}

/**
 * The user's own reported purchases, newest first.
 *
 * Reads `affiliate_conversions`, which RLS scopes to `user_id = auth.uid()`
 * — the `userId` filter here is for index selectivity and readability, not
 * security. Note this is *our* view of their orders, assembled from partner
 * postbacks: it lags the actual purchase, may never arrive if a network drops
 * the subid, and shows `pending` until the return window closes. It is not a
 * receipt, and UI built on it should not imply otherwise.
 */
export async function listMyOrders(
  userId: string
): Promise<ApiResult<ConversionWithProduct[]>> {
  const { data, error } = await supabase
    .from("affiliate_conversions")
    .select("*, product:brand_products(*), brand:brands(*)")
    .eq("user_id", userId)
    .order("occurred_at", { ascending: false });

  if (error) {
    return { data: null, error: error.message };
  }

  // Cast through `unknown` for the same reason as api/shop.ts: the
  // hand-written Database type declares no `Relationships`, so supabase-js
  // can't infer the shape of an embedded select.
  const rows = (data ?? []) as unknown as ConversionWithProduct[];

  return { data: rows, error: null };
}

/**
 * What Selv earns if this product sells at the price currently shown.
 *
 * An estimate, not a booking: it assumes a single unit, no shipping, no tax,
 * no basket-level discount, and that the sale is approved rather than
 * reversed. Real commission is computed by the postback edge function from
 * the order total the network reports. Intended for internal and
 * brand-facing surfaces ("you'd earn $4.95 on this"), not for anything shown
 * to a shopper.
 */
export function estimatedCommissionCents(product: ProductWithBrand): number {
  const rateBps = resolveCommissionRateBps(
    product.commission_rate_bps,
    product.brand.commission_rate_bps
  );
  return commissionCents(effectivePriceCents(product), rateBps);
}
