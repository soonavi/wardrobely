/**
 * `affiliate-postback` — the endpoint that turns a purchase into revenue.
 *
 * WHAT CALLS THIS
 * ---------------
 * A brand's backend (direct integration) or an affiliate network's postback
 * worker (Rakuten/CJ/Impact/ShopStyle/Awin), server-to-server, after an order
 * completes on the brand's own checkout. There is no user and no browser in
 * this request path — the shopper finished buying minutes or hours ago and
 * has long since closed the app.
 *
 * WHY IT MATTERS MORE THAN ANY OTHER ENDPOINT
 * -------------------------------------------
 * This is the only place Selv learns that it earned money. Every failure mode
 * here is a financial one:
 *   - accept a forged postback  -> we invoice a brand for a sale that never
 *                                  happened, and lose the partner
 *   - reject a real postback    -> we never get paid for a sale we drove
 *   - double-count a retry      -> we over-invoice; brands reconcile and
 *                                  catch it
 *   - drop an unattributed sale -> revenue silently vanishes
 *
 * So the shape of the code is: authenticate hard, validate hard, then be as
 * forgiving as possible about *recording* the event. Networks retry on any
 * non-2xx, so a 200 is a promise that we have durably stored the event; a
 * non-2xx is a request to try again.
 *
 * CONTRACT
 * --------
 *   POST /functions/v1/affiliate-postback?network=<affiliate_network>
 *   Headers:
 *     X-Selv-Timestamp: <unix seconds>
 *     X-Selv-Signature: <hex HMAC-SHA256 of `${timestamp}.${rawBody}`>
 *     Content-Type: application/json
 *   Body:
 *     {
 *       "subid": "<click_token we put in the outbound URL>",
 *       "network_order_id": "<the brand/network's own order id>",
 *       "order_total_cents": 12900,
 *       "currency": "USD",                 // optional, default USD
 *       "status": "pending",               // optional, default pending
 *       "occurred_at": "2026-07-26T10:00:00Z", // optional, default now
 *       "product_external_id": "SKU-123",  // optional, attribution fallback
 *       "items": [ ... ]                   // optional, stored for audit only
 *     }
 *   200: { ok: true, conversion_id, commission_cents, status, request_id }
 *   4xx: { ok: false, error: "<specific reason>", request_id }
 */

import {
  corsHeaders,
  handlePreflight,
  jsonResponse,
  newRequestId,
} from "../_shared/cors.ts";
import {
  PG_UNIQUE_VIOLATION,
  supabaseAdmin,
} from "../_shared/supabaseAdmin.ts";
import {
  commissionCents,
  formatBps,
  resolveCommissionRateBps,
} from "../_shared/commission.ts";

// ---------------------------------------------------------------------------
// Domain constants — these mirror the enums in supabase/schema.sql verbatim.
// ---------------------------------------------------------------------------

const AFFILIATE_NETWORKS = [
  "direct",
  "rakuten",
  "cj",
  "impact",
  "shopstyle",
  "awin",
] as const;
type AffiliateNetwork = (typeof AFFILIATE_NETWORKS)[number];

const CONVERSION_STATUSES = [
  "pending",
  "approved",
  "reversed",
  "paid",
] as const;
type ConversionStatus = (typeof CONVERSION_STATUSES)[number];

/**
 * Maximum clock skew tolerated between the caller's `X-Selv-Timestamp` and
 * our clock, in seconds. Five minutes is the industry-standard window (Stripe,
 * Slack and Shopify all use 5 minutes) — long enough to absorb an unsynced
 * server clock and a slow retry, short enough that a captured request can't be
 * replayed usefully later.
 */
const MAX_TIMESTAMP_SKEW_SECONDS = 300;

/**
 * Reject absurd order totals outright. $10,000,000 is far beyond any real
 * apparel order, so a value above it means a units bug on the caller's side
 * (dollars sent as cents, or cents sent as micro-cents) — we would rather
 * bounce it with a clear message than quietly invoice a brand for it.
 */
const MAX_ORDER_TOTAL_CENTS = 1_000_000_000;

/** Cap the request body so a malformed/hostile caller can't exhaust memory. */
const MAX_BODY_BYTES = 256 * 1024;

/** How many superseded payloads to retain on a conversion row. */
const MAX_PAYLOAD_HISTORY = 10;

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

