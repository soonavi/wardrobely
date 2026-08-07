/**
 * Unit tests for `buildAffiliateUrl` in src/lib/api/affiliate.ts.
 *
 * Scope is deliberately just that one function. It is exported separately from
 * `createCheckoutLink` precisely so it can be tested without a database, and
 * everything else in the module talks to Supabase. This is the last piece of
 * logic a Buy tap runs before the user leaves the app, so getting it wrong
 * means either an untracked click-out (a silently lost commission) or a
 * throw in the Buy sheet.
 */
// affiliate.ts imports the Supabase client singleton, which throws at module
// load without EXPO_PUBLIC_SUPABASE_* env vars and would drag AsyncStorage in.
// `buildAffiliateUrl` touches none of it, so stub the module out rather than
// standing up a real client just to import a pure function.
jest.mock("../../supabase", () => ({ supabase: {} }));

import { buildAffiliateUrl } from "../affiliate";

// In the app, `URL` comes from react-native-url-polyfill (imported by
// lib/supabase.ts). Node's built-in URL implements the same WHATWG spec, so
// the parsing/serialisation behaviour asserted below is the same one the
// device sees.

const TOKEN = "clk_01HZX9";
const PRODUCT_URL = "https://halcyondenim.com/products/512-slim";

describe("buildAffiliateUrl — network wrapper template", () => {
  it("substitutes {URL} and {SUBID}", () => {
    const url = buildAffiliateUrl(
      PRODUCT_URL,
      TOKEN,
      "https://go.network.com/c/123?u={URL}&subid={SUBID}"
    );

    expect(url).toBe(
      `https://go.network.com/c/123?u=${encodeURIComponent(PRODUCT_URL)}&subid=${TOKEN}`
    );
  });

  // The inner url becomes a query parameter *inside* the wrapper, so an
  // un-encoded `?`/`&`/`=` would truncate it and the shopper would land on the
  // wrong page (or the network would drop the destination entirely).
  it("URI-encodes the inner product url so its own query string survives", () => {
    const productWithQuery =
      "https://shop.example.com/p/jacket?variant=42&color=navy#reviews";
    const url = buildAffiliateUrl(
      productWithQuery,
      TOKEN,
      "https://go.network.com/c/123?u={URL}"
    );

    expect(url).toBe(
      "https://go.network.com/c/123?u=https%3A%2F%2Fshop.example.com%2Fp%2Fjacket%3Fvariant%3D42%26color%3Dnavy%23reviews"
    );
    // Nothing after the first substitution may look like a wrapper-level
    // parameter separator.
    expect(url.indexOf("&")).toBe(-1);
    expect(url.split("?").length).toBe(2);
  });

  it("encodes the subid too, so an exotic token can't break the wrapper", () => {
    const url = buildAffiliateUrl(
      PRODUCT_URL,
      "tok/en+with&chars",
      "https://go.network.com/c/123?u={URL}&subid={SUBID}"
    );

    expect(url).toContain("subid=tok%2Fen%2Bwith%26chars");
    expect(url).not.toContain("subid=tok/en+with&chars");
  });

  it("replaces every occurrence, not just the first", () => {
    const url = buildAffiliateUrl(
      "https://a.test/x",
      "T1",
      "https://go.network.com/{SUBID}/c?u={URL}&back={URL}&s2={SUBID}"
    );

    expect(url).toBe(
      "https://go.network.com/T1/c?u=https%3A%2F%2Fa.test%2Fx&back=https%3A%2F%2Fa.test%2Fx&s2=T1"
    );
    expect(url).not.toContain("{URL}");
    expect(url).not.toContain("{SUBID}");
  });

  it("never appends selv_subid/utm params when a wrapper is in play", () => {
    const url = buildAffiliateUrl(
      PRODUCT_URL,
      TOKEN,
      "https://go.network.com/c/123?u={URL}&subid={SUBID}"
    );

    expect(url).not.toContain("selv_subid");
    expect(url).not.toContain("utm_source");
  });

  it("uses the direct-partner path for an absent or blank template", () => {
    for (const blank of [null, "", "   ", "\n\t"]) {
      const url = buildAffiliateUrl(PRODUCT_URL, TOKEN, blank);
      expect(url).toContain("selv_subid=" + TOKEN);
      expect(url).toContain("utm_source=selv");
    }
  });

  // A template is trusted to be well-formed enough to substitute into; it only
  // decides where the user is sent, never what we bill (see the module's
  // createCheckoutLink comment). A template with no placeholders is therefore
  // passed through as-is rather than "fixed up".
  it("passes a placeholder-free template through untouched", () => {
    expect(
      buildAffiliateUrl(PRODUCT_URL, TOKEN, "https://go.network.com/static-landing")
    ).toBe("https://go.network.com/static-landing");
  });
});

