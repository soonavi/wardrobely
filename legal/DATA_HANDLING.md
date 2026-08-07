# Data Handling Spec (Engineering-Facing)

**Audience:** whoever is building/maintaining the Supabase backend, the account-deletion flow, and the App Store Connect submission. Pairs with `legal/PRIVACY_POLICY.md` (the user-facing version of this document) and `PRODUCT_SPEC.md` §7 (data model).
**Last updated:** 2026-07-20 (avatar approach updated — see the note below and `AVATAR_CREATOR_PLAN.md`)

> This is engineering guidance, not legal advice — items marked `[VERIFY]` need a lawyer or a vendor DPA check before launch, not just an engineer's judgment call.

---

> **Avatar approach (updated):** Selv no longer builds the avatar from a photo or body measurements. Users design a customizable character in a character creator (skin tone, face shape, eyes, hair, brows, facial hair, body type, accessories), stored in `avatars.customization` (jsonb). This is a privacy simplification — the avatar is no longer body/photo data at all, just a record of preset choices. `avatars.height_cm`/`weight_kg` are now nullable, optional, reference-only fields (not used to shape the avatar); the legacy `measurements`/`blendshape_weights`-style columns from the old pipeline are unused by the current renderer. §2 and §4 below are updated to reflect this.

## 1. Current state vs. target

