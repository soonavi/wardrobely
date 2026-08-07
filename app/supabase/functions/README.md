# Selv Edge Functions

Deno / Supabase Edge Functions. Three endpoints:

| Function | Called by | Auth mechanism | JWT gateway |
|---|---|---|---|
| `affiliate-postback` | Brand / affiliate-network servers | HMAC-SHA256 signature | **must be off** |
| `product-feed-ingest` | Brand servers | Brand API key (bearer, SHA-256 hashed) | **must be off** |
| `delete-account` | The Selv app | Supabase user JWT | on (default) |

Shared code lives in `_shared/` and is bundled into each function at deploy
time — there is no separate deploy step for it.

---

## 1. Prerequisites

```bash
npm install -g supabase        # or: brew install supabase/tap/supabase
supabase login
supabase link --project-ref <your-project-ref>
```

Everything below is run from `app/` (the directory containing `supabase/`).

---

## 2. Secrets

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are **injected automatically**
into every hosted Edge Function. You do not set them, and you must not
override them. They are only needed manually for local `supabase functions
serve` (see §5).

Everything else is set with `supabase secrets set`.

### Required before `affiliate-postback` will accept anything

```bash
# Generate a strong shared secret and keep a copy — this is what the brand or
# network signs with. There is no way to recover it from Supabase later.
openssl rand -hex 32

supabase secrets set AFFILIATE_POSTBACK_SECRET="<the value you just generated>"
```

### Optional — per-network secrets

Set these to give each partner its own credential. The function checks the
network-specific variable first and falls back to `AFFILIATE_POSTBACK_SECRET`.

```bash
supabase secrets set AFFILIATE_POSTBACK_SECRET_DIRECT="<hex>"
supabase secrets set AFFILIATE_POSTBACK_SECRET_RAKUTEN="<hex>"
supabase secrets set AFFILIATE_POSTBACK_SECRET_CJ="<hex>"
supabase secrets set AFFILIATE_POSTBACK_SECRET_IMPACT="<hex>"
supabase secrets set AFFILIATE_POSTBACK_SECRET_SHOPSTYLE="<hex>"
supabase secrets set AFFILIATE_POSTBACK_SECRET_AWIN="<hex>"
```

The suffix is the `affiliate_network` enum value, uppercased.

### Optional — browser CORS

Only needed if an Expo **Web** build calls `delete-account`. Native iOS/Android
does not enforce CORS and works without this.

```bash
supabase secrets set CORS_ALLOWED_ORIGINS="https://app.selv.com,http://localhost:8081"
```

Default is empty = no cross-origin browser access at all, which is the correct
posture for the two server-to-server endpoints.

### Verify what is set

```bash
supabase secrets list      # shows names + digests, never values
```

### Full env var matrix

| Variable | `affiliate-postback` | `product-feed-ingest` | `delete-account` | Source |
|---|---|---|---|---|
| `SUPABASE_URL` | required | required | required | auto-injected |
| `SUPABASE_SERVICE_ROLE_KEY` | required | required | required | auto-injected |
| `AFFILIATE_POSTBACK_SECRET` | **required** | – | – | `secrets set` |
| `AFFILIATE_POSTBACK_SECRET_<NETWORK>` | optional | – | – | `secrets set` |
| `CORS_ALLOWED_ORIGINS` | optional | optional | optional | `secrets set` |

A missing `SUPABASE_*` var throws at module load (the function refuses to
boot). A missing postback secret returns HTTP 500 so the network keeps
retrying rather than losing the conversion.

---

## 3. Deploy

```bash
# The two server-to-server endpoints MUST be deployed with --no-verify-jwt.
# Supabase's gateway otherwise rejects any request whose Authorization header
# is not a valid Supabase JWT — and a brand's server sends an HMAC signature or
# a brand API key, not a JWT. Without this flag the request is bounced before
# our code ever runs, and every postback silently fails with a 401.
# These functions do their OWN authentication; the flag disables the platform
# gateway check, not our security.
supabase functions deploy affiliate-postback  --no-verify-jwt
supabase functions deploy product-feed-ingest --no-verify-jwt

# delete-account keeps the default JWT verification: it is only ever called by
# a signed-in app user, and it re-verifies the token itself anyway.
supabase functions deploy delete-account
```

Deployed URLs:

```
https://<project-ref>.supabase.co/functions/v1/affiliate-postback
https://<project-ref>.supabase.co/functions/v1/product-feed-ingest
https://<project-ref>.supabase.co/functions/v1/delete-account
```

Logs:

```bash
supabase functions logs affiliate-postback --tail
```

Every response carries a `request_id`; grep the logs for it to trace a single
call end to end.

---

## 4. Endpoint reference

### 4.1 `affiliate-postback`

```
POST /functions/v1/affiliate-postback?network=<direct|rakuten|cj|impact|shopstyle|awin>
```