/**
 * Explicit status-transition table. `STATUS_TRANSITIONS[current]` is the set
 * of statuses a postback is allowed to move an existing conversion INTO.
 *
 * The rules, and why:
 *
 *   pending  -> pending | approved | reversed | paid
 *       The normal lifecycle. `pending -> paid` is allowed because some
 *       networks skip the explicit approval event and only report a
 *       conversion once it has already been settled in their payment cycle.
 *
 *   approved -> approved | reversed | paid
 *       Forward or reversed only. Never back to `pending`: once a brand has
 *       confirmed the order, a stale in-flight `pending` retry arriving late
 *       must not un-confirm it.
 *
 *   paid     -> paid | reversed
 *       `paid -> reversed` is a genuine clawback (a return processed after we
 *       were paid); it becomes a debit on the next reconciliation. `paid ->
 *       approved` is a downgrade and is rejected — we do not un-pay ourselves
 *       because of an out-of-order event.
 *
 *   reversed -> reversed
 *       TERMINAL. This is the load-bearing row of the table. Networks retry
 *       aggressively and deliver out of order: it is entirely normal for the
 *       original `pending` postback to be retried *after* the `reversed` one
 *       has already landed. Without this rule, a refunded order would flip
 *       back to `pending`, then get `approved` on the next sweep, and Selv
 *       would invoice for a sale that was returned. A reversal that is itself
 *       a mistake is corrected by a human, not by a duplicate postback.
 *
 * Anything not listed is ignored: we keep the current status, still return
 * 200 (so the network stops retrying), and log the rejected transition.
 */
const STATUS_TRANSITIONS: Record<ConversionStatus, readonly ConversionStatus[]> = {
  pending: ["pending", "approved", "reversed", "paid"],
  approved: ["approved", "reversed", "paid"],
  paid: ["paid", "reversed"],
  reversed: ["reversed"],
};

/**
 * Given the stored status and the status a postback is asking for, return the
 * status the row should end up in. Never throws — an illegal transition just
 * resolves to "no change".
 */
function resolveStatusTransition(
  current: ConversionStatus,
  incoming: ConversionStatus,
): { status: ConversionStatus; changed: boolean; allowed: boolean } {
  const allowed = STATUS_TRANSITIONS[current].includes(incoming);
  if (!allowed) return { status: current, changed: false, allowed: false };
  return { status: incoming, changed: incoming !== current, allowed: true };
}

// ---------------------------------------------------------------------------
// HMAC verification
// ---------------------------------------------------------------------------

/**
 * Constant-time byte comparison.
 *
 * A naive `a === b` on hex strings short-circuits on the first differing
 * character, so the time it takes to fail leaks how many leading bytes were
 * correct. That turns forging a signature from "brute force 2^256" into "brute
 * force 32 bytes one at a time" for an attacker who can measure response
 * latency — a well-documented, practically exploited class of bug.
 *
 * This runs over `max(a.length, b.length)` bytes unconditionally and folds the
 * length mismatch into the same accumulator, so neither the content nor the
 * length of the presented signature changes the work done.
 *
 * (`Uint8Array` out-of-bounds reads return `undefined`, hence the `?? 0`.)
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

/** Decode a hex string to bytes. Returns `null` on any non-hex input. */
function hexToBytes(hex: string): Uint8Array | null {
  const clean = hex.trim().toLowerCase();
  if (clean.length === 0 || clean.length % 2 !== 0) return null;
  if (!/^[0-9a-f]+$/.test(clean)) return null;

  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** HMAC-SHA256 of `message` under `secret`, as raw bytes. */
async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return new Uint8Array(signature);
}

/**
 * Look up the shared secret for a network.
 *
 * Per-network secrets exist so that a compromised or rotated credential at one
 * network cannot be used to post conversions "from" another. `?network=rakuten`
 * checks `AFFILIATE_POSTBACK_SECRET_RAKUTEN` first and falls back to the
 * shared `AFFILIATE_POSTBACK_SECRET`, which keeps a single-partner setup (and
 * local testing) to one secret while leaving room to split them later without
 * a code change.
 */
function secretForNetwork(network: AffiliateNetwork): string | null {
  const specific = Deno.env.get(
    `AFFILIATE_POSTBACK_SECRET_${network.toUpperCase()}`,
  );
  if (specific && specific.length > 0) return specific;

  const fallback = Deno.env.get("AFFILIATE_POSTBACK_SECRET");
  return fallback && fallback.length > 0 ? fallback : null;
}

