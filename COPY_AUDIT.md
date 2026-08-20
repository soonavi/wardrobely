# Copy Audit — Responsible Body Messaging

**Checklist item:** `LAUNCH_CHECKLIST.md` §5 🔴 — *"Marketing/product copy audit: no before/after
body language, no weight-loss framing, no numeric outfit/body scoring anywhere in the app or App
Store listing (per `MARKETING_STRATEGY.md` §11)."*

**Date:** 2026-08-20
**Verdict:** **PASS — no violations found on any in-scope surface.** Four near-misses recorded
below for the record; none require a change to ship. Two genuine near-misses were found on
*adjacent* marketing surfaces that were outside the checklist's stated scope — they are flagged
in §6 for routing, not fixed here.

---

## 1. What was being looked for

`MARKETING_STRATEGY.md` §11 makes four commitments. Restated as testable rules:

| # | Rule | Source |
|---|---|---|
| R1 | No before/after body language | §11, "How to message and design responsibly", bullet 1 |
| R2 | No weight-loss-adjacent framing | §11, same bullet |
| R3 | No "flaw-fixing" copy — nothing implying the user's body or existing choices are wrong | §11, same bullet + bullet 5 |
| R4 | No numeric scoring, ranking or grading of bodies or outfits | §11, "No public numeric scoring of bodies or looks" |

---

## 2. Scope and method

**In scope** (the surfaces the checklist item names):

| Surface | Extent |
|---|---|
| `app/src/**` | 53 non-test `.ts` / `.tsx` files |
| `app/app/**` | 19 route files |
| `APP_STORE_LISTING.md` | 155 lines, all sections |
| `landing/index.html` | 276 lines |

**Method** — two independent passes, because a keyword sweep alone would miss a violation phrased
without any of the trigger words:

1. **Exhaustive string extraction.** Every string literal containing a space, plus every bare JSX
   text node, was extracted from all 72 source files with comments and SVG path data stripped —
   **321 candidate user-facing strings** (319 in `app/src`, 2 in `app/app`). Each was read. This is
   the pass that carries the verdict; it does not depend on guessing the wording a violation would
   use.

   That heuristic drops single-word strings, which is why `app/app` yields only 2 — the route and
   tab titles are one word each. Those were reviewed separately by reading every `title:`,
   `headerTitle` and `tabBarLabel` in `app/app/**`: *Wardrobe, Try On, Shop, Outfits, Profile,
   Add Garment, Garment*. All are object nouns; none reference the body.
2. **Targeted pattern sweep** over the same files plus both documents, for: `before/after`,
   `transformation`, `lose weight`, `weight loss`, `slim(ming)`, `shed`, `burn fat`, `diet`,
   `goal weight`, `flatter(ing)`, `flaw`, `problem area`, `tone up`, `body goals`, `beach body`,
   `snatched`, `hide/conceal your`, `fix your`, `BMI`, `score`, `rating`, `rate`, `N/10`,
   `out of 10`, `grade`, `rank`, `stars`, `leaderboard`, `streak`.

The pattern sweep returned **zero** true positives. Every hit was a false positive of one of three
kinds: `String.prototype.trim()` calls, the words `Upgrade`/`downgrade` in the Selv+ waitlist code,
and one `BMI` reference in an internal code comment (see N3).

To reproduce the sweep:

```
grep -rnE -i 'before[ -]and[ -]after|weight[ -]loss|slim down|flatter(ing)?|flaw|body goals|score|rating|\b[0-9](\.[0-9])?/10\b|grade|leaderboard' app/src app/app APP_STORE_LISTING.md landing/index.html
```

---

## 3. Verdict per surface

| Surface | Strings checked | R1 before/after | R2 weight-loss | R3 flaw-fixing | R4 scoring | Verdict |
|---|---|---|---|---|---|---|
| `app/src/**` (53 files) | 319 | 0 | 0 | 0 | 0 | **Clean** |
| `app/app/**` (19 files) | 2 + 7 route/tab titles | 0 | 0 | 0 | 0 | **Clean** |
| `APP_STORE_LISTING.md` | full file | 0 | 0 | 0 | 0 | **Clean — actively compliant** |
| `landing/index.html` | full file | 0 | 0 | 0 | 0 | **Clean — actively compliant** |

