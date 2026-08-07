> ## ⚠️ NOT LEGAL ADVICE
> This document was drafted by an AI assistant researching current (2025–2026) Apple App Store, GDPR, and CCPA/CPRA requirements as a **first-draft starting point**, not a finished legal instrument. **Have a qualified privacy attorney (ideally one familiar with app-based businesses processing photos/biometric-adjacent data and EU/UK/California users) review and revise this before it is published, linked from the App Store listing, or shown to a single real user.** Placeholder fields (entity name, jurisdiction, contact addresses, hosting region) are marked `[TBD]` and must be filled in before publishing.

---

# Selv Privacy Policy

**Effective date:** [TBD — set at publish] · **Last updated:** July 20, 2026 (avatar approach updated — see §2 and §4: the avatar is now built entirely from character-creator choices, never a photo or scan of you)
**App:** Selv (working name — see naming note in `MARKETING_STRATEGY.md`; this policy will need a find-and-replace pass once the name is finalized)
**Company:** [Legal entity name, TBD] ("**we**," "**us**," "**Selv**")

---

## Our Promise (read this part even if you skip everything else)

- **We never use your photos or body measurements to train AI/ML models** — not ours, not a third party's, ever.
- **We never sell your photos, measurements, or any personal data.** Full stop — no data brokers, no ad exchanges.
- **You can delete your account, your photos, your measurements, and everything else in one tap**, from inside the app, at any time. No phone calls, no "please email us to confirm," no guilt trips.
- Your body is not the product here. The avatar is a styling tool, not a grading tool — we don't score, rank, or rate bodies, and neither should anyone using this app.