| Header | Required | Value |
|---|---|---|
| `Content-Type` | yes | `application/json` |
| `X-Selv-Timestamp` | yes | Unix time in **seconds**. Rejected if more than 300s from our clock. |
| `X-Selv-Signature` | yes | Lowercase hex HMAC-SHA256 of `` `${timestamp}.${raw_body}` `` under the shared secret. |

Request body:

```jsonc
{
  "subid": "clk_9f2a...",            // required — the click_token from our outbound URL
  "network_order_id": "ORD-10231",   // required — your order id; the idempotency key
  "order_total_cents": 12900,        // required — integer cents, >= 0
  "currency": "USD",                 // optional — ISO 4217, default USD
  "status": "pending",               // optional — pending|approved|reversed|paid, default pending
  "occurred_at": "2026-07-26T10:00:00Z", // optional — ISO 8601, default now
  "product_external_id": "SKU-123",  // optional — attribution fallback if subid is lost
  "items": [{ "sku": "SKU-123", "qty": 1 }] // optional — stored verbatim for audit only
}
```

Success (always HTTP 200, including for duplicates):

```json
{
  "ok": true,
  "conversion_id": "8f1c...",
  "commission_cents": 1290,
  "status": "pending",
  "duplicate": false,
  "request_id": "3f8a2c1b90de"
}
```

Errors:

| Status | Meaning |
|---|---|
| 400 | Body failed validation. `error` names the exact field and why. |
| 401 | Missing/invalid signature, missing/skewed timestamp. |
| 405 | Not a POST. |
| 413 | Body over 256 KB. |
| 422 | Authenticated and well-formed, but not attributable to any brand — the `subid` matched no click and `product_external_id` was missing or ambiguous. **Do not retry as-is**; resend with a valid `product_external_id`. |
| 500 | Our fault (unset secret, DB write failure). **Retry.** |

Send `product_external_id` on every postback even when you have a `subid`. It
costs nothing and it is the only thing standing between a lost `subid` and a
422.

```json
{ "ok": false, "error": "…specific reason…", "request_id": "3f8a2c1b90de" }
```

#### Computing the signature

The signature covers `` `${timestamp}.${raw_body}` `` — the **exact bytes**
sent on the wire. Do not re-serialize the JSON between signing and sending;
key order and whitespace are part of the signed material.

`bash` + `openssl`:

```bash
SECRET="your_shared_secret"
URL="https://<project-ref>.supabase.co/functions/v1/affiliate-postback?network=direct"
TS=$(date +%s)
BODY='{"subid":"clk_abc","network_order_id":"ORD-1","order_total_cents":12900,"currency":"USD","status":"pending"}'

SIG=$(printf '%s' "${TS}.${BODY}" \
  | openssl dgst -sha256 -hmac "$SECRET" -hex \
  | sed 's/^.*= //')

curl -s -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "X-Selv-Timestamp: ${TS}" \
  -H "X-Selv-Signature: ${SIG}" \
  --data-binary "$BODY"
```

Node:

```js
const crypto = require("node:crypto");
const ts = Math.floor(Date.now() / 1000);
const body = JSON.stringify({ subid, network_order_id, order_total_cents });
const sig = crypto.createHmac("sha256", process.env.SELV_POSTBACK_SECRET)
  .update(`${ts}.${body}`).digest("hex");

await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Selv-Timestamp": String(ts),
    "X-Selv-Signature": sig,
  },
  body, // the same string that was signed
});
```

Python:

```python
import hashlib, hmac, json, time, requests

ts = str(int(time.time()))
body = json.dumps({"subid": subid, "network_order_id": oid, "order_total_cents": 12900})
sig = hmac.new(SECRET.encode(), f"{ts}.{body}".encode(), hashlib.sha256).hexdigest()

requests.post(url, data=body, headers={
    "Content-Type": "application/json",
    "X-Selv-Timestamp": ts,
    "X-Selv-Signature": sig,
})
```

#### Reversals

Send the **same** `network_order_id` with `"status": "reversed"`. The
conversion is updated in place, never deleted. `reversed` is terminal: a later
duplicate `pending` or `approved` for the same order is ignored (logged, still
200) so a retried stale event cannot resurrect a refunded sale.

---

### 4.2 `product-feed-ingest`

```
POST /functions/v1/product-feed-ingest
Authorization: Bearer <brand_api_key>
Content-Type: application/json
```

```bash
curl -s -X POST \
  "https://<project-ref>.supabase.co/functions/v1/product-feed-ingest" \
  -H "Authorization: Bearer $SELV_BRAND_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "deactivate_missing": false,
    "products": [
      {
        "external_id": "SKU-123",
        "name": "Linen Camp Shirt",
        "description": "Washed European linen, boxy fit.",
        "category": "top",
        "color": "sand",
        "price_cents": 12900,
        "sale_price_cents": 9900,
        "currency": "USD",
        "image_url": "https://cdn.example.com/sku-123.jpg",
        "extra_image_urls": ["https://cdn.example.com/sku-123-back.jpg"],
        "tryon_image_url": "https://cdn.example.com/sku-123-flat.png",
        "product_url": "https://example.com/products/linen-camp-shirt",
        "sizes": ["XS","S","M","L","XL"],
        "tags": ["linen","summer"],
        "in_stock": true,
        "is_active": true
      }
    ]
  }'
```

