# Selv — Ship Readiness

**What this is:** the hand-off doc for everything that cannot be done from a build container. Every item here needs a human with an Apple Developer account, a Supabase dashboard, a physical iPhone, a lawyer, or a credit card. Each one says *what to do*, *where*, *what "done" looks like*, *what it blocks*, and *which file in this repo already does the thinking for you*.

**Compiled:** 2026-08-20, against the working tree on `claude/youthful-rubin-f0f9wr`.
**Companion to:** `LAUNCH_CHECKLIST.md` (the full checklist, including the on-machine half), `APP_STORE_LISTING.md` (copy + answers), `legal/DATA_HANDLING.md`, `legal/PRIVACY_POLICY.md`, `legal/TERMS_OF_USE.md`, `SELV_VERIFICATION.md`.

**Legend** (same as `LAUNCH_CHECKLIST.md`, kept for continuity):
🔴 **BLOCKING** — App Review will reject, or the launch is legally exposed, without this.
🟡 **Nice-to-have** — do it if time allows; does not block submission.
⏸️ **Deferred** — still required, but only once a precondition outside v1 scope is met.
🔒 **Blocked** — cannot be decided in this session; the blocker is named on the item.

**Count: 19 blocking · 9 non-blocking · 6 deferred · 2 blocked.** Full tally in §8.

---

## §0. Read this before you fill in a single form

Four things in the planning docs are **stale relative to the shipped code**, and three of them would put a wrong answer on an Apple questionnaire. Where a doc and the code disagree, this file follows the code. The full discrepancy register is §9; these four are the ones that change an answer you are about to give.

**1. Height and weight are still collected, and a BMI is still derived from them.**
`legal/DATA_HANDLING.md` §4, `APP_STORE_LISTING.md` §7 and `PRIVACY_POLICY.md` §2 all say height/weight are "optional, reference-only fields with no bearing on the avatar's shape." That is true of the **try-on avatar** — the character creator takes no measurements. It is **not true of the Profile screen**. `app/src/features/profile/ProfileScreen.tsx:60` calls `buildWidthScale(profile.height_cm, profile.weight_kg)`, and `app/src/features/avatar/avatars.tsx:27-34` computes `bmi = weightKg / (heightCm/100)^2` and returns `sqrt(bmi/22)` clamped to 0.85–1.25, which is then passed to `BuildPicker` to widen or narrow the rendered body silhouettes. Both fields have a real UI (unit toggle, 90–250 cm / 30–300 kg range validation), and `saveMetrics()` refuses to save a *build* change without them.
→ Affects the **App Privacy** Health answer (§6) and the **age-rating** medical/wellness answer (§1.14). Do not answer either from the doc's stated rationale.

**2. Product-interaction analytics are already being collected server-side — no SDK required.**
`legal/DATA_HANDLING.md` §4 lists "Usage Data → Product Interaction" as *Pending (planned)*, on the assumption it arrives with an analytics vendor. It is already live: `product_try_ons` records every try-on with a timestamp and a user id, `wishlist_items` records every save, `affiliate_clicks` records every Buy tap *including which app surface it came from*, and `waitlist_signups.source` records which paywall the user hit. All four are linked to the user and all four are readable by the user through their own RLS policy.
→ This is the single most likely **under-declaration** on the App Privacy form. Answer **Yes, Linked**.

**3. "Purchase History" is right for the wrong reason.**
The doc justifies it with "Selv+ subscription status via RevenueCat." There is no RevenueCat and no IAP — `app/package.json` has neither. But `affiliate_conversions` stores `order_total_cents`, `network_order_id` and `product_id` against a `user_id`, the user can read their own rows, and the app surfaces them (`app/src/features/orders/`). That is purchase history of third-party purchases.
→ Answer stays **Yes**; the justification must be rewritten to the affiliate ledger, and counsel needs to see it (the privacy policy currently does not mention affiliate data at all — see item 4).

**4. The privacy policy describes a different app than the one that ships.**
`legal/PRIVACY_POLICY.md` names **remove.bg** and **RevenueCat** as processors (neither is a dependency), describes signup as "hashed password (or Sign in with Apple / Google identity token)" (auth is email OTP only — `app/src/lib/api/auth.ts` exposes `signInWithOtp` and nothing else), and says **nothing at all** about the affiliate flow: not the click token handed to a retailer, not the conversion records, not the Selv+ waitlist email, not `wishlist_items` or `product_try_ons`.
→ It simultaneously **over-declares** vendors that do not exist and **under-declares** data that does. This is the highest-value thing to put in front of the attorney; do not treat the review as a formality.

---

## §1. 🔴 Blocking — in the order they block submission

### Gate A — the account you need before anything else exists

**1. Apple Developer Program enrollment and the App Store Connect app record**
- **Do:** confirm (or complete) enrollment, then create the app record with bundle id `com.selv.app` — the value already set in `app/app.json` — and reserve the name "Selv" *provisionally*, because §2.1 may change it.
- **Where:** developer.apple.com/programs, then App Store Connect → Apps → +.
- **Done:** an app record exists in "Prepare for Submission" state with the matching bundle id.
- **Blocks:** every other App Store Connect item in this file. Enrollment has multi-day lead time for an organisation entity, and the entity name is also a `[TBD]` in both legal docs (§1.2) — so start these two together.
- **Repo:** `app/app.json` (`ios.bundleIdentifier`, `version: "1.0.0"`).

> ⚠️ **Name-lock hazard.** Reserving "Selv" is not clearance. See §2.1 before spending on anything with the name baked in.

### Gate B — legal (longest lead time, gates the store listing)

**2. Attorney review of the privacy policy and the Terms of Use, together**
- **Do:** engage a privacy/consumer-app attorney and hand them **both** documents at once. They cross-reference each other and cannot be reviewed separately. Give them §0 above verbatim — the drafts describe a pre-pivot product and a vendor stack that does not exist, and a reviewer working only from the text will bless the wrong app.
- **Where:** outside the repo.
- **Done:** both documents returned with every `[TBD]` filled and the ⚠️ NOT LEGAL ADVICE banner at the top of each removed.
- **Blocks:** items 3, 4, 12, 13.
- **Repo:** `legal/PRIVACY_POLICY.md`, `legal/TERMS_OF_USE.md`, `legal/DATA_HANDLING.md` (the engineering-facing map counsel should be shown alongside).

**Every `[TBD]`, enumerated so nothing is missed.** These are the drafting decisions only a human can make.

*Shared by both documents (decide once, apply twice):*

| Field | Where |
|---|---|
| Legal entity name | `PRIVACY_POLICY.md` §Company, §16; `TERMS_OF_USE.md` intro, §Contact |
| Registered address for legal notices | `TERMS_OF_USE.md` §Contact |
| Effective date (set at publish) | both, line 8–10 |
| `privacy@` / `support@` / `legal@` addresses — and whether the domain is `selv.app` at all (see §2.1) | `PRIVACY_POLICY.md` §11, §16; `TERMS_OF_USE.md` §72, §117, §251, §Contact |
| Final Supabase hosting region + the GDPR transfer mechanism (SCCs or equivalent) | `PRIVACY_POLICY.md` §74, §155 — see item 11 |
| Stable public URL each document will live at | `TERMS_OF_USE.md` §276; needed by items 3 and 4 |