"Actively compliant" means the surface does not merely avoid the banned framing — it states the
opposite commitment in user-facing copy:

- `APP_STORE_LISTING.md:35` — *"No filters, no grading — just your fit, your way."*
- `APP_STORE_LISTING.md:60` — *"Selv is built to hype you up, not grade you. There's no 'outfit
  score,' no body-shaming filters, no beauty bias — just your character, your clothes, your call."*
- `landing/index.html:147` — *"Your avatar is a styling tool, not a body-scorer."*

That is R4 discharged affirmatively on both public surfaces, which is stronger than absence.

### Structural evidence, beyond the copy

The app has no scoring mechanism to write copy about. There is no rating, score, grade, rank,
streak or leaderboard field anywhere in `app/src/lib/database.types.ts`, no such column in the
schema, and no UI component that renders one. Outfit interaction is limited to naming, saving,
and sharing. R4 is not a copy convention here; there is nothing in the product that could violate
it.

Likewise the pre-pivot risk surface is gone rather than merely unrouted: the measurements-based
onboarding screen was deleted, not left in the tree (`app/app/onboarding.tsx:11-17` documents
this), so there is no dormant body-measurement flow whose copy could be reintroduced by accident.

---

## 4. Near-misses (in scope — recorded, no change required)

None of these violate R1–R4. They are recorded so a future reviewer does not have to re-derive
the judgement.

**N1 — Body-type option labels.**
`app/src/features/creator/customization.ts:150-156` and `app/src/features/avatar/BuildPicker.tsx:20-26`
(deliberately duplicated; the comment at `customization.ts:149` says the two lists are kept in sync).

```
Slim      — "Leaner frame"
Average   — "In-between build"
Athletic  — "Toned, defined"
Curvy     — "Fuller hips & bust"
Broad     — "Wider shoulders"
```

**Assessment: compliant.** Each is a neutral descriptor of shape, presented as a flat set of peers
with no ordering, no default-as-ideal, and no evaluative adjective. The one word worth naming is
**"Average"**, which can be heard as normative — it implies the other four are not average. It is
paired with the neutral hint "In-between build", which defuses it, and it is standard vocabulary
in character creators. **No change proposed.** If it is ever revisited, "Regular" or "Balanced"
would remove the implication at no cost.

**N2 — "Toned, defined" (`customization.ts:153`, `BuildPicker.tsx:23`).**
Slightly more aesthetic-leaning than the other four hints. **Assessment: compliant** — it describes
a build, not an achievement, and carries no implication that the other builds lack something. It is
the hint for a body type the user chooses, not feedback on one they were assigned.

**N3 — BMI in an internal comment.**
`app/src/features/avatar/avatars.tsx:23` and `:32-33` derive the silhouette's width scale from BMI.
**Assessment: compliant, and not user-facing** — the word BMI appears only in a code comment and a
local variable. No BMI value, category, or bracket is ever displayed. Worth keeping that way: BMI
shown to a user would be squarely inside R4.

**N4 — Height/weight out-of-range message (now changed).**
The previous message at `ProfileScreen.tsx` was *"Those measurements look out of range — please
double-check."* **Assessment: not a violation**, but weak: "look out of range" describes the
*number the user typed* rather than the *limit of the field*, which is the grammatical shape a
judgement takes. Replaced as part of this branch's §3 work — see §5.

---

## 5. Changes made (files owned by this branch)

Only two screen files were in scope for edits. Both changes are copy-affecting and are recorded
here for completeness.

**`app/src/features/profile/ProfileScreen.tsx`** — validation messages now name the accepted range
instead of characterising the user's input, and are correct in whichever unit system is on screen:

| Before | After |
|---|---|
| "Height and weight must be whole numbers." | "Height should be a whole number in cm." / "…in inches." |
| "Those measurements look out of range — please double-check." | "Height should be between 90 and 250 cm." / "Height should be between 36 and 98 inches." (and the weight equivalents) |
| "Please fill in height and weight." | "Add your height and weight first, then pick a build." |
| *(no hint in metric)* | Range shown up front in both unit systems, so the limits read as guidance rather than a surprise |

