/**
 * Unit tests for src/lib/commerce/commission.ts — the money math.
 *
 * Ported from (and extended beyond) the hand-rolled `_commission_smoke.ts`
 * script that predated a test runner. The cases are weighted towards failure
 * modes that cost real money or embarrass us in the UI: a `0` commission
 * override mistaken for "unset", a stale sale price that isn't a discount,
 * half-cent rounding disagreeing with a network's statement, and NaN reaching
 * a price label.
 */
import {
  PLATFORM_DEFAULT_COMMISSION_BPS,
  commissionCents,
  discountPercent,
  effectivePriceCents,
  formatCommission,
  formatPrice,
  formatRate,
  isOnSale,
  resolveCommissionRateBps,
} from "../commission";

describe("resolveCommissionRateBps", () => {
  it("prefers the per-product override over the brand rate", () => {
    expect(resolveCommissionRateBps(500, 1200)).toBe(500);
  });

  it("falls back to the brand rate when there is no override", () => {
    expect(resolveCommissionRateBps(null, 1200)).toBe(1200);
    expect(resolveCommissionRateBps(undefined, 1200)).toBe(1200);
  });

  it("falls back to the platform default when neither level specifies a rate", () => {
    expect(resolveCommissionRateBps(null, null)).toBe(PLATFORM_DEFAULT_COMMISSION_BPS);
    expect(resolveCommissionRateBps(undefined, undefined)).toBe(
      PLATFORM_DEFAULT_COMMISSION_BPS
    );
  });

  // The documented edge case, and the one a `productOverride ?? brandDefault`
  // (or any falsy test) implementation gets wrong: 0% is a real negotiated
  // commercial term ("we pay nothing on this SKU"), not an absent value.
  describe("a zero rate is a real value, never 'absent'", () => {
    it("a product override of 0 beats a non-zero brand rate", () => {
      expect(resolveCommissionRateBps(0, 1200)).toBe(0);
    });

    it("a brand rate of 0 beats the platform default", () => {
      expect(resolveCommissionRateBps(null, 0)).toBe(0);
      expect(resolveCommissionRateBps(undefined, 0)).toBe(0);
    });

    it("holds for every brand rate a feed could pair a 0 override with", () => {
      for (const brandRate of [0, 1, 900, 1200, 10000, null, undefined]) {
        expect(resolveCommissionRateBps(0, brandRate)).toBe(0);
      }
    });

    // -0 is what `JSON.parse("-0")` and some numeric coercions produce. It is
    // still zero commission, and must not be mistaken for absent either.
    it("treats -0 as zero rather than falling through", () => {
      const rate = resolveCommissionRateBps(-0, 1200);
      // `=== 0` rather than toBe(0): -0 is still zero commission, and the
      // failure this guards against is falling through to 1200.
      expect(rate === 0).toBe(true);
      expect(rate).not.toBe(1200);
    });
  });

  it("accepts the full 0..10000 bps range inclusive", () => {
    expect(resolveCommissionRateBps(10000, 1200)).toBe(10000);
    expect(resolveCommissionRateBps(0, 1200)).toBe(0);
  });

  // Out-of-range is treated as ABSENT (fall through), not clamped: a nonsense
  // number is far more likely a feed-parsing bug than a real 500% rate.
  it("ignores an out-of-range override rather than clamping it", () => {
    expect(resolveCommissionRateBps(50000, 1200)).toBe(1200);
    expect(resolveCommissionRateBps(10001, 1200)).toBe(1200);
    expect(resolveCommissionRateBps(-100, 1200)).toBe(1200);
  });

  it("ignores non-finite rates at either level", () => {
    expect(resolveCommissionRateBps(Number.NaN, 1200)).toBe(1200);
    expect(resolveCommissionRateBps(Number.POSITIVE_INFINITY, 1200)).toBe(1200);
    expect(resolveCommissionRateBps(Number.NaN, Number.NaN)).toBe(
      PLATFORM_DEFAULT_COMMISSION_BPS
    );
  });

  it("falls all the way through when both levels are invalid", () => {
    expect(resolveCommissionRateBps(-1, 99999)).toBe(PLATFORM_DEFAULT_COMMISSION_BPS);
  });

  it("documents the platform default as 10%", () => {
    expect(PLATFORM_DEFAULT_COMMISSION_BPS).toBe(1000);
  });
});

