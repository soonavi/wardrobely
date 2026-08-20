# Data Handling Spec (Engineering-Facing)

**Audience:** whoever is building/maintaining the Supabase backend, the account-deletion flow, and the App Store Connect submission. Pairs with `legal/PRIVACY_POLICY.md` (the user-facing version of this document) and `PRODUCT_SPEC.md` §7 (data model).
**Last updated:** 2026-08-20 (reconciled against the shipped code — see the reconciliation note below)

> This is engineering guidance, not legal advice — items marked `[VERIFY]` need a lawyer or a vendor DPA check before launch, not just an engineer's judgment call.

> ### 📋 Reconciliation note — 2026-08-20
> **Every table, bucket, processor and deletion step below was re-derived from the code on 2026-08-20** — `app/supabase/schema.sql`, `app/supabase/migrations/002_commerce.sql`–`006_age_gate.sql`, `app/src/lib/api/*.ts`, and `app/supabase/functions/delete-account/index.ts`. The previous revision of this file described a pre-pivot product and a vendor stack that does not exist. Corrections fall into two directions, and both are filing risks:
>
> - **Over-declared and now removed:** a `garment-ingest` Edge Function sending garment photos to **remove.bg** (neither exists — zero matches across `app/src` and `app/supabase`); **RevenueCat** as a processor and a deletion step (not a dependency; `app/src/lib/pricing.ts` holds a `TODO` stub and `getCurrentPlan()` is hardcoded to `"free"`); hashed passwords, Sign in with Apple and Google OAuth (auth is `signInWithOtp`/`verifyOtp` only); an Apple token-revocation deletion step; a password re-entry confirmation; a `catalog_items` table; `garment-templates` and `catalog` storage buckets.
> - **Under-declared and now added:** eight live tables missing from §2a, five of which hold user-linked data (`wishlist_items`, `product_try_ons`, `affiliate_clicks`, `affiliate_conversions`, `waitlist_signups`, plus the system-owned `brands`, `brand_products`, `brand_api_keys`); the affiliate click/postback flow as an outbound data path (§2c); the 13+ age gate columns from `006_age_gate.sql`; **Product Interaction** and **Purchase History** in §4, both of which were marked *Pending* or justified by a vendor that does not exist.
>
> **One correction has filing consequences and is called out rather than folded in:** §4's Health & Fitness answer previously rested on "height/weight are not used to generate the avatar." That reasoning is true of the 3D try-on character and **false of the Profile screen**, where `buildWidthScale()` derives a BMI and scales the rendered silhouettes. It is now an open `[VERIFY]` for counsel, not a "No."
>
> Section numbers (§1, §2a–§2d, §3.1–§3.5, §4) are unchanged, because `SHIP_READINESS.md`, `LAUNCH_CHECKLIST.md`, `PRIVACY_POLICY.md`, `schema.sql` and the verification scripts all cite this file by section. §2d is new and additive.

---

> **Avatar approach (updated, and corrected 2026-08-20):** Selv does not build the try-on avatar from a photo or from body measurements. Users design a customizable character in a character creator (skin tone, face shape, eyes, hair, brows, facial hair, body type, accessories), stored in `avatars.customization` (jsonb). That is a genuine privacy simplification — the try-on avatar is a record of preset choices, not body or photo data.
>
> **Do not extend that conclusion to `profiles.height_cm` / `profiles.weight_kg`.** Those are two different columns from `avatars.height_cm` / `avatars.weight_kg`, they are live, and they *do* drive a rendered body shape:
> `app/src/features/profile/ProfileScreen.tsx:73` calls `buildWidthScale(profile.height_cm, profile.weight_kg)`, and `app/src/features/avatar/avatars.tsx:27-33` computes `bmi = weightKg / (heightCm/100)^2` and returns `sqrt(bmi/22)` clamped to 0.85–1.25, which `BuildPicker` applies as a horizontal scale to the body silhouettes. Both fields have a real UI (unit toggle, 90–250 cm / 30–300 kg validation in `src/lib/bodyMetrics.ts`), and `saveMetrics()` refuses to save a build change without them. The derived BMI is computed at render time and is not persisted.
> The **`avatars`** table's `height_cm`/`weight_kg`/`chest_cm`/`waist_cm`/`hip_cm`/`inseam_cm`/`skin_tone`/`shape_params` columns are the legacy measurement pipeline and *are* dead: their only writer is `upsertMyAvatar()` in `src/lib/api/avatars.ts`, which has **no callers** anywhere in the app. §2a marks the two cases differently on purpose.

## 1. Current state vs. target

`app/supabase/schema.sql` is the authoritative model and is in sync with `migrations/002`–`006`. Three things a reader should know before touching it:

