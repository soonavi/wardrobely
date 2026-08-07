# Selv — Creative queue (ready to generate)

The image/video generation connector disconnected mid-session, so these are queued with exact prompts. Fire them the moment it's reconnected. All in the stylized-character brand world (Zepeto/3D-emoji look) + brand palette (lavender #8B7CFF, acid #C7F94B, ink #141026, cream #F5F2EA). 9:16 unless noted.

**Status (2026-07-23):** Ad A **rendered + live** in `ADS_GALLERY.html` (`hf_20260723_083812_6e55d99f`, UTM `meet3dyou`). Ads B–E + the stylized spin are **still pending** — the generation-submit endpoint went intermittent (reads/job_display succeed, every `generate_image` submit times out with "connector's server isn't responding"; credits fine, call shape verified). Gallery already has queued slots + locked headlines/UTMs; just re-fire the prompts below one at a time when the endpoint recovers and swap the `<img src>` in.

---

## 1. Stylized spin video (replaces the old photoreal spin)

- **Model/approach:** image-to-video, ~15s, 9:16, from a stylized-character frame (start image = the stylized "your closet, in 3D" ad `23cd4674` or a fresh stylized full-body character). Kling-turbo-style single-start-frame animation.
- **Prompt:** "15-second cinematic vertical clip. A cute stylized 3D character (Zepeto / 3D-emoji style, not photorealistic) in a trendy outfit slowly rotates on a subtle circular platform like a turntable, soft studio lighting with a gentle lavender and acid-green rim glow, delicate particle shimmer, slow subtle camera move. Keep any on-screen text and the 'selv' wordmark perfectly static and sharp. Premium, playful, clean 3D render, no new text."
- **Use:** "how it works" / product-reveal Reel; loops cleanly; add a trending sound + a "design your character" caption in edit.

---

## 2. Photo ads (photorealistic lifestyle — the "human moment," complements the stylized 3D ads)

These are realistic photography-style ads: a real Gen Z person + their Selv character on the phone. 9:16, baked headline + acid-green "Join the waitlist" pill + small lowercase `selv` wordmark. Diverse cast.

**Ad A — "meet the 3D you"**
> Vertical 9:16 photorealistic lifestyle ad. A real Gen Z woman in her cozy bedroom, delighted, holding up her phone toward camera; on the phone screen is a cute stylized 3D character (her Selv avatar) in a trendy outfit. Warm natural light, digital-lavender and acid-green accent glow. Headline: "meet the 3D you." Acid-green pill: "Join the waitlist". Small 'selv' wordmark top-left. Authentic, aspirational, crisp legible text, no watermark.

**Ad B — "your closet, now in your pocket"**
> Vertical 9:16 photorealistic ad. A real young woman standing at her open, full closet, looking at her phone which shows a neat 3D wardrobe grid + her stylized character. Natural light, lavender/acid accents on a cream-toned room. Headline: "your closet, now in your pocket." Acid-green "Join the waitlist" pill. 'selv' wordmark top-left. Relatable, clean, legible text, no watermark.

**Ad C — "make your character" (social)**
> Vertical 9:16 photorealistic ad. Two real Gen Z friends on a couch laughing, comparing their phones — each screen shows a different cute stylized 3D Selv character. Natural candid light, brand lavender/acid glow. Headline: "make your character." Acid-green "Join the waitlist" pill. 'selv' wordmark. Fun, authentic, sharp text, no watermark.

**Ad D — "try it on selv first"**
> Vertical 9:16 photorealistic ad. A real young woman in a cute real-life outfit, holding her phone that shows her stylized 3D character wearing the same outfit (a match). Soft studio-ish natural light, cream backdrop, lavender/acid accents. Headline: "try it on selv first." Acid-green "Join the waitlist" pill. 'selv' wordmark top-left. Premium, aspirational, legible text, no watermark.

**Ad E — "nothing to wear? design a 3D you" (pain-point)**
> Vertical 9:16 photorealistic ad. A real young woman sitting on her bed surrounded by a pile of clothes, mock-overwhelmed but smiling at her phone showing her Selv character in a great outfit. Natural light, brand accents. Headline: "nothing to wear? design a 3D you." Acid-green "Join the waitlist" pill. 'selv' wordmark. Relatable, warm, crisp text, no watermark.

---

## After generating
- Add the 5 photo ads + spin video to `ADS_GALLERY.html` (a new "Photo ads" section + replace the flagged pre-pivot spin).
- Append per-creative UTMs: `?utm_source=<tiktok|instagram>&utm_medium=<organic|paid>&utm_campaign=prelaunch&utm_content=<slug>` (slugs: meet3dyou, pocket-closet, make-character, tryon-first, nothing-to-wear, spin).
- Download the finals off CloudFront before any paid use.
- Guardrails: styling tool not body-eval; diverse cast; no "unlimited wardrobe" on Free; no Phase-2 feed promises.