These commitments are legally binding parts of this policy, not marketing copy — see [How to Delete Your Data](#how-to-delete-your-data) and [What We Never Do](#what-we-never-do-with-your-data) below.

---

## 1. Who this policy covers

This policy applies to anyone who uses the Selv iOS app (and, later, Android). It explains what we collect, why, where it lives, who else touches it, and — most importantly — how you stay in control of it.

## 2. Information We Collect

| Category | Examples | Where it comes from |
|---|---|---|
| **Account info** | Email address, hashed password (or Sign in with Apple / Google identity token), display name | You, at signup |
| **Avatar customization** | The appearance choices you make in the character creator — skin tone, face shape, eyes, hair, eyebrows, facial hair, body type, accessories (all preset options you pick, not derived from you) | You, while designing your character |
| **Height & weight (optional)** | Height and weight, only if you choose to enter them | You, optionally, in your profile — not required, and not used to generate your avatar |
| **Garment photos** | Photos of clothes you own, taken to digitize them into your wardrobe. **We do not collect a photo of your face or body for the avatar** — see the note below the table. | You, via camera or photo library |
| **Garment metadata** | Name, color, brand, category, tags you assign to a garment | You |
| **Outfit data** | Saved outfit names, which garments/catalog items are in them, layering order | Generated as you use the outfit builder |
| **Purchase/subscription status** | Whether you have an active Selv+ subscription, renewal date | Apple, via StoreKit/RevenueCat — **we never see or store your card number** |
| **Usage & diagnostic data** | Screens viewed, taps, crash logs, performance data (planned; not yet live as of this writing) | Automatically, once an analytics/crash SDK is integrated |
| **Device/technical data** | IP address (transient), device type, OS version | Automatically, for security and to make the app work |

**Avatar privacy note:** your avatar is entirely user-authored — you pick from preset options (skin tone, face shape, eyes, hair, brows, facial hair, body type, accessories) in a character creator. We never ask for, or process, a photo or scan of your face or body to build it, and we don't require body measurements to build it either.

We do **not** collect your precise location, your contacts, your browsing history outside the app, or payment card details.

## 3. Why We Collect It, and Our Legal Basis

| Purpose | What it uses | Legal basis (GDPR Art. 6) |
|---|---|---|
| Create and secure your account | Email, password/OAuth identity | Performance of a contract (you asked us to create an account) |
| Build your 3D character | Your character-creator selections (skin tone, face shape, eyes, hair, brows, facial hair, body type, accessories) — plus height/weight only if you optionally add them | Performance of a contract / your explicit action (you pick these to get the feature) |
| Digitize and display your wardrobe | Garment photos, metadata | Performance of a contract |
| Try-before-you-buy rendering | Catalog item + your avatar | Performance of a contract |
| Process payments for Selv+ | Subscription status (via Apple/RevenueCat) | Performance of a contract |
| Keep the app secure and working | Device/technical data, crash logs | Legitimate interest (security, reliability) — narrowly scoped, doesn't override your rights |
| Improve the product | Aggregated usage data | Legitimate interest, or consent where required (e.g., analytics opt-in on iOS via App Tracking Transparency if ever applicable) |
| Send you service emails (password reset, receipts) | Email address | Performance of a contract |
| Send you marketing emails | Email address | Consent — opt-in, unsubscribe any time |

We deliberately did **not** design any feature that requires "special category" data under GDPR Art. 9 (e.g., health data, biometric identification data) as a matter of course. See the callout in §4 about how we classify photos and measurements, and why photo-based body-shape estimation (a possible future feature) would change this analysis. Background: [GDPR Art. 9 — special categories of personal data](https://gdpr-info.eu/art-9-gdpr/); per GDPR Recital 51, ordinary photographs are not automatically "biometric data" — they only become special-category data when processed through technical means specifically to uniquely identify someone (e.g., facial recognition). We do not currently run your photos through any identification or facial-recognition process.

## 4. Is your avatar "biometric" or "health" data?

Short answer: **no, and it's simpler than it used to be.** Your avatar is built entirely from preset choices you pick in a character creator (skin tone, face shape, eyes, hair, brows, facial hair, body type, accessories) — never from a photo or scan of you, and never from required body measurements.

- **Avatar customization choices (skin tone, face shape, hair, eyes, etc.):** these are ordinary personal data — a record of which preset options you selected, no different in kind from picking a font or a theme color. They are not biometric data under GDPR (biometric data requires "specific technical processing" of a physical, physiological, or behavioral characteristic for unique identification — see [ICO guidance on special category data](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/special-category-data/what-is-special-category-data/)), and they aren't derived from any photo, scan, or measurement of your actual body or face.
- **Height/weight (optional):** if you choose to enter them — purely optional, not required for the avatar — these are ordinary personal data you typed into a form, not biometric data, and they no longer drive the avatar's shape at all.
- **Photos:** the only photos we collect are **photos of your clothes**, to digitize them into your wardrobe (see §2). We do not collect a photo of your face or body for the avatar, and we do not run face recognition or body-shape estimation on any photo. If a future version ever introduced a photo-based avatar option, we'd update this policy and ask for separate, explicit, opt-in consent first (see §11).
- **Under CCPA/CPRA**, biometric information is one of the enumerated categories of "sensitive personal information" (see [CCPA/CPRA and biometric data — TermsFeed](https://www.termsfeed.com/blog/ccpa-biometrics/)). Nothing we collect for the avatar meets that definition — but we extend CCPA-style deletion and limit-use rights to **all** users, everywhere, regardless of category (see §9).

## 5. Where Your Data Lives

Your data is stored in **Supabase** (Postgres database + file storage), hosted on [TBD — confirm final region, e.g., AWS us-east-1] at launch. If you are in the EU/UK/EEA, this means your data may be transferred outside your region; where required, we rely on Standard Contractual Clauses or an equivalent safeguard with our hosting provider. See §12 for more on international transfers.

## 6. Who Else Sees Your Data (Third-Party Processors)

We use a small number of vetted vendors ("processors") to run the app. We do not let any of them use your data for their own purposes (like training their own models or advertising).

| Vendor | What they receive | Why |
|---|---|---|
| **[Supabase](https://supabase.com/privacy)** | Everything in §2 — it's our database/auth/file-storage provider | Hosting our entire backend |
| **[remove.bg](https://www.remove.bg/privacy)** | The raw garment photo you upload, briefly, to strip the background | Background removal so your garment renders cleanly on your avatar. remove.bg processes the image and returns a cutout; we are confirming their retention window in our vendor DPA before launch — see `DATA_HANDLING.md` for the open item. |
| **Apple (StoreKit / App Store)** | Your subscription purchase event, device/Apple ID token needed to process payment | Handling all Selv+ billing — **Apple, not us, ever sees your payment card** |
| **RevenueCat** | Your anonymous app-user ID and subscription/entitlement status | Reconciling subscription state across devices |
| **[Analytics vendor — TBD, planned]** | Anonymized usage events (screen views, taps) — **never photos or measurements** | Understanding which features are working, fixing bugs |
| **[Crash-reporting vendor — TBD, planned]** | Crash logs, device/OS info | Fixing bugs before they hit more users |

We do not use social-media login SDKs, ad networks, or data brokers. If that ever changes, we will update this policy and, where required, ask for your consent first.

## 7. What We Never Do With Your Data

- We never sell, rent, or trade your personal data, photos, or measurements to anyone.
- We never use your photos or body measurements as training data for any AI/ML model — internal or third-party.
- We never share your photos or measurements with advertisers or data brokers.
- We never run facial recognition or any identity-matching process on your photos in the current version of the app.
- We never make any optional height/weight you enter, or your raw garment photos, public — anything you choose to share (Phase 2 outfit-sharing feed, once it ships) shares your **character wearing an outfit**, never a raw photo or raw measurement numbers.

## 8. How Long We Keep Your Data

| Data | Retention |
|---|---|
| Account, profile, avatar, wardrobe, outfits | While your account is active |
| After you delete your account | Removed from our live database and file storage immediately (see §10); residual copies may persist in encrypted backups for up to 30 days before being permanently purged |
| Purchase/subscription records | Retained by Apple/RevenueCat as required for financial and tax recordkeeping, even after account deletion — this is a legal requirement on payment processors, not something we control |
| Crash/diagnostic logs | Typically 90 days, then deleted or fully anonymized |
| Support emails | Retained as long as needed to resolve your request, then deleted per our internal retention schedule |

## 9. Your Rights

Regardless of where you live, you can ask us to:

- **Access** — get a copy of the personal data we hold about you
- **Correct** — fix inaccurate data (e.g., update your character or an optional height/weight entry)
- **Export** — receive your data in a portable format
- **Delete** — permanently remove your account and associated data (see §10 — you can also just do this yourself, in-app, right now)
- **Restrict or object** to certain processing
- **Withdraw consent** for anything based on consent (e.g., marketing email) at any time
- **(California residents)** know what categories of sensitive personal information we've collected, and direct us to limit its use — see [CCPA information — California DOJ](https://www.oag.ca.gov/privacy/ccpa)
- **Non-discrimination** — we will never charge you more or degrade your experience for exercising any of these rights

To exercise any right beyond in-app self-service, email **[privacy@selv.app — TBD, confirm domain](mailto:privacy@selv.app)**. We'll respond within 30 days (or sooner where local law requires, e.g., 45 days under CCPA, one month under GDPR).

## 10. How to Delete Your Data

**In-app (fastest, works for everyone, everywhere):**
Settings → Account → Delete Account → confirm. This is a real, permanent deletion of your account, your avatar/character customization, any optional height/weight you entered, every garment photo, every outfit, and your profile — not a "deactivation." You'll be asked to confirm once (so a stray tap can't delete your account by accident), and if you have an active Selv+ subscription we'll remind you to cancel it in the App Store first so Apple doesn't keep billing you after you're gone.

**By email (backup option):**
Email **[privacy@selv.app — TBD]** from the address on your account and we'll delete it manually — typically within a few business days, always confirmed by email when done.

We built the in-app option to satisfy [Apple's App Store Review Guideline 5.1.1(v)](https://developer.apple.com/support/offering-account-deletion-in-your-app/), which requires that any app allowing account creation must let you delete that account — not just disable it — from inside the app. The full engineering spec for exactly what gets deleted, in what order, is in `DATA_HANDLING.md`.

## 11. If This Changes: Photo- or Scan-Based Avatars (Not in v1)

Selv's current avatar is built entirely from the preset choices you make in the character creator — no photo, no scan, and no body measurements are used to generate it. A possible future version could offer a photo- or scan-based avatar option (e.g., facial likeness or photo-refined body shape, using a third-party service). If we ever ship that:
- It will be **opt-in**, off by default
- We will update this policy and Apple's App Privacy label to reflect the new processing (this would likely introduce "Sensitive Info / biometric" data for the first time)
- The character-creator path will always remain available as a non-biometric alternative

## 12. Children and Minors

Selv is intended for users **13 and older** (we enforce a minimum age at signup). We do not knowingly collect personal data from children under 13, and if we learn we have, we will delete it — this matches the U.S. [Children's Online Privacy Protection Act (COPPA)](https://www.ftc.gov/legal-library/browse/rules/childrens-online-privacy-protection-rule-coppa) "actual knowledge" standard.

Because our audience skews 16–26 and realistically includes users under 18, we've deliberately avoided building anything that scores, ranks, or rates a user's body or appearance (see the Responsible, Body-Positive Messaging section of `MARKETING_STRATEGY.md`), and any future social feed (Phase 2) will ship with moderation and reporting tools before it launches — not after.

For users in the EU/EEA/UK: the age at which you can consent to an "information society service" like an app varies by country (13–16, set individually by each EU member state under GDPR Art. 8). Where local law requires parental consent for a user under that country's threshold, we rely on our 13+ minimum-age gate and Apple's platform-level age-verification signals; if you believe a user below the applicable age has an account, please contact us.

## 13. Security

We use industry-standard protections: encrypted connections (TLS/HTTPS) for all data in transit, Supabase's Postgres Row Level Security (RLS) so your data is only queryable by you, and access controls limiting who on our team can see raw user data (and why). No system is 100% unbreachable — if something goes wrong, we'll notify affected users and regulators as required by applicable law (e.g., within 72 hours under GDPR Art. 33 where a breach poses a risk to your rights).

## 14. International Data Transfers

If you're accessing Selv from outside the country where our servers are hosted, your data will be transferred internationally. Where that crosses out of the EU/UK/EEA, we rely on Standard Contractual Clauses or another lawful transfer mechanism with our processors. `[TBD — legal to confirm final hosting region and transfer mechanism before publishing.]`

## 15. Changes to This Policy

We'll post any material changes here with an updated "Last updated" date, and for significant changes (e.g., a new use of your photos or measurements) we'll notify you in-app before the change takes effect.

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
