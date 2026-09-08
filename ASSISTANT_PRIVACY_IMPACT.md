# Wardrobe assistant — privacy impact

**Status:** scaffolded, shipped **off by default**, not yet enabled for anyone.
**Written:** 2026-09-08, alongside migrations `009_assistant.sql` and the
`wardrobe-assistant` Edge Function.

This document exists because the assistant is the first feature in Selv that
sends user data to a company other than Supabase, and because
`legal/PRIVACY_POLICY.md` is with an attorney *right now*
(`SHIP_READINESS.md` §1.2). Whoever is handling that review needs this in
front of them; it will not be obvious from the diff.

---

## What changed

Anthropic becomes a **data processor**. Selv previously had exactly one, which
is the whole reason `cf7e317` was able to reconcile the privacy policy down to
Supabase and strip out the vendors that were named but never integrated.
That statement is no longer true the moment anyone turns the assistant on.

## What is sent

Per request, for the caller only:

| Sent | Not sent |
|---|---|
| Garment category, colour, brand, tags | **Garment photographs** |
| Garment measurements + their provenance | Storage paths or signed URLs |
| The subject item on screen | Email, name, or any auth identifier |
| — | Height, weight, build, or any body metric |
| — | Affiliate clicks, conversions, order history |

Two of those exclusions are load-bearing rather than incidental:

**Photographs.** `legal/DATA_HANDLING.md` §2a rates garment images Medium and
they sit in a private, owner-RLS bucket no third party reads. Sending them
would make that statement false and materially change the App Privacy answer.
For the actual job — "what goes with a navy wool coat" — the colour and
category fields carry nearly all the signal. If a future version wants images
in the prompt, that is a product decision with a privacy review attached, not
a prompt tweak.

**Body metrics.** The prompt describes *garments*, never the wearer. The
system prompt also forbids the model from commenting on the user's body, size
or appearance. Height and weight do reach garment measurement *estimates*
(`lib/measurements/garmentMeasurements.ts` derives them locally), but the
derived garment number is what travels — never the body number it came from.

## Consent

`assistant_preferences.enabled` is `not null default false`. Nothing is sent
until a user turns it on in Profile → Wardrobe assistant, and that card carries
the full disclosure — it names Anthropic, names what is sent, and names that
photos are not.

**The default is off for timing, not principle.** The product intent is an
assistant that is simply on with a toggle for people who don't want it, and the
column is one word away from that. It ships off because:

1. Turning it on shares data under a published policy that does not name the
   processor doing the processing.
2. The App Privacy questionnaire (§1.13) is unanswered, and "data shared with
   third parties" is one of its questions.

Both clear at the same moment. **When counsel returns the policy with Anthropic
named, flip the default in a migration** — it was deliberately built as a
default rather than a hard rule so that flip is one line.

## What counsel needs to decide

1. **Name Anthropic as a processor** in `PRIVACY_POLICY.md`, with the category
   list above. Note this partially *reverses* `cf7e317`, which removed
   processors — the difference is that this one is real.
2. **Sub-processor / DPA.** Whether Anthropic's terms need papering the way
   §1.11 asks for Supabase's, and what applies for EU/UK users given where
   inference runs.
3. **Retention.** How long Anthropic holds prompt content under the account's
   plan, and whether that needs stating alongside the Supabase backup window
   (§1.10). `assistant_suggestions` rows live in Selv's own database and
   cascade on account deletion; what the processor keeps is a separate question.
4. **App Privacy answers that change:** "Data used to personalise" and
   "data shared with third parties" both move. The existing under-declaration
   of Product Interaction (`SHIP_READINESS.md` §0 item 2) is unaffected but
   compounds — both are the same form.
5. **Whether an in-product consent record is needed** beyond
   `prompted_at` / `enabled`, or whether the settings state suffices.

## What is *not* claimed here

This is an engineering description of what the code sends. It is not a legal
opinion, it does not clear any of the above, and the `[TBD]` convention in the
legal documents is untouched — nothing in this change closes a placeholder.

## Files

| Path | Role |
|---|---|
| `app/supabase/migrations/009_assistant.sql` | Consent column, suggestion record, RLS |
| `app/supabase/functions/wardrobe-assistant/index.ts` | The only place data leaves |
| `app/src/lib/api/assistant.ts` | Client API |
| `app/src/features/assistant/AssistantSettingsCard.tsx` | The consent surface |

## Operational note

The function requires `ANTHROPIC_API_KEY` in Supabase Edge Function secrets. It
returns `503 assistant_unavailable` when unset rather than an empty suggestion
list, so a missing key looks like an outage and not like a model with no ideas.
That key is **not** in the client bundle and must never be — `SHIP_READINESS.md`
§1.12's grep covers `app/src`, `app/app`, `app.json` and `eas.json`.