describe("commissionCents", () => {
  it("computes a plain percentage of the order total", () => {
    expect(commissionCents(48000, 1000)).toBe(4800); // 10% of $480.00
    expect(commissionCents(10000, 1250)).toBe(1250); // 12.5% of $100.00
    expect(commissionCents(13800, 900)).toBe(1242); // 9% of $138.00
    expect(commissionCents(4800, 10000)).toBe(4800); // 100%
  });

  it("earns nothing at a zero rate or on a zero order", () => {
    expect(commissionCents(48000, 0)).toBe(0);
    expect(commissionCents(0, 1500)).toBe(0);
  });

  // Half-up, not banker's rounding: affiliate networks round half up on their
  // own statements, so matching them means any mismatch is a real discrepancy
  // rather than a rounding convention.
  describe("rounds half up to match network statements", () => {
    it("rounds exactly half a cent up", () => {
      expect(commissionCents(1, 5000)).toBe(1); // 0.5c -> 1c
      expect(commissionCents(3, 5000)).toBe(2); // 1.5c -> 2c (banker's would give 2 here too)
      expect(commissionCents(5, 5000)).toBe(3); // 2.5c -> 3c (banker's would give 2)
      expect(commissionCents(9, 5000)).toBe(5); // 4.5c -> 5c (banker's would give 4)
    });

    it("rounds below half down", () => {
      expect(commissionCents(1, 4000)).toBe(0); // 0.4c -> 0c
      expect(commissionCents(10, 499)).toBe(0); // 0.499c -> 0c
    });
  });

  it("stays exact on large order totals instead of accumulating float error", () => {
    // $999,999.99 at 12.34% — computed as (total * rate) / 10000 so the
    // intermediate stays an exact integer. 99999999 * 1234 / 10000 =
    // 12339999.8766, which rounds to 12340000.
    expect(commissionCents(99999999, 1234)).toBe(12340000);
    // A `total * (rate / 10000)` implementation drifts here; this pins the
    // multiply-then-divide ordering.
    expect(commissionCents(2, 3333)).toBe(1); // 0.6666c -> 1c
  });

  it("clamps a nonsense rate rather than rejecting it (the rate is already chosen by now)", () => {
    expect(commissionCents(4800, 50000)).toBe(4800); // 150% reads as 100%
    expect(commissionCents(4800, -1000)).toBe(0);
  });

  it("never returns negative commission — a refund is a reversed conversion, not negative money", () => {
    expect(commissionCents(-5000, 1000)).toBe(0);
    expect(commissionCents(-5000, -1000)).toBe(0);
  });

  it("never propagates NaN or Infinity into a NOT NULL money column", () => {
    expect(commissionCents(Number.NaN, 1000)).toBe(0);
    expect(commissionCents(48000, Number.NaN)).toBe(0);
    expect(commissionCents(Number.POSITIVE_INFINITY, 1000)).toBe(0);
    // A non-finite *rate* is rejected outright (rate := 0), not clamped to
    // 100% — only finite-but-out-of-range rates get clamped.
    expect(commissionCents(48000, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("is monotonic in both order total and rate", () => {
    expect(commissionCents(10000, 1000)).toBeLessThan(commissionCents(20000, 1000));
    expect(commissionCents(10000, 500)).toBeLessThan(commissionCents(10000, 1000));
  });
});

describe("effectivePriceCents", () => {
  const fullPrice = { price_cents: 11800, sale_price_cents: null };
  const onSale = { price_cents: 14500, sale_price_cents: 10900 };
  // A promotion that ended but left its sale_price_cents behind — the exact
  // shape partner feeds send, and why the comparison is strictly-less-than.
  const staleSale = { price_cents: 11800, sale_price_cents: 11800 };
  const badFeed = { price_cents: 11800, sale_price_cents: 19900 };

  it("uses the list price when there is no sale price", () => {
    expect(effectivePriceCents(fullPrice)).toBe(11800);
  });

  it("uses a sale price that is strictly below the list price", () => {
    expect(effectivePriceCents(onSale)).toBe(10900);
  });

  it("ignores a sale price equal to the list price (a stale promotion)", () => {
    expect(effectivePriceCents(staleSale)).toBe(11800);
  });

  it("ignores a sale price above the list price (a bad feed)", () => {
    expect(effectivePriceCents(badFeed)).toBe(11800);
  });

  it("honours a genuine free-with-purchase sale price of 0", () => {
    expect(effectivePriceCents({ price_cents: 11800, sale_price_cents: 0 })).toBe(0);
  });

  it("keeps a free item free", () => {
    expect(effectivePriceCents({ price_cents: 0, sale_price_cents: null })).toBe(0);
  });

  it("clamps a negative list price to 0", () => {
    expect(effectivePriceCents({ price_cents: -500, sale_price_cents: null })).toBe(0);
  });

  it("ignores a negative sale price rather than showing negative money", () => {
    expect(effectivePriceCents({ price_cents: 11800, sale_price_cents: -100 })).toBe(11800);
  });

  it("ignores non-finite sale prices", () => {
    expect(
      effectivePriceCents({ price_cents: 11800, sale_price_cents: Number.NaN })
    ).toBe(11800);
    expect(
      effectivePriceCents({ price_cents: 11800, sale_price_cents: Number.NEGATIVE_INFINITY })
    ).toBe(11800);
  });
});

describe("isOnSale / discountPercent", () => {
  const fullPrice = { price_cents: 11800, sale_price_cents: null };
  const onSale = { price_cents: 14500, sale_price_cents: 10900 };
  const staleSale = { price_cents: 11800, sale_price_cents: 11800 };

  it("flags a sale only when the effective price is genuinely lower", () => {
    expect(isOnSale(fullPrice)).toBe(false);
    expect(isOnSale(onSale)).toBe(true);
    expect(isOnSale(staleSale)).toBe(false);
  });

  it("returns null (not 0) when there is no discount, so callers can test `!== null`", () => {
    expect(discountPercent(fullPrice)).toBeNull();
    expect(discountPercent(staleSale)).toBeNull();
  });

  it("rounds the discount to a whole percent for the badge", () => {
    expect(discountPercent(onSale)).toBe(25);
    expect(discountPercent({ price_cents: 6400, sale_price_cents: 4480 })).toBe(30);
  });

  it("returns null when the list price is 0 rather than dividing by zero", () => {
    expect(discountPercent({ price_cents: 0, sale_price_cents: 0 })).toBeNull();
    expect(discountPercent({ price_cents: 0, sale_price_cents: null })).toBeNull();
  });

  it("reports 100% off for a free-with-purchase sale price", () => {
    expect(discountPercent({ price_cents: 11800, sale_price_cents: 0 })).toBe(100);
  });
});

describe("formatPrice", () => {
  it("renders integer cents as display money", () => {
    expect(formatPrice(4800)).toBe("$48.00");
    expect(formatPrice(4800, "USD")).toBe("$48.00");
  });

  it("uses the symbol for currencies we have partners in", () => {
    expect(formatPrice(4800, "GBP")).toBe("£48.00");
    expect(formatPrice(19900, "EUR")).toBe("€199.00");
  });

  it("normalises the currency code's case", () => {
    expect(formatPrice(4800, "usd")).toBe("$48.00");
    expect(formatPrice(4800, "gbp")).toBe("£48.00");
  });

  it("degrades to the ISO code rather than guessing a symbol", () => {
    expect(formatPrice(4800, "JPY")).toBe("JPY 48.00");
  });

  it("falls back to USD for an empty currency", () => {
    expect(formatPrice(4800, "")).toBe("$48.00");
  });

  it("always shows two cent digits", () => {
    expect(formatPrice(4805)).toBe("$48.05");
    expect(formatPrice(4850)).toBe("$48.50");
    expect(formatPrice(7)).toBe("$0.07");
    expect(formatPrice(0)).toBe("$0.00");
  });

  it("groups thousands", () => {
    expect(formatPrice(125000)).toBe("$1,250.00");
    expect(formatPrice(123456789)).toBe("$1,234,567.89");
    expect(formatPrice(99999)).toBe("$999.99");
    expect(formatPrice(100000)).toBe("$1,000.00");
  });

  it("puts a negative sign outside the symbol", () => {
    expect(formatPrice(-4800)).toBe("-$48.00");
    expect(formatPrice(-4800, "GBP")).toBe("-£48.00");
    expect(formatPrice(-4800, "JPY")).toBe("-JPY 48.00");
  });

  // The entire point of the non-finite guards: a partner feed with a null
  // price must render "$0.00", never "$NaN".
  it("never renders NaN or Infinity", () => {
    expect(formatPrice(Number.NaN)).toBe("$0.00");
    expect(formatPrice(Number.POSITIVE_INFINITY)).toBe("$0.00");
    expect(formatPrice(Number.NEGATIVE_INFINITY)).toBe("$0.00");
    expect(formatPrice(undefined as unknown as number)).toBe("$0.00");
    expect(formatPrice(null as unknown as number)).toBe("$0.00");
  });

  // Deterministic by hand rather than via Intl, because Hermes on Android
  // ships without full ICU and would format differently per platform. Pin
  // the separators so a well-meaning switch to Intl.NumberFormat fails loudly.
  it("always uses comma grouping and a dot decimal, regardless of host locale", () => {
    expect(formatPrice(123456789)).toBe("$1,234,567.89");
  });
});

describe("formatCommission", () => {
  it("formats like a price", () => {
    expect(formatCommission(1242)).toBe("$12.42");
    expect(formatCommission(1242, "GBP")).toBe("£12.42");
  });

  it("floors at zero — reversals show as a status, never as negative money", () => {
    expect(formatCommission(-1242)).toBe("$0.00");
    expect(formatCommission(Number.NaN)).toBe("$0.00");
  });
});

describe("formatRate", () => {
  it("renders basis points as a percentage", () => {
    expect(formatRate(1000)).toBe("10%");
    expect(formatRate(1250)).toBe("12.5%");
    expect(formatRate(1)).toBe("0.01%");
    expect(formatRate(0)).toBe("0%");
    expect(formatRate(10000)).toBe("100%");
  });

  it("strips trailing zeros so whole rates read cleanly", () => {
    expect(formatRate(1000)).not.toBe("10.0%");
    expect(formatRate(1200)).toBe("12%");
    expect(formatRate(1230)).toBe("12.3%");
  });

  it("clamps out-of-range and non-finite input to 0..100%", () => {
    expect(formatRate(50000)).toBe("100%");
    expect(formatRate(-500)).toBe("0%");
    expect(formatRate(Number.NaN)).toBe("0%");
    // Non-finite is rejected to 0 rather than clamped to the max, matching
    // commissionCents' handling of a non-finite rate.
    expect(formatRate(Number.POSITIVE_INFINITY)).toBe("0%");
  });
});

// ---------------------------------------------------------------------------
// End-to-end: what Selv actually earns on a real seeded product.
// Halcyon Denim's 512 Slim: $138 list, $99 on sale, brand rate 900 bps but a
// 500 bps clearance override. Mirrors seed/001_brands_products.sql.
// ---------------------------------------------------------------------------
describe("end-to-end: a seeded clearance product", () => {
  const slimJean = { price_cents: 13800, sale_price_cents: 9900 };

  it("applies the clearance override, prices at the sale price, and earns 5%", () => {
    const rate = resolveCommissionRateBps(500, 900);
    expect(rate).toBe(500);

    const price = effectivePriceCents(slimJean);
    expect(price).toBe(9900);

    const earned = commissionCents(price, rate);
    expect(earned).toBe(495);
    expect(formatCommission(earned)).toBe("$4.95");
    expect(formatRate(rate)).toBe("5%");
  });

  it("earns nothing on a SKU whose override is a negotiated 0%", () => {
    const rate = resolveCommissionRateBps(0, 900);
    expect(rate).toBe(0);
    expect(commissionCents(effectivePriceCents(slimJean), rate)).toBe(0);
    expect(formatCommission(0)).toBe("$0.00");
  });
});