`app/supabase/schema.sql` now has the `avatars` table with the current `customization` jsonb column (the character creator's output) alongside legacy nullable columns (`height_cm`, `weight_kg`, `chest_cm`, `waist_cm`, `hip_cm`, `inseam_cm`, `skin_tone`, `shape_params`) kept from the pre-pivot measurement-driven design — those legacy columns are not populated by the current onboarding flow and are not required. RLS is enabled on `avatars` (`user_id = auth.uid()`). Flagging here so nobody re-adds a required-measurement step assuming the table doesn't already exist or that these columns are still load-bearing.

## 2. Data Inventory

### 2a. Postgres tables

| Table | Contents | Sensitivity | Contains body/photo data? | Retention | RLS |
|---|---|---|---|---|---|
| `auth.users` | Email, hashed credentials, OAuth identity, Supabase-managed | High (credential material) | No | Life of account | Supabase-managed, not directly queryable by clients |
| `profiles` | `display_name`, `body_type` enum, `skin_tone`, `created_at` | Medium | `body_type`/`skin_tone` are body-adjacent | Life of account | `id = auth.uid()` |
| `avatars` | `customization` jsonb (skin tone, face shape, eyes, hair, brows, facial hair, body type, accessories — the character creator's output), `height_cm`/`weight_kg` (nullable, optional, reference-only), legacy `chest_cm`/`waist_cm`/`hip_cm`/`inseam_cm`/`skin_tone`/`shape_params` (unused by current flow), `preview_path` | **Low–Medium** — `customization` is user-authored appearance choices, not body/biometric data; legacy measurement columns are optional and unpopulated by default | No — no photo or biometric data; optional height/weight only if the user chooses to enter them | Life of account; deleted immediately on account deletion | `user_id = auth.uid()` |
| `garments` | `image_path`, `texture_path`, `category`, `name`, `color`, `brand`, `tags`, `source`, `processing_status` | Medium (photos of user's real belongings, not their body) | Photo of clothing only, not the user | Life of item; user can delete individually; all deleted on account deletion | `user_id = auth.uid()` (existing) |
| `garment_templates` | System-owned mesh library, `category`, `size_bucket`, `mesh_path` | Low — not personal data | No | Indefinite (system asset) | Public read |
| `catalog_items` | System-owned seed catalog, brand/price/affiliate metadata | Low — not personal data | No | Indefinite (system asset) | Public read |
| `outfits` | `name`, `thumbnail_path` | Medium (thumbnail is a rendered avatar wearing clothes, not a real photo) | Indirectly — rendered avatar snapshot | Life of item; deleted on account deletion | `user_id = auth.uid()` (existing) |
| `outfit_items` | Links `outfit_id` → `garment_id` and/or `catalog_item_id`, slot, layer order | Low | No | Cascades with `outfits` | Via parent `outfits` join (existing) |
| `follows` *(Phase 2 — not built)* | `follower_id`, `followee_id` | Low | No | Life of relationship | `user_id = auth.uid()` on either side |
| `shared_outfits` *(Phase 2 — not built)* | `outfit_id`, `visibility`, `share_slug`, `like_count` | Medium (public-facing avatar imagery once shared) | Indirectly | Life of item, or until unshared | Conditional: `visibility='public' OR user_id=auth.uid()` |

### 2b. Storage buckets

| Bucket | Contents | Public? | Sensitivity | Retention |
|---|---|---|---|---|
| `garments` | User-uploaded garment photo + processed texture, path `{user_id}/{garment_id}.jpg` | No (private, existing RLS policies) | Medium | Deleted on item delete or account deletion |
| `avatar-previews` **(planned)** | Per-user rendered thumbnail snapshots of the user's designed character | No (private) | Low–Medium — a rendering of the user's own preset appearance choices, not a photo or a scan of their actual body | Deleted on account deletion |
| `outfit-thumbnails` **(planned)** | Per-outfit rendered snapshots (avatar + clothes) | No (private) | Medium | Deleted on item delete or account deletion |
| `garment-templates` | System GLB mesh library | Yes (public-read) | None — not user data | Indefinite |
| `catalog` | Catalog thumbnails/textures | Yes (public-read) | None — not user data | Indefinite |

### 2c. Third-party processors (data leaves Supabase)

| Vendor | What crosses the wire | Retention on their side | Action needed |
|---|---|---|---|
| **remove.bg** | Raw garment photo, sent from the `garment-ingest` Edge Function | Believed stateless/per-request; **`[VERIFY]`** — confirm in remove.bg's DPA/ToS before publishing the privacy policy's claim about this | Get remove.bg's data-processing terms in writing; add a signed DPA if the free/pay-as-you-go tier doesn't already include one |
| **RevenueCat** | Anonymous `app_user_id`, subscription/entitlement events | Retains transaction history per their own policy (needed for financial reconciliation) | Use RevenueCat's subscriber-deletion endpoint (`DELETE /v1/subscribers/{app_user_id}`) when a Selv account is deleted, to purge what can legally be purged |
| **Apple (StoreKit)** | Purchase transaction, Apple ID token | Per Apple's own retention (financial/tax) | No action — Apple controls this as the payment processor |
| **Analytics vendor (planned, e.g. PostHog)** | Anonymized usage events | Per vendor default | Configure to **exclude** photo URLs, measurement values, and any free-text garment/outfit names from event payloads — track feature usage, not content |
| **Crash reporting (planned, e.g. Sentry)** | Stack traces, device info | Per vendor default (~90 days typical) | Scrub PII from breadcrumbs (no auth tokens, no image URLs, no measurement values in logged state) |

---

## 3. Account Deletion — Implementation Spec

This satisfies [App Store Review Guideline 5.1.1(v)](https://developer.apple.com/support/offering-account-deletion-in-your-app/), which requires: (a) deletion is initiated **in-app**, not via a support ticket, for a non-regulated app like this one; (b) it deletes the account record and associated personal data, not just deactivates it; (c) you may add confirmation/re-authentication steps to prevent accidental or malicious deletion; (d) if deletion takes time, that's acceptable as long as the user is told and gets a confirmation when it's done.

### 3.1 Entry point (client)
`Settings → Account → Delete Account`. Must be reachable in ≤2 taps from the main settings screen (Apple's own guidance: "easy to find," typically in account settings). Tapping it shows:
1. A plain-language explanation of what's being deleted (avatar/character customization, any optional height/weight, wardrobe, outfits, account) — pull copy directly from `PRIVACY_POLICY.md` §10's tone, not legalese.
2. **If an active Selv+ subscription is detected** (via RevenueCat SDK on-device check): a warning that deleting the account does not cancel Apple billing, with a button that calls `Linking.openURL('https://apps.apple.com/account/subscriptions')` (or `showManageSubscriptions` where available) so they can cancel first. This mirrors Apple's own FAQ guidance on handling auto-renewable subscriptions during account deletion.
3. A single explicit confirmation step (e.g., re-enter password, or a "type DELETE" / biometric-gated confirm) — this satisfies Apple's allowance for confirmation steps while not making deletion "unnecessarily difficult."

### 3.2 Server-side deletion order (Supabase Edge Function, service-role key, never exposed to the client)

Run as one Edge Function (`delete-account`) invoked by the authenticated client, executing in this order:

1. **Verify** the caller's JWT matches the `user_id` being deleted (defense in depth — RLS should already prevent cross-user deletion, but the Edge Function runs with the service role and bypasses RLS, so this check is load-bearing).
2. **Storage — delete objects first, in this order** (Storage objects are *not* foreign-keyed to `auth.users`, so nothing cascades automatically; this must be explicit):
   - List and remove everything under `garments/{user_id}/*`
   - List and remove everything under `avatar-previews/{user_id}/*` (once that bucket exists)
   - List and remove everything under `outfit-thumbnails/{user_id}/*` (once that bucket exists)
3. **Database — delete rows** (even though FKs are `on delete cascade` from `auth.users`, do this explicitly first so the function can confirm each step succeeded and log it, rather than relying silently on cascade):
   - `outfit_items` (or let it cascade via `outfits` delete — either is fine given the existing FK)
   - `outfits`
   - `garments`
   - `avatars`
   - `shared_outfits`, `follows` (Phase 2, once built) — see §3.4 for the public-content nuance
   - `profiles`
4. **Third-party cleanup:**
   - Call RevenueCat's subscriber-deletion endpoint for this `app_user_id`.
   - **If the user signed in with Apple:** call the [Sign in with Apple token-revocation REST API](https://developer.apple.com/documentation/sign_in_with_apple/revoke_tokens/) using the stored refresh token, *before* deleting the row that holds it. This is an explicit item in Apple's own account-deletion FAQ.
5. **Auth — delete the `auth.users` row** via the Supabase Auth Admin API (`supabase.auth.admin.deleteUser(user_id)`). This is the actual "account" deletion; everything above should have already run so nothing is orphaned.
6. **Audit log:** insert one row into a `deletion_audit` table containing a *hashed* user ID (not reversible to the original), a timestamp, and a reason code. This is not personal data (can't be linked back to the person) and exists purely for fraud/abuse investigation and to prove compliance if ever asked. Do not store email, name, or any deleted content here.
7. **Confirm** to the client that deletion succeeded (or, if any step failed, retry via a queued job rather than leaving a partial deletion — a partially-deleted account is worse than a slow one).

### 3.3 Timing and backups
Deletion of live rows/objects should complete within the same request (seconds), but Supabase's automated backups will retain point-in-time copies for the plan's backup window (commonly up to ~7–30 days depending on tier). Disclose this in the privacy policy (already done, §8/§10) rather than pretending backups don't exist — Apple's own guidance explicitly allows non-instant deletion as long as it's disclosed and bounded.

### 3.4 Open design question for Phase 2 (`shared_outfits`, `follows`)
Once the social feed exists, a hard cascade delete of `shared_outfits` when a user deletes their account is correct for *their own* content, but consider whether other users' `like_count` aggregates or feed references need to be decremented/cleaned up rather than left dangling. Not a blocker for v1 (these tables don't exist yet) but flag for the Phase 2 build.

### 3.5 What this is *not*
- Not sufficient: a "deactivate" toggle that hides the account but keeps rows. Apple explicitly rejects this pattern.
- Not sufficient: only offering deletion via an emailed support ticket. That's only acceptable for apps in Apple's "highly regulated industries" carve-out (5.1.1(ix)) — Selv is not one of those.
- Not required: instant, synchronous deletion of backup copies — see §3.3.

---

## 4. App Privacy "Nutrition Label" Questionnaire — Selv's Answers

Reference: [Apple's official data-type list](https://developer.apple.com/app-store/app-privacy-details/). Fill this table into App Store Connect → App Privacy at submission time. "Linked" = tied to the user's identity (account/device); "Tracking" = used to link with third-party data for ad targeting/measurement (Selv does none of this).

| Apple category | Collected? | Linked to user? | Used for tracking? | Justification |
|---|---|---|---|---|
| Contact Info → Name | Yes | Yes | No | `profiles.display_name`, optional |
| Contact Info → Email Address | Yes | Yes | No | Account creation/auth via Supabase Auth |
| Health & Fitness → Health | **No** | — | — | The avatar is built entirely from character-creator selections (skin tone, face shape, eyes, hair, brows, facial hair, body type, accessories), not from body measurements. Height/weight are optional, reference-only fields the user may or may not enter, and are not used to generate the avatar — this no longer meets the bar for a Health & Fitness declaration. *Confirm with counsel before submission; if the optional height/weight field is populated and displayed anywhere prominently, revisit this answer.* |
| Health & Fitness → Fitness | No | — | — | No exercise/motion/Fitness API data collected |
| Financial Info → Payment Info | **No** | — | — | Apple/StoreKit handles all payment; per Apple's own clarifying guidance, payment info entered through a payment service the developer never sees does not need to be disclosed |
| Financial Info → Other | No | — | — | Not collected |
| Location → Precise/Coarse | No | — | — | No location features in v1 |
| Sensitive Info | **No** | — | — | No processing meets Apple's "biometric data" definition — the avatar is built entirely from character-creator selections (preset skin tone/face/hair/eyes/body-type choices), never from a photo or scan of the user. No facial recognition, no photo-based body/identity processing. **Must be re-declared as Yes (biometric) if/when a photo- or scan-based avatar option ships** (a possible future feature, not planned — see `PRIVACY_POLICY.md` §11) |
| Contacts | No | — | — | No contact-list sync feature |
| User Content → Photos or Videos | **Yes** | Yes | No | Garment photos only — no photo of the user's face or body is collected for the avatar |
| User Content → Other User Content | Yes | Yes | No | Garment names/brand/tags, outfit names |
| Browsing History | No | — | — | N/A |
| Search History | Depends on implementation | — | — | If catalog-search queries are persisted server-side tied to a user, declare Yes; if search only round-trips to service a live request and isn't stored, it doesn't need disclosure per Apple's "collect = stored longer than needed to service the request" definition. **Engineering decision needed before submission — default to not persisting raw queries.** |
| Identifiers → User ID | Yes | Yes | No | `auth.users.id` used throughout |
| Identifiers → Device ID | Pending | — | — | Only if/when an analytics SDK collects a device identifier — update once vendor is chosen |
| Purchases → Purchase History | Yes | Yes | No | Selv+ subscription status via RevenueCat |
| Usage Data → Product Interaction | Pending (planned) | Likely Yes | No | Once analytics ships — screen views, taps |
| Diagnostics → Crash/Performance Data | Pending (planned) | Depends on vendor config | No | Once crash reporting ships |
| Surroundings | No | — | — | No AR environment scanning |
| Body → Hands/Head | No | — | — | Avatar is built from character-creator selections, not ARKit/body- or hand-tracking or any camera-based body scanning |
| Other Data | No | — | — | N/A |

**Privacy manifest note:** as of May 1, 2024, Apple requires a `PrivacyInfo.xcprivacy` privacy manifest for any [commonly-used third-party SDK on Apple's list](https://developer.apple.com/support/third-party-SDK-requirements/) that uses a "required reason" API — check the current list against everything in `package.json` (RevenueCat's SDK is commonly on this list; Expo/React Native modules that touch things like `UserDefaults` or file timestamps may also require entries). Missing manifests are an automatic binary-validation rejection, not a review judgment call — verify with `npx expo prebuild` + Xcode's build-time privacy report before every submission.

---

## 5. Sources
- [Apple — Offering account deletion in your app](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
- [Apple — App Privacy Details / data type definitions](https://developer.apple.com/app-store/app-privacy-details/)
- [Apple — Third-party SDK requirements (privacy manifests)](https://developer.apple.com/support/third-party-SDK-requirements/)
- [Apple — Sign in with Apple: Revoke Tokens](https://developer.apple.com/documentation/sign_in_with_apple/revoke_tokens/)
- [App Store Review Guideline 5.1.1(v) — Data Collection and Storage](https://developer.apple.com/app-store/review/guidelines/#data-collection-and-storage)