describe("buildAffiliateUrl — direct partner (no wrapper)", () => {
  it("appends the subid and the utm params to the product url", () => {
    const url = new URL(buildAffiliateUrl(PRODUCT_URL, TOKEN, null));

    expect(url.origin + url.pathname).toBe(
      "https://halcyondenim.com/products/512-slim"
    );
    expect(url.searchParams.get("selv_subid")).toBe(TOKEN);
    expect(url.searchParams.get("utm_source")).toBe("selv");
    expect(url.searchParams.get("utm_medium")).toBe("affiliate");
  });

  it("preserves the product url's own query params and fragment", () => {
    const url = new URL(
      buildAffiliateUrl(
        "https://shop.example.com/p/jacket?variant=42&color=navy#reviews",
        TOKEN,
        null
      )
    );

    expect(url.searchParams.get("variant")).toBe("42");
    expect(url.searchParams.get("color")).toBe("navy");
    expect(url.hash).toBe("#reviews");
    expect(url.searchParams.get("selv_subid")).toBe(TOKEN);
  });

  // `set`, not `append`: re-linking an already-tagged url must replace the
  // stale token, or the partner receives two conflicting subids and we can't
  // say which click a conversion belongs to.
  describe("re-linking an already-tagged url replaces rather than appends", () => {
    it("replaces a stale selv_subid", () => {
      const firstPass = buildAffiliateUrl(PRODUCT_URL, "old_token", null);
      const secondPass = buildAffiliateUrl(firstPass, "new_token", null);

      const params = new URL(secondPass).searchParams;
      expect(params.getAll("selv_subid")).toEqual(["new_token"]);
      expect(secondPass).not.toContain("old_token");
    });

    it("does not duplicate the utm params either", () => {
      const twice = buildAffiliateUrl(
        buildAffiliateUrl(PRODUCT_URL, "old_token", null),
        "new_token",
        null
      );
      const params = new URL(twice).searchParams;

      expect(params.getAll("utm_source")).toEqual(["selv"]);
      expect(params.getAll("utm_medium")).toEqual(["affiliate"]);
    });

    it("is idempotent when the token is unchanged", () => {
      const once = buildAffiliateUrl(PRODUCT_URL, TOKEN, null);
      expect(buildAffiliateUrl(once, TOKEN, null)).toBe(once);
    });

    it("overwrites a partner-supplied selv_subid rather than trusting it", () => {
      const tagged = buildAffiliateUrl(
        "https://shop.example.com/p/jacket?selv_subid=someone_elses_token",
        TOKEN,
        null
      );
      const params = new URL(tagged).searchParams;

      expect(params.getAll("selv_subid")).toEqual([TOKEN]);
    });
  });
});

describe("buildAffiliateUrl — malformed input", () => {
  // A Buy button that opens an untracked page is a lost commission; a Buy
  // button that throws is a broken app. The product url comes from a partner
  // feed we don't control, so this must never throw.
  const MALFORMED = [
    "not a url at all",
    "",
    "   ",
    "/relative/path",
    "//cdn.example.com/p/jacket", // protocol-relative: unparseable without a base
    "https://",
  ];

  it.each(MALFORMED)("returns %p unchanged instead of throwing", (bad) => {
    expect(() => buildAffiliateUrl(bad, TOKEN, null)).not.toThrow();
    expect(buildAffiliateUrl(bad, TOKEN, null)).toBe(bad);
  });

  it("returns an unparseable url unchanged even with a token that looks appendable", () => {
    expect(buildAffiliateUrl("not a url at all", TOKEN, null)).toBe("not a url at all");
    expect(buildAffiliateUrl("not a url at all", TOKEN, null)).not.toContain("selv_subid");
  });

  it("still substitutes a malformed product url into a wrapper template", () => {
    // The wrapper path never parses the url, so a partner-side redirect can
    // still receive whatever the feed gave us — no throw, no silent drop.
    expect(
      buildAffiliateUrl("not a url", TOKEN, "https://go.network.com/c?u={URL}")
    ).toBe("https://go.network.com/c?u=not%20a%20url");
  });
});
