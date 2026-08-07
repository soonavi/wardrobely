/**
 * Commission maths for the affiliate system.
 *
 * !! INTENTIONAL DUPLICATE !!
 * ---------------------------
 * This file is a deliberate copy of the app's `src/lib/commerce/commission.ts`.
 * It is duplicated, not imported, because Supabase Edge Functions run on Deno
 * with URL-based ES module resolution and are bundled from
 * `supabase/functions/` — they cannot reach up into the React Native app's
 * `src/` tree (different module resolution, different tsconfig, different
 * runtime lib, and `src/` pulls in RN-only imports the moment you touch
 * anything adjacent).
 *
 * The two copies MUST stay in sync. They are the client-side and server-side
 * halves of the same number: the app shows the user/brand an expected
 * commission, the postback endpoint computes the one we actually bill. If
 * they drift, brands will reconcile our invoices against their own numbers
 * and find a discrepancy — the fastest way to lose a partner.
 *
 * If you change anything here, change `app/src/lib/commerce/commission.ts`
 * identically in the same commit, and vice versa.
 */

/**
 * Selv's default take rate when neither the product nor the brand specifies
 * one: 1000 bps = 10%.
 *
 * Basis points (not percent floats) are used everywhere so rates are exact
 * integers — 10% is `1000`, not `0.1`, which cannot be represented exactly in
 * binary floating point. Money maths that starts from an inexact rate ends in
 * off-by-one-cent disputes.
 */
export const PLATFORM_DEFAULT_COMMISSION_BPS = 1000;

/** Basis points in 100% — a rate can never exceed this. */
const MAX_BPS = 10_000;

/**
 * True when a stored rate is a real, usable value: finite and inside
 * `[0, 10000]`. Mirrors `isUsableRateBps` in the app copy exactly, including
 * the fact that an OUT-OF-RANGE rate is treated as absent (and therefore
 * falls through to the next level of precedence) rather than being clamped.
 *
 * SUBTLE AND IMPORTANT: `0` is a legitimate rate. A product placed at 0%
 * commission (a loss-leader, a co-marketing item, a brand's own-brand
 * placement) must resolve to 0%, NOT fall through to the 10% platform
 * default. That is why this is an explicit range check and not a truthiness
 * check — `if (productBps)` would silently bill a brand 10% on items they
 * negotiated to zero.
 *
 * The range bound matches the `check (commission_rate_bps between 0 and
 * 10000)` constraint on `brands` and `brand_products` in migration
 * 002_commerce.sql, so a rate that fails this test could not have come from
 * the database in the first place.
 */
function isUsableBps(value: number | null | undefined): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_BPS
  );
}

/**
 * Coerce anything into a non-negative, finite integer cent amount. Mirrors
 * `sanitizeCents` in the app copy — note it rounds rather than truncates, so
 * both sides treat a fractional-cent input identically.
 */
function sanitizeCents(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.round(value);
}

/**
 * Resolve the commission rate to apply, in basis points.
 *
 * Precedence, most specific wins:
 *   1. `brand_products.commission_rate_bps` — a per-product override, e.g. a
 *      brand paying more on slow-moving stock or less on already-discounted
 *      items. Nullable in the schema precisely so "no override" is
 *      distinguishable from "0%".
 *   2. `brands.commission_rate_bps` — the rate negotiated in the partner
 *      agreement. This is the normal case.
 *   3. `PLATFORM_DEFAULT_COMMISSION_BPS` — the published default (10%), used
 *      for a brand row that somehow has no rate set.
 *
 * An out-of-range value at any level is treated as absent and falls through
 * to the next one — a data-entry slip of `100000` bps resolves to the brand
 * rate (or the platform default), not to a clamped 100%.
 */
export function resolveCommissionRateBps(
  productBps: number | null | undefined,
  brandBps: number | null | undefined,
): number {
  if (isUsableBps(productBps)) return productBps;
  if (isUsableBps(brandBps)) return brandBps;
  return PLATFORM_DEFAULT_COMMISSION_BPS;
}

/**
 * Selv's commission on an order, in whole cents.
 *
 * Rounding is **half up** (0.5 cents becomes 1 cent, in Selv's favour).
 * `Math.round` in JS is also half-up for positives, but it rounds *half away
 * from zero* for negatives; the explicit `Math.floor(x + 0.5)` here makes the
 * rule unambiguous and independent of sign handling. Negative inputs cannot
 * reach it anyway — the order total is clamped to >= 0 first.
 *
 * Guards, in order:
 *   - Non-finite or negative input (NaN from a bad payload) yields 0 rather
 *     than poisoning the row with NaN, which Postgres would reject on the
 *     `commission_cents integer not null check (>= 0)` column and turn into
 *     an opaque 500. A refund is modelled as a `reversed` conversion status,
 *     never as a negative amount.
 *   - Unlike `resolveCommissionRateBps`, an out-of-range RATE here is clamped
 *     rather than rejected: by the time we are computing money the rate has
 *     already been chosen, and the only safe reading of "150%" is "100%".
 *
 * The multiply happens before the divide so the intermediate stays an exact
 * integer instead of accumulating float error from a `rate / 10000` fraction.
 * It stays well inside JS's safe integer range for any plausible order (a
 * $1,000,000 order at 100% is 1e8 * 1e4 = 1e12, vs a 9.007e15 limit).
 */
export function commissionCents(
  orderTotalCents: number,
  rateBps: number,
): number {
  const total = sanitizeCents(orderTotalCents);
  if (total === 0) return 0;

  const rate =
    typeof rateBps === "number" && Number.isFinite(rateBps)
      ? Math.min(Math.max(rateBps, 0), MAX_BPS)
      : 0;
  if (rate === 0) return 0;

  return Math.round((total * rate) / MAX_BPS);
}

/**
 * Format a bps rate for human-readable logs, e.g. `1000` -> `10%`.
 *
 * Log-only. The app copy's `formatRate` is the one users see; this exists so
 * the postback's log lines are readable and is deliberately not part of the
 * synced surface.
 */
export function formatBps(bps: number): string {
  const safe = Number.isFinite(bps) ? Math.min(Math.max(bps, 0), MAX_BPS) : 0;
  const pct = safe / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}