The rewrite states a property of the field, not of the person. `app/src/lib/__tests__/bodyMetrics.test.ts`
locks this in: a test asserts that no message the module can emit contains any of *too heavy, too
light, too tall, too short, overweight, underweight, obese, unhealthy, normal, ideal, realistic,
believable, impossible, invalid*.

**`app/src/features/wardrobe/AddGarmentScreen.tsx`** — added the §5 data-control moment (a separate
checklist item). New user-facing copy:

> **Your photos stay yours**
> Photos of your clothes are stored privately, never sold, and never used to train AI models.
> Delete an item whenever you like — one tap and a confirm, and its photo is erased from our
> storage too.

Checked against R1–R4: no body language of any kind; the subject is the garment photo, not the
user. Styled as a quiet note (`colors.surfaceAlt` + `colors.muted`), not a warning banner, per the
§11 requirement that data controls be clear without being alarmist.

---

## 6. Findings on adjacent surfaces — flagged for routing, NOT fixed here

These are outside both this branch's file ownership and the checklist item's stated scope
(which names the app and the store listing). They are recorded because they are copy that becomes
public, and because the same §11 rule governs them.

**A1 — `MARKETING_STRATEGY.md:188` — TikTok concept #6.**

> | 6 | **Rate my fit but it's my avatar not me** | "Rating my own outfits is easier when it's not actually my face" |

**A2 — `ADS_PLAN.md:165` — ad script, 0:00–0:01 beat.**

> `| 0:00–0:01 | Avatar standing center frame in outfit 1 | "rating my fits… it's not even me 👀" |`

**Assessment: near-miss, worth a second look — not a clear violation.** Both are non-numeric and
both are explicitly about *outfits*, not the body, which is the distinction §11 draws. But "rate /
rating my fit" is the exact social-media trope §11 singles out as inviting comparison dynamics
("avoid the '9.3/10' pattern … which invites exactly the comparison dynamics to avoid"), and there
is a visible internal tension: `ADS_PLAN.md:275` lists *"no numeric scores"* as a hard guardrail in
the same document that opens an ad with "rating my fits". Whoever owns marketing copy should make
a deliberate call rather than inheriting one.

Proposed replacements, preserving the hook (the joke is *"it isn't my real face"*, which survives
without the word "rating"):

| Location | Current | Proposed |
|---|---|---|
| `MARKETING_STRATEGY.md:188` | "Rate my fit but it's my avatar not me" | **"Fit check but it's my avatar not me"** |
| `MARKETING_STRATEGY.md:188` | "Rating my own outfits is easier when it's not actually my face" | **"Doing a fit check is easier when it's not actually my face"** |
| `ADS_PLAN.md:165` | "rating my fits… it's not even me 👀" | **"fit check… it's not even me 👀"** |

"Fit check" is already the app's own register (`app/src/features/avatar3d/CharacterTryOnScreen.tsx:1586`
"Share this fit"; `landing/index.html:118` "Three steps to your 3D fit check") and carries no
evaluative frame.

**Routing:** marketing-copy owner. Neither file is editable from this branch.

**Not a finding:** `social/SELV_POST_2026-07-28.md:33` and `ADS_PLAN.md:20`/`:275` already carry
explicit §11 guardrail checks in their own text. Those are working as intended.

---

## 7. Related engineering finding (not copy)

Surfaced while tracing `buildWidthScale` for the §3 height/weight work, recorded here because it
has no other home and the owning file is outside this branch:

`app/src/features/avatar/avatars.tsx:27-34` — `buildWidthScale` returns `NaN` for a **negative**
weight. `Math.sqrt` of a negative BMI is `NaN`, and `Math.min`/`Math.max` both pass `NaN` through
unchanged, so the clamp does not catch it. That value lands in an SVG `scale()` transform and
blanks the silhouette. Nothing writes a negative today — the profile input accepts digits only —
but `height_cm`/`weight_kg` are plain nullable numbers in the database.

Mitigated at the only call site (`ProfileScreen.tsx:60`, the sole consumer app-wide) by sanitising
both inputs and the result via `app/src/lib/bodyMetrics.ts`. A one-line guard in `buildWidthScale`
itself would close it at the source. Covered by a regression test that asserts the hazard still
exists, so the mitigation cannot be silently removed.

**Routing:** owner of `app/src/features/avatar/avatars.tsx`.
