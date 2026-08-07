/**
 * Commission and price math for the affiliate loop — single source of truth
 * for how much Selv earns on a sale and what a shopper is shown as the price.
 *
 * Pure by design: no imports, no Supabase, no React. Every function here is
 * called from three places that must never disagree — the client (to show a
 * price and an estimated commission), the click writer (to snapshot a rate
 * into `affiliate_clicks`), and the service-role postback edge function (to
 * value a conversion). If this file reached for the network or the DB, the
 * edge function couldn't share it and the two would drift.
 *
 * Two conventions hold throughout, matching supabase/schema.sql:
 *   * money is integer **cents**, never a float. Floating-point money that is
 *     off by a fraction of a cent per click becomes a reconciliation dispute
 *     with a partner at volume.
 *   * rates are integer **basis points** (1 bps = 0.01%), so 1000 bps = 10%.
 *     Basis points let us store "12.5%" exactly as 1250 with no decimals.
 *
 * Every function is total: given garbage (NaN, Infinity, negatives, a rate of
 * 50000) it returns a sane number rather than throwing or propagating NaN
 * into a UI. Partner feeds and network postbacks are untrusted input, and a
 * price row rendering as "$NaN" is a worse failure than a clamped one.
 */

/**
 * Fallback commission when neither the product nor its brand specifies one —
 * 10%, the rate our standard partner agreement opens at. Only reached for
 * malformed data, since `brands.commission_rate_bps` is NOT NULL with the
 * same default at the DB level.
 */
export const PLATFORM_DEFAULT_COMMISSION_BPS = 1000; // 10%

/**
 * Upper bound on any rate: 10000 bps = 100%. Mirrors the
 * `check (commission_rate_bps between 0 and 10000)` constraint on both
 * `brands` and `brand_products`, so client-side clamping and DB validation
 * agree on what "impossible" means.
 */
const MAX_COMMISSION_BPS = 10000;

/**
 * The subset of a product row this module needs to price something. Declared
 * structurally rather than importing `BrandProductRow` so callers can pass a
 * partial row, a form draft, or a test fixture — and so this file keeps its
 * zero-import purity.
 */
export interface PricedItem {
  price_cents: number;
  sale_price_cents: number | null;
}

/**
 * True when `value` is usable as a rate: a finite number inside 0..10000.
 * Note that `0` passes — a zero rate is a real commercial term (plenty of
 * partners pay nothing on clearance), which is exactly why the callers below
 * can never use `??`-on-falsy to detect an absent rate.
 */
function isUsableRateBps(value: number | null | undefined): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_COMMISSION_BPS
  );
}

/** Coerce anything into a non-negative, finite integer cent amount. */
function sanitizeCents(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.round(value);
}

/**
 * Decide the commission rate for a product: the per-product override wins,
 * then the brand default, then the platform default.
 *
 * The precedence itself is obvious; the subtlety is that a product override
 * of `0` must beat a brand default of 1200, because "we pay nothing on this
 * SKU" is a term partners actually negotiate. That rules out the tempting
 * `productOverrideBps ?? brandDefaultBps ?? DEFAULT` one-liner in any form
 * that treats 0 as absent, and it's why the check is an explicit range test.
 *
 * Out-of-range values (a feed sending 50000, a negative from a bad import)
 * are treated as absent rather than clamped — a nonsense number is more
 * likely a parsing bug than a real 500% rate, and falling through to the next
 * level of the chain is the conservative reading.
 */
export function resolveCommissionRateBps(
  productOverrideBps: number | null | undefined,
  brandDefaultBps: number | null | undefined
): number {
  if (isUsableRateBps(productOverrideBps)) return productOverrideBps;
  if (isUsableRateBps(brandDefaultBps)) return brandDefaultBps;
  return PLATFORM_DEFAULT_COMMISSION_BPS;
}

/**
 * What Selv earns on an order of `orderTotalCents` at `rateBps`.
 *
 * Rounds half up (0.5 cents becomes 1 cent) rather than using banker's
 * rounding, because that is what every affiliate network's own statement
 * does — matching them keeps our ledger and their remittance advice equal to
 * the cent, so a mismatch is always a real discrepancy and never a rounding
 * convention. The multiply happens before the divide so the intermediate
 * stays an exact integer (well inside 2^53 for any plausible order value)
 * instead of accumulating float error from a `rate / 10000` fraction.
 *
 * Negative or non-finite input clamps to 0: a refund is modelled as a
 * `reversed` conversion, never as negative commission, and the caller that
 * hands us NaN would otherwise write NaN into a NOT NULL money column.
 */