*Privacy policy only:*
- Analytics vendor name (§86) and crash-reporting vendor name (§87) — **both blocked, see §4**. The policy can publish with these lines removed rather than left as `[TBD]`, since neither vendor is integrated. Decide with counsel which reads better: omit now and amend later, or name them now and ship them.
- Backup retention window (§8) — a number, from item 10.

*Terms of Use only, each explicitly flagged "counsel required":*
- **§Disputes is entirely `[TBD]` and the draft says "do not publish these Terms with this placeholder in place."** Governing law; exclusive forum/venue; arbitration vs. court and, if arbitration, the administering body, rules, seat, fee allocation, small-claims carve-out and opt-out; class-action and jury-trial waivers and whether they are enforceable in the launch markets; consumer carve-outs (EU/UK consumers generally cannot be deprived of their home courts, so a single blanket forum clause is likely insufficient); an informal-resolution step.
- Liability cap (§206). The usual "greater of what you paid us in 12 months or $X" formula needs the fallback figure specified, **because the app is free and the first prong is zero for every user of this version.**
- Consumer-protection carve-outs per launch jurisdiction (§197).
- Whether a formal DMCA agent designation and notice-and-takedown procedure must be published, and the registered agent details if so (§117).
- Whether an English-governs clause is permissible in each launch market (§266).

**3. Publish the privacy policy at a stable public URL**
- **Do:** host the finalised policy at a URL that will not move. `landing/` in this repo is a static page; the same host can serve `/privacy`.
- **Where:** your web host, then App Store Connect → App Information → **Privacy Policy URL** (a required field — submission is impossible without it).
- **Done:** the URL loads the finalised text over HTTPS, with no `[TBD]` visible, and is pasted into App Store Connect.
- **Blocks:** submission, hard.
- **Repo:** `legal/PRIVACY_POLICY.md`, `landing/index.html`.

**4. Publish the Terms of Use and link them**
- **Do:** host the finalised Terms at a stable URL. Then either paste it into App Store Connect → App Information → **EULA** (custom licence agreement), or link it from the app description. The Terms already contain the Apple-required third-party-beneficiary clauses (§251) for a custom EULA.
- **Where:** your web host + App Store Connect.
- **Done:** URL live; linked from the listing; in-app links (if any ship) point at the same URL, not a different one.
- **Blocks:** not submission on its own — but the Terms are required in their own right for v1 (account creation, affiliate links, user-generated content), and a live app with a privacy policy and no terms is an avoidable exposure.
- **Note:** Guideline 3.1.2 (subscription disclosure) does **not** attach yet — it attaches the day Selv+ ships. See §3.

### Gate C — prove the backend before you promise anything about it

> The four scripts in `app/supabase/verification/` were written for exactly these items. Read `app/supabase/verification/README.md` first — it explains the two-account impersonation, and why an audit that only looks for RLS *errors* silently passes half the cases.

**5. Apply the pending migrations to the live project**
- **Do:** the working tree contains `app/supabase/migrations/006_age_gate.sql` (the enforced 13+ minimum, landed this session by another agent) which may not be applied to the live database yet. Confirm every migration 002→006 is applied, in order.
- **Where:** Supabase Dashboard → SQL Editor, or `supabase db push`.
- **Done:** `select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='age_verified_on'` returns a row. Script `01` reports "age gate present" rather than EXPECTED-ABSENT.
- **Blocks:** items 6 and 14 — an unapplied age gate means the 13+ claim in `PRIVACY_POLICY.md` §12 is false in production, and the age-rating questionnaire is answered against a control that does not exist.
- ⚠️ **Ordering hazard, already documented in the migration:** `002_commerce.sql` is a snapshot of the pre-fix schema. **Never re-run 002 after 003** — it re-opens the affiliate insert hole. If you do re-run it by hand, run 003 again immediately afterwards.

**6. RLS two-account audit**
- **Do:** create two throwaway accounts through the real signup path, then run `00_harness.sql` → `01_rls_two_account_audit.sql` against the live project, and the curl appendix at the bottom of that file.
- **Where:** Supabase SQL editor or `psql`, plus a terminal for the HTTP half.
- **Done:** the script's final row reads `✅ 01 PASSED` and the FAIL count is 0. It covers all ten tables `LAUNCH_CHECKLIST.md` §4 names, plus `waitlist_signups` and the new age gate.
- **Blocks:** submission (§4 of the checklist), and honestly, launch — this is the difference between "the policies look right" and "a second account bounced off every one of them."
- **Repo:** `app/supabase/verification/01_rls_two_account_audit.sql`.

**7. Affiliate write-path audit**
- **Do:** run `02_affiliate_write_path_audit.sql`, plus its Edge Function appendix (unsigned postback, wrong signature, stale timestamp, duplicate delivery).
- **Where:** same.
- **Done:** `✅ 02 PASSED`; a duplicate postback books exactly one conversion row.
- **Blocks:** the §4 checklist item, and the abuse/rate-limit review of the deployed Edge Functions.
- ⚠️ **The thing to not get wrong:** `affiliate_clicks` and `affiliate_conversions` have **no client INSERT policy on purpose**, and the script reports that as `EXPECTED-ABSENT`. Adding one back — even the obvious `with check (user_id = auth.uid())` — lets any user forge a click at 10000 bps against any product, buy the item for real, and cause us to invoice the brand for 100% of their own order value. A forged click row is byte-identical to a real one, so it would surface as a partner asking why their invoice is wrong. `migrations/003_affiliate_click_rpc.sql` exists solely to *remove* that policy.
- **Repo:** `app/supabase/verification/02_affiliate_write_path_audit.sql`, `app/supabase/migrations/003_affiliate_click_rpc.sql`, `app/supabase/functions/affiliate-postback/index.ts`.

**8. Storage bucket policy verification**
- **Do:** run `03_storage_policy_audit.sql` and its curl appendix.
- **Where:** same.
- **Done:** `✅ 03 PASSED`; the anonymous public-object fetch in the appendix returns 404, not an image.
- **Blocks:** the §4 storage item.
- **Scope note:** `garments` is the only bucket `schema.sql` creates, and it is audited live. **`avatar-previews` and `outfit-thumbnails` do not exist** — they are named in `PRODUCT_SPEC.md` §7 and `DATA_HANDLING.md` §2b as planned, and `delete-account` already sweeps their prefixes pre-emptively. Their absence is expected, not a defect. The script prints the exact four-policy DDL that must ship **in the same migration** that creates either bucket; a private bucket with no policies is unreadable even by its owner, and one created through the dashboard with "public" ticked is readable by everyone. `DATA_HANDLING.md` §2b also lists `garment-templates` and `catalog` buckets that schema.sql does not create — reconcile the data map before publishing the policy against it.
- **Repo:** `app/supabase/verification/03_storage_policy_audit.sql`.

