# App Store Listing — Selv

**Working name:** Selv (see `MARKETING_STRATEGY.md` §3 — name not final; this whole file needs a find-and-replace pass once the name is legally cleared). All copy below is written to be swapped cleanly if the name changes.
**Last updated:** 2026-08-07 (Selv+ paid-tier copy removed — v1 ships no IAP; see §5 and §11)

> **Pivot note:** Selv no longer builds the avatar from a photo or body measurements — users **design a customizable 3D character** in a character creator (skin tone, face shape, eyes, hair, brows, facial hair, body type, accessories). Copy, screenshots, and permission strings below are updated so nothing implies a face/body scan for the avatar. Camera/photo-library access is for **garment photos only** (digitizing clothes). See `AVATAR_CREATOR_PLAN.md`.

---

## 1. Title (≤30 characters)

> **Selv: 3D Closet & Try-On**

26 characters. Leads with the brand name (best for recognition/searches on the name itself) and packs in two high-intent ASO keywords — "3D Closet" and "Try-On" — that Whering/Acloset-style competitors also rank for.

## 2. Subtitle (≤30 characters)

> **Dress your 3D twin. Post it.**

28 characters. Pulls the "digital twin" double-meaning straight from the naming rationale in `MARKETING_STRATEGY.md` §3, and ends on the action (share-card loop) that's the core growth mechanic in §6.5 of that doc.

## 3. Keywords field (≤100 characters, comma-separated, no spaces)

```
wardrobe,outfit,avatar,3d,tryon,fashion,style,closet,thrift,ootd,stylist,capsule,mannequin,fit,twin
```

99 characters. Notes:
- Deliberately excludes words already in the Title/Subtitle ("Selv," "closet," "try-on," "3D," "dress") — Apple already indexes those, so repeating them in the keyword field wastes character budget.
- `mannequin` and `capsule` (as in "capsule wardrobe") are aimed at the same searchers who currently find Whering/Indyx.
- `twin` is a bet on the naming-doc's Gen-Z "twinning" hook (§3, §6.5) generating branded search once it has social proof.

## 4. Promotional text (≤170 characters, editable without a new build)

> Design your 3D character, dress it in your real closet, and try on anything before you buy it. No filters, no grading — just your fit, your way.

(168 characters — leaves headroom to append a launch-week callout, e.g. "🎉 Now live" without a resubmission.)

## 5. Full Description

> **Your closet, but make it 3D.**
>
> Selv turns a 3D character you design and your actual clothes into a wardrobe you can play with. Build your character, meet your avatar, and start dressing it in the clothes you already own — no mirror selfies, no guessing what goes with what.
>
> **Design your 3D character.**
> Pick your skin tone, face, eyes, hair, brows, facial hair, body type, and accessories in our character creator — no photos, no measurements, no scans. Your character is yours to tweak any time.
>
> **Digitize your closet.**
> Snap a photo of anything in your closet and Selv turns it into a wearable 3D item — shirts, jeans, jackets, sneakers, all of it. Build a real digital inventory of what you actually own, instead of forgetting about it in the back of your closet.
>
> **Mix it. Match it. Make it yours.**
> Drag and drop your real clothes onto your avatar, layer jackets over tees, save your favorite combinations by name, and stop standing in front of your closet with "nothing to wear."
>
> **See the fit before you commit.**
> Thinking about buying something? Try it on your own avatar first — see how it actually looks with what you already own before you spend a dollar or wait on a return.
>
> **Post the fit.**
> Every outfit you save becomes a share-ready card of your own avatar wearing the look — post it, send it to the group chat, or keep it just for you.
>
> Selv is built to hype you up, not grade you. There's no "outfit score," no body-shaming filters, no beauty bias — just your character, your clothes, your call.
>
> Selv is **free**, and v1 has nothing to buy. You get your 3D character, up to 25 digitized wardrobe items, unlimited outfit mixing, try-on, and shareable fit cards.
>
> **Selv+ is coming.** Unlimited wardrobe items, wardrobe analytics, and more are in the works — hit the 25-item mark and you can join the list to hear first. Joining is free and is not a purchase.

**Do not restore the paid-tier block here until IAP actually ships.** This section
previously read "**Selv+** ($6.99/mo) unlocks unlimited wardrobe items…" followed by
standard auto-renewal boilerplate. There is no subscription to sell: v1 ships no
in-app purchase, no StoreKit product, and no RevenueCat entitlement, and
`app/src/lib/pricing.ts` hardcodes every user to the free tier because there is no
entitlement to read. Hitting the 25-item cap opens `SelvPlusWaitlistSheet.tsx`, not a
paywall. Listing metadata that advertises a subscription the binary cannot sell is a
Guideline 2.3.1 (accurate metadata) problem *and* a 3.1.2 (subscription disclosure)
problem — the disclosure requirements below only attach once there is something to
disclose. When IAP does ship, the price, the auto-renewal terms, and the paywall
screen all land in the same change.

