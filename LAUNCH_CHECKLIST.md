# Selv — Pre-Launch Checklist

**Last updated:** 2026-07-14 · Companion to `legal/PRIVACY_POLICY.md`, `legal/DATA_HANDLING.md`, `APP_STORE_LISTING.md`, `PRODUCT_SPEC.md`, `MARKETING_STRATEGY.md`.

Legend: 🔴 **BLOCKING** — App Review will reject or the launch is legally exposed without this. 🟡 **Nice-to-have** — do it if time allows, doesn't block submission.

---

## Top 3 Things Most Likely to Get This App Rejected

1. **No (or inadequate) in-app account deletion.** This is the single most common 2026 rejection reason ([Guideline 5.1.1(v)](https://developer.apple.com/support/offering-account-deletion-in-your-app/)), and Selv's current schema doesn't even have the `avatars` table built yet (see `legal/DATA_HANDLING.md` §1) — meaning deletion coverage can't be finished until that table exists. A "deactivate" toggle or an email-only flow will not pass.
2. **App Privacy label / actual data collection mismatch, or a missing privacy manifest.** Reviewers (and automated binary validation) check that what's declared in the App Privacy questionnaire matches what the app actually does — and separately, any bundled third-party SDK (RevenueCat, any analytics/crash SDK) on [Apple's commonly-used-SDK list](https://developer.apple.com/support/third-party-SDK-requirements/) that lacks a `PrivacyInfo.xcprivacy` manifest triggers an automatic rejection at upload, before a human ever reviews the app.
3. **Subscription/IAP setup errors.** Selv+ must be a StoreKit auto-renewable subscription, fully configured and *Apple-approved* before submission (a paywall pointing at an unapproved product shows as "missing" to the reviewer and triggers a Guideline 2.1 rejection), with price/duration/auto-renewal terms visible on the same screen as the buy button (Guideline 3.1.2). The try-before-you-buy affiliate flow must stay visually and functionally distinct from the Selv+ paywall so a reviewer doesn't misread it as external digital-goods checkout.

---

## 1. Legal / Compliance

- [ ] 🔴 Have a lawyer review and finalize `legal/PRIVACY_POLICY.md` — replace every `[TBD]` (legal entity name, jurisdiction, contact emails, hosting region)
- [ ] 🔴 Publish the privacy policy at a stable public URL and link it in App Store Connect ("Privacy Policy" field is required for submission)
- [ ] 🔴 Draft and publish Terms of Use / EULA (referenced in the Selv+ paywall per Guideline 3.1.2) — not yet drafted, needs its own pass
- [ ] 🔴 Confirm remove.bg's data retention/processing terms in writing (DPA or ToS) — currently marked `[VERIFY]` in `legal/DATA_HANDLING.md` §2c
- [ ] 🔴 Set minimum account age to 13 at signup (age gate / birthdate field) and confirm this is enforced, not just stated in the ToS
- [ ] 🟡 Confirm final Supabase hosting region and document the GDPR international-transfer mechanism (SCCs) if EU users are expected at launch
- [ ] 🟡 Register/confirm trademark clearance on the final app name before it's locked (see `MARKETING_STRATEGY.md` §3 — "Selv" is already taken by a direct competitor)
- [ ] 🟡 Vendor DPAs on file for Supabase, RevenueCat, and whichever analytics/crash vendor is chosen

## 2. App Store Submission

- [ ] 🔴 Build the in-app account-deletion flow per `legal/DATA_HANDLING.md` §3, end to end, and manually test that it actually removes Storage objects (not just DB rows)
- [ ] 🔴 Complete the App Privacy questionnaire in App Store Connect using `legal/DATA_HANDLING.md` §4 as the answer key
- [ ] 🔴 Add `PrivacyInfo.xcprivacy` manifests for every third-party SDK on Apple's required list (RevenueCat at minimum) — verify via Xcode's build-time privacy report, not by assumption
- [ ] 🔴 Complete the updated age-rating questionnaire (13+/16+/18+ system, mandatory since Jan 31, 2026) — see `APP_STORE_LISTING.md` §7 for the recommended answers and rationale
- [ ] 🔴 Set `ITSAppUsesNonExemptEncryption: false` in `Info.plist` (see `APP_STORE_LISTING.md` §10)
- [ ] 🔴 Configure the Selv+ auto-renewable subscription in App Store Connect and get it into "Ready to Submit" state *before* submitting the app binary (an unapproved IAP product is a common false-rejection trigger)
- [ ] 🔴 Sign the Paid Applications Agreement in App Store Connect (required before any IAP will function in review or production)
- [ ] 🔴 Add the required screenshot set per `APP_STORE_LISTING.md` §9 (6.9" iPhone source size, auto-scaled by Apple)
- [ ] 🔴 Finalize Title/Subtitle/Keywords/Description exactly as specified in `APP_STORE_LISTING.md` (or the equivalent once the final app name is locked)
- [ ] 🟡 Prepare an App Review notes field explaining the try-on/affiliate external-purchase flow proactively, so a reviewer doesn't need to guess why external links exist next to an IAP subscription

## 3. Product Must-Haves

- [ ] 🔴 Build the `avatars` table + RLS policy in Supabase (currently missing — see `legal/DATA_HANDLING.md` §1) before any real user enters measurements
- [ ] 🔴 In-app account deletion (see §2 above — listed twice deliberately, it's both a legal and a product-engineering item)
- [ ] 🔴 Camera/photo-library permission purpose strings implemented exactly as specified in `APP_STORE_LISTING.md` §8
- [ ] 🔴 Crash reporting integrated (currently only "planned" per `PRODUCT_SPEC.md` §10 cost table) — shipping without any crash visibility on a 10-day-built app is a reliability risk, not just a nice-to-have
- [ ] 🔴 Selv+ paywall screen shows price, billing period, and auto-renewal terms on the same screen as the purchase button (Guideline 3.1.2)
- [ ] 🟡 Analytics integrated with PII scrubbing configured per `legal/DATA_HANDLING.md` §2c (photo URLs, measurement values, and free-text names excluded from event payloads)
- [ ] 🟡 "Delete this garment / this outfit" granular deletion (not just full-account deletion) — already implied by `PRODUCT_SPEC.md` §4 wardrobe grid, confirm it ships in v1
- [ ] 🟡 Re-editable measurements flow tested for edge cases (very high/low values) so the avatar doesn't break or render offensively at extremes

## 4. Backend / Infra

- [ ] 🔴 RLS audit: every user-owned table (`profiles`, `garments`, `outfits`, `outfit_items`, and the new `avatars`) has `user_id = auth.uid()` policies verified with a real second-user test account, not just code review
- [ ] 🔴 Confirm Storage bucket policies match the RLS pattern — `garments` bucket already has per-user path policies; `avatar-previews` and `outfit-thumbnails` need the same before they hold real data
- [ ] 🔴 No secrets (Supabase service-role key, RevenueCat secret key, remove.bg API key) present in client bundle — service-role operations must run only inside Edge Functions
- [ ] 🔴 Rate limiting on the `garment-ingest` Edge Function (remove.bg calls cost money per request — an unrated endpoint is a billing-abuse vector)
- [ ] 🔴 Automated Supabase backups confirmed enabled, with the retention window documented (feeds directly into the privacy policy's "residual copies in backups" disclosure)
- [ ] 🟡 Storage/bandwidth cost monitoring/alerting configured before a viral TikTok moment turns into a surprise bill (see `PRODUCT_SPEC.md` §9 cost-scaling risk)
- [ ] 🟡 Load-test the avatar/garment render path on a real low/mid-range device, not just simulator (per `PRODUCT_SPEC.md` §9)

## 5. Trust & Safety

- [ ] 🔴 QA pass on avatar generation across a representative range of body sizes, skin tones, and body types with equal fidelity — this is an explicit public commitment in `MARKETING_STRATEGY.md` §11, not just a nice-to-have
- [ ] 🔴 Marketing/product copy audit: no before/after body language, no weight-loss framing, no numeric outfit/body scoring anywhere in the app or App Store listing (per `MARKETING_STRATEGY.md` §11)
- [ ] 🔴 In-app data-control moment: the photo/measurement upload screen itself (not just a buried privacy policy link) states plainly that this data is never used to train models and is one-tap deletable, per the marketing doc's explicit design requirement
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