Response (HTTP 200 even with per-item errors — `ok` is false if any row failed):

```json
{
  "ok": false,
  "upserted": 412,
  "skipped": 2,
  "deactivated": null,
  "errors": [
    { "index": 17, "external_id": "SKU-988", "message": "`category` is required and must be one of: top, bottom, dress, outerwear, shoes, accessory." },
    { "index": 240, "external_id": "SKU-311", "message": "`image_url` must use https://. Got \"http://\" — …" }
  ],
  "request_id": "c31d70b28a44"
}
```

Rules worth knowing before you write a feed generator:

- **Batch cap: 500 products.** Paginate above that.
- `external_id` must be stable across runs — it is the upsert key.
- Duplicate `external_id` values **within one batch** are rejected after the
  first occurrence (Postgres cannot upsert the same key twice in one statement).
- `image_url`, `product_url`, `tryon_image_url` and every `extra_image_urls`
  entry must be absolute **`https://`** URLs. `http://`, `data:`, `javascript:`
  and `file:` are rejected.
- All prices are integer cents.
- `category` must be one of `top`, `bottom`, `dress`, `outerwear`, `shoes`,
  `accessory`.
- `brand_id` is taken from the API key. Sending one in the body does nothing.
- `deactivate_missing: true` sets `is_active = false` on any of your products
  absent from the batch (full-feed-replace). It is **skipped entirely if any
  item in the batch failed validation**, and must not be used with pagination.

Errors: 400 (malformed envelope), 401 (bad/missing/revoked key), 405, 413
(body over 8 MB), 500.

#### Issuing a brand API key

Keys are stored hashed. Generate one, hand the raw value to the brand once,
and store only the digest:

```bash
KEY="selv_$(openssl rand -hex 24)"
HASH=$(printf '%s' "$KEY" | openssl dgst -sha256 -hex | sed 's/^.*= //')
echo "give the brand: $KEY"
echo "insert this hash: $HASH"
```

```sql
insert into brand_api_keys (brand_id, label, key_hash)
values ('<brand uuid>', 'acme prod feed', '<HASH>');

-- revoke:
update brand_api_keys set revoked_at = now() where id = '<key uuid>';
```

---

### 4.3 `delete-account`

Called only by the app via `supabase.functions.invoke("delete-account")`. To
exercise it manually you need a real user access token:

```bash
curl -s -X POST \
  "https://<project-ref>.supabase.co/functions/v1/delete-account" \
  -H "Authorization: Bearer $USER_ACCESS_TOKEN" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json"
```

```json
{ "success": true, "request_id": "a91f0c2b7e14" }
```

The user id is derived **only** from the verified JWT. There is no request
body and no `user_id` parameter — one user can never delete another.

Failure returns HTTP 200 with `{ "success": false, "error": "…" }` so that
`account.ts` can show the message (`functions.invoke` discards the body of any
non-2xx response). Auth failures return a real 401.

What it removes, in order: storage objects under `{user_id}/` in `garments`
(plus `avatar-previews` / `outfit-thumbnails` if those buckets exist) →
de-identifies `affiliate_clicks` / `affiliate_conversions` / `product_try_ons`
by nulling `user_id` (financial records are kept, the person is not) → deletes
`garments`, `outfits`, `avatars`, `profiles` → deletes the `auth.users` row.
Idempotent at every step.

---

## 5. Local development

```bash
# supabase/.env — NEVER commit this file
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<local service role key from `supabase start`>
AFFILIATE_POSTBACK_SECRET=dev_secret
CORS_ALLOWED_ORIGINS=http://localhost:8081
```

```bash
supabase start
supabase functions serve affiliate-postback --env-file supabase/.env --no-verify-jwt
```

Local base URL is `http://127.0.0.1:54321/functions/v1/<name>`.

Typecheck and lint before deploying (these files are Deno, so the app's `tsc`
does not cover them):

```bash
cd supabase/functions
deno check affiliate-postback/index.ts product-feed-ingest/index.ts delete-account/index.ts
deno lint
```

---

## 6. Keeping commission maths in sync

`_shared/commission.ts` is a deliberate duplicate of the app's
`src/lib/commerce/commission.ts` — Deno cannot import from the React Native
source tree. The two are the client-side and server-side halves of the same
number. **Change them together, in the same commit.** If they drift, the
commission the app shows and the commission we invoice will disagree, and a
brand will find it during reconciliation.
