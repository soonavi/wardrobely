/**
 * Pricing / entitlement rules — single source of truth for the Free vs.
 * Selv+ wardrobe cap. See APP_STORE_LISTING.md: "Selv+ ($6.99/mo)
 * unlocks unlimited wardrobe items...".
 */

/**
 * Maximum number of wardrobe items a Free-tier user may have. Selv+
 * subscribers are unlimited (see `isUnlimited`).
 */
export const FREE_WARDROBE_LIMIT = 25;

export type PlanTier = "free" | "plus";

/** True when `tier` has no wardrobe item cap (Selv+). */
export function isUnlimited(tier: PlanTier): boolean {
  return tier === "plus";
}

/** Whether a user on `tier` with `currentCount` items may add one more. */
export function canAddGarment(currentCount: number, tier: PlanTier): boolean {
  if (isUnlimited(tier)) return true;
  return currentCount < FREE_WARDROBE_LIMIT;
}

/**
 * Free slots remaining before hitting the cap, or `null` if `tier` is
 * unlimited. Never negative (a user can't go "below zero" slots even if
 * they somehow exceed the cap, e.g. after a downgrade).
 */
export function remainingFreeSlots(
  currentCount: number,
  tier: PlanTier
): number | null {
  if (isUnlimited(tier)) return null;
  return Math.max(FREE_WARDROBE_LIMIT - currentCount, 0);
}

/**
 * Shared user-facing copy for hitting the Free wardrobe cap. Kept here so
 * the entry-point prompt and the save-time defensive guard show identical
 * wording — `AddGarmentScreen` compares `createGarment`'s error against this
 * exact string to tell the cap apart from a real failure, so the two must be
 * one function and not two copies.
 *
 * REWORDED, and the wording is the point. This used to end "Upgrade to Selv+
 * for an unlimited wardrobe", which promises something that cannot be bought:
 * there is no in-app purchase in v1, no RevenueCat dependency, and
 * `getCurrentPlan()` below is hardcoded to "free" because there is no
 * entitlement to read. The old copy sat above a button wired to a `// TODO`,
 * so the user was told to upgrade and then given no way to. Selv+ is now
 * described as coming, and the call to action is joining a list — which is
 * something the app can actually do (src/features/paywall/
 * SelvPlusWaitlistSheet.tsx). No price appears here or anywhere else in the
 * app; stating one for a product with no purchase flow is what App Store
 * Guideline 3.1.2 exists to catch.
 *
 * If in-app purchases ever ship, this string goes back to naming an upgrade
 * — but only in the same change that makes one possible.
 */
export function wardrobeLimitMessage(): string {
  return `You've reached the ${FREE_WARDROBE_LIMIT}-item limit on Free. Selv+ will lift it — it isn't on sale yet, but you can join the list to hear when it is.`;
}

// v1 ships NO in-app purchase. This stub is not waiting on a half-finished
// integration — the decision was to keep the cap and validate willingness to
// pay with a waitlist first (supabase/migrations/004_waitlist.sql,
// src/lib/api/waitlist.ts, src/features/paywall/SelvPlusWaitlistSheet.tsx),
// so nothing in the app sells or claims to sell anything today. The note
// below describes the shape the real thing should take when it is built.
//
// TODO(RevenueCat): replace this stub with real entitlement wiring once
// in-app purchases land (see APP_STORE_LISTING.md — Selv+ is sold as an
// auto-renewable subscription via RevenueCat wrapping StoreKit). The real
// implementation should read the "selv_plus" entitlement from
// `Purchases.getCustomerInfo()` (likely surfaced through a `usePlanTier()`
// hook that subscribes to RevenueCat customer-info updates) instead of
// hardcoding "free". This is kept as a single swappable getter — a plain
// module-level function — specifically so call sites don't need to change
// when the real hook replaces it; only this function's body does.
export function getCurrentPlan(): PlanTier {
  return "free";
}
