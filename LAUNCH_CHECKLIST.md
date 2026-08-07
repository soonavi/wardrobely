# Selv — Pre-Launch Checklist

**Last updated:** 2026-08-07 (rejection-risk summary and the IAP items re-scoped to the shipped, no-purchase v1) · Companion to `legal/PRIVACY_POLICY.md`, `legal/DATA_HANDLING.md`, `APP_STORE_LISTING.md`, `PRODUCT_SPEC.md`, `MARKETING_STRATEGY.md`.

Legend: 🔴 **BLOCKING** — App Review will reject or the launch is legally exposed without this. 🟡 **Nice-to-have** — do it if time allows, doesn't block submission. ⏸️ **Deferred** — still required, but only once a precondition that is *not* in v1 scope is met; the precondition is named on the item.

---

## Top 3 Things Most Likely to Get This App Rejected

1. **In-app account deletion that doesn't actually delete everything.** This is still the single most common 2026 rejection reason ([Guideline 5.1.1(v)](https://developer.apple.com/support/offering-account-deletion-in-your-app/)), but the shape of the risk has changed: the flow is **built** — a two-step confirmation in `app/src/features/profile/ProfileScreen.tsx` calling the source-controlled `delete-account` Edge Function — and the `avatars` table now exists in `app/supabase/schema.sql` with an owner-only RLS policy, so the old "can't finish deletion coverage until that table exists" blocker is gone. What remains is **verification**: prove end-to-end that deletion removes Storage objects and every owned row across `profiles`, `avatars`, `garments`, `outfits`/`outfit_items`, and the commerce tables — not just the auth user. A flow that leaves orphaned data fails review the same way an email-only flow does.
2. **App Privacy label / actual data collection mismatch, or a missing privacy manifest.** Reviewers (and automated binary validation) check that what's declared in the App Privacy questionnaire matches what the app actually does. Note the current mismatch risk runs in the *over*-declaring direction: the app no longer collects body measurements for the avatar (the character creator collects none), so don't answer the questionnaire from the pre-pivot data map. On manifests: any bundled third-party SDK on [Apple's commonly-used-SDK list](https://developer.apple.com/support/third-party-SDK-requirements/) that lacks a `PrivacyInfo.xcprivacy` manifest triggers an automatic rejection at upload, before a human ever reviews the app. **Today the shipping build bundles none of them** — there is no RevenueCat, no analytics SDK, and no crash SDK in `app/package.json` — so this attaches the moment the crash/analytics vendor in §3 is added, and it must be checked again then rather than assumed clear.
3. **Inaccurate metadata about what the app sells (Guideline 2.3.1).** The old #3 here was Selv+ StoreKit/IAP configuration; that risk does not apply to v1, because **v1 sells nothing** — no StoreKit product, no RevenueCat entitlement, and the 25-item cap opens `SelvPlusWaitlistSheet.tsx` rather than a paywall. The live risk is the inverse: listing copy, screenshots, or in-app text that describes a purchasable Selv+ (or the Phase-2 social feed) invites a reviewer to hunt for a purchase flow they will not find. Keep the store listing on the waitlist framing per `APP_STORE_LISTING.md` §5/§11, and make sure the try-before-you-buy affiliate flow reads unambiguously as external checkout for **physical goods** (permitted under Guideline 3.1.1's carve-out). The Guideline 3.1.2 subscription-disclosure risk returns in full the day Selv+ ships — see the ⏸️ items in §2 and §3.

---

## 1. Legal / Compliance

- [ ] 🔴 Have a lawyer review and finalize `legal/PRIVACY_POLICY.md` — replace every `[TBD]` (legal entity name, jurisdiction, contact emails, hosting region)
- [ ] 🔴 Publish the privacy policy at a stable public URL and link it in App Store Connect ("Privacy Policy" field is required for submission)
- [ ] 🔴 Draft and publish Terms of Use / EULA — still required for v1 in its own right (account creation, affiliate links, UGC), independently of Guideline 3.1.2, which only attaches once there is a Selv+ paywall to reference it from. Not yet drafted, needs its own pass
- [ ] ⏸️ Confirm the background-removal vendor's data retention/processing terms in writing (DPA or ToS) — **precondition: a background-removal step is actually integrated.** remove.bg is *not* wired into the shipping build (not in `app/package.json`, no `garment-ingest` Edge Function); garments are stored as uploaded photos. Keep the `[VERIFY]` in `legal/DATA_HANDLING.md` §2c pending, and make sure the privacy policy doesn't disclose a processor the app doesn't use
- [ ] 🔴 Set minimum account age to 13 at signup (age gate / birthdate field) and confirm this is enforced, not just stated in the ToS
- [ ] 🟡 Confirm final Supabase hosting region and document the GDPR international-transfer mechanism (SCCs) if EU users are expected at launch
- [ ] 🟡 Register/confirm trademark clearance on the final app name before it's locked — **"Selv" screened CLEAR** in Round 2 (`TRADEMARK_NAME_SHORTLIST.md`; the name taken by a direct competitor was the dropped "Drobe"), but that was a knockout screen, not clearance: a full USPTO TESS + common-law search and attorney sign-off are still outstanding before any name-baked spend. See also `TRADEMARK_CLEARANCE.md`, which is a superseded record for Twinit
- [ ] 🟡 Vendor DPAs on file for Supabase, plus whichever analytics/crash vendor is chosen (and any payments vendor, if and when Selv+ ships — RevenueCat is not currently a dependency, so there is nothing to paper today)

## 2. App Store Submission

- [ ] 🔴 Manually test the in-app account-deletion flow end to end per `legal/DATA_HANDLING.md` §3, confirming it actually removes Storage objects and not just DB rows — the flow itself is built (`ProfileScreen.tsx` → `delete-account` Edge Function); this item is now the verification, not the build
- [ ] 🔴 Complete the App Privacy questionnaire in App Store Connect using `legal/DATA_HANDLING.md` §4 as the answer key — and re-check that answer key against the character creator before submitting, since the pre-pivot version of it assumes body measurements the app no longer collects
- [ ] 🔴 Add `PrivacyInfo.xcprivacy` manifests for every third-party SDK on Apple's required list — verify via Xcode's build-time privacy report, not by assumption. The shipping build currently bundles **no** SDK from that list (no RevenueCat, no analytics, no crash reporter), so re-run this check after the crash/analytics vendor in §3 lands rather than treating it as permanently satisfied
- [ ] 🔴 Complete the updated age-rating questionnaire (13+/16+/18+ system, mandatory since Jan 31, 2026) — see `APP_STORE_LISTING.md` §7 for the recommended answers and rationale
- [ ] 🔴 Set `ITSAppUsesNonExemptEncryption: false` in `Info.plist` (see `APP_STORE_LISTING.md` §10)
- [ ] 🔴 Declare **no in-app purchases** for the v1 submission and answer the business-model questions accordingly (`APP_STORE_LISTING.md` §11) — pre-declaring a subscription that the binary can't sell invites a reviewer to look for a purchase flow that doesn't exist
- [ ] ⏸️ Configure the Selv+ auto-renewable subscription in App Store Connect and get it into "Ready to Submit" state *before* submitting the app binary (an unapproved IAP product is a common false-rejection trigger) — **precondition: the Selv+ subscription launch. Not v1.** Keep this item: it is a hard requirement the day a paid tier ships, and it must land in the same release as the paywall item in §3 and the restored paid copy in `APP_STORE_LISTING.md` §5
- [ ] ⏸️ Sign the Paid Applications Agreement in App Store Connect (required before any IAP will function in review or production) — **precondition: the Selv+ subscription launch. Not v1.** v1 sells nothing, so the free-app agreement is sufficient; this has lead time, so start it before the paid release, not on submission day
- [ ] 🔴 Add the required screenshot set per `APP_STORE_LISTING.md` §9 (6.9" iPhone source size, auto-scaled by Apple)
- [ ] 🔴 Finalize Title/Subtitle/Keywords/Description exactly as specified in `APP_STORE_LISTING.md` (or the equivalent once the final app name is locked)
- [ ] 🟡 Prepare an App Review notes field explaining the try-on/affiliate external-purchase flow proactively, so a reviewer doesn't need to guess why external links out to a retailer exist — say plainly that these are **physical goods** under Guideline 3.1.1 and that the app contains no in-app purchase to compete with them. (Once Selv+ ships, this note also has to explain why the affiliate flow sits alongside an IAP subscription without being one.)

## 3. Product Must-Haves

- [x] ~~Build the `avatars` table + RLS policy in Supabase~~ — **done.** `app/supabase/schema.sql` defines `avatars` (one row per user) with an owner-only `"own avatar"` policy. Note the live avatar source is the `customization` jsonb written by the character creator; the measurement columns are nullable legacy fields, and `legal/DATA_HANDLING.md` §1 needs updating to match
- [ ] 🔴 In-app account deletion (see §2 above — listed twice deliberately, it's both a legal and a product-engineering item; the build is done, the end-to-end deletion test is not)
- [ ] 🔴 Camera/photo-library permission purpose strings implemented exactly as specified in `APP_STORE_LISTING.md` §8 — including the "never used to scan your face or body" clause, which is now literally true and worth keeping
- [ ] 🔴 Crash reporting integrated — **still genuinely unwired**; there is no crash SDK in `app/package.json`. Shipping with zero crash visibility on a 3D render path is a reliability risk, not just a nice-to-have
- [ ] ⏸️ Selv+ paywall screen shows price, billing period, and auto-renewal terms on the same screen as the purchase button (Guideline 3.1.2) — **precondition: the Selv+ subscription launch. Not v1.** There is no paywall today; the wardrobe cap opens `app/src/features/paywall/SelvPlusWaitlistSheet.tsx`, which shows no price and sells nothing, which is exactly why 3.1.2 doesn't bite yet. Keep this item — it is the thing most likely to be forgotten in the release that introduces the paid tier
- [ ] 🟡 Analytics integrated — **still genuinely unwired** (no analytics SDK in `app/package.json`), so there is currently no event data behind the north-star metric in §6. When it lands, configure PII scrubbing per `legal/DATA_HANDLING.md` §2c (photo URLs, free-text names, and the optional height/weight profile values excluded from event payloads)
- [ ] 🟡 "Delete this garment / this outfit" granular deletion (not just full-account deletion) — already implied by `PRODUCT_SPEC.md` §4 wardrobe grid, confirm it ships in v1
- [ ] 🟡 Height/weight profile fields tolerate edge-case input (very high/low/empty values) without breaking the profile screen — these are **optional, reference-only fields that no longer drive the avatar's shape**, so this is input validation, not avatar fidelity. The avatar-rendering equivalent is the character-creator QA pass in §5 below

## 4. Backend / Infra

- [ ] 🔴 RLS audit: every user-owned table (`profiles`, `avatars`, `garments`, `outfits`, `outfit_items`, plus the commerce tables `wishlist_items`, `product_try_ons`, `affiliate_clicks`, `affiliate_conversions`) has `user_id = auth.uid()` policies verified with a real second-user test account, not just code review. **Deliberate exception, don't "fix" it:** `affiliate_clicks`/`affiliate_conversions` are **select-only** — there is no client insert policy, because those rows carry forgeable commission terms and are written through an RPC / the `affiliate-postback` Edge Function instead. Audit that the insert path is what's locked down, not that a missing insert policy gets added
- [ ] 🔴 Confirm Storage bucket policies match the RLS pattern — `garments` bucket already has per-user path policies; `avatar-previews` and `outfit-thumbnails` need the same before they hold real data
- [ ] 🔴 No secrets present in the client bundle — the service-role key and `AFFILIATE_POSTBACK_SECRET` must exist only as Edge Function environment variables, never in the app. (The old RevenueCat and remove.bg keys listed here aren't a risk because neither vendor is integrated; re-add them to this check if either ever is.)
- [ ] 🔴 Abuse/rate-limit review of the deployed Edge Functions that exist — `affiliate-postback` (accepts third-party postbacks and writes commission rows; verify the shared-secret check and replay handling), `product-feed-ingest`, and `delete-account`. There is no `garment-ingest`/remove.bg endpoint to rate-limit; when a paid per-request vendor is introduced, that becomes a billing-abuse vector and goes back on this list
- [ ] 🔴 Automated Supabase backups confirmed enabled, with the retention window documented (feeds directly into the privacy policy's "residual copies in backups" disclosure)
- [ ] 🟡 Storage/bandwidth cost monitoring/alerting configured before a viral TikTok moment turns into a surprise bill (see `PRODUCT_SPEC.md` §9 cost-scaling risk)
- [ ] 🟡 Load-test the avatar/garment render path on a real low/mid-range device, not just simulator (per `PRODUCT_SPEC.md` §9)

## 5. Trust & Safety

- [ ] 🔴 QA pass across the character creator's full option space — every skin tone × body type × face/eye/hair/brow/facial-hair combination renders with equal fidelity, and no combination degrades or looks like an afterthought (`app/src/features/creator/customization.ts` is the authoritative option list). This is an explicit public commitment in `MARKETING_STRATEGY.md` §11, not just a nice-to-have
- [ ] 🔴 Marketing/product copy audit: no before/after body language, no weight-loss framing, no numeric outfit/body scoring anywhere in the app or App Store listing (per `MARKETING_STRATEGY.md` §11)
- [ ] 🔴 In-app data-control moment: the **garment photo** upload screen itself (not just a buried privacy policy link) states plainly that the photo is never used to train models and is one-tap deletable, per the marketing doc's explicit design requirement. Garment photos are now the only user-supplied images the app takes — there is no body photo and no measurement entry in the avatar flow, which makes this a much smaller promise to keep than it was pre-pivot
- [ ] 🟡 Draft the Phase 2 moderation plan now, even though the social feed isn't in v1: reaction-based (not numeric) feedback only, a reporting/block mechanism, and a defined SLA for acting on reports — [Apple's Guideline 1.2](https://developer.apple.com/app-store/review/guidelines/) expects reported UGC to be acted on quickly (commonly cited as within 24 hours) once a feed exists, and building the plan pre-launch avoids a scramble later
- [ ] 🟡 Define an escalation path for a user reporting a non-consensual or harmful photo/likeness use, even though Phase 2 sharing isn't live yet — decide this before there's a live incident to react to

## 6. Marketing / Launch

- [ ] 🟡 Waitlist landing page live with referral mechanic and blurred-avatar teaser (`MARKETING_STRATEGY.md` §6.4)
- [ ] 🟡 Creator seeding wave 1 (75–150 micro creators) confirmed and scheduled to post in a coordinated window, not staggered (§6.2)
- [ ] 🟡 Product Hunt draft listing prepared, targeting a Fri/Sat/Sun launch per the 2026 PH playbook referenced in `MARKETING_STRATEGY.md` §7
- [ ] 🟡 App Store screenshots and description finalized and consistent with the TikTok/creator content angle (avatar reveal, digitize-closet, try-before-you-buy) so paid/organic traffic and the store listing tell the same story
- [ ] 🟡 30/60/90-day metrics dashboard (Weekly Avatars Styled north-star metric per `MARKETING_STRATEGY.md` §10) wired up before launch day, not after

---

## Sources
- [Apple — Offering account deletion in your app](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
- [Apple — Third-party SDK requirements](https://developer.apple.com/support/third-party-SDK-requirements/)
- [Apple — App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Apple — Updated age ratings in App Store Connect](https://developer.apple.com/news/?id=ks775ehf)