## 6. What's New (v1.0 release notes)

> Welcome to Selv! This is our very first release:
> • Design your own 3D character in the character creator
> • Digitize your closet by snapping photos of your clothes
> • Mix and save outfits on your avatar
> • Try on catalog items before you buy them
> • Share your best fits as a card
>
> We're just getting started — tell us what you want to see next.

## 7. Age Rating Recommendation: **13+**

Rationale, mapped to [Apple's updated age-rating system](https://developer.apple.com/news/?id=ks775ehf) (13+/16+/18+ tiers replacing 12+/17+, mandatory questionnaire update by Jan 31, 2026 covering in-app controls, capabilities, medical/wellness topics, and violent themes):

- **No content in v1 pushes this above 13+ on its own** — no violence, no mature themes, no gambling, no unmoderated chat.
- **13+ (not 4+/9+) because:** the app collects photos of the user's clothes, requires account creation, and links out to external retail checkout for try-before-you-buy purchases (an "unrestricted web/commerce" signal Apple's guidance treats as inconsistent with the youngest tiers). It is deliberately **not** built or marketed for Apple's Kids Category.
- **Medical/wellness questionnaire answer:** Selv's avatar is built entirely from character-creator selections (skin tone, face, hair, eyes, body type, etc.), not from body measurements — height/weight are optional, reference-only fields with no bearing on the avatar's shape. The app makes no medical, fitness, or weight-loss claims and provides no health advice (consistent with `MARKETING_STRATEGY.md` §11's explicit ban on before/after or weight-loss framing). Answer the questionnaire as "no medically-relevant data collected."
- **Revisit at Phase 2:** once the social outfit-sharing feed ships, Apple's own guidance states that apps with unrestricted or unmoderated user-generated content are automatically bumped to a higher tier. If Selv's Phase 2 moderation (see `LAUNCH_CHECKLIST.md`) is proactive and robust before launch, staying at 13+ may still be defensible; if moderation is reactive-only, budget for 16+.

## 8. iOS Permission Purpose Strings

These populate `Info.plist` (via `app.json` → `expo.ios.infoPlist` in the Expo config). Apple requires a purpose string for every permission the app requests, displayed verbatim in the system prompt — vague strings ("this app needs your camera") are a common rejection reason.

```json
{
  "expo": {
    "ios": {
      "infoPlist": {
        "NSCameraUsageDescription": "Selv uses your camera to photograph your clothes so we can turn them into 3D wardrobe items. Your avatar is designed in our character creator — the camera is never used to scan your face or body.",
        "NSPhotoLibraryUsageDescription": "Selv needs access to your photo library so you can pick existing photos of your clothes instead of retaking them with your camera.",
        "NSPhotoLibraryAddUsageDescription": "Selv needs permission to save your outfit cards and avatar renders to your photo library so you can share them.",
        "ITSAppUsesNonExemptEncryption": false
      }
    }
  }
}
```

Notes:
- Each string states the *specific* in-app reason, not a generic one — this is what App Review checks for under Guideline 5.1.1 (data minimization/purpose) and it also reduces opt-out rates, since users are more likely to grant access when the reason is concrete.
- `NSPhotoLibraryAddUsageDescription` is separate from `NSPhotoLibraryUsageDescription` — use it (not the broader read/write key) for the share-card "save to camera roll" feature so the app only requests write access where that's all it needs.
- If a future build adds `expo-camera`'s microphone capture (e.g., for outfit video cards), add `NSMicrophoneUsageDescription` at that time — not needed for the v1 feature set described in `PRODUCT_SPEC.md`.

## 9. Screenshot Plan — 5 Screens

Per [current App Store Connect screenshot specs](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/), only the largest device per size class needs source screenshots as of 2026 — Apple auto-scales down. Design at **6.9" iPhone (1320×2868 px)**, portrait, PNG/JPEG, no alpha channel. Each screenshot pairs a bold headline (matching the naming-doc's "chunky display face" direction, `MARKETING_STRATEGY.md` §4) with the actual in-app screen behind it — no fake UI mockups, which is itself a review risk (Guideline 2.3.3, misleading screenshots).

| # | Screen | Headline overlay | Supporting copy | Copy-bank source |
|---|---|---|---|---|
| 1 | **Character creator** | "Meet your 3D character." | "Design your look — skin, hair, eyes, body type, and more. No photo required." | Echoes tagline "Dress up as yourself" + the "design your character" hook from `MARKETING_STRATEGY.md` §8 concept #1 |
| 2 | **Digitize your closet** | "Your closet, but make it 3D." | "Snap a photo, we cut it out — your real clothes, digitized." | Tagline option 1, copy bank §12 |
| 3 | **Build the fit** | "Mix it. Match it. Make it yours." | "Drag your real clothes onto your avatar and save the looks that work." | Outfit-builder feature description, `PRODUCT_SPEC.md` §4 |
| 4 | **Try-on (try before you buy)** | "See the fit before you commit." | "Try on anything before you buy it — skip the return." | Tagline option 2, copy bank §12 |
| 5 | **Share the fit** | "Post the fit." | "Every saved outfit becomes a share-ready card of you." | Growth-loop mechanic, `MARKETING_STRATEGY.md` §6.5 — **shows the save/share-card export, not an in-app social feed** (that's Phase 2 and not shipping in v1; showing it in a screenshot would be inaccurate metadata under Guideline 2.3.1) |

Production notes: keep device-frame chrome consistent across all 5 (same status bar time, same background gradient treatment), and run the actual rendered character through the same body-type/skin-tone diversity check called for in `MARKETING_STRATEGY.md` §11 — the screenshots are also a public commitment to character-creator diversity, not just marketing assets.

## 10. Export Compliance / Encryption

Selv only uses standard HTTPS/TLS for network calls (Supabase, and the Supabase Edge Functions) — no proprietary or non-exempt encryption is implemented in the app itself. (This previously also listed RevenueCat and remove.bg; neither is a dependency of the shipping build.) Per [Apple's export compliance guidance](https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations), OS-provided encryption (i.e., HTTPS) is **exempt** from export documentation requirements.

**Answer:** set `ITSAppUsesNonExemptEncryption` to `false` in `Info.plist` (shown in §8 above) so App Store Connect doesn't re-prompt the encryption questionnaire on every build submission. If a future feature adds proprietary/custom encryption (unlikely for this stack), this value and the answer here must be revisited together.

## 11. Category & Business Model Declaration (submission checklist items)

- **Primary category:** Lifestyle (or Shopping — pick based on which competitor placement, Whering/Acloset vs. Depop, tests better; do not use Health & Fitness — the avatar is no longer body/measurement-driven, but a wardrobe/fashion app still fits Lifestyle/Shopping better and avoids inviting health-app review scrutiny)
- **In-App Purchase: none in v1.** Declare no IAP products. The app sells nothing — there is no StoreKit product, no RevenueCat dependency, and no entitlement check; the wardrobe cap opens a waitlist sheet. Answer the business-model questions accordingly rather than pre-declaring a subscription that does not exist, which invites a reviewer to look for a purchase flow they will not find.
- **Try-before-you-buy / affiliate purchases:** these are physical goods (real apparel/footwear shipped by a third-party retailer), so external checkout/links are permitted under Guideline 3.1.1's physical-goods carve-out. This is the *only* commerce surface in v1, which also removes the old risk of a reviewer confusing it with a Selv+ paywall — there isn't one.
- **When Selv+ ships (not v1), all of this attaches at once:** an auto-renewable subscription product configured in App Store Connect and purchased **only** through StoreKit/Apple IAP per [Guideline 3.1.1](https://developer.apple.com/app-store/review/guidelines/) (RevenueCat wraps StoreKit for cross-platform entitlements — it does not replace it); a paywall screen showing subscription length, price, auto-renewal terms and a Terms/Privacy link on the same screen as the purchase button per Guideline 3.1.2; the paid-tier copy restored to §5; and UI that keeps the paywall visually distinct from the affiliate checkout. Shipping any one of these without the others is what gets a build rejected.

## 12. Sources
- [Apple — App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Apple — Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)
- [Apple — Updated age ratings in App Store Connect](https://developer.apple.com/news/?id=ks775ehf)
- [Apple — Complying with Encryption Export Regulations](https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations)
- [Apple — NSCameraUsageDescription](https://developer.apple.com/documentation/BundleResources/Information-Property-List/NSCameraUsageDescription)
- [Apple — NSPhotoLibraryUsageDescription](https://developer.apple.com/documentation/BundleResources/Information-Property-List/NSPhotoLibraryUsageDescription)
