/**
 * Unit tests for src/lib/pricing.ts — the Free vs. Selv+ wardrobe cap.
 *
 * These rules gate the upgrade prompt, so getting them wrong either blocks a
 * paying subscriber from adding an item or hands the paid feature away for
 * free. The off-by-one at the boundary and the post-downgrade over-cap case
 * are the two that matter.
 */
import {
  FREE_WARDROBE_LIMIT,
  canAddGarment,
  getCurrentPlan,
  isUnlimited,
  remainingFreeSlots,
  wardrobeLimitMessage,
} from "../pricing";
import type { PlanTier } from "../pricing";

describe("isUnlimited", () => {
  it("is true only for the paid tier", () => {
    expect(isUnlimited("plus")).toBe(true);
    expect(isUnlimited("free")).toBe(false);
  });
});

describe("canAddGarment", () => {
  it("lets a Free user add items right up to the limit", () => {
    expect(canAddGarment(0, "free")).toBe(true);
    expect(canAddGarment(1, "free")).toBe(true);
    expect(canAddGarment(FREE_WARDROBE_LIMIT - 1, "free")).toBe(true);
  });

  // The boundary: at exactly `FREE_WARDROBE_LIMIT` items the user already has
  // the full allowance, so the next add is the one that must be blocked.
  it("blocks the add that would exceed the limit", () => {
    expect(canAddGarment(FREE_WARDROBE_LIMIT, "free")).toBe(false);
    expect(canAddGarment(FREE_WARDROBE_LIMIT + 1, "free")).toBe(false);
    expect(canAddGarment(FREE_WARDROBE_LIMIT + 100, "free")).toBe(false);
  });

  it("never blocks a Selv+ subscriber, at any count", () => {
    for (const count of [0, FREE_WARDROBE_LIMIT - 1, FREE_WARDROBE_LIMIT, 10_000]) {
      expect(canAddGarment(count, "plus")).toBe(true);
    }
  });

  it("agrees with remainingFreeSlots at every count around the boundary", () => {
    for (let count = 0; count <= FREE_WARDROBE_LIMIT + 3; count += 1) {
      const remaining = remainingFreeSlots(count, "free");
      expect(canAddGarment(count, "free")).toBe((remaining as number) > 0);
    }
  });
});

describe("remainingFreeSlots", () => {
  it("counts down from the full allowance", () => {
    expect(remainingFreeSlots(0, "free")).toBe(FREE_WARDROBE_LIMIT);
    expect(remainingFreeSlots(1, "free")).toBe(FREE_WARDROBE_LIMIT - 1);
    expect(remainingFreeSlots(FREE_WARDROBE_LIMIT - 1, "free")).toBe(1);
    expect(remainingFreeSlots(FREE_WARDROBE_LIMIT, "free")).toBe(0);
  });

  // A user who built a 60-item wardrobe on Selv+ and then let it lapse is
  // over the cap. "-35 slots left" must never reach the UI.
  it("floors at zero after a downgrade leaves the user over the cap", () => {
    expect(remainingFreeSlots(FREE_WARDROBE_LIMIT + 1, "free")).toBe(0);
    expect(remainingFreeSlots(60, "free")).toBe(0);
    expect(remainingFreeSlots(10_000, "free")).toBe(0);
  });

  it("never returns a negative number for any plausible count", () => {
    for (let count = 0; count <= 200; count += 1) {
      expect(remainingFreeSlots(count, "free")).toBeGreaterThanOrEqual(0);
      expect(remainingFreeSlots(count, "free")).toBeLessThanOrEqual(
        FREE_WARDROBE_LIMIT
      );
    }
  });

  // `null`, not `0` and not `Infinity`: the UI distinguishes "no cap" from
  // "no slots left", and they render completely differently.
  it("returns null for an unlimited tier rather than a number", () => {
    expect(remainingFreeSlots(0, "plus")).toBeNull();
    expect(remainingFreeSlots(10_000, "plus")).toBeNull();
  });
});

describe("wardrobeLimitMessage", () => {
  it("names the actual limit so the copy can't drift from the constant", () => {
    expect(wardrobeLimitMessage()).toContain(String(FREE_WARDROBE_LIMIT));
  });

  it("names Selv+ as what lifts the cap", () => {
    expect(wardrobeLimitMessage()).toMatch(/Selv\+/);
  });

  // App Store Guideline 3.1.2, and the reason this string was reworded: v1
  // ships no in-app purchase, so the copy must not tell the user to buy or
  // upgrade, and must not state a price. The call to action is joining the
  // waitlist — something the app can actually do.
  it("does not sell something the app cannot sell", () => {
    const message = wardrobeLimitMessage();
    expect(message).not.toMatch(/\bupgrade\b/i);
    expect(message).not.toMatch(/\b(buy|purchase|subscribe)\b/i);
    expect(message).not.toMatch(/[$£€]\s?\d/);
    expect(message).not.toMatch(/\/\s?mo\b|per month/i);
  });

  // AddGarmentScreen compares createGarment's error against this exact string
  // to tell the cap apart from a real failure, so the entry-point prompt and
  // the save-time guard must be one function, not two copies of a literal.
  it("is stable across calls", () => {
    expect(wardrobeLimitMessage()).toBe(wardrobeLimitMessage());
  });
});

describe("getCurrentPlan", () => {
  // Deliberately not asserting "free": this is a swappable stub that real
  // RevenueCat entitlement wiring replaces. What must hold is that it always
  // returns a tier the rest of the module understands.
  it("returns a tier the entitlement helpers accept", () => {
    const tier: PlanTier = getCurrentPlan();
    expect(["free", "plus"]).toContain(tier);
    expect(typeof canAddGarment(0, tier)).toBe("boolean");
    expect(typeof isUnlimited(tier)).toBe("boolean");
  });
});

describe("FREE_WARDROBE_LIMIT", () => {
  it("is the 25 items the App Store listing promises", () => {
    expect(FREE_WARDROBE_LIMIT).toBe(25);
  });
});