// ---------------------------------------------------------------------------
// Request body validation
// ---------------------------------------------------------------------------

interface PostbackBody {
  subid: string;
  networkOrderId: string;
  orderTotalCents: number;
  currency: string;
  status: ConversionStatus;
  occurredAt: string;
  productExternalId: string | null;
}

type ValidationResult =
  | { ok: true; value: PostbackBody }
  | { ok: false; error: string };

function isNonEmptyString(v: unknown, maxLen: number): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= maxLen;
}

/**
 * Strict validation of the postback body. Every rejection returns a specific,
 * actionable message because the caller is an engineer at a partner company
 * wiring this up for the first time — "invalid request" costs a day of email
 * round-trips, "order_total_cents must be a non-negative integer number of
 * cents (got 129.0)" costs five minutes.
 *
 * These messages are safe to expose: they describe only what the caller sent,
 * never anything about our internals.
 */
function validateBody(raw: unknown): ValidationResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  const body = raw as Record<string, unknown>;

  // --- subid (our click_token) --------------------------------------------
  if (!isNonEmptyString(body.subid, 256)) {
    return {
      ok: false,
      error:
        "`subid` is required and must be a non-empty string of at most 256 " +
        "characters. It is the value Selv appended to the outbound product " +
        "URL and that you should echo back verbatim.",
    };
  }

  // --- network_order_id ----------------------------------------------------
  if (!isNonEmptyString(body.network_order_id, 256)) {
    return {
      ok: false,
      error:
        "`network_order_id` is required and must be a non-empty string of at " +
        "most 256 characters. It must be stable across retries — it is the " +
        "idempotency key for this conversion.",
    };
  }

  // --- order_total_cents ---------------------------------------------------
  const total = body.order_total_cents;
  if (typeof total !== "number" || !Number.isInteger(total)) {
    return {
      ok: false,
      error:
        "`order_total_cents` must be an integer number of cents (e.g. 12900 " +
        `for $129.00), not ${typeof total === "number" ? String(total) : typeof total}.`,
    };
  }
  if (total < 0) {
    return {
      ok: false,
      error:
        "`order_total_cents` must be >= 0. A refund is reported by sending " +
        '`status: "reversed"` for the original `network_order_id`, not as a ' +
        "negative amount.",
    };
  }
  if (total > MAX_ORDER_TOTAL_CENTS) {
    return {
      ok: false,
      error:
        `\`order_total_cents\` exceeds the maximum of ${MAX_ORDER_TOTAL_CENTS} ` +
        "(this usually means the amount was sent in a unit other than cents).",
    };
  }

  // --- currency ------------------------------------------------------------
  let currency = "USD";
  if (body.currency !== undefined && body.currency !== null) {
    if (typeof body.currency !== "string" || !/^[A-Za-z]{3}$/.test(body.currency)) {
      return {
        ok: false,
        error: "`currency` must be a 3-letter ISO 4217 code, e.g. \"USD\".",
      };
    }
    currency = body.currency.toUpperCase();
  }

  // --- status --------------------------------------------------------------
  let status: ConversionStatus = "pending";
  if (body.status !== undefined && body.status !== null) {
    if (
      typeof body.status !== "string" ||
      !CONVERSION_STATUSES.includes(body.status as ConversionStatus)
    ) {
      return {
        ok: false,
        error:
          "`status` must be one of: " + CONVERSION_STATUSES.join(", ") + ".",
      };
    }
    status = body.status as ConversionStatus;
  }

  // --- occurred_at ---------------------------------------------------------
  let occurredAt = new Date().toISOString();
  if (body.occurred_at !== undefined && body.occurred_at !== null) {
    if (typeof body.occurred_at !== "string") {
      return {
        ok: false,
        error: "`occurred_at` must be an ISO-8601 timestamp string.",
      };
    }
    const parsed = new Date(body.occurred_at);
    if (Number.isNaN(parsed.getTime())) {
      return {
        ok: false,
        error:
          "`occurred_at` could not be parsed as a date. Use ISO-8601, e.g. " +
          '"2026-07-26T10:00:00Z".',
      };
    }
    // Unlike X-Selv-Timestamp, occurred_at is allowed to be well in the past:
    // networks batch conversions and often report days late. Only the future
    // is nonsensical, and even then we accept a little slack for clock skew.
    occurredAt = parsed.toISOString();
  }

  // --- product_external_id (optional attribution fallback) -----------------
  let productExternalId: string | null = null;
  if (body.product_external_id !== undefined && body.product_external_id !== null) {
    if (!isNonEmptyString(body.product_external_id, 256)) {
      return {
        ok: false,
        error:
          "`product_external_id`, when present, must be a non-empty string of " +
          "at most 256 characters.",
      };
    }
    productExternalId = body.product_external_id.trim();
  }

  // --- items (optional; audit only) ----------------------------------------
  // `items` is never parsed into columns — it is retained inside raw_payload
  // for dispute resolution ("which line items made up this order total?").
  // Only its type is checked so a malformed value is caught at the boundary.
  if (body.items !== undefined && body.items !== null && !Array.isArray(body.items)) {
    return { ok: false, error: "`items`, when present, must be an array." };
  }

  return {
    ok: true,
    value: {
      subid: body.subid.trim(),
      networkOrderId: body.network_order_id.trim(),
      orderTotalCents: total,
      currency,
      status,
      occurredAt,
      productExternalId,
    },
  };
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

