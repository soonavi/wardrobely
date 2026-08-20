> ## ⚠️ NOT LEGAL ADVICE
> This document was drafted by an AI assistant researching current (2025–2026) Apple App Store, GDPR, and CCPA/CPRA requirements as a **first-draft starting point**, not a finished legal instrument. **Have a qualified privacy attorney (ideally one familiar with app-based businesses processing photos/biometric-adjacent data and EU/UK/California users) review and revise this before it is published, linked from the App Store listing, or shown to a single real user.** Placeholder fields (entity name, jurisdiction, contact addresses, hosting region) are marked `[TBD]` and must be filled in before publishing.

> ### 📋 Reconciliation note — 2026-08-20
> **This draft was reconciled line-by-line against the shipped v1 code on 2026-08-20** (`app/supabase/schema.sql`, `app/supabase/migrations/002`–`006`, `app/src/lib/api/*.ts`, `app/supabase/functions/*`). Before that pass it described a materially different app. Three classes of correction were made:
>
> 1. **Over-declaration removed.** The previous draft named **remove.bg** and **RevenueCat** as active third-party processors and described password/Sign-in-with-Apple/Google authentication and Selv+ subscription billing. **None of those exist in this build.** A published policy naming a processor that receives nothing is a factual misstatement to users, and it is a filing risk in the same way an omission is.
> 2. **Under-declaration corrected.** The previous draft was **silent** on the affiliate click/conversion flow, the Selv+ waitlist email, the wishlist, and product try-on records — all of which are live, server-side, and linked to the user. Those are now disclosed (§2, §6a, §8, §10).
> 3. **One factual correction with filing consequences.** The previous draft said optional height/weight "no longer drive the avatar's shape at all." **That is false for the Profile screen** — see §4, which now states the real behaviour and flags the open Health & Fitness question for counsel rather than resolving it.
>
> `[TBD]` markers below are facts only counsel or the founder can supply; none has been guessed at. The engineering-facing map this policy is built on is `legal/DATA_HANDLING.md`, reconciled in the same pass. Read the two together. Companion document: `legal/TERMS_OF_USE.md`.

---

# Selv Privacy Policy

**Effective date:** [TBD — set at publish] · **Last updated:** August 20, 2026 (reconciled against the shipped v1 build — see the reconciliation note above; the substantive changes are in §2, §4, §6, §6a, §8, §10 and §12)
**App:** Selv (working name — see naming note in `MARKETING_STRATEGY.md`; this policy will need a find-and-replace pass once the name is finalized)
**Company:** [Legal entity name, TBD] ("**we**," "**us**," "**Selv**")

---

## Our Promise (read this part even if you skip everything else)

- **We never use your photos or body measurements to train AI/ML models** — not ours, not a third party's, ever.
- **We never sell your photos, measurements, or any personal data.** Full stop — no data brokers, no ad exchanges.
- **Your garment photos never leave our own storage.** They go from your device straight into a private storage bucket that only your account can read. No third-party image service ever receives them.
- **We do not keep your date of birth.** We ask for it once to check you are 13 or older, run the check, and keep only the *year* you were born and the *date we checked* — never the full date (§12).
- **You can delete your account from inside the app, at any time** — Profile → Delete account, one confirmation. No phone calls, no "please email us to confirm," no guilt trips. That removes your profile, your character, any optional height/weight, every garment photo, every outfit, your wishlist, your try-on history and your waitlist signup (§10). Copies already written to encrypted backups are purged on the schedule in §8 rather than instantly, and a narrow category of **de-identified** retailer-purchase records survives with your identity stripped out — §6a and §10 explain exactly which, and why.
- Your body is not the product here. The avatar is a styling tool, not a grading tool — we don't score, rank, or rate bodies, and neither should anyone using this app.

