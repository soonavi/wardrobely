/**
 * Shared CORS handling for Selv's Supabase Edge Functions.
 *
 * WHY THIS IS DELIBERATELY RESTRICTIVE
 * ------------------------------------
 * Two of the three functions in this directory (`affiliate-postback`,
 * `product-feed-ingest`) are **server-to-server** endpoints. They are called
 * by a brand's backend or by an affiliate network's postback worker — never
 * by a browser. A `curl`/server client does not send an `Origin` header and
 * does not honour `Access-Control-Allow-*` responses at all, so a permissive
 * `Access-Control-Allow-Origin: *` buys those endpoints exactly nothing.
 *
 * What it *would* buy is risk: `*` on a postback endpoint means any web page
 * on the internet can have a visitor's browser fire cross-origin POSTs at it
 * and read the response. The HMAC signature check is the real security
 * boundary (see `affiliate-postback/index.ts`), but there is no reason to
 * hand attackers a free, readable, in-browser probe of that boundary. So the
 * default here is "no cross-origin browser access at all", and any origin
 * that genuinely needs it must be named explicitly in an env var.
 *
 * The third function (`delete-account`) IS called by the app. On iOS/Android
 * that's React Native's `fetch`, which is not a browser and does not enforce
 * CORS — so it works with the default deny. Only Expo **Web** builds need an
 * entry in `CORS_ALLOWED_ORIGINS` (e.g. `http://localhost:8081` in dev, plus
 * the deployed web origin).
 */

/**
 * Comma-separated allowlist of origins permitted to call these functions
 * from a browser. Empty (the default) means: allow none.
 *
 * Example: `supabase secrets set CORS_ALLOWED_ORIGINS="https://app.selv.com,http://localhost:8081"`
 */
const ALLOWED_ORIGINS: string[] = (Deno.env.get("CORS_ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter((o) => o.length > 0);

/** Headers every response gets, CORS-relevant or not. */
const BASE_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  // These endpoints return JSON that should never be sniffed as HTML, and
  // must never be cached by an intermediary — a cached postback response
  // could mask a real retry.
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store",
};

/**
 * Build the response headers for a request. If the caller sent an `Origin`
 * and that origin is allowlisted, echo it back (echoing the specific origin
 * rather than `*` is required for credentialed requests and is strictly
 * safer). Otherwise omit the CORS headers entirely — a browser will then
 * block the response, which is exactly the intent.
 */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin");

  if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
    return { ...BASE_HEADERS };
  }

  return {
    ...BASE_HEADERS,
    "Access-Control-Allow-Origin": origin,
    // `Vary: Origin` matters because the response differs per origin; without
    // it a shared cache could serve one origin's allow header to another.
    Vary: "Origin",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-selv-signature, x-selv-timestamp",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

/**
 * Handle a CORS preflight. Returns a `Response` if the request was an
 * `OPTIONS` preflight (and the caller should return it immediately), or
 * `null` if this is a normal request that should be processed.
 *
 * A preflight from a non-allowlisted origin still gets a 204 — but without
 * the `Access-Control-Allow-Origin` header, so the browser fails the actual
 * request. Returning 204 rather than 403 avoids leaking which origins are on
 * the list via a status-code oracle.
 */
export function handlePreflight(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

/** Convenience: a JSON response carrying the right CORS/base headers. */
export function jsonResponse(
  req: Request,
  status: number,
  body: unknown,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(req),
  });
}

/**
 * A short, non-secret id attached to every request's logs and to every error
 * response. Lets Ben grep the function logs for a specific failure a brand
 * reports ("we got request 3f8a2c1b back") without us having to echo the
 * internal error text — which could leak table names, constraint names or
 * key material — to an untrusted caller.
 */
export function newRequestId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}