interface Attribution {
  clickId: string | null;
  userId: string | null;
  /**
   * NOTE: `affiliate_conversions.brand_id` is NOT NULL in the schema, so a
   * null here means the conversion is *unstorable*, not merely unattributed.
   * The handler turns that into a 422 rather than a failed insert — see the
   * `brandId === null` branch below.
   */
  brandId: string | null;
  productId: string | null;
  rateBps: number;
  /** For logging: how we arrived at this attribution. */
  method: "click_token" | "product_external_id" | "unattributed";
}

/**
 * Look up products by `external_id`, optionally scoped to brands on a given
 * network. Returns at most 2 rows — we only need to know "exactly one" vs
 * "more than one". Errors degrade to an empty result and a log line.
 */
async function lookupProductByExternalId(
  externalId: string,
  network: AffiliateNetwork | null,
  requestId: string,
): Promise<Array<Record<string, unknown>>> {
  let query = supabaseAdmin
    .from("brand_products")
    .select(
      "id, brand_id, commission_rate_bps, brands!inner(commission_rate_bps, network)",
    )
    .eq("external_id", externalId);

  if (network) query = query.eq("brands.network", network);

  const { data, error } = await query.limit(2);

  if (error) {
    console.error(
      `[postback ${requestId}] brand_products fallback lookup failed ` +
        `(network=${network ?? "any"}):`,
      error.message,
    );
    return [];
  }

  return (data ?? []) as Array<Record<string, unknown>>;
}

/**
 * Resolve who/what a conversion belongs to.
 *
 * PRIMARY PATH — the click token.
 * `subid` is the `click_token` we minted when the user tapped Buy and wrote
 * into `affiliate_clicks`. Finding it gives us the user, the brand, the
 * product, and — critically — `affiliate_clicks.commission_rate_bps`.
 *
 * WHY WE USE THE SNAPSHOTTED RATE AND NOT TODAY'S RATE:
 * The rate is captured at click time and inherited here unchanged. If a brand
 * renegotiates from 12% to 8% next month, every order from a click made under
 * the old agreement must still bill at 12%. Reading the *current*
 * `brands.commission_rate_bps` here would retroactively re-price completed
 * orders every time a rate changed — a bookkeeping nightmare, an unarguable
 * source of invoice disputes, and in the reverse direction (rate goes up) a
 * charge the brand never agreed to. The click row is the contract; this
 * function copies it, it does not recompute it. `price_cents_at_click` on the
 * same row exists for the same reason.
 *
 * FALLBACK PATH — product_external_id.
 * Click tokens go missing for mundane reasons: the user cleared the app, the
 * network dropped the subid through a redirect chain, the brand's checkout
 * stripped the query string, or the purchase happened on a different device.
 * When that happens the sale is still real and we still drove it, so we record
 * the conversion **unattributed** (`click_id`/`user_id` null) rather than
 * discarding it. An unattributed row is still billable revenue and still shows
 * up in reconciliation; a dropped row is money gone with no trace. The cost is
 * that we cannot credit it to a user's funnel — an acceptable trade for not
 * losing the revenue.
 *
 * The fallback resolves the product by `external_id` scoped to brands on the
 * reporting network. If that is ambiguous (the same SKU string used by two
 * brands on the same network) we deliberately attribute to neither — a wrong
 * brand attribution is worse than none, because it invoices the wrong company.
 */