1. **`profiles` is the live body-metric table**, not `avatars`. It holds `display_name`, `body_type`, `height_cm`, `weight_kg`, `build`, `birth_year`, `age_verified_on`, `created_at`. It does **not** have a `skin_tone` column — appearance lives in `avatars.customization`.
2. **`avatars` carries a dead measurement pipeline.** `customization` (jsonb) is the character creator's output and is the only thing the current renderer reads. The legacy columns listed above are nullable, unpopulated, and have no live writer. Do not re-add a required-measurement onboarding step assuming they are load-bearing; do not delete them in a hurry either, since `features/avatar3d/bodyModel.ts` still compiles against them.
3. **The commerce and waitlist halves of the schema are live and user-linked.** `affiliate_clicks`, `affiliate_conversions`, `wishlist_items`, `product_try_ons` and `waitlist_signups` all carry a `user_id` and all predate this document's previous revision by several migrations. They are the reason §4's Product Interaction and Purchase History answers changed.

## 2. Data Inventory

### 2a. Postgres tables

Every table `schema.sql` creates. "Contains body/photo data?" is about the *user's own* body or face, not photos of their belongings.

| Table | Contents | Sensitivity | Contains body/photo data? | Retention | RLS |
|---|---|---|---|---|---|
| `auth.users` | Email address, Supabase-managed session/OTP state. **No password hash and no OAuth identity** — sign-in is email one-time-code only (`signInWithOtp`/`verifyOtp` in `src/lib/api/auth.ts`); there is no password and no social provider wired up. | High (account identity) | No | Life of account | Supabase-managed, not directly queryable by clients |
| `profiles` | `display_name`, `body_type` enum, **`height_cm`**, **`weight_kg`**, `build` enum, `birth_year`, `age_verified_on`, `created_at` | **Medium–High.** Self-reported height/weight from which a BMI is derived at render time (see the callout above and §4). `birth_year` is coarse by design. | **Yes — height/weight, self-reported.** No photo, no scan, no measurement taken by the app | Life of account; deleted on account deletion | `"own profile"`: `id = auth.uid()`. Plus a **restrictive** `"profile writes require the age gate"` UPDATE policy requiring `age_verified_on is not null`, and column-level grants (see §2d) |
| `avatars` | `customization` jsonb (skin tone, face shape, eyes, hair, brows, facial hair, body type, accessories — the character creator's output), `preview_path`; **legacy and unpopulated:** `height_cm`, `weight_kg`, `chest_cm`, `waist_cm`, `hip_cm`, `inseam_cm`, `skin_tone`, `shape_params` | **Low** — `customization` is user-authored appearance choices, not body or biometric data. Legacy columns have no live writer (`upsertMyAvatar()` is uncalled) and `preview_path` is never written | No | Life of account; deleted on account deletion | `user_id = auth.uid()` |
| `garments` | `image_path`, `image_url`, `product_id`, `texture_path`, `template_id`, `category`, `name`, `color`, `brand`, `tags`, `source`, `processing_status`, `created_at` | Medium (photos of the user's real belongings, not their body) | Photo of clothing only, never the user | Life of item; user can delete individually; all deleted on account deletion | `user_id = auth.uid()` |
| `garment_templates` | System-owned mesh library: `category`, `name`, `glb_path`, `default_texture_path`, `is_active` | Low — not personal data | No | Indefinite (system asset) | Public read of `is_active` rows only; no write policy |
| `outfits` | `name`, `created_at`. **No `thumbnail_path`** — outfits are not rendered to a stored image anywhere | Low–Medium | No | Life of item; deleted on account deletion | `user_id = auth.uid()` |
| `outfit_items` | `outfit_id`, `garment_id`, `layer_order`, `x`, `y`, `scale`, `rotation` — the layout of a saved outfit | Low | No | Cascades with `outfits` | Via parent `outfits` join. ⚠️ `with check` constrains `outfit_id` only, not `garment_id` — see §2d |
| `brands` | System-owned partner data: `slug`, `name`, `network`, `commission_rate_bps`, `affiliate_url_template`, `status`, `contact_email` | Low — partner business data, not user data (`contact_email` is a partner's, not a user's) | No | Indefinite | Public read of `status = 'active'` only; no write policy |
| `brand_products` | System-owned catalog: SKU, name, description, price, images, `product_url`, sizes, tags, `search_tsv` | Low — not user data | No | Indefinite; soft-deleted via `is_active` | Public read of active rows whose brand is active; no write policy |
| `brand_api_keys` | Partner credentials — `key_hash` (sha256 hex only, raw key never stored), `label`, `last_used_at`, `revoked_at` | **High (credential material)** — but a partner's, not a user's | No | Life of the partner relationship | **RLS enabled with zero policies.** Unreachable from anon/authenticated; service-role only |
| `affiliate_clicks` | `click_token`, **`user_id` (nullable, `on delete set null`)**, `product_id`, `brand_id`, `source` (which app surface), `commission_rate_bps` and `price_cents_at_click` (both snapshotted at click time), `created_at` | Medium — user-linked purchase-intent record | No | **Survives account deletion, de-identified** (`user_id` nulled) — see §3.2 | SELECT-own only. **No INSERT/UPDATE/DELETE policy, deliberately** — see §2d |
| `affiliate_conversions` | `click_id`, `click_token`, **`user_id` (nullable, `on delete set null`)**, `brand_id`, `product_id`, `network`, `network_order_id`, `order_total_cents`, `currency`, `commission_rate_bps`, `commission_cents`, `status`, `occurred_at`, `confirmed_at`, **`raw_payload` (verbatim postback body)**, `created_at` | Medium–High — this is a record of a real purchase, tied to a user until deletion | No | **Survives account deletion, de-identified** — see §3.2 | SELECT-own only; every write path is service-role (the postback function) |
| `wishlist_items` | `user_id`, `product_id`, `created_at`. Composite PK | Low–Medium — user-linked interest signal | No | Life of item; **deleted** on account deletion via `on delete cascade` | `user_id = auth.uid()` |
| `product_try_ons` | `id`, **`user_id` (NOT NULL, `on delete cascade`)**, `product_id`, `created_at`. Append-only | Low–Medium — user-linked interaction record | No | **Destroyed** on account deletion — it cannot be de-identified, see §3.2 | `user_id = auth.uid()` |
| `waitlist_signups` | `user_id` (PK), **`email`** (defaults to the JWT's address but is client-supplied), `source` (which cap the user hit), `created_at` | **Medium** — a marketing-consent record keyed to a person, and a second email address we hold | No | Deleted on account deletion via `on delete cascade` | Own-row INSERT/SELECT; UPDATE restricted to the `email` column by grant (§2d); no DELETE policy |
| `follows` *(Phase 2 — not built)* | `follower_id`, `followee_id` | Low | No | Life of relationship | `user_id = auth.uid()` on either side |
| `shared_outfits` *(Phase 2 — not built)* | `outfit_id`, `visibility`, `share_slug`, `like_count` | Medium (public-facing avatar imagery once shared) | Indirectly | Life of item, or until unshared | Conditional: `visibility='public' OR user_id=auth.uid()` |

**Tables a previous revision of this file listed that do not exist:** `catalog_items` (the catalog is `brands` + `brand_products`). Column-level corrections in the same revision: `profiles` was listed with a `skin_tone` column it does not have and **without** `height_cm`/`weight_kg`/`birth_year`/`age_verified_on`, which it does; `outfits` was listed with a `thumbnail_path` it does not have; `outfit_items` with `catalog_item_id`/`slot` instead of its real geometry columns; `garment_templates` with `size_bucket`/`mesh_path` instead of `glb_path`/`default_texture_path`/`is_active`.

> ⚠️ **`[VERIFY]` — `affiliate_conversions.raw_payload` is an unbounded third-party blob.** The postback handler stores `JSON.parse(rawBody)` **verbatim** (`functions/affiliate-postback/index.ts:748-750, 844`), including the optional `items` array, which is type-checked but never inspected. Only the fields we validate become columns; everything else the network chose to send is retained. If any partner or network includes buyer name, email, or shipping address in their payload, that data lands here — and `delete-account` nulls `user_id` **without touching `raw_payload`**, so it would survive account deletion in a row we are calling de-identified. Before launch: audit an actual payload from each live network, and either (a) confirm no PII is present and document that per-network, or (b) add an allow-list scrub before the insert. This is not currently disclosed in `PRIVACY_POLICY.md` §6a because it is not currently known to occur.

### 2b. Storage buckets

| Bucket | Contents | Public? | Sensitivity | Retention | Exists? |
|---|---|---|---|---|---|
| `garments` | User-uploaded garment photo (+ processed texture, when one exists), path `{user_id}/{garment_id}.jpg` | **No — private**, with four owner-scoped policies on `storage.objects` (select/insert/update/delete, each keyed on `(storage.foldername(name))[1] = auth.uid()::text`). Read through short-lived signed URLs (`getGarmentImageUrl`) | Medium | Deleted on item delete or account deletion | **Yes** — the only bucket `schema.sql` creates |
| `avatar-previews` **(planned, not created)** | Per-user rendered thumbnails of the user's designed character | No (private) when created | Low–Medium — a rendering of preset choices, not a photo or scan | Deleted on account deletion | **No.** `delete-account` already sweeps its prefix pre-emptively |
| `outfit-thumbnails` **(planned, not created)** | Per-outfit rendered snapshots (avatar + clothes) | No (private) when created | Medium | Deleted on item delete or account deletion | **No.** Same pre-emptive sweep |

**Corrected 2026-08-20:** a previous revision listed public-read `garment-templates` and `catalog` buckets. **Neither is created by `schema.sql`,** and nothing in the app reads from them — garment template meshes and partner product imagery are served from paths/CDN URLs stored in `garment_templates.glb_path` and `brand_products.image_url` respectively. `verification/03_storage_policy_audit.sql` reports their live status.

> ⚠️ **When either planned bucket is created, its four RLS policies must ship in the same migration.** A private bucket with no policies is unreadable even by its owner; one created through the dashboard with "public" ticked is readable by everyone. `03_storage_policy_audit.sql` prints the exact DDL.

### 2c. Third-party processors (data leaves Supabase)

| Vendor | What crosses the wire | Retention on their side | Action needed |
|---|---|---|---|
| **Supabase** | Everything in §2a and §2b — database, auth, storage, Edge Functions. Also sends the one-time sign-in codes | Per Supabase's own policy and the plan's backup window | Request and execute the Supabase DPA; record the hosting region and the backup retention window (both are `[TBD]` in `PRIVACY_POLICY.md` §5 and §8) |
| **Partner retailers and affiliate networks** — `direct`, `rakuten`, `cj`, `impact`, `shopstyle`, `awin` | **Outbound:** a `click_token` only, embedded in the outbound URL — either substituted into the brand's `affiliate_url_template` at `{SUBID}`, or appended as `selv_subid` plus `utm_source=selv&utm_medium=affiliate` (`buildAffiliateUrl()` in `src/lib/api/affiliate.ts`). **No user id, email, name, age, measurements or wardrobe data is transmitted.** **Inbound:** a signed server-to-server postback with `subid`, `network_order_id`, `order_total_cents`, `currency`, `status`, optional `occurred_at` / `product_external_id` / `items` | The retailer/network controls its own tracking under its own policy, including whatever their site sets once the user lands | **`[VERIFY]`** — (a) confirm each network's publisher agreement permits the subid use described here; (b) audit one real payload per network for unexpected PII (see the `raw_payload` warning in §2a); (c) confirm the disclosure in `PRIVACY_POLICY.md` §6a matches the networks actually live at launch |
| **Apple (App Store)** | App download/installation, and — **if Selv+ ever ships** — purchase transactions. **Not applicable today:** there is no StoreKit product, no IAP and no purchase surface in v1 | Per Apple's own retention | None for v1. This row activates only in the release that makes a purchase possible |
| **Analytics vendor (not integrated)** | — | — | **Not chosen and not wired.** `app/package.json` contains no analytics SDK. When one lands: configure it to **exclude** photo URLs, height/weight values, birth year, and any free-text garment/outfit names from event payloads — track feature usage, not content. Then re-run the privacy-manifest check (§4) and flip Device ID / Diagnostics in §4 |
| **Crash reporting (not integrated)** | — | — | **Not chosen and not wired.** `app/package.json` contains no crash SDK. When one lands: scrub PII from breadcrumbs (no auth tokens, no image URLs, no measurement values in logged state), same manifest and §4 consequences |

**Processors a previous revision listed that receive nothing:**

- **remove.bg** — described as receiving the raw garment photo from a `garment-ingest` Edge Function. **Neither the integration nor the function exists** (zero matches for either across `app/src` and `app/supabase`; the only mentions are comments recording their absence). `createGarment()` in `src/lib/api/garments.ts` uploads the photo directly to the private `garments` bucket and inserts the row. **No third party receives a garment photo.** `PRIVACY_POLICY.md` §6 and §7 now say so affirmatively; do not re-add a background-removal vendor to either document before it is actually wired.
- **RevenueCat** — described as receiving an `app_user_id` and subscription events, and as being called at deletion. **Not a dependency.** `src/lib/pricing.ts` holds a `TODO(RevenueCat)` stub and `getCurrentPlan()` returns a hardcoded `"free"`; the 25-item cap opens a free email waitlist (`src/features/paywall/SelvPlusWaitlistSheet.tsx`), which sells nothing and shows no price.

### 2d. Controls that are split across two statements (do not remove half)

Several protections here are one mechanism expressed as an RLS policy **plus** a SQL grant. RLS decides *which rows*; it has no vocabulary for *which columns*, so the column half is a grant. Deleting one half does not loosen things gradually — it removes the control.

| Control | The two halves | What breaks if half is removed |
|---|---|---|
| **Age verdict is unforgeable** | `revoke insert, update on profiles` + re-grant on `(display_name, body_type, height_cm, weight_kg, build)` only — `birth_year`/`age_verified_on` are on neither list — **and** `public.record_age_check(date)`, a `security definer` RPC that is the only writer | Any signed-in user could `update profiles set age_verified_on = current_date, birth_year = 1990`, and "we enforce a minimum age" becomes false. Adding a `profiles` column later means adding it to the grant too, or PostgREST returns 42501 |
| **Age gate is enforced, not just recorded** | The restrictive `"profile writes require the age gate"` UPDATE policy (`age_verified_on is not null`), which blocks an unverified account from completing onboarding (`profiles.build` is the gate `app/_layout.tsx` routes on). A blocked write **filters rather than raises** — it reports success with zero rows, and surfaces only because every writer in `src/lib/api/profiles.ts` ends `.select().single()` | Dropping `.single()` makes a silently-skipped write look like a successful one |
| **Commission terms are server-authoritative** | **No INSERT policy on `affiliate_clicks`** + `public.create_affiliate_click(uuid, click_source)`, a `security definer` RPC that derives rate, price, brand and token from the catalog | Re-adding the obvious `with check (user_id = auth.uid())` lets any user forge a click at 10000 bps against any product, buy the item for real, and cause us to invoice the brand for 100% of their own order value. A forged click row is byte-identical to a real one. `migrations/003_affiliate_click_rpc.sql` exists solely to *remove* that policy |
| **Waitlist attribution is immutable** | `revoke update on waitlist_signups` + `grant update (email)` only, alongside the own-row UPDATE policy | `source` and `created_at` — the entire analytic value of the table — become client-rewritable |
| **`outfit_items` garment ownership** | ⚠️ **Known gap, non-blocking.** `with check` constrains `outfit_id` only, not `garment_id`, so a user can attach another user's garment id to their own outfit. Nothing is disclosed — reading the outfit joins `garments`, where RLS hides the row — so the cost is a uuid-v4 existence oracle | Not worth blocking a launch on. `verification/01_rls_two_account_audit.sql` §7b records the tightening expression |

---

## 3. Account Deletion — Implementation Spec

This satisfies [App Store Review Guideline 5.1.1(v)](https://developer.apple.com/support/offering-account-deletion-in-your-app/), which requires: (a) deletion is initiated **in-app**, not via a support ticket, for a non-regulated app like this one; (b) it deletes the account record and associated personal data, not just deactivates it; (c) you may add confirmation/re-authentication steps to prevent accidental or malicious deletion; (d) if deletion takes time, that's acceptable as long as the user is told and gets a confirmation when it's done.

**§3.1 and §3.2 below describe what the code does today, not a target.** Where the spec once described something unimplemented, it now says so explicitly rather than reading as a requirement someone has already met.

### 3.1 Entry point (client) — as shipped

**Profile tab → "Delete account".** That is two taps from the app's main screen, which satisfies Apple's "easy to find" guidance. Implemented in `src/features/profile/ProfileScreen.tsx` (`handleDeleteAccount`), calling `deleteAccount()` in `src/lib/api/account.ts`.

**Corrected 2026-08-20:** a previous revision specified `Settings → Account → Delete Account`. **There is no Settings screen**; the control lives on the Profile tab. `PRIVACY_POLICY.md` §10 has been corrected to match, and `APP_STORE_LISTING.md`'s reviewer notes already describe the Profile path.

Tapping it shows a single native `Alert`:

1. A plain-language explanation of what's being deleted — currently *"This permanently deletes your avatar, closet photos, saved outfits, and account. This can't be undone."* `[VERIFY]` — this string is narrower than what actually gets deleted (it omits the wishlist, try-on history and waitlist signup) and does not mention the de-identified commercial records that survive. `PRIVACY_POLICY.md` §10 lists both correctly; consider widening the in-app copy to match, since the Alert is what most users will actually read.
2. An explicit destructive confirmation (**Cancel** / **Delete**), satisfying Apple's allowance for a confirmation step without making deletion "unnecessarily difficult."

**There is no password re-entry, and there cannot be: Selv has no passwords.** Authentication is email one-time-code only, so holding a valid session on the device *is* the re-authentication. A previous revision of this file listed "re-enter password" as an option; it was never implementable. If a stronger confirmation is ever wanted, the available options are a typed `DELETE` confirmation or a biometric gate — not a password.

**There is no subscription check, and there is nothing to check.** A previous revision specified detecting an active Selv+ subscription via the RevenueCat SDK and warning the user to cancel Apple billing first. **v1 sells nothing**, so no such state exists. `[Reserved — not yet in effect]`: if Selv+ ever ships as an auto-renewable subscription, this step becomes required by Apple's own account-deletion FAQ and must be added in the same release.

### 3.2 Server-side deletion order — as implemented

One Edge Function, `delete-account` (`app/supabase/functions/delete-account/index.ts`), running with the service-role key, invoked by the authenticated client via `supabase.functions.invoke`. Every step tolerates "already gone," so a half-completed attempt can be retried to a clean state.

1. **Verify the caller.** The user id comes **only** from the verified JWT (`getUserIdFromRequest`); the request body is never read and there is deliberately no `user_id` parameter. This is load-bearing — the function bypasses RLS, so accepting an id from the payload would let anyone delete any account.
2. **Storage first**, because it is the only step no cascade covers. Recursively lists and removes everything under `{user_id}/` in `garments`, `avatar-previews` and `outfit-thumbnails`. The latter two do not exist yet and are skipped without failing (§2b). Paginated at 1000, capped at 20,000 objects, chunked into batches of 100. **A storage failure is logged, not fatal** — blocking an account deletion on a transient storage error is a worse compliance outcome than a few residual files.
3. **De-identify, don't delete:** `affiliate_clicks` and `affiliate_conversions` have their `user_id` set to null. These are financial records — a conversion is money a brand owes, a click is the snapshotted rate backing that invoice — and deleting them would let a partner dispute a bill we can no longer substantiate, would retroactively change reported revenue, and would leave a later reversal postback with no row to reverse. Runs **before** the auth delete so it works regardless of how the FK was declared.
   - **`product_try_ons` is deliberately NOT de-identified.** Its `user_id` is `not null … on delete cascade`, so nulling is impossible and the rows are destroyed with the account. That means per-product try-on counts genuinely **decrease** when a user deletes. Defensible and privacy-forward, but a real caveat on any number quoted to brands (`AFFILIATE_SYSTEM.md` §2.4).
   - **`raw_payload` is not scrubbed** during de-identification — see the `[VERIFY]` in §2a.
4. **Delete owned rows explicitly**, children before parents: `garments`, `outfits`, `avatars`, `profiles`. All four cascade from `auth.users` anyway; they are deleted explicitly so the deletion set is auditable from this one file and so a future migration that forgets a cascade does not silently orphan a wardrobe. `outfit_items` is intentionally absent — it has no `user_id` and cascades from `outfits`.
   - **Covered by cascade, not listed explicitly:** `wishlist_items`, `product_try_ons` and `waitlist_signups` each declare `references auth.users(id) on delete cascade` and are destroyed at step 5. They are named here so nobody concludes from the `OWNED_TABLES` list that they survive.
5. **Delete the `auth.users` row** via `supabase.auth.admin.deleteUser(user_id)` — last, because it is irreversible and every cascade hangs off it. "User not found" counts as success (idempotent retry).
6. **Audit log — specified, not implemented.** A previous revision specified a `deletion_audit` table holding a *hashed* user id, a timestamp and a reason code. **No such table exists in `schema.sql` or any migration**, and the function writes `console.log` lines carrying a request id instead. `[VERIFY]` — either build it (it is not personal data if the id is genuinely non-reversible, and it is useful for proving compliance) or drop the claim. Do not cite it as an existing control. Non-blocking for launch.
7. **Confirm to the client.** Returns `{ success: true }`; recoverable failures return HTTP 200 with `{ success: false, error }` because `functions.invoke` discards the body of any non-2xx response, so a 500 would show the user a meaningless string. The client then signs the local session out and navigates to sign-in.

**Third-party cleanup — none required, and none performed.** A previous revision specified two steps here that are **not applicable and correctly absent from the code**:
- *RevenueCat subscriber deletion* (`DELETE /v1/subscribers/{app_user_id}`) — there is no RevenueCat account, no `app_user_id`, and no subscription (§2c).
- *[Sign in with Apple token revocation](https://developer.apple.com/documentation/sign_in_with_apple/revoke_tokens/)* — Sign in with Apple is not wired up; there is no refresh token to revoke. **This becomes mandatory the day SIWA ships**, per Apple's own account-deletion FAQ, so the link is kept here rather than deleted. `[Reserved — not yet in effect]`.

> Note for anyone reading `schema.sql`'s `waitlist_signups.email` comment: it reasons at length about Apple private-relay addresses. That is sound forward-looking design, **not** evidence that Sign in with Apple ships today. It does not.

### 3.3 Timing and backups
Deletion of live rows/objects completes within the same request (seconds), but Supabase's automated backups retain point-in-time copies for the plan's backup window. **Confirm the actual number** (Dashboard → Database → Backups) and write it into `PRIVACY_POLICY.md` §8, which currently carries a `[TBD]` for exactly this. Do not publish a guessed figure — a previous revision of both documents asserted "up to 30 days" with nothing behind it. Apple's guidance explicitly allows non-instant deletion **as long as it is disclosed and bounded**, so the number is what makes the disclosure valid.

### 3.4 Open design question for Phase 2 (`shared_outfits`, `follows`)
Once the social feed exists, a hard cascade delete of `shared_outfits` when a user deletes their account is correct for *their own* content, but consider whether other users' `like_count` aggregates or feed references need to be decremented/cleaned up rather than left dangling. Not a blocker for v1 (these tables don't exist yet) but flag for the Phase 2 build.

### 3.5 What this is *not*
- Not sufficient: a "deactivate" toggle that hides the account but keeps rows. Apple explicitly rejects this pattern.
- Not sufficient: only offering deletion via an emailed support ticket. That's only acceptable for apps in Apple's "highly regulated industries" carve-out (5.1.1(ix)) — Selv is not one of those.
- Not required: instant, synchronous deletion of backup copies — see §3.3.
- **Not a defect:** de-identified `affiliate_clicks` / `affiliate_conversions` rows surviving the deletion. `verification/04_account_deletion_verification.sql` §4d asserts they survive, that every `user_id` is null, that commission terms and order totals are unchanged, and that the conversion→click linkage still resolves. A test that expects zero rows there is testing the wrong thing.

---

## 4. App Privacy "Nutrition Label" Questionnaire — Selv's Answers

Reference: [Apple's official data-type list](https://developer.apple.com/app-store/app-privacy-details/). Fill this into App Store Connect → App Privacy at submission time. "Linked" = tied to the user's identity (account/device); "Tracking" = used to link with third-party data for ad targeting/measurement — **Selv does none of this, so every Tracking answer is No.**

**Re-derived from the code on 2026-08-20.** Rows marked 🔄 changed in that pass; the old answer and why it was wrong are in the justification. `SHIP_READINESS.md` §6 carries the same table with per-row code citations and should agree with this one — if they ever diverge, the code wins and both get updated.

| Apple category | Collected? | Linked to user? | Used for tracking? | Justification |
|---|---|---|---|---|
| Contact Info → Name | Yes | Yes | No | `profiles.display_name`, optional |
| Contact Info → Email Address | Yes | Yes | No | 🔄 Two sources, not one: `auth.users.email` (email OTP is the **only** sign-in — `src/lib/api/auth.ts`), **plus `waitlist_signups.email`**, a second, separately-supplied address held as a marketing-consent record. The waitlist address was previously undisclosed anywhere; it is now in `PRIVACY_POLICY.md` §2 and §8 |
| Health & Fitness → Health | **`[VERIFY]` — counsel must decide** | — | No | 🔄 **The previous "No" rested on a false premise** and must not be reused. It read: "height/weight are optional, reference-only fields not used to generate the avatar." True of the 3D try-on character; **false of the Profile screen**, where `profiles.height_cm`/`weight_kg` are collected through a real UI (unit toggle, 90–250 cm / 30–300 kg validation) and `buildWidthScale()` derives a **BMI** from them to scale rendered body silhouettes (`features/avatar/avatars.tsx:27`, consumed at `ProfileScreen.tsx:73`). Whether self-reported height/weight used this way is "Health" data is a judgement call. Re-derive it with counsel against the code, alongside `PRIVACY_POLICY.md` §4's matching `[TBD]` and the **age-rating medical/wellness question** (`APP_STORE_LISTING.md` §7 answers that one from the same false premise and must not be used as written) |
| Health & Fitness → Fitness | No | — | — | No exercise/motion/Fitness API data collected |
| Financial Info → Payment Info | **No** | — | — | No payment surface in the app at all. No StoreKit, no IAP, no card entry. Retailer checkout happens entirely off-app on the retailer's own site, and nothing about it reaches us except an order total (see Purchase History below) |
| Financial Info → Other | No | — | — | Not collected |
| Location → Precise/Coarse | No | — | — | No location features in v1 |
| Sensitive Info | **No** | — | — | No processing meets Apple's "biometric data" definition — the avatar is built entirely from character-creator selections (preset skin tone/face/hair/eyes/body-type choices), never from a photo or scan of the user. No facial recognition, no photo-based body/identity processing. This justification **does** still hold. **Must be re-declared as Yes (biometric) if/when a photo- or scan-based avatar option ships** (see `PRIVACY_POLICY.md` §11). Note this row is independent of the Health `[VERIFY]` above |
| Contacts | No | — | — | No contact-list sync feature |
| User Content → Photos or Videos | **Yes** | Yes | No | Garment photos in the private `garments` bucket. Clothes only — never the user's face or body |
| User Content → Other User Content | Yes | Yes | No | Garment names/brand/colour/tags, outfit names and layouts |
| Browsing History | No | — | — | N/A |
| Search History | **No** | — | — | 🔄 Previously "depends on implementation — engineering decision needed." **It is decided by the code:** `searchProducts()` (`src/lib/api/shop.ts:140`) passes the term to `.textSearch("search_tsv", …)` on a live query and nothing persists it. Under Apple's "collect = stored longer than needed to service the request" definition, that is not collection. **Re-open this if a search-history or recent-searches feature ever ships** |
| Identifiers → User ID | Yes | Yes | No | `auth.users.id` used throughout |
| Identifiers → Device ID | **No** | — | — | 🔄 Previously "Pending." Today it is **No**: no analytics SDK, and nothing in the app collects a device or advertising identifier. Flips the day an analytics vendor lands (§2c) |
| Purchases → Purchase History | **Yes** | Yes | No | 🔄 **Right answer, previously wrong reason.** The old justification was "Selv+ subscription status via RevenueCat" — there is no RevenueCat and no IAP. The real basis is `affiliate_conversions`: `order_total_cents`, `network_order_id` and `product_id` stored against a `user_id`, readable by the user through the `"own affiliate conversions select"` policy and surfaced in the app at `src/features/orders/`. That is purchase history of third-party purchases. Fix the justification before an App Review question exposes the gap |
| Usage Data → Product Interaction | **Yes** | **Yes** | No | 🔄 **Previously "Pending (planned)." This was the single most likely under-declaration on the form.** It is already collected server-side with no SDK involved: `product_try_ons` (every try-on, timestamped, per user), `wishlist_items` (every save), `affiliate_clicks` (every Buy tap **plus which app surface**, via the `click_source` enum), and `waitlist_signups.source` (which cap was hit). All four carry a `user_id` and all four are readable by the user under their own RLS policy |
| Usage Data → Advertising Data | No | — | — | No ad network, no attribution SDK, no ad targeting of any kind |
| Diagnostics → Crash/Performance Data | **No** | — | — | 🔄 Previously "Pending (planned)." Today it is **No** — `app/package.json` contains no crash-reporting SDK. Flips the day one lands (§2c) |
| Surroundings | No | — | — | No AR environment scanning |
| Body → Hands/Head | No | — | — | No ARKit body/hand tracking and no camera-based body scanning. The avatar is character-creator selections |
| Other Data | No | — | — | N/A |

**Two things counsel must see alongside this table**, because they are what turns a green form into a defensible one:

1. **The affiliate data flow is now disclosed, and the disclosure is what four of these rows rest on.** `PRIVACY_POLICY.md` §6a describes the click token handed to a retailer, the postback that comes back, the de-identified rows that outlive account deletion, and the fact that no user identity is transmitted. Answer the form against that section, and make sure it is the version that gets published.
2. **The processor list runs in both directions.** The policy previously named two processors that do not exist (remove.bg, RevenueCat) and omitted the ones that do (partner brands and their affiliate networks). Over-declaring a processor is not "safely conservative" — it is an inaccurate disclosure in exactly the way under-declaring is, and it invites a reviewer to look for a vendor integration the binary cannot demonstrate.

**Privacy manifest note:** Apple requires a `PrivacyInfo.xcprivacy` privacy manifest for any [commonly-used third-party SDK on Apple's list](https://developer.apple.com/support/third-party-SDK-requirements/) that uses a "required reason" API. **The shipping build bundles none of them** — no RevenueCat SDK, no analytics SDK, no crash reporter (`app/package.json` verified 2026-08-20). The Expo SDK 54 / React Native 0.81 toolchain ships its own manifests for the modules it provides, but "the toolchain probably handles it" is not a check: run `npx expo prebuild`, open the workspace in Xcode, and **read the build-time privacy report** before every submission. Missing manifests are an automatic binary-validation rejection, not a review judgment call. **Re-run this the day an analytics or crash vendor lands.**

---

## 5. Sources
- [Apple — Offering account deletion in your app](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
- [Apple — App Privacy Details / data type definitions](https://developer.apple.com/app-store/app-privacy-details/)
- [Apple — Third-party SDK requirements (privacy manifests)](https://developer.apple.com/support/third-party-SDK-requirements/)
- [Apple — Sign in with Apple: Revoke Tokens](https://developer.apple.com/documentation/sign_in_with_apple/revoke_tokens/) *(not applicable to v1 — retained for the release that ships Sign in with Apple; see §3.2)*
- [App Store Review Guideline 5.1.1(v) — Data Collection and Storage](https://developer.apple.com/app-store/review/guidelines/#data-collection-and-storage)