**9. Account-deletion end-to-end verification — the highest rejection risk in the launch**
- **Do:** the four-phase procedure in `04_account_deletion_verification.sql`. Phase 0 is a real app session on a device (the script's checklist), Phase 1 snapshots the footprint, Phase 2 is tapping **Delete Account** in the app, Phase 3 is the proof.
- **Where:** device/simulator + SQL editor.
- **Done:** `✅ 04 PASSED`. Phase 1 **refuses to continue** if any of the twelve surfaces is empty — a deletion test against an account that only ever signed in proves nothing, and that is the most common way this item gets ticked without being done.
- **Blocks:** submission. Guideline 5.1.1(v) is the most common 2026 rejection reason, and a flow that leaves orphaned Storage objects fails the same way an email-only flow does.
- ⚠️ **The distinction the script preserves:** `delete-account` **de-identifies** `affiliate_clicks` and `affiliate_conversions` by nulling `user_id`, and deletes everything else. Those rows are financial evidence — a conversion is money a brand owes, a click is the snapshotted rate backing that invoice. Surviving de-identified rows are a **PASS**. Script §4d asserts they survive, that every `user_id` is null, that the commission terms and order totals are unchanged, and that the conversion→click linkage still resolves. Separately, `product_try_ons` is **not** de-identified — its `user_id` is `NOT NULL … on delete cascade`, so those rows are destroyed and per-product try-on counts genuinely decrease on deletion. Defensible, but a real caveat on a number quoted to brands (`AFFILIATE_SYSTEM.md` §2.4).
- **Also confirm while you are in the app** (review criteria, not data criteria): deletion is initiated in-app; reachable in ≤2 taps from settings; plain-language explanation; an explicit confirmation step; a success confirmation; signed out afterwards.
- **Repo:** `app/supabase/verification/04_account_deletion_verification.sql`, `app/supabase/functions/delete-account/index.ts`, `legal/DATA_HANDLING.md` §3.

**10. Automated backups confirmed, retention window documented**
- **Do:** Supabase Dashboard → Database → Backups. Confirm automated backups are on, and write down the retention window in days for your plan.
- **Where:** Supabase dashboard → then `legal/PRIVACY_POLICY.md` §8.
- **Done:** backups on; the actual number replaces the vague wording in §8, before the policy is published.
- **Blocks:** item 3 (the policy cannot be finalised with an unspecified retention window), and it is the honest half of the deletion story — live rows go in seconds, backups do not, and Apple explicitly permits non-instant deletion **so long as it is disclosed and bounded**.
- **Repo:** `PRIVACY_POLICY.md` §8/§10, `DATA_HANDLING.md` §3.3, `04_account_deletion_verification.sql` §7.

**11. Confirm the Supabase hosting region and the transfer mechanism**
- **Do:** read the region off the project (Dashboard → Settings → General), then decide with counsel what transfer mechanism applies for EU/UK users (SCCs or equivalent) and whether the Supabase DPA is executed.
- **Where:** Supabase dashboard + counsel.
- **Done:** `PRIVACY_POLICY.md` §74 and §155 name the real region and the real mechanism.
- **Blocks:** item 3. `LAUNCH_CHECKLIST.md` files this as 🟡; **it is promoted to 🔴 here** for one specific reason — the privacy policy cannot be published with `[TBD — confirm final region]` in the text, and publishing the policy is a hard submission gate. The *diligence* is nice-to-have; the *placeholder* is blocking.

**12. No secrets in the client bundle; Edge Function secrets set server-side**
- **Do (off-machine half):** Supabase Dashboard → Edge Functions → Secrets. Confirm `AFFILIATE_POSTBACK_SECRET` (or the per-network `AFFILIATE_POSTBACK_SECRET_<NETWORK>` variants) is set there. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by Supabase and should **not** be set manually. Confirm the service-role key is not in your EAS build environment or in `eas.json`.
- **Do (on-machine half, quick):** `grep -R "service_role\|SERVICE_ROLE\|AFFILIATE_POSTBACK_SECRET" app/src app/app app/app.json app/eas.json` must return nothing.
- **Done:** both halves clean. The anon key *is* expected in the bundle and is not a secret — that is precisely why every RLS policy above matters.
- **Blocks:** the §4 checklist item. The old RevenueCat and remove.bg keys on that list are not a risk because neither vendor is integrated.
- **Repo:** `app/supabase/functions/_shared/supabaseAdmin.ts`, `app/supabase/functions/README.md` §5.

### Gate D — the App Store Connect questionnaires

**13. App Privacy questionnaire**
- **Do:** fill it in from the corrected answer key in **§6 of this file** — *not* straight from `DATA_HANDLING.md` §4, which was written pre-pivot and disagrees with the code in four places.
- **Where:** App Store Connect → App Privacy.
- **Done:** every row in §6 answered; the four rows flagged ⚠️ resolved with counsel first.
- **Blocks:** submission. A label/behaviour mismatch is a documented rejection path, and the mismatch here runs in **both** directions (over-declaring vendors that do not exist, under-declaring interaction data that does).
- **Repo:** §6 below; `legal/DATA_HANDLING.md` §4 (superseded where they disagree).

**14. Age-rating questionnaire (the 13+/16+/18+ system, mandatory since 2026-01-31)**
- **Do:** answer the new questionnaire. `APP_STORE_LISTING.md` §7 has the reasoning and lands on **13+**, which is right — no violence, no mature themes, no gambling, no unmoderated chat, but account creation, user photos, and external retail checkout put it above the youngest tiers, and it is deliberately not a Kids Category app.
- ⚠️ **One answer in that file must not be used as written.** §7 says to answer the medical/wellness section as *"no medically-relevant data collected,"* on the grounds that height/weight have no bearing on the avatar. Per §0 item 1, the app collects height and weight through a real UI and derives a **BMI** from them to scale body silhouettes. Re-derive that answer against the code, with counsel, before submitting. Getting it wrong is a metadata-accuracy problem, not a rating problem.
- **Where:** App Store Connect → App Information → Age Rating.
- **Done:** questionnaire complete; the resulting rating is 13+ or the reason it is not is written down.
- **Blocks:** submission.
- **Depends on:** item 5 — the enforced gate has to actually exist in production before you assert a minimum age.

**15. Declare no in-app purchases**
- **Do:** answer the business-model questions with **no IAP products**. Verified: `app/package.json` contains no RevenueCat, no StoreKit wrapper, no purchase SDK of any kind; the 25-item cap opens `SelvPlusWaitlistSheet.tsx`, which shows no price and sells nothing.
- **Where:** App Store Connect → the app record's IAP section (leave empty) and the submission questionnaire.
- **Done:** zero IAP products configured; the listing copy stays on the waitlist framing.
- **Blocks:** submission — and pre-declaring a subscription the binary cannot sell actively invites a reviewer to hunt for a purchase flow that does not exist (Guideline 2.3.1).
- **Repo:** `APP_STORE_LISTING.md` §11.

**16. Export compliance — already satisfied in config, confirm it survives the build**
- **Status:** `app/app.json` already sets `ios.infoPlist.ITSAppUsesNonExemptEncryption: false`. The app uses only OS-provided HTTPS/TLS, which is exempt.
- **Do:** after `expo prebuild`, confirm the key is present in the generated `Info.plist`, so App Store Connect stops re-prompting the encryption questionnaire per build.
- **Done:** key present; no encryption prompt on upload.
- **Repo:** `app/app.json`, `APP_STORE_LISTING.md` §10.

**17. Privacy manifests (`PrivacyInfo.xcprivacy`)**
- **Do:** run `npx expo prebuild`, open the workspace in Xcode, and read the **build-time privacy report**. Do not answer this from the dependency list.
- **Status:** the shipping build bundles **none** of the third-party SDKs the checklist calls out — no RevenueCat, no analytics, no crash reporter (`app/package.json` verified). The React Native / Expo toolchain (Expo SDK 54, RN 0.81) ships its own manifests for the modules it provides, but "the toolchain probably handles it" is not a check.
- **Done:** the Xcode privacy report is read and clean, and the binary uploads without a validation rejection.
- **Blocks:** upload — a missing manifest is an automatic binary-validation rejection, before a human ever sees the app.
- **Re-run this** the day the crash/analytics vendor in §4 lands. Do not treat it as permanently satisfied.

### Gate E — the listing itself

**18. Screenshot set (5 screens, 6.9" iPhone source)**
- **Do:** capture the five screens in `APP_STORE_LISTING.md` §9 at **1320×2868 px**, portrait, PNG or JPEG, **no alpha channel**. Only the largest device per size class needs source art; Apple auto-scales down.
- **Where:** device/simulator capture → App Store Connect → the 6.9" slot.
- **Done:** five screenshots uploaded, headline overlays matching §9's copy bank, consistent device chrome (same status-bar time, same background treatment).
- ⚠️ **Two constraints that are review risks, not style notes:** (a) real in-app screens only — mocked-up UI is a Guideline 2.3.3 problem; (b) screenshot #5 shows the **share-card export**, not an in-app social feed, because the feed is Phase 2 and showing it would be inaccurate metadata under 2.3.1.
- ⚠️ **The characters in these screenshots are a public commitment.** `MARKETING_STRATEGY.md` §11 commits to diversity in the character creator; the store listing is where that commitment is most visible. Run the rendered characters through the same skin-tone/body-type check as item 20 before shipping the set.
- **Repo:** `APP_STORE_LISTING.md` §9.

**19. Listing metadata + App Review notes**
- **Do:** paste Title / Subtitle / Keywords / Promotional text / Description / What's New from `APP_STORE_LISTING.md` §1–§6 verbatim (they are already length-checked: 26, 28, 99, 168 characters). Set primary category to **Lifestyle** or **Shopping** — explicitly *not* Health & Fitness. Then fill the **App Review notes** field.
- **Done:** all fields entered; review notes present.
- **Blocks:** submission.
- **Paste-ready review notes** — the affiliate flow is the one thing a reviewer will find confusing, so explain it before they have to guess:

> Selv is free and contains **no in-app purchases**. There is no StoreKit product, no subscription, and no paywall in this build. When a user reaches the 25-item wardrobe limit, the app opens a free email-waitlist sheet for a future "Selv+" tier — it states plainly that Selv+ is coming and is not purchasable, and joining is free.
>
> The **Shop** tab links out to third-party retailer websites for **physical goods** (real apparel and footwear, shipped by the retailer). These are affiliate links: checkout happens entirely on the retailer's own site and Selv earns a commission. Under **Guideline 3.1.1**, physical goods and services purchased outside the app are permitted, and there is no in-app purchase in this build for them to compete with.
>
> The **avatar is designed by the user in a character creator** — skin tone, face shape, eyes, hair, brows, facial hair, body type, accessories. The app never photographs or scans the user's face or body. Camera and photo-library access are used **only** to photograph garments (clothing), which is what the permission strings say.
>
> **Account deletion:** Profile → Delete Account, two taps from the main screen, with one confirmation. It removes the account, all stored data and all uploaded images. *(If you keep any de-identified commercial records: "Records of completed retailer purchases are retained for financial reconciliation with our brand partners with the user identifier removed, as disclosed in our privacy policy.")*
>
> Test account: `<email>` / one-time code delivered by email — sign-in is passwordless (email OTP). Please contact us if you need a code delivered.

- ⚠️ Sign-in is **email OTP with no password**. A reviewer cannot log in without receiving a code. Either provide a demo account whose inbox you can watch and relay codes for, or arrange a reviewer bypass. **This has failed reviews for other passwordless apps** — do not leave it to the reviewer to figure out.
- **Repo:** `APP_STORE_LISTING.md` §1–§6, §11.

### Gate F — real-device QA

**20. Character-creator option-space fidelity pass**
- **Do:** verify on a real device that every appearance option renders with equal fidelity, and that no combination degrades or looks like an afterthought.
- **Why it is blocking:** `MARKETING_STRATEGY.md` §11 makes this an explicit **public commitment**, not an internal nicety: *"Commit publicly (and enforce in QA) to testing character rendering across all skin tones, body types, and hairstyles with equal fidelity."* A creator whose options render unevenly functions as a beauty bias even with no photo estimation involved.
- **The real scope, so you can plan it.** `app/src/features/creator/customization.ts` is the authoritative option list. Its eleven appearance axes are:

  | Axis | Options |
  |---|---|
  | `SKIN_TONES` | 10 |
  | `FACE_SHAPES` | 5 |
  | `EYE_COLORS` | 8 |
  | `EYE_SHAPES` | 4 |
  | `EYEBROW_STYLES` | 4 |
  | eyebrow colour (`HAIR_COLORS`) | 12 |
  | `HAIR_STYLES` | 12 |
  | hair colour (`HAIR_COLORS`) | 12 |
  | `FACIAL_HAIR_STYLES` | 5 |
  | facial-hair colour (`HAIR_COLORS`) | 12 |
  | `BODY_TYPES` | 5 |

  **10 × 5 × 8 × 4 × 4 × 12 × 12 × 12 × 5 × 12 × 5 = 3,317,760,000 combinations.** With `accessories` (a subset of glasses / earrings, so 4 states) that is **13,271,040,000**. Exhaustive coverage is not a thing that exists. Anyone who says "we tested every combination" did not.

- **A pass that actually discharges the commitment, in roughly a day:**
  1. **Single-axis sweep — 92 renders.** Sweep each axis with everything else at `DEFAULT_CUSTOMIZATION`. Catches "this hairstyle is broken" and "this brow colour is invisible." (10+5+8+4+4+12+12+12+5+12+5 = 89, plus 3 accessory states.)
  2. **Skin-tone crosses — ~390 renders.** Skin tone is the axis the public commitment names, and it is where fidelity gaps historically appear. Cross all 10 tones against: hair style (120), hair colour (120), body type (50), facial hair (50), face shape (50).
  3. **Deduplicate** — the two sets overlap; ~450 distinct renders total.
  4. Review them as a **contact-sheet grid**, not one at a time. Uneven fidelity is a comparative property; it is nearly invisible when you look at one render and obvious across a row.
- For reference, full **all-pairs (2-way) coverage** needs ~150–200 cases (lower bound 12×12 = 144). That is a cheaper, broader net — but it will not concentrate on skin tone, which is the axis you publicly promised to concentrate on. Do the targeted pass.
- **Done:** ~450 renders reviewed as grids; every defect either fixed or written down with a decision.
- **Repo:** `app/src/features/creator/customization.ts`, `app/src/features/creator/AvatarPreview.tsx`, `MARKETING_STRATEGY.md` §11.

---

## §2. 🟡 Non-blocking — do these if time allows

**1. Full USPTO clearance for "Selv" — the highest-value 🟡 in this file**
- **Status:** `SELV_VERIFICATION.md` is explicit that it is *"preliminary, not a legal clearance opinion."* It clears the test the last shortlist failed — **no same-category app, no obvious Class 9/42 software mark** — which is the important positive. `TRADEMARK_CLEARANCE.md` is a superseded record for the dropped name "Twinit"; ignore it.
- **The specific unresolved question, carried forward verbatim so it does not get lost:** **Selve** (`selve.shoes`) is a German custom-footwear brand that is **phonetically identical** to Selv, sits in Class 25 (footwear), and — pointedly — markets **3D-scan technology** for custom shoes. Its **US registration status is unknown**. Selv's goods are *software*, not clothing, so the question is *relatedness*, not identity, and it is arguable either way. **The question to put to the attorney is exactly this: does "Selve" — or any live apparel mark — block "Selv" for a software application?** If that comes back clear, the name is good.
- **Do:** attorney or full TESS search across **Classes 9, 42, 25 and 35**, explicitly including the phonetic variants **Selv / Selve / Selvi / Selva**. If clear, file **Intent-to-Use in Classes 9 + 42** and acquire the domain and handles the same day.
- **Secondary conflicts noted but lower risk:** *Selvi* (womenswear, Class 25, "Sel-vee"), *Selva* (watches/jewellery, Class 14). "SELV" is also an electrical-engineering acronym (Safety Extra-Low Voltage) — not a brand conflict, but it makes plain-`selv` search results noisy and is a minor discoverability drag.
- **Fallbacks if Selve makes you nervous:** **Persa** and **Faela** both came back clean with no phonetically identical apparel neighbour. Selv is the strongest brand; those two are marginally safer legally.
- **Do today, in parallel (2 minutes, no attorney needed):** WHOIS `selv.com` and `selv.app`; check `@selv` on Instagram and TikTok. Four-letter `.com`s are essentially all held, and four-letter handles are scarce, so **assume both are gone** and pick the fallback (`selv.app`, `getselv`, `tryselv`, `@selv.app`) *before* branding anything. This decision feeds directly into item §1.2 — the `privacy@` / `support@` / `legal@` addresses in both legal documents assume `selv.app`.
- **Why it is 🟡 and not 🔴:** the app can ship under a name that is not yet registered. What is *not* recoverable is spending on a name you then have to abandon — App Store listing, domain, handles, the find-and-replace pass through every doc in this repo. **Do this before any name-baked spend, which is realistically before the store listing goes live.**
- **Repo:** `SELV_VERIFICATION.md`, `TRADEMARK_NAME_SHORTLIST.md`, `TRADEMARK_KNOCKOUT.md`.

**2. Storage and bandwidth cost alerting** — Supabase Dashboard → Settings → Billing → usage alerts, plus a spend cap if the plan offers one. `PRODUCT_SPEC.md` §9 names cost scaling as a risk; the failure mode is a viral TikTok turning into a surprise invoice. Cheap, do it.

**3. Vendor DPA on file for Supabase** — request/execute the DPA. Feeds item §1.11. (No other vendor to paper: remove.bg and RevenueCat are not integrated.)

**4. 3D render performance on a real low/mid-range device** — not a simulator. `PRODUCT_SPEC.md` §9 flags this. Watch for frame rate in the creator and the try-on view, thermal throttling after a few minutes, and memory pressure with a full 25-item wardrobe. **This is the one 🟡 most likely to deserve promotion:** there is currently **no crash reporting** (§4), so a render-path crash on a mid-range device is invisible to you until a one-star review says so. If you can only do one 🟡, do this one.

**5. Granular delete for a single garment / outfit** — confirm it ships in v1 (`PRODUCT_SPEC.md` §4). Full-account deletion is the review requirement; per-item deletion is the promise made on the garment upload screen.

**6. Height/weight edge-case input** — very high, very low, empty. Note this is input validation on optional reference fields, *not* avatar fidelity. See §0 item 1: it is also where the BMI derivation lives, so a look at that screen serves two items at once.

**7–9. Marketing (all 🟡, all off-machine):** waitlist landing page live with the referral mechanic (`MARKETING_STRATEGY.md` §6.4); creator seeding wave 1, 75–150 micro creators posting in one coordinated window rather than staggered (§6.2); Product Hunt draft targeting a Fri/Sat/Sun launch (§7). None of these blocks submission; all of them have lead time measured in weeks, so schedule them against the review timeline rather than after it.

---

## §3. ⏸️ Deferred — required, but not for v1

Each names the precondition that un-defers it. Do not delete these; the Selv+ ones are exactly what gets forgotten in the release that introduces the paid tier.

1. **Configure the Selv+ auto-renewable subscription in App Store Connect** and get it to "Ready to Submit" *before* the binary that sells it. — *Precondition: the Selv+ launch.*
2. **Sign the Paid Applications Agreement.** — *Precondition: the Selv+ launch.* This has real lead time; start it before the paid release, not on submission day. v1's free-app agreement is sufficient.
3. **Guideline 3.1.2 paywall disclosure** — price, billing period and auto-renewal terms on the same screen as the purchase button, plus restored paid copy in `APP_STORE_LISTING.md` §5 and UI that keeps the paywall visually distinct from affiliate checkout. — *Precondition: the Selv+ launch.* Shipping any one of these without the others is what gets a build rejected.
4. **RevenueCat subscriber deletion + Sign in with Apple token revocation in `delete-account`.** Both are specced in `DATA_HANDLING.md` §3.2 step 4 and both are correctly absent from the code today: there is no RevenueCat, and auth is email OTP only, so there is no Apple refresh token to revoke. — *Precondition: either Sign in with Apple or a paid tier.* Apple's own account-deletion FAQ makes token revocation an explicit requirement, so this lands in the same change as SIWA.
5. **Background-removal vendor DPA (remove.bg).** — *Precondition: a background-removal step is actually integrated.* It is not: no dependency, no `garment-ingest` function; garments are stored as uploaded photos. Keep the `[VERIFY]` in `DATA_HANDLING.md` §2c pending, and **make sure the privacy policy does not disclose a processor the app does not use** — today it does (§0 item 4).
6. **Phase 2 moderation plan and likeness-escalation path** — reaction-based feedback, reporting/block, a defined SLA (Guideline 1.2 expects reported UGC to be acted on quickly once a feed exists). — *Precondition: the social feed.* Drafting it pre-launch avoids a scramble; it also determines whether the age rating stays 13+ or goes to 16+ (`APP_STORE_LISTING.md` §7).

---

## §4. 🔒 Blocked — cannot be decided in this session

**1. Crash reporting vendor selection** (`LAUNCH_CHECKLIST.md` §3 marks this 🔴)
**2. Analytics vendor selection** (§3, 🟡)

Both are genuinely unwired — `app/package.json` contains no crash SDK and no analytics SDK, verified.

**Why they are blocked rather than done:** this repo's `CLAUDE.md` requires searching the obsidian-mind vault (the `om` MCP server) *before proposing any dependency*, because the vault holds prior decisions, rejected approaches and business constraints recorded nowhere in this codebase — and it explicitly forbids implementing an approach the vault records as rejected. **That server is not connected in this session,** so a vendor choice could not be validated against the record. Picking Sentry or PostHog here would be exactly the guess the instruction exists to prevent; a vendor the vault already rejected is worse than no vendor, because it is a dependency plus a rollback.

**To unblock:** connect the `om` MCP server and search the vault for prior crash-reporting and analytics decisions before adding either dependency.

**What attaches the moment either one lands** — none of this is optional afterwards:
- Re-run item §1.17. A vendor SDK on Apple's commonly-used list without a `PrivacyInfo.xcprivacy` manifest is an **automatic binary-validation rejection**.
- Update the App Privacy answers: **Diagnostics → Crash Data** and **Identifiers → Device ID** move off "No" (§6).
- Fill the two vendor `[TBD]`s in `PRIVACY_POLICY.md` §86–87 — a named processor in the policy must match the one in the binary, in both directions.
- Configure PII scrubbing per `DATA_HANDLING.md` §2c: no photo URLs, no free-text garment/outfit names, no height/weight values in event payloads or crash breadcrumbs.
- Get the vendor DPA on file.

**Interim mitigation, since crash reporting is 🔴 and shipping blind on a 3D render path is a real reliability risk:** Xcode Organizer surfaces App Store crash reports for TestFlight and production builds with no SDK and no dependency decision. It is far worse than a real crash reporter — no breadcrumbs, no user context, delayed — but it is not nothing, and it needs no vault decision. Use it to cover the gap, and pair it with item §2.4 (real-device render testing) rather than treating either as a substitute for the other.

---

## §5. 🔴 In-repo blockers found this pass that I could not fix

These are code/config, not hand-off — but they are blocking and nobody else has flagged them, so they are recorded here. **File ownership in this session prevented me from touching `app/app.json` or `app/src/`;** another agent is actively editing that tree.

**1. The iOS permission purpose strings in `app/app.json` do not match `APP_STORE_LISTING.md` §8.**
`LAUNCH_CHECKLIST.md` §3 lists this as 🔴: *"Camera/photo-library permission purpose strings implemented exactly as specified in `APP_STORE_LISTING.md` §8 — including the 'never used to scan your face or body' clause."*

What `app.json` actually ships, via the `expo-image-picker` plugin:
> `"cameraPermission": "Allow Selv to access your camera so you can photograph garments."`
> `"photosPermission": "Allow Selv to access your photos so you can add garment images."`

What §8 specifies:
> `"NSCameraUsageDescription": "Selv uses your camera to photograph your clothes so we can turn them into 3D wardrobe items. Your avatar is designed in our character creator — the camera is never used to scan your face or body."`

The shipped strings are generic, and — more importantly — the "never used to scan your face or body" clause is **missing**. That clause is the single sentence that pre-empts a reviewer's question about why an avatar app wants the camera, it is now literally true after the pivot, and `MARKETING_STRATEGY.md` §11 leans on it. Vague purpose strings are a documented Guideline 5.1.1 rejection path.
**Fix:** move the §8 strings into `app.json` — either as `ios.infoPlist` keys or as the plugin's `cameraPermission` / `photosPermission` / `savePhotosPermission` values. Verify after `expo prebuild` that they reach `Info.plist` verbatim.

**2. `app/supabase/functions/README.md` overstates deletion coverage.**
It says `delete-account` *"de-identifies `affiliate_clicks` / `affiliate_conversions` / **`product_try_ons`** by nulling user_id."* The code's `DE_IDENTIFY_TABLES` is only the first two, and its own comment explains at length why `product_try_ons` cannot be de-identified (`user_id` is `NOT NULL … on delete cascade`) and is destroyed instead. The README is the doc a reviewer or a partner would be shown; correct it to match the code.

---

## §6. App Privacy answer key — re-derived from the code

Fill this into App Store Connect → App Privacy. "Linked" = tied to the user's identity. "Tracking" = linked with third-party data for ad targeting — **Selv does none of this**, so every Tracking answer is No.

⚠️ = this row disagrees with `legal/DATA_HANDLING.md` §4. Where they disagree, the code wins; the ones marked **counsel** are judgement calls, not facts.

| Apple category | Answer | Linked | Evidence in the code | vs. `DATA_HANDLING.md` §4 |
|---|---|---|---|---|
| Contact Info → Name | **Yes** | Yes | `profiles.display_name`, optional | agrees |
| Contact Info → Email | **Yes** | Yes | `auth.users` (email OTP is the *only* sign-in — `src/lib/api/auth.ts`), **plus `waitlist_signups.email`**, a second user-supplied address held as a marketing-consent record | ⚠️ agrees on the answer; the waitlist address is undisclosed in the privacy policy and needs its own line |
| Health & Fitness → Health | **counsel** | — | `profiles.height_cm` / `weight_kg` are collected through a real UI (`ProfileScreen.tsx`, unit toggle, 90–250 cm / 30–300 kg validation) and **`buildWidthScale()` derives a BMI** from them to scale body silhouettes (`features/avatar/avatars.tsx:27`) | ⚠️ §4 answers **No** on the grounds that they are "not used to generate the avatar." That reasoning does not survive contact with the Profile screen. Re-derive with counsel. |
| Health & Fitness → Fitness | **No** | — | no motion, exercise or Fitness API data | agrees |
| Financial Info → Payment Info | **No** | — | no payment surface in the app at all | agrees |
| Location (precise/coarse) | **No** | — | no location feature | agrees |
| Sensitive Info | **No** | — | avatar is preset selections only; no photo, no scan, no facial recognition | agrees — and this justification **does** hold. Re-declare as Yes if a photo/scan avatar option ever ships. |
| Contacts | **No** | — | no contact sync | agrees |
| User Content → Photos or Videos | **Yes** | Yes | garment photos in the private `garments` bucket. Clothes, never the user's face or body | agrees |
| User Content → Other | **Yes** | Yes | garment names/brand/colour/tags, outfit names | agrees |
| Browsing History | **No** | — | n/a | agrees |
| Search History | **No** | — | **resolved.** `searchProducts()` (`src/lib/api/shop.ts:140`) passes the term to `.textSearch("search_tsv", …)` on a live query. Nothing persists it, so it is not "collected" under Apple's *stored longer than needed to service the request* definition | ⚠️ §4 leaves this as *"Depends on implementation — engineering decision needed."* It is decided; the code does not persist queries. |
| Identifiers → User ID | **Yes** | Yes | `auth.users.id` throughout | agrees |
| Identifiers → Device ID | **No** | — | no analytics SDK; nothing collects a device identifier | ⚠️ §4 says *Pending*. Today the answer is No. Re-check when §4's vendor lands. |
| Purchases → Purchase History | **Yes** | Yes | **not IAP** — `affiliate_conversions` stores `order_total_cents`, `network_order_id`, `product_id` against `user_id`; the user reads their own rows via the `"own affiliate conversions select"` policy and the app surfaces them (`src/features/orders/`) | ⚠️ §4 says Yes *"via RevenueCat"*. There is no RevenueCat. Right answer, wrong justification — rewrite it to the affiliate ledger before an interview question exposes the gap. |
| Usage Data → Product Interaction | **Yes** | Yes | **live today, server-side, no SDK involved:** `product_try_ons` (every try-on, timestamped, per user), `wishlist_items` (every save), `affiliate_clicks` (every Buy tap **plus which app surface** — the `click_source` enum), `waitlist_signups.source` (which paywall) | ⚠️ §4 says *Pending (planned)*. **This is the most likely under-declaration on the whole form.** |
| Usage Data → Advertising Data | **No** | — | no ad network, no attribution SDK | n/a |
| Diagnostics → Crash / Performance | **No** | — | no crash SDK (§4 of this file) | ⚠️ §4 says *Pending*. Today: No. Flips the day a vendor lands. |
| Surroundings | **No** | — | no AR environment scanning | agrees |
| Body → Hands / Head | **No** | — | no ARKit body/hand tracking, no camera-based body scanning | agrees |
| Other Data | **No** | — | n/a | agrees |

**Two things counsel must see alongside this table**, because they are what turns a green form into a defensible one:

1. **The privacy policy discloses none of the affiliate data flow.** Not the `click_token` subid handed to a retailer, not the conversion records posted back, not the retention of de-identified click/conversion rows after account deletion, not the waitlist email. Four rows above depend on data the policy is silent about. Fix the policy, then answer the form.
2. **The policy names two processors that do not exist** (remove.bg, RevenueCat) and **omits the ones that do** (partner brands and their affiliate networks — `direct`, `rakuten`, `cj`, `impact`, `shopstyle`, `awin` — receive a click token that is later joined back to a user). Over-declaring a processor is not "safely conservative": it is an inaccurate disclosure in the same way under-declaring is.

---

## §7. Suggested order of operations

Nothing here is on a critical path except by dependency, so start the long-lead items first.

**Week 1 — start the things that wait on other people**
Apple Developer enrollment + app record (§1.1) · engage the attorney with both legal docs and §0 (§1.2) · attorney/TESS trademark search with the Selve question (§2.1) · WHOIS + handle check, 2 minutes (§2.1) · request the Supabase DPA (§2.3).

**Week 1, same week — the backend proof, because it can invalidate everything else**
Apply migrations (§1.5) · run scripts 01–03 (§1.6–8) · confirm backups + record the retention number (§1.10) · read the hosting region (§1.11) · check Edge Function secrets (§1.12). If script 01 or 04 fails, the launch date moves; find that out first, not last.

**Week 2 — device work**
Account-deletion end-to-end, all four phases (§1.9) · character-creator fidelity pass, ~450 renders (§1.20) · low/mid-range render performance (§2.4) · capture the screenshot set once the creator pass is clean, since the screenshots inherit its output (§1.18).

**Week 3 — assemble the submission**
Publish the policy and terms once counsel returns them (§1.3, §1.4) · App Privacy from §6 (§1.13) · age rating, with the BMI answer re-derived (§1.14) · declare no IAP (§1.15) · encryption key + Xcode privacy report (§1.16, §1.17) · listing metadata and review notes (§1.19) · **arrange reviewer access for the passwordless sign-in** (§1.19 ⚠️).

**Before you tap Submit:**
- [ ] Every 🔴 in §1 closed
- [ ] Scripts 01–04 all report ✅ with 0 FAIL rows
- [ ] `[TBD]` returns nothing in `legal/`
- [ ] Both published URLs load and are pasted into App Store Connect
- [ ] §5's permission strings fixed and verified in the built `Info.plist`
- [ ] A reviewer can actually sign in

---

## §8. Tally

| | Count | Where |
|---|---|---|
| 🔴 Blocking, off-machine | **19** | §1 (items 1–20; item 16 is already satisfied in config and only needs confirming) |
| 🔴 Blocking, in-repo, not mine to fix | **2** | §5 |
| 🟡 Non-blocking | **9** | §2 |
| ⏸️ Deferred | **6** | §3 |
| 🔒 Blocked on the vault | **2** | §4 |

**Promoted from the checklist's severity:** §1.11 (hosting region) 🟡 → 🔴, because a `[TBD]` in the privacy policy blocks publishing it, and publishing it blocks submission. The diligence is optional; the placeholder is not.

**Demoted / closed:** `ITSAppUsesNonExemptEncryption` is already set in `app/app.json` (§1.16 is confirmation, not work). `PrivacyInfo.xcprivacy` (§1.17) is conditionally satisfied — no listed third-party SDK ships today — but still needs the Xcode report read, and flips back the day §4's vendor lands.

**The three items most likely to actually cost you a rejection**, in order: **§1.9** (account deletion — the most common 2026 rejection reason, and the one where a silent partial failure looks identical to success), **§1.13** (App Privacy, because §0 shows the current answer key is wrong in both directions), and **§1.19**'s passwordless sign-in note (a reviewer who cannot log in files a rejection, not a support ticket).

---

## §9. Doc ↔ code discrepancy register

Everything found this pass, including the items already used above. Each one is a place a planning doc would lead you to a wrong answer.

**Would change an Apple answer:**

1. **`DATA_HANDLING.md` §4 / `APP_STORE_LISTING.md` §7 / `PRIVACY_POLICY.md` §2 — "height/weight have no bearing on the avatar."** False for the Profile screen: `buildWidthScale()` derives a BMI and scales body silhouettes. Affects the Health declaration and the age-rating medical answer.
2. **`DATA_HANDLING.md` §4 — "Usage Data → Product Interaction: Pending (planned)."** Already collected server-side by four tables. Under-declaration.
3. **`DATA_HANDLING.md` §4 — "Purchases → Purchase History: Yes, via RevenueCat."** No RevenueCat exists; the real basis is `affiliate_conversions`.
4. **`DATA_HANDLING.md` §4 — "Search History: depends on implementation."** Decided by the code: `searchProducts()` does not persist queries. Answer No.
5. **`DATA_HANDLING.md` §4 — "Identifiers → Device ID / Diagnostics: Pending."** Today both are No; no SDK collects either.
6. **`PRIVACY_POLICY.md` §2, §6 — remove.bg and RevenueCat named as processors.** Neither is a dependency. Over-declaration.
7. **`PRIVACY_POLICY.md` §2 — "hashed password (or Sign in with Apple / Google identity token)."** Auth is email OTP only; there is no password and no OAuth provider.
8. **`PRIVACY_POLICY.md` — no mention of the affiliate flow, the waitlist email, wishlist or try-on records.** Silent on data that is collected and, in the case of the click/conversion rows, deliberately retained past account deletion.

**Data-map errors (fix before the policy is published against the map):**

9. **`DATA_HANDLING.md` §2a — `profiles` listed with `skin_tone`.** It has none. Its real columns are `display_name`, `body_type`, `height_cm`, `weight_kg`, `build`, and now `birth_year` / `age_verified_on`. The map lists a column that does not exist and **omits the two body-measurement columns that do** — which is the same mistake as item 1, in the table this time.
10. **`DATA_HANDLING.md` §2a — `outfits` listed with `thumbnail_path`.** No such column: `outfits` is `id`, `user_id`, `name`, `created_at`.
11. **`DATA_HANDLING.md` §2a — `outfit_items` listed with `catalog_item_id` and `slot`.** Real columns are `outfit_id`, `garment_id`, `layer_order`, `x`, `y`, `scale`, `rotation`.
12. **`DATA_HANDLING.md` §2a — `catalog_items` table.** Does not exist. The catalog is `brands` + `brand_products`.
13. **`DATA_HANDLING.md` §2a — `garment_templates` listed with `size_bucket` / `mesh_path`.** Real columns: `category`, `name`, `glb_path`, `default_texture_path`, `is_active`.
14. **`DATA_HANDLING.md` §2a omits eight live tables entirely:** `wishlist_items`, `product_try_ons`, `affiliate_clicks`, `affiliate_conversions`, `waitlist_signups`, `brands`, `brand_products`, `brand_api_keys`. Five of those hold user-linked personal data. A data map that omits them cannot support the privacy policy built on top of it.
15. **`DATA_HANDLING.md` §2b — `garment-templates` and `catalog` storage buckets.** Neither is created by `schema.sql`; only `garments` is. Script `03` reports their live status.
16. **`DATA_HANDLING.md` §3.1 — "re-enter password" as a deletion confirmation option.** There are no passwords.
17. **`DATA_HANDLING.md` §3.2 step 6 — `deletion_audit` table with a hashed user id.** Specced, not implemented; the function writes console logs. Non-blocking, but either build it or drop the claim.

**Documentation vs. code:**

18. **`app/supabase/functions/README.md`** says `product_try_ons` is de-identified. It is deleted. (§5.2)
19. **`app/app.json`** permission strings do not match `APP_STORE_LISTING.md` §8. (§5.1)
20. **`APP_DIAGNOSIS.md`** is correctly marked a historical snapshot and its self-correction is accurate — with one exception: it states height/weight *"no longer drive the avatar's shape."* True of the try-on avatar, not of the Profile screen's `BuildPicker` silhouettes. Same root as item 1.
21. **`LAUNCH_CHECKLIST.md` §3** notes that `DATA_HANDLING.md` §1 needs updating to match the pivot. Still true, and items 9–17 above are the specific list.

**Observations, non-blocking, recorded so nobody re-derives them:**

22. **`outfit_items`' `with check` constrains `outfit_id` only, not `garment_id`.** A user can attach another user's garment id to their own outfit. Nothing is disclosed — reading the outfit still joins `garments`, where RLS hides the row — so the cost is a uuid-v4 existence oracle, which is not an attack anyone can mount. Script `01` §7b records it with the tightening expression if you ever want it closed. **Do not block a launch on this.**
23. **`authenticated` still holds the raw `INSERT` privilege on `affiliate_clicks` / `affiliate_conversions`;** RLS is the only gate. Sufficient, and proven sufficient by script `02` — but the repo already uses belt-and-braces `revoke`/`grant` on `waitlist_signups` and on the age columns, and the same pattern here costs nothing. Script `02` §7 prints the exact revokes. **INFO, not a blocker.**
24. **`schema.sql`'s `waitlist_signups.email` comment reasons at length about Apple private-relay addresses.** Sound forward-looking design, but Sign in with Apple is not wired today, so the scenario it mitigates cannot currently occur. Not a defect — just do not read it as evidence that SIWA ships.

---

## §10. What is already in this repo that you do not have to rebuild

| Need | Already written |
|---|---|
| RLS proof for 10 tables + waitlist + age gate | `app/supabase/verification/01_rls_two_account_audit.sql` |
| Affiliate write-path lockdown proof | `app/supabase/verification/02_affiliate_write_path_audit.sql` |
| Storage policy proof + DDL for the two future buckets | `app/supabase/verification/03_storage_policy_audit.sql` |
| Account-deletion end-to-end proof | `app/supabase/verification/04_account_deletion_verification.sql` |
| How to run all four, and the two failure shapes RLS has | `app/supabase/verification/README.md` |
| Listing copy, all length-checked | `APP_STORE_LISTING.md` §1–§6 |
| Screenshot plan with headline copy | `APP_STORE_LISTING.md` §9 |
| Age-rating rationale (one answer needs re-deriving — §1.14) | `APP_STORE_LISTING.md` §7 |
| Permission purpose strings (not yet in `app.json` — §5.1) | `APP_STORE_LISTING.md` §8 |
| Privacy policy draft + every `[TBD]` marked | `legal/PRIVACY_POLICY.md` |
| Terms of Use draft + every `[TBD]` marked | `legal/TERMS_OF_USE.md` |
| Engineering data map (see §9 items 9–17 before trusting it) | `legal/DATA_HANDLING.md` |
| Trademark position and the Selve question | `SELV_VERIFICATION.md` |
| App Review notes, paste-ready | §1.19 of this file |
| App Privacy answer key, re-derived from code | §6 of this file |
| Character-creator QA plan and the real combinatorics | §1.20 of this file |

**Work in flight this session by other agents** — described as in-flight because I could not verify completion: the 13+ age gate (`app/supabase/migrations/006_age_gate.sql`, `app/src/features/age/`, `legal/TERMS_OF_USE.md` all appeared in the tree during this pass), ESLint config and CI workflows (`app/eslint.config.js`, `.github/workflows/`), and Trust & Safety copy/validation fixes. Re-check `LAUNCH_CHECKLIST.md` against the tree before working from any item this file marks as depending on them.