async function resolveAttribution(
  body: PostbackBody,
  network: AffiliateNetwork,
  requestId: string,
): Promise<Attribution> {
  // --- Primary: click token -------------------------------------------------
  const { data: click, error: clickError } = await supabaseAdmin
    .from("affiliate_clicks")
    .select("id, user_id, brand_id, product_id, commission_rate_bps")
    .eq("click_token", body.subid)
    .maybeSingle();

  if (clickError) {
    // A lookup failure is not the same as "no click": we must not silently
    // downgrade to unattributed because the database hiccuped. Log it and let
    // the fallback run, but make the distinction visible in the logs.
    console.error(
      `[postback ${requestId}] affiliate_clicks lookup failed:`,
      clickError.message,
    );
  }

  if (click) {
    return {
      clickId: click.id as string,
      userId: (click.user_id as string | null) ?? null,
      brandId: (click.brand_id as string | null) ?? null,
      productId: (click.product_id as string | null) ?? null,
      // Snapshotted at click time — see the comment above. Fall back to the
      // platform default only if the click row somehow has no rate.
      rateBps: resolveCommissionRateBps(
        click.commission_rate_bps as number | null,
        null,
      ),
      method: "click_token",
    };
  }

  // --- Fallback: product_external_id ---------------------------------------
  if (body.productExternalId) {
    // Two attempts, most-specific first. `external_id` is only unique per
    // brand, so we scope by the reporting network to disambiguate; if that
    // finds nothing (e.g. the brand row's network was never updated after
    // they moved onto a network) we retry unscoped and accept the result only
    // when it is unambiguous. Two cheap queries are worth it — the
    // alternative is failing to bill for a real sale.
    let products = await lookupProductByExternalId(
      body.productExternalId,
      network,
      requestId,
    );
    if (products.length === 0) {
      products = await lookupProductByExternalId(
        body.productExternalId,
        null,
        requestId,
      );
    }

    if (products.length === 1) {
      const product = products[0] as Record<string, unknown>;

      // PostgREST returns a to-one embed as an object, but some
      // client/schema-cache combinations surface it as a single-element
      // array. Normalise both rather than depending on which one we get.
      const embed = product.brands as
        | { commission_rate_bps?: number | null }
        | Array<{ commission_rate_bps?: number | null }>
        | null;
      const brand = Array.isArray(embed) ? (embed[0] ?? null) : embed;

      return {
        clickId: null,
        userId: null,
        brandId: (product.brand_id as string | null) ?? null,
        productId: (product.id as string | null) ?? null,
        rateBps: resolveCommissionRateBps(
          product.commission_rate_bps as number | null,
          brand?.commission_rate_bps ?? null,
        ),
        method: "product_external_id",
      };
    } else if (products.length > 1) {
      console.warn(
        `[postback ${requestId}] product_external_id "${body.productExternalId}" ` +
          "matches products belonging to more than one brand — refusing to " +
          "guess, since attributing to the wrong brand invoices the wrong company.",
      );
    }
  }

  // --- Unattributed ---------------------------------------------------------
  return {
    clickId: null,
    userId: null,
    brandId: null,
    productId: null,
    rateBps: resolveCommissionRateBps(null, null),
    method: "unattributed",
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const requestId = newRequestId();

  if (req.method !== "POST") {
    return jsonResponse(req, 405, {
      ok: false,
      error: "Method not allowed. Use POST.",
      request_id: requestId,
    });
  }

  try {
    // --- 1. Network selection ----------------------------------------------
    const url = new URL(req.url);
    const networkParam = (url.searchParams.get("network") ?? "direct").toLowerCase();

    if (!AFFILIATE_NETWORKS.includes(networkParam as AffiliateNetwork)) {
      return jsonResponse(req, 400, {
        ok: false,
        error:
          "Unknown `network` query parameter. Must be one of: " +
          AFFILIATE_NETWORKS.join(", ") + ".",
        request_id: requestId,
      });
    }
    const network = networkParam as AffiliateNetwork;

    // --- 2. Read the RAW body ----------------------------------------------
    // The signature covers the exact bytes the caller sent. We must therefore
    // read the body as text and sign *that*, never re-serialize the parsed
    // JSON — key ordering and whitespace differ and every signature would fail.
    const rawBody = await req.text();

    if (rawBody.length > MAX_BODY_BYTES) {
      return jsonResponse(req, 413, {
        ok: false,
        error: `Request body exceeds ${MAX_BODY_BYTES} bytes.`,
        request_id: requestId,
      });
    }

    // --- 3. Replay protection ----------------------------------------------
    // The timestamp is part of the signed payload, so it cannot be edited by
    // anyone who does not hold the secret. Binding it into the signature is
    // what makes the freshness check meaningful: without it, an attacker who
    // captured one valid request could replay the same body forever.
    const timestampHeader = req.headers.get("X-Selv-Timestamp");
    if (!timestampHeader) {
      return jsonResponse(req, 401, {
        ok: false,
        error: "Missing X-Selv-Timestamp header (unix seconds).",
        request_id: requestId,
      });
    }

    const timestamp = Number(timestampHeader);
    if (!Number.isFinite(timestamp) || !Number.isInteger(timestamp)) {
      return jsonResponse(req, 401, {
        ok: false,
        error: "X-Selv-Timestamp must be an integer number of unix seconds.",
        request_id: requestId,
      });
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const skew = Math.abs(nowSeconds - timestamp);
    if (skew > MAX_TIMESTAMP_SKEW_SECONDS) {
      // Deliberately reported as a skew problem, because in practice this is
      // almost always an unsynced clock on the caller's side rather than an
      // attack, and saying so saves a support round-trip.
      return jsonResponse(req, 401, {
        ok: false,
        error:
          `X-Selv-Timestamp is ${skew}s away from server time; the maximum ` +
          `allowed skew is ${MAX_TIMESTAMP_SKEW_SECONDS}s. Check the sending ` +
          "server's clock (NTP), and send seconds, not milliseconds.",
        request_id: requestId,
      });
    }

    // --- 4. Signature verification -----------------------------------------
    const secret = secretForNetwork(network);
    if (!secret) {
      // A missing secret is OUR misconfiguration, not the caller's. Return 500
      // (not 401) so the network keeps retrying and the conversions are not
      // lost while Ben sets the secret.
      console.error(
        `[postback ${requestId}] no postback secret configured for network ` +
          `"${network}". Set AFFILIATE_POSTBACK_SECRET_${network.toUpperCase()} ` +
          "or AFFILIATE_POSTBACK_SECRET.",
      );
      return jsonResponse(req, 500, {
        ok: false,
        error: "Postback verification is temporarily unavailable. Please retry.",
        request_id: requestId,
      });
    }

    const signatureHeader = req.headers.get("X-Selv-Signature");
    if (!signatureHeader) {
      return jsonResponse(req, 401, {
        ok: false,
        error:
          "Missing X-Selv-Signature header (hex HMAC-SHA256 of " +
          '`${X-Selv-Timestamp}.${raw_request_body}`).',
        request_id: requestId,
      });
    }

    const presented = hexToBytes(signatureHeader);
    const expected = await hmacSha256(secret, `${timestamp}.${rawBody}`);

    // NOTE: the signature value itself is never logged, here or anywhere else
    // in this file. Logging even a rejected signature would put attacker-
    // controlled bytes next to our secrets in the log stream, and logging a
    // valid one would let anyone with log access replay it inside the 5-minute
    // window.
    if (!presented || !timingSafeEqual(presented, expected)) {
      console.warn(
        `[postback ${requestId}] signature rejected for network "${network}".`,
      );
      return jsonResponse(req, 401, {
        ok: false,
        error: "Invalid signature.",
        request_id: requestId,
      });
    }

    // --- 5. Parse + validate ------------------------------------------------
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return jsonResponse(req, 400, {
        ok: false,
        error: "Request body is not valid JSON.",
        request_id: requestId,
      });
    }

    const validation = validateBody(parsed);
    if (!validation.ok) {
      return jsonResponse(req, 400, {
        ok: false,
        error: validation.error,
        request_id: requestId,
      });
    }
    const body = validation.value;

    // --- 6. Attribution -----------------------------------------------------
    const attribution = await resolveAttribution(body, network, requestId);

    // --- 7. Unstorable conversions -----------------------------------------
    //
    // `affiliate_conversions.brand_id` is NOT NULL, so a conversion we cannot
    // tie to *any* brand physically cannot be recorded. `user_id` and
    // `click_id` ARE nullable, which is the case the fallback in
    // resolveAttribution exists to serve — a sale with no click row is still
    // recorded and still billable. But with no brand there is nobody to
    // invoice and no row to write.
    //
    // This is answered with 422, deliberately, rather than 5xx: the request
    // was well-formed and authenticated, but no amount of retrying will make
    // it storable, and networks retry 5xx forever. A 4xx stops the retry loop
    // and surfaces the problem to the partner immediately, which is the only
    // way it gets fixed. The log line is loud because this IS lost revenue
    // until someone acts on it.
    if (attribution.brandId === null) {
      console.error(
        `[postback ${requestId}] REVENUE AT RISK — could not resolve a brand. ` +
          `network=${network} order=${body.networkOrderId} subid=${body.subid} ` +
          `product_external_id=${body.productExternalId ?? "-"} ` +
          `total=${body.orderTotalCents}${body.currency}. ` +
          "No affiliate_clicks row matched the subid and the product fallback " +
          "did not resolve to exactly one brand.",
      );
      return jsonResponse(req, 422, {
        ok: false,
        error:
          "Could not attribute this conversion to a brand. The `subid` did " +
          "not match a known Selv click, and `product_external_id` was " +
          "missing or did not resolve to exactly one product. Include a " +
          "`product_external_id` that matches the `external_id` from your " +
          "product feed, or contact Selv with the request id below.",
        request_id: requestId,
      });
    }

    // --- 8. Commission ------------------------------------------------------
    const commission = commissionCents(body.orderTotalCents, attribution.rateBps);

    console.log(
      `[postback ${requestId}] network=${network} order=${body.networkOrderId} ` +
        `subid=${body.subid} attribution=${attribution.method} ` +
        `brand=${attribution.brandId ?? "-"} product=${attribution.productId ?? "-"} ` +
        `total=${body.orderTotalCents}${body.currency} ` +
        `rate=${formatBps(attribution.rateBps)} commission=${commission} ` +
        `status=${body.status}`,
    );

    // --- 9. Idempotent write ------------------------------------------------
    const confirmedAt =
      body.status === "approved" || body.status === "paid"
        ? new Date().toISOString()
        : null;

    const insertRow = {
      click_id: attribution.clickId,
      click_token: body.subid,
      user_id: attribution.userId,
      brand_id: attribution.brandId,
      product_id: attribution.productId,
      network,
      network_order_id: body.networkOrderId,
      order_total_cents: body.orderTotalCents,
      currency: body.currency,
      commission_rate_bps: attribution.rateBps,
      commission_cents: commission,
      status: body.status,
      occurred_at: body.occurredAt,
      confirmed_at: confirmedAt,
      // Full body retained verbatim for auditing and dispute resolution: when
      // a brand queries an invoice line six months from now, this is the only
      // record of exactly what they told us and when.
      raw_payload: parsed,
    };

    // Try the insert first and let the `(network, network_order_id)` unique
    // constraint be the idempotency mechanism.
    //
    // WHY INSERT-THEN-HANDLE-CONFLICT RATHER THAN SELECT-THEN-INSERT:
    // networks retry aggressively and often fire duplicates concurrently. A
    // read-then-write would race — both requests would see "no existing row"
    // and both would insert, and only the constraint would save us from a
    // double-count. Going straight at the constraint makes the database the
    // arbiter, which is the only component that can be.
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("affiliate_conversions")
      .insert(insertRow)
      .select("id, status, commission_cents")
      .single();

    if (!insertError && inserted) {
      return jsonResponse(req, 200, {
        ok: true,
        conversion_id: inserted.id,
        commission_cents: inserted.commission_cents,
        status: inserted.status,
        duplicate: false,
        request_id: requestId,
      });
    }

    if (insertError && insertError.code !== PG_UNIQUE_VIOLATION) {
      // A real write failure. Return 5xx so the network retries — this is the
      // one case where we *want* to be retried.
      console.error(
        `[postback ${requestId}] conversion insert failed:`,
        insertError.message,
      );
      return jsonResponse(req, 500, {
        ok: false,
        error: "Could not record conversion. Please retry.",
        request_id: requestId,
      });
    }

    // --- 10. Duplicate: apply the status transition --------------------------
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("affiliate_conversions")
      .select("id, status, commission_cents, raw_payload")
      .eq("network", network)
      .eq("network_order_id", body.networkOrderId)
      .maybeSingle();

    if (existingError || !existing) {
      console.error(
        `[postback ${requestId}] unique violation but existing row not found:`,
        existingError?.message ?? "no row",
      );
      return jsonResponse(req, 500, {
        ok: false,
        error: "Could not record conversion. Please retry.",
        request_id: requestId,
      });
    }

    const currentStatus = existing.status as ConversionStatus;
    const transition = resolveStatusTransition(currentStatus, body.status);

    if (!transition.allowed) {
      console.warn(
        `[postback ${requestId}] rejected status transition ` +
          `${currentStatus} -> ${body.status} for order ${body.networkOrderId}; ` +
          "keeping current status.",
      );
    }

    if (!transition.changed) {
      // Pure duplicate (or a rejected transition). 200 with the stored values:
      // the event IS recorded, so telling the network anything other than
      // success would only make it retry forever.
      return jsonResponse(req, 200, {
        ok: true,
        conversion_id: existing.id,
        commission_cents: existing.commission_cents,
        status: currentStatus,
        duplicate: true,
        request_id: requestId,
      });
    }

    // Append the superseding payload to the audit trail. Keep the most recent
    // body at the top level (that is the current truth) and retain prior ones
    // under a reserved key, capped so a pathological retry loop cannot grow
    // the row without bound.
    const priorHistory = Array.isArray(
      (existing.raw_payload as Record<string, unknown> | null)?._history,
    )
      ? ((existing.raw_payload as Record<string, unknown>)._history as unknown[])
      : [];
    const previousPayload = { ...(existing.raw_payload as Record<string, unknown> ?? {}) };
    delete previousPayload._history;

    const mergedPayload = {
      ...(parsed as Record<string, unknown>),
      _history: [...priorHistory, previousPayload].slice(-MAX_PAYLOAD_HISTORY),
    };

    // Guard the update with the status we read. If a concurrent postback moved
    // the row in between, this matches zero rows and we simply report the
    // stored state — better than clobbering a reversal that landed first.
    const update: Record<string, unknown> = {
      status: transition.status,
      raw_payload: mergedPayload,
    };
    if (transition.status === "approved" || transition.status === "paid") {
      update.confirmed_at = new Date().toISOString();
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("affiliate_conversions")
      .update(update)
      .eq("id", existing.id)
      .eq("status", currentStatus)
      .select("id, status, commission_cents")
      .maybeSingle();

    if (updateError) {
      console.error(
        `[postback ${requestId}] conversion status update failed:`,
        updateError.message,
      );
      return jsonResponse(req, 500, {
        ok: false,
        error: "Could not update conversion. Please retry.",
        request_id: requestId,
      });
    }

    if (!updated) {
      // Lost the race; the other writer's state stands.
      console.warn(
        `[postback ${requestId}] concurrent update won for order ` +
          `${body.networkOrderId}; leaving stored status in place.`,
      );
      return jsonResponse(req, 200, {
        ok: true,
        conversion_id: existing.id,
        commission_cents: existing.commission_cents,
        status: currentStatus,
        duplicate: true,
        request_id: requestId,
      });
    }

    console.log(
      `[postback ${requestId}] order ${body.networkOrderId}: ` +
        `${currentStatus} -> ${updated.status}`,
    );

    return jsonResponse(req, 200, {
      ok: true,
      conversion_id: updated.id,
      commission_cents: updated.commission_cents,
      status: updated.status,
      duplicate: true,
      request_id: requestId,
    });
  } catch (err) {
    // Never leak internal error text to a partner's server: it can contain
    // table names, constraint names, and occasionally connection strings.
    console.error(
      `[postback ${requestId}] unhandled error:`,
      err instanceof Error ? err.stack ?? err.message : String(err),
    );
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Internal error. Please retry.",
        request_id: requestId,
      }),
      { status: 500, headers: corsHeaders(req) },
    );
  }
});