export function commissionCents(
  orderTotalCents: number,
  rateBps: number
): number {
  const total = sanitizeCents(orderTotalCents);
  if (total === 0) return 0;

  // Unlike resolveCommissionRateBps, an out-of-range rate is clamped rather
  // than rejected: by the time we're computing money the rate has already
  // been chosen, and the only safe reading of "150%" is "100%".
  const rate =
    typeof rateBps === "number" && Number.isFinite(rateBps)
      ? Math.min(Math.max(rateBps, 0), MAX_COMMISSION_BPS)
      : 0;
  if (rate === 0) return 0;

  return Math.round((total * rate) / MAX_COMMISSION_BPS);
}

/**
 * The price a shopper actually pays right now — the sale price when one is
 * set AND strictly below the list price, otherwise the list price.
 *
 * The "strictly below" test is not defensive paranoia: partner feeds
 * routinely leave a stale `sale_price_cents` equal to (or above) the list
 * price after a promotion ends, and honouring it would render "$118, was
 * $118" with a 0% discount badge. Every price shown, every click snapshot
 * and every commission estimate goes through here so the app never reads
 * `price_cents` raw.
 */
export function effectivePriceCents(p: PricedItem): number {
  const list = sanitizeCents(p?.price_cents);
  const sale = p?.sale_price_cents;

  if (
    typeof sale === "number" &&
    Number.isFinite(sale) &&
    sale >= 0 &&
    sale < list
  ) {
    return Math.round(sale);
  }

  return list;
}

/** Whether to show a strike-through list price and a sale badge for this item. */
export function isOnSale(p: PricedItem): boolean {
  return effectivePriceCents(p) < sanitizeCents(p?.price_cents);
}

/**
 * Percentage off, rounded to a whole number for the badge ("30% off"), or
 * `null` when the item isn't discounted — a `null` return is what lets a
 * caller write `{pct !== null && <Badge …/>}` instead of testing for 0,
 * which would be ambiguous with a genuine sub-0.5% markdown.
 */
export function discountPercent(p: PricedItem): number | null {
  const list = sanitizeCents(p?.price_cents);
  if (list === 0) return null;

  const effective = effectivePriceCents(p);
  if (effective >= list) return null;

  return Math.round(((list - effective) / list) * 100);
}

/** Currency symbols we have real partners in. Anything else falls back to the ISO code. */
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  GBP: "£",
  EUR: "€",
};

/** Group the integer part with commas: 125000 -> "1,250". */
function groupThousands(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Render integer cents as display money: `4800` -> `"$48.00"`.
 *
 * Hand-rolled rather than `Intl.NumberFormat` because React Native's Hermes
 * engine ships without full ICU on Android unless the app opts into a larger
 * binary, so `Intl` silently produces different output per platform. A price
 * that reads differently on iOS and Android is a bug we'd only find in
 * screenshots, so we take deterministic formatting over locale awareness.
 *
 * Unknown currency codes degrade to `"JPY 4800.00"` rather than guessing a
 * symbol. Negative amounts (only reachable from a reversal calculation)
 * render as `"-$48.00"` with the sign outside the symbol.
 */
export function formatPrice(cents: number, currency: string = "USD"): string {
  const safeCents =
    typeof cents === "number" && Number.isFinite(cents) ? Math.round(cents) : 0;

  const sign = safeCents < 0 ? "-" : "";
  const abs = Math.abs(safeCents);
  const amount = `${groupThousands(String(Math.floor(abs / 100)))}.${String(
    abs % 100
  ).padStart(2, "0")}`;

  const code = (currency || "USD").toUpperCase();
  const symbol = CURRENCY_SYMBOLS[code];

  return symbol ? `${sign}${symbol}${amount}` : `${sign}${code} ${amount}`;
}

/**
 * Render a commission amount. Same formatting as `formatPrice`, but exposed
 * under its own name for two reasons: call sites in brand-facing and
 * internal revenue UI read as what they are, and commission is floored at
 * zero here — a negative commission is never a thing we display, since
 * reversals are shown as a `reversed` status rather than as negative money.
 */
export function formatCommission(
  cents: number,
  currency: string = "USD"
): string {
  return formatPrice(sanitizeCents(cents), currency);
}

/**
 * Render a basis-point rate as a percentage: `1000` -> `"10%"`,
 * `1250` -> `"12.5%"`.
 *
 * Trailing zeros are stripped so the common whole-number case doesn't read
 * as "10.0%" in a partner-facing table full of clean rates. Precision stops
 * at two decimals, which is the full resolution basis points can express
 * (1 bps = 0.01%). Out-of-range and non-finite input clamps to 0..100% for
 * the same reason as `commissionCents`.
 */
export function formatRate(bps: number): string {
  const safe =
    typeof bps === "number" && Number.isFinite(bps)
      ? Math.min(Math.max(bps, 0), MAX_COMMISSION_BPS)
      : 0;

  // toFixed(2) then Number() collapses "10.00" -> 10 and "12.50" -> 12.5.
  return `${Number((safe / 100).toFixed(2))}%`;
}