These commitments are legally binding parts of this policy, not marketing copy — see [How to Delete Your Data](#10-how-to-delete-your-data) and [What We Never Do](#7-what-we-never-do-with-your-data) below.

---

## 1. Who this policy covers

This policy applies to anyone who uses the Selv iOS app (and, later, Android). It explains what we collect, why, where it lives, who else touches it, and — most importantly — how you stay in control of it.

It also covers the **Shop** tab, where tapping "Buy" hands you off to a third-party retailer's own website. What happens on our side of that handoff is described in §6a; what happens on the retailer's side is governed by *their* privacy policy, not this one.

## 2. Information We Collect

| Category | Examples | Where it comes from |
|---|---|---|
| **Account info** | Your email address, and the one-time sign-in codes we send to it. **There is no password**, and no Sign in with Apple, Google or other social login in this version — sign-in is a six-digit code emailed to you each time. | You, at signup and at each sign-in |
| **Display name (optional)** | A name you choose to show in the app | You, optionally, in your profile |
| **Age-check record** | The **year** you were born and the **date** we confirmed you were 13+. We ask for your full date of birth to run that check and then discard it — we never store it (§12). | You, at signup |
| **Avatar customization** | The appearance choices you make in the character creator — skin tone, face shape, eyes, hair, eyebrows, facial hair, body type, accessories (all preset options you pick, not derived from you) | You, while designing your character |
| **Height & weight (optional)** | Height and weight, only if you choose to enter them. **Read §4 before assuming these are inert:** they are optional and are not used to build your 3D try-on character, but if you enter them the app derives a body-mass index from them on your device and uses it to widen or narrow the flat body silhouette shown on your Profile screen. | You, optionally, in your profile |
| **Build** | A general build you pick from five presets (slim, average, athletic, curvy, broad) | You, in your profile |
| **Garment photos** | Photos of clothes you own, taken to digitize them into your wardrobe. **We do not collect a photo of your face or body for the avatar** — see the note below the table. | You, via camera or photo library |
| **Garment metadata** | Name, color, brand, category, tags you assign to a garment | You |
| **Outfit data** | Saved outfit names, which garments are in them, and how you positioned and layered each one | Generated as you use the outfit builder |
| **Wishlist** | Which shop products you saved for later | You, when you tap save on a product |
| **Try-on records** | Which shop products you placed on your character, and when | Automatically, each time you try a product on |
| **Shopping click records** | Each time you tap "Buy": which product, which brand, which screen of the app you tapped from, the price and commission rate at that moment, and a random tracking token. See §6a. | Automatically, at the moment you leave for the retailer |
| **Retailer purchase reports** | If a purchase you made at a retailer is reported back to us: the retailer's order number, order total, currency, which product, and the status of the order. **We never see or receive your card number, billing address, or anything else you typed on the retailer's site.** See §6a. | The retailer or its affiliate network, after you buy |
| **Selv+ waitlist** | If you join the Selv+ waitlist: an email address you give us (which may differ from your sign-in address) and which in-app limit you had reached when you joined | You, if you choose to join |
| **Device/technical data** | IP address, device type, OS version, and similar request metadata, held in our hosting provider's server logs | Automatically, for security and to make the app work |

**Avatar privacy note:** your avatar is entirely user-authored — you pick from preset options (skin tone, face shape, eyes, hair, brows, facial hair, body type, accessories) in a character creator. We never ask for, or process, a photo or scan of your face or body to build it, and we don't require body measurements to build it either.

**Analytics and crash reporting:** as of the date above, **no analytics SDK and no crash-reporting SDK are integrated into the app.** We do not collect screen-view or tap telemetry through a third-party vendor, and we do not collect an advertising or device identifier. The interaction records we *do* hold are the wishlist, try-on and shopping-click rows named in the table above — those are collected by our own backend as a direct result of you using the feature, not by an SDK watching you. If we later add an analytics or crash vendor, we will update this policy and §6 before that vendor ships.

**Selv+ subscriptions — not applicable to this version.** This version of Selv sells nothing. There is no in-app purchase, no subscription, and no payment flow, so we hold no subscription status, no purchase receipts and no payment information of any kind. Reaching the free wardrobe limit opens a waitlist, which is free and is not a purchase (`TERMS_OF_USE.md` §10). If Selv+ ever becomes purchasable, the payment data description will be added here in the same change that makes it possible.

We do **not** collect your precise location, your contacts, your browsing history outside the app, or payment card details.

## 3. Why We Collect It, and Our Legal Basis

| Purpose | What it uses | Legal basis (GDPR Art. 6) |
|---|---|---|
| Create and secure your account | Email address, one-time sign-in codes | Performance of a contract (you asked us to create an account) |
| Confirm you are old enough to use Selv | Your date of birth at signup (checked, then discarded), and the resulting birth year + check date | Legal obligation / legitimate interest in not operating a service for children under 13 (§12) |
| Build your 3D character | Your character-creator selections (skin tone, face shape, eyes, hair, brows, facial hair, body type, accessories) | Performance of a contract / your explicit action (you pick these to get the feature) |
| Show a body silhouette on your Profile that roughly matches you | Your build, plus optional height/weight if you entered them (§4) | Consent / your explicit action — these fields are optional and the app works without them |
| Digitize and display your wardrobe | Garment photos, metadata | Performance of a contract |
| Try-before-you-buy rendering | Shop product + your character | Performance of a contract |
| Remember what you saved and what you tried on | Wishlist rows, try-on records | Performance of a contract (the features are "save this" and "show me what I tried") |
| Get paid a commission when you buy from a retailer we linked you to, and be able to substantiate that commission if the retailer disputes it | Shopping click records, retailer purchase reports (§6a) | Legitimate interest (running the business that makes the app free) — and, for the records that outlive your account, our legitimate interest in accurate financial records, balanced by removing your identity from them |
| Tell you when Selv+ opens | The email address you gave on the waitlist | Consent — opt-in, and you can ask us to remove you at any time |
| Keep the app secure and working | Device/technical data in server logs | Legitimate interest (security, reliability) — narrowly scoped, doesn't override your rights |
| Send you service emails (sign-in codes, account notices) | Email address | Performance of a contract |
| Send you marketing emails | Email address | Consent — opt-in, unsubscribe any time |

We deliberately did **not** design any feature that requires "special category" data under GDPR Art. 9 (e.g., biometric identification data) as a matter of course. **See §4 for the one place where that conclusion is not clean** — the optional height/weight fields — and for the open question we have flagged for our lawyers rather than answered ourselves. Background: [GDPR Art. 9 — special categories of personal data](https://gdpr-info.eu/art-9-gdpr/); per GDPR Recital 51, ordinary photographs are not automatically "biometric data" — they only become special-category data when processed through technical means specifically to uniquely identify someone (e.g., facial recognition). We do not run your photos through any identification or facial-recognition process.

## 4. Is your avatar "biometric" or "health" data?

Short answer: **the avatar is not, and that part is simpler than it used to be. The optional height and weight fields are a genuinely open question, and we are not going to pretend otherwise.**

Your 3D try-on character is built entirely from preset choices you pick in a character creator (skin tone, face shape, eyes, hair, brows, facial hair, body type, accessories) — never from a photo or scan of you, and never from body measurements.

- **Avatar customization choices (skin tone, face shape, hair, eyes, etc.):** these are ordinary personal data — a record of which preset options you selected, no different in kind from picking a font or a theme color. They are not biometric data under GDPR (biometric data requires "specific technical processing" of a physical, physiological, or behavioral characteristic for unique identification — see [ICO guidance on special category data](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/special-category-data/what-is-special-category-data/)), and they aren't derived from any photo, scan, or measurement of your actual body or face.

- **Height/weight (optional) — corrected 2026-08-20.** An earlier draft of this policy said these fields "no longer drive the avatar's shape at all." **That was accurate for the 3D try-on character and inaccurate for the Profile screen, and we are correcting it rather than leaving it.** What actually happens: the fields are optional, you can use Selv without ever entering them, and they are not sent to any third party. If you do enter them, the app computes a **body-mass index** from them and uses it as a horizontal scale factor — clamped to a narrow range — on the flat body silhouettes shown in the build picker on your Profile screen. So they are typed-in numbers, stored as typed-in numbers, and also used to size a picture of a body.

  We do not measure you, estimate you from a photo, score you, rank you, or tell you anything about the resulting number. You are never shown a BMI, a category, a target, or a comparison, and nothing in the app treats one value as better than another. The calculation happens on your device, for rendering, and the result is not stored.

  `[TBD — counsel to determine and record here: (a) whether self-reported height and weight, used to derive a BMI that scales a rendered silhouette, constitute "health data" under GDPR Art. 9 and/or "sensitive personal information" under CCPA/CPRA; (b) the corresponding answer to Apple's App Privacy "Health & Fitness → Health" question; and (c) the corresponding answer to the medical/wellness section of Apple's age-rating questionnaire. Do not answer any of the three from the pre-2026-08-20 wording of this section, which was factually wrong. Engineering references: buildWidthScale() at app/src/features/avatar/avatars.tsx:27, consumed at app/src/features/profile/ProfileScreen.tsx:73.]`

- **Photos:** the only photos we collect are **photos of your clothes**, to digitize them into your wardrobe (see §2). We do not collect a photo of your face or body for the avatar, and we do not run face recognition or body-shape estimation on any photo. If a future version ever introduced a photo-based avatar option, we'd update this policy and ask for separate, explicit, opt-in consent first (see §11).

- **Under CCPA/CPRA**, biometric information is one of the enumerated categories of "sensitive personal information" (see [CCPA/CPRA and biometric data — TermsFeed](https://www.termsfeed.com/blog/ccpa-biometrics/)). Nothing we collect **for the avatar** meets that definition. The height/weight question above is separate and is part of the same `[TBD]`. Regardless of category, we extend CCPA-style deletion and limit-use rights to **all** users, everywhere (see §9).

## 5. Where Your Data Lives

Your data is stored in **Supabase** (Postgres database + file storage), hosted on [TBD — confirm final region, e.g., AWS us-east-1] at launch. If you are in the EU/UK/EEA, this means your data may be transferred outside your region; where required, we rely on Standard Contractual Clauses or an equivalent safeguard with our hosting provider. See §14 for more on international transfers.

Your garment photos are held in a **private** storage bucket, partitioned by user, that is readable only by your own signed-in account. They are not on a public URL, and the app fetches them through short-lived signed links.

## 6. Who Else Sees Your Data (Third-Party Processors)

We use a small number of vetted vendors ("processors") to run the app. We do not let any of them use your data for their own purposes (like training their own models or advertising).

| Vendor | What they receive | Why |
|---|---|---|
| **[Supabase](https://supabase.com/privacy)** | Everything in §2 — it's our database, authentication and file-storage provider, and it sends your one-time sign-in codes | Hosting our entire backend |
| **Partner retailers and their affiliate networks** (currently: direct partners, Rakuten, CJ, Impact, ShopStyle, Awin) | A random tracking token, and nothing else about you, when you tap "Buy". They send back an order report if you buy. **See §6a — this is the one that needs reading.** | Getting you to the retailer's product page, and getting us paid a commission if you buy |

**Vendors that a previous version of this policy named, and that we do not use.** We are listing them explicitly because the earlier draft was wrong and someone may have read it:

| Previously named | Actual status |
|---|---|
| **remove.bg** (background removal) | **Not used. Never integrated.** No third-party image-processing service receives your garment photos. Your photos go from your device directly into our own private storage. |
| **RevenueCat** (subscription management) | **Not used. Not a dependency of this app.** There is no subscription to manage. |
| **Apple (StoreKit / App Store billing)** | **Not applicable to this version.** Selv sells nothing in-app, so no purchase event, entitlement or payment token is created or received. Apple of course knows you downloaded the app, under Apple's own privacy policy. If Selv+ ever becomes purchasable, this row changes in the same release that makes it possible. |
| **Analytics vendor** | **Not integrated.** No analytics SDK ships in this build. If one is added, it will be named here before it ships, and it will be configured never to receive photos, height/weight values, or free-text garment and outfit names. |
| **Crash-reporting vendor** | **Not integrated.** No crash-reporting SDK ships in this build. Same commitment as above. |

We do not use social-media login SDKs, ad networks, or data brokers. If that ever changes, we will update this policy and, where required, ask for your consent first.

## 6a. When you tap "Buy" — retailers, affiliate links, and commissions

Selv is free because it earns an affiliate commission when you buy something from a retailer we linked you to. This section describes that flow completely, because it is the part of Selv that involves other companies.

**What leaves Selv when you tap "Buy."** We generate a random tracking token — a string with no meaning outside our own database — and put it in the link that opens the retailer's product page. **That token is all we attach.** We do not send the retailer your name, your email address, your age, your height or weight, your wardrobe, your photos, or your Selv user ID. The retailer sees an ordinary visitor arriving from an affiliate link, plus whatever their own site and their own cookies collect about that visit, under **their** privacy policy and not ours. Once you are on their site, you are their customer and we cannot see what you do there.

**What we record on our side, at that moment.** One row: which product, which brand, which screen of the app you tapped from, the product's price and our commission rate as they stood at that second, the tracking token, the time, and your user ID. The price and rate are snapshotted because a commission has to be valued at the terms it was earned under, even if they change later.

**What comes back, if you buy.** The retailer or its affiliate network sends us a server-to-server report containing the tracking token, their own order number, the order total, the currency, the product, and the order's status (pending, approved, reversed, paid). We match the token to your click and record the commission. **We never receive your payment card number, your billing or shipping address, your name as given to the retailer, or the rest of your basket.** The app shows you these records under Orders so you can see what we were told about your purchases — they are our view of your order, not a receipt, and they can lag or, if a network drops the token, never arrive at all.

**Why some of this outlives your account.** A conversion record is money a brand owes us, and the click record is the evidence backing that invoice. If deleting an account also deleted those, a partner could dispute a bill we could no longer substantiate and our own revenue history would silently change. So when you delete your account, we **de-identify** these two record types instead of deleting them: your user ID is set to null, permanently and irreversibly, and what remains is a commercial record with no link to you — indistinguishable from an order we were never able to attribute to anyone. **Everything else about you is deleted** (§10). Your try-on records, by contrast, are *not* de-identified — they are destroyed outright with your account.

**No ad targeting, ever.** We do not use any of this to target advertising, we do not combine it with data from other companies to profile you, and we do not run an ad network or an attribution SDK. The affiliate networks named in §6 are paid-referral plumbing, not adtech, and they receive a token rather than an identity.

**Brand-side credentials.** Retailers push their catalogs to us and report orders using their own API keys. Those are the brand's credentials, not yours, and they are stored hashed.

## 7. What We Never Do With Your Data

- We never sell, rent, or trade your personal data, photos, or measurements to anyone.
- We never use your photos or body measurements as training data for any AI/ML model — internal or third-party.
- We never share your photos or measurements with advertisers or data brokers.
- We never send your garment photos to a third-party image-processing service. They go from your device to our own private storage and stay there.
- We never run facial recognition or any identity-matching process on your photos in the current version of the app.
- We never tell a retailer who you are. They get a random token (§6a).
- We never use your shopping activity to target ads at you, and we never combine it with third-party data to profile you.
- We never make any optional height/weight you enter, or your raw garment photos, public. The **share card** the app can generate is rendered on your device from your character and your outfit — it never contains a raw garment photo or your height/weight numbers — and it is saved or shared only when you choose to, through your device's own share sheet or photo library. We do not receive a copy. There is no public feed and no social sharing surface on our servers in this version.

## 8. How Long We Keep Your Data

| Data | Retention |
|---|---|
| Account, profile, age-check record, character customization, wardrobe, outfits, wishlist, try-on records | While your account is active |
| After you delete your account | Removed from our live database and file storage immediately (see §10); residual copies may persist in encrypted backups for `[TBD — confirm the hosting plan's actual backup retention window, in days, and state the number here before publishing]` before being permanently purged |
| Shopping click and retailer purchase records | Retained after account deletion **with your user ID permanently removed**, for financial reconciliation with our brand partners and to substantiate commissions already invoiced (§6a). Retained for `[TBD — counsel to set a retention period for de-identified commercial records, consistent with the applicable tax/financial recordkeeping period.]` |
| Selv+ waitlist signup | Until Selv+ launches and we have told you, until you ask us to remove you, or until you delete your account — whichever comes first. Deleted with your account. |
| Server logs (IP address, device/OS, request metadata) | Per our hosting provider's log retention `[TBD — confirm the provider's log retention window.]` |
| Crash/diagnostic logs | **None collected.** No crash-reporting SDK is integrated (§2, §6). If one is added, its retention will be stated here. |
| Support emails | Retained as long as needed to resolve your request, then deleted per our internal retention schedule |

## 9. Your Rights

Regardless of where you live, you can ask us to:

- **Access** — get a copy of the personal data we hold about you
- **Correct** — fix inaccurate data (e.g., update your character, an optional height/weight entry, or the email address on your waitlist signup)
- **Export** — receive your data in a portable format
- **Delete** — permanently remove your account and associated data (see §10 — you can also just do this yourself, in-app, right now)
- **Restrict or object** to certain processing
- **Withdraw consent** for anything based on consent (e.g., marketing email, or the waitlist) at any time
- **(California residents)** know what categories of sensitive personal information we've collected, and direct us to limit its use — see [CCPA information — California DOJ](https://www.oag.ca.gov/privacy/ccpa)
- **Non-discrimination** — we will never charge you more or degrade your experience for exercising any of these rights

One limit, stated plainly: once a shopping click or retailer purchase record has been **de-identified** (§6a, §10), it is no longer linked to you and we have no way to find it, return it, correct it or delete it on request — that is what de-identification means. Before you delete your account, those records are yours and all of the rights above apply to them normally.

To exercise any right beyond in-app self-service, email **[privacy@selv.app — TBD, confirm domain](mailto:privacy@selv.app)**. We'll respond within 30 days (or sooner where local law requires, e.g., 45 days under CCPA, one month under GDPR).

## 10. How to Delete Your Data

**In-app (fastest, works for everyone, everywhere):**
Open the **Profile** tab → **Delete account** → confirm. That is two taps from the app's main screen. You'll be asked to confirm once (so a stray tap can't delete your account by accident). **There is no password to re-enter, because Selv has no passwords** — being signed in on the device is what authorises the deletion.

This is a real, permanent deletion, not a "deactivation." It removes:

- your account and sign-in credentials;
- your profile, including your display name, your build, any optional height/weight, and your age-check record;
- your character customization;
- every garment photo you uploaded, deleted from storage as well as from the database;
- every garment record, every outfit, and every outfit layout;
- your wishlist;
- your product try-on records — these are destroyed, not de-identified;
- your Selv+ waitlist signup.

**The one exception, stated in full:** shopping click records and retailer purchase reports are **de-identified** rather than deleted — your user ID is permanently set to null and the remaining row is a commercial record about an order, with nothing linking it to you. §6a explains why. Nothing else survives.

**By email (backup option):**
Email **[privacy@selv.app — TBD]** from the address on your account and we'll delete it manually — typically within a few business days, always confirmed by email when done.

We built the in-app option to satisfy [Apple's App Store Review Guideline 5.1.1(v)](https://developer.apple.com/support/offering-account-deletion-in-your-app/), which requires that any app allowing account creation must let you delete that account — not just disable it — from inside the app. The full engineering spec for exactly what gets deleted, in what order, is in `DATA_HANDLING.md` §3.

## 11. If This Changes: Photo- or Scan-Based Avatars (Not in v1)

Selv's current avatar is built entirely from the preset choices you make in the character creator — no photo, no scan, and no body measurements are used to generate it. A possible future version could offer a photo- or scan-based avatar option (e.g., facial likeness or photo-refined body shape, using a third-party service). If we ever ship that:
- It will be **opt-in**, off by default
- We will update this policy and Apple's App Privacy label to reflect the new processing (this would likely introduce "Sensitive Info / biometric" data for the first time)
- The character-creator path will always remain available as a non-biometric alternative

## 12. Children and Minors

Selv is for users **13 and older**, and that minimum is enforced by our database, not merely stated here.

**How the check works, and what we keep.** Before your account is created, we ask for your date of birth. The app checks it, and then our server checks it again — the second check is the one that counts, because a check that only runs in the app is a check anyone can skip. **Your date of birth is used for that check and then discarded.** It is never written to our database. What we keep is only:

- the **year** you were born — no month, no day; and
- the **date** on which a 13+ check passed.

We keep those two rather than a bare yes/no so that the result stays independently verifiable, and rather than the full date because a day-precision date of birth is a permanent identifier we do not need and would rather not hold. An account that has not answered the age question cannot finish setting up.

If you were under 13, no account is created at all — we ask the question before the account exists, specifically so that we are not left holding a child's email address after refusing them. We do not knowingly collect personal data from children under 13, and if we learn we have, we will delete it — this matches the U.S. [Children's Online Privacy Protection Act (COPPA)](https://www.ftc.gov/legal-library/browse/rules/childrens-online-privacy-protection-rule-coppa) "actual knowledge" standard.

Because our audience skews 16–26 and realistically includes users under 18, we've deliberately avoided building anything that scores, ranks, or rates a user's body or appearance (see the Responsible, Body-Positive Messaging section of `MARKETING_STRATEGY.md`), and any future social feed will ship with moderation and reporting tools before it launches — not after.

For users in the EU/EEA/UK: the age at which you can consent to an "information society service" like an app varies by country (13–16, set individually by each EU member state under GDPR Art. 8). Where local law requires parental consent for a user under that country's threshold, we rely on our 13+ minimum-age gate and Apple's platform-level age-verification signals; if you believe a user below the applicable age has an account, please contact us. `[TBD — counsel to confirm whether a 13+ floor is sufficient in each launch market, or whether a higher per-country threshold and a parental-consent path are required.]`

## 13. Security

We use industry-standard protections: encrypted connections (TLS/HTTPS) for all data in transit, Supabase's Postgres Row Level Security (RLS) so your data is only queryable by you, private storage buckets with per-user access rules for your garment photos, and access controls limiting who on our team can see raw user data (and why).

Two things are deliberately server-authoritative rather than trusted from the app: the result of your age check, and the commercial terms attached to a shopping click. Neither can be written or altered by a client, including a modified one.

No system is 100% unbreachable — if something goes wrong, we'll notify affected users and regulators as required by applicable law (e.g., within 72 hours under GDPR Art. 33 where a breach poses a risk to your rights).

## 14. International Data Transfers

If you're accessing Selv from outside the country where our servers are hosted, your data will be transferred internationally. Where that crosses out of the EU/UK/EEA, we rely on Standard Contractual Clauses or another lawful transfer mechanism with our processors. `[TBD — legal to confirm final hosting region and transfer mechanism before publishing.]`

Separately, when you tap "Buy" you are sent to a retailer whose site may be operated anywhere in the world; from that point their privacy policy governs (§6a).

## 15. Changes to This Policy

We'll post any material changes here with an updated "Last updated" date, and for significant changes (e.g., a new use of your photos or measurements, a new third-party processor, or the introduction of paid features) we'll notify you in-app before the change takes effect.

## 16. Contact Us

**[Legal entity name, TBD]**
Email: **[privacy@selv.app — TBD]**
Support: **[support@selv.app — TBD]**

If you're in the EU/UK and believe we haven't resolved your concern, you also have the right to lodge a complaint with your local data protection authority.

---

### Sources relied on for this draft
- [Apple — Offering account deletion in your app](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
- [Apple — App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/)
- [GDPR Art. 9 — Processing of special categories of personal data](https://gdpr-info.eu/art-9-gdpr/)
- [ICO — What is special category data?](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/special-category-data/what-is-special-category-data/)
- [TermsFeed — CCPA/CPRA and biometric data](https://www.termsfeed.com/blog/ccpa-biometrics/)
- [California DOJ — CCPA](https://www.oag.ca.gov/privacy/ccpa)
- [FTC — Children's Online Privacy Protection Rule (COPPA)](https://www.ftc.gov/legal-library/browse/rules/childrens-online-privacy-protection-rule-coppa)
