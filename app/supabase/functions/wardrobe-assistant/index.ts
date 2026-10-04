/**
 * ============================================================================
 * wardrobe-assistant — "what else in my wardrobe goes with this?"
 * ============================================================================
 * Called by the app when a user is looking at one garment or one shop product.
 * Reads their wardrobe server-side, asks Claude what would pair with the thing
 * on screen, and returns a short ranked list of items they already own.
 *
 * WHY THE WARDROBE IS READ HERE AND NOT SENT BY THE CLIENT
 * ---------------------------------------------------------
 * The obvious shape is for the app to POST its own wardrobe and let this
 * function forward it. That is wrong for the same reason
 * `create_affiliate_click` derives the commission rate server-side (003): a
 * value the client states is a value the client can lie about. Here the lie is
 * cheap and the damage is small — a user could ask us to reason about garments
 * they do not own — but the shape matters more than this instance, because the
 * suggestion row we persist is a record of what we recommended, and a record
 * built from client-supplied inputs is not evidence of anything.
 *
 * So: the client sends an id and nothing else. Everything the model sees comes
 * from a query scoped to the caller's own `user_id`.
 *
 * WHAT ACTUALLY LEAVES THIS FUNCTION
 * ----------------------------------
 * Text metadata only: category, colour, brand, tags and measurements. NOT the
 * garment photographs.
 *
 * That is a deliberate line, not an oversight. The images are the most
 * sensitive thing in the app — `legal/DATA_HANDLING.md` §2a rates them Medium
 * and they sit in a private, owner-RLS bucket that no third party reads. The
 * whole reconciliation in cf7e317 turned on being able to say that. Sending
 * them to a vision model would make that statement false, would materially
 * expand the App Privacy answer, and — for the actual job of "what goes with a
 * navy wool coat" — buys very little that the colour and category fields do
 * not already carry. If a future version wants photographs in the prompt, that
 * is a product decision with a privacy review attached, not a prompt tweak.
 *
 * CONSENT
 * -------
 * `assistant_preferences.enabled` gates every call and defaults to false.
 * A disabled user gets 403 with a machine-readable code, not an empty list —
 * "you turned this off" and "we had no ideas" must not look the same to the
 * client, or the settings toggle appears broken.
 */

import Anthropic from "npm:@anthropic-ai/sdk@0.71.0";

import {
  handlePreflight,
  jsonResponse,
  newRequestId,
} from "../_shared/cors.ts";
import {
  getUserIdFromRequest,
  supabaseAdmin,
} from "../_shared/supabaseAdmin.ts";

/**
 * Opus 5 rather than a cheaper tier. This is a taste judgement rendered in one
 * or two sentences per item — short output, and the quality difference is the
 * entire product. Cost is bounded by the suggestion cache in 009 (a wardrobe
 * that has not changed does not get re-asked) rather than by model choice.
 */
const MODEL = "claude-opus-5";

/** Wardrobe items sent to the model per request. */
const MAX_WARDROBE_ITEMS = 120;

/** Suggestions we ask for. Small on purpose: this is a nudge, not a catalogue. */
const MAX_SUGGESTIONS = 4;

const SYSTEM_PROMPT = `You are Selv's wardrobe assistant. The user is looking at one garment. Your job is to name items from their OWN wardrobe that would work with it, and say why in one short sentence each.

Rules:
- Only ever suggest items from the wardrobe list you are given. Never invent an item, and never suggest something they should buy.
- Suggest at most ${MAX_SUGGESTIONS} items, fewest that genuinely work. Two strong pairings beat four weak ones. Returning an empty list is a valid and useful answer when nothing in the wardrobe goes with the subject.
- Never suggest the subject item itself.
- Reasons must be concrete and about these specific garments — colour, texture, formality, proportion, layering. "It matches" and "this is versatile" are not reasons.
- Do not comment on the user's body, size, weight or appearance. You are commenting on clothes.
- Measurements marked "estimated" are our guess, not a fact. Do not build a fit claim on one.`;

interface WardrobeItem {
  id: string;
  name: string | null;
  category: string;
  color: string | null;
  brand: string | null;
  tags: string[];
  measurement_source: string | null;
  chest_cm: number | null;
  waist_cm: number | null;
  hip_cm: number | null;
  length_cm: number | null;
  shoulder_cm: number | null;
  sleeve_cm: number | null;
  inseam_cm: number | null;
}

const ITEM_COLUMNS =
  "id, name, category, color, brand, tags, measurement_source, " +
  "chest_cm, waist_cm, hip_cm, length_cm, shoulder_cm, sleeve_cm, inseam_cm";

/**
 * Render one garment as a compact line for the prompt.
 *
 * Measurements carry their provenance into the prompt for the same reason the
 * UI carries it to the user (`lib/measurements/garmentMeasurements.ts`): an
 * estimate presented as a measurement invites the model to make a fit claim
 * we cannot stand behind.
 */
function describeItem(item: WardrobeItem): string {
  const bits: string[] = [item.category];
  if (item.color) bits.push(item.color);
  if (item.brand) bits.push(item.brand);
  if (item.tags?.length) bits.push(item.tags.join("/"));

  const axes: Array<[string, number | null]> = [
    ["chest", item.chest_cm],
    ["waist", item.waist_cm],
    ["hip", item.hip_cm],
    ["length", item.length_cm],
    ["shoulder", item.shoulder_cm],
    ["sleeve", item.sleeve_cm],
    ["inseam", item.inseam_cm],
  ];
  const measured = axes
    .filter(([, v]) => typeof v === "number")
    .map(([k, v]) => `${k} ${v}cm`);

  if (measured.length > 0) {
    const qualifier = item.measurement_source === "estimated" ? " (estimated)" : "";
    bits.push(`${measured.join(", ")}${qualifier}`);
  }

  return `- id=${item.id} | ${item.name ?? "Untitled"} | ${bits.join(" | ")}`;
}

/** The shape we make Claude return, so parsing is not a guessing game. */
const SUGGESTION_SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      maxItems: MAX_SUGGESTIONS,
      items: {
        type: "object",
        properties: {
          garment_id: { type: "string" },
          reason: { type: "string" },
        },
        required: ["garment_id", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["suggestions"],
  additionalProperties: false,
} as const;

interface Suggestion {
  garment_id: string;
  reason: string;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const requestId = newRequestId();

  if (req.method !== "POST") {
    return jsonResponse(req, 405, { error: "method_not_allowed", requestId });
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    // Loud, and distinguishable from "the model had no ideas". A missing key
    // is an operator problem; returning an empty suggestion list would hide it
    // behind a feature that merely looks unhelpful.
    console.error(`[${requestId}] ANTHROPIC_API_KEY is not set`);
    return jsonResponse(req, 503, { error: "assistant_unavailable", requestId });
  }

  const userId = await getUserIdFromRequest(req);
  if (!userId) {
    return jsonResponse(req, 401, { error: "unauthorized", requestId });
  }

  let body: { garmentId?: string; productId?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(req, 400, { error: "invalid_json", requestId });
  }

  const { garmentId, productId } = body;
  // Mirrors `assistant_suggestions_one_subject` in 009. Checked here too so a
  // malformed request gets a 400 naming the problem rather than a 500 from a
  // constraint violation three queries later.
  if ((garmentId ? 1 : 0) + (productId ? 1 : 0) !== 1) {
    return jsonResponse(req, 400, { error: "exactly_one_subject_required", requestId });
  }

  // --- Consent -------------------------------------------------------------
  const { data: prefs, error: prefsError } = await supabaseAdmin
    .from("assistant_preferences")
    .select("enabled")
    .eq("user_id", userId)
    .maybeSingle();

  if (prefsError) {
    console.error(`[${requestId}] preferences read failed: ${prefsError.message}`);
    return jsonResponse(req, 500, { error: "internal_error", requestId });
  }

  // No row means never opted in — the same answer as an explicit false. The
  // client turns this code into the opt-in prompt.
  if (!prefs?.enabled) {
    return jsonResponse(req, 403, { error: "assistant_disabled", requestId });
  }

  // --- The subject ---------------------------------------------------------
  let subjectLine: string;

  if (garmentId) {
    const { data, error } = await supabaseAdmin
      .from("garments")
      .select(ITEM_COLUMNS)
      .eq("id", garmentId)
      .eq("user_id", userId) // scoping, not filtering: service role bypasses RLS
      .maybeSingle();

    if (error) {
      console.error(`[${requestId}] subject garment read failed: ${error.message}`);
      return jsonResponse(req, 500, { error: "internal_error", requestId });
    }
    if (!data) return jsonResponse(req, 404, { error: "subject_not_found", requestId });

    subjectLine = describeItem(data as WardrobeItem);
  } else {
    const { data, error } = await supabaseAdmin
      .from("brand_products")
      .select("id, name, category, color, price_cents, tags, brands(name, status)")
      .eq("id", productId!)
      .maybeSingle();

    if (error) {
      console.error(`[${requestId}] subject product read failed: ${error.message}`);
      return jsonResponse(req, 500, { error: "internal_error", requestId });
    }
    if (!data) return jsonResponse(req, 404, { error: "subject_not_found", requestId });

    const p = data as unknown as {
      id: string;
      name: string;
      category: string;
      color: string | null;
      tags: string[] | null;
      brands: { name: string } | null;
    };
    const bits = [p.category, p.color, p.brands?.name, p.tags?.join("/")].filter(Boolean);
    subjectLine = `- ${p.name} | ${bits.join(" | ")}`;
  }

  // --- The wardrobe --------------------------------------------------------
  // `neq` on the subject so the model is never offered the thing it is being
  // asked about. The system prompt forbids it too; the query makes the
  // instruction unnecessary rather than trusting it.
  let wardrobeQuery = supabaseAdmin
    .from("garments")
    .select(ITEM_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(MAX_WARDROBE_ITEMS);

  if (garmentId) wardrobeQuery = wardrobeQuery.neq("id", garmentId);

  const { data: wardrobe, error: wardrobeError } = await wardrobeQuery;

  if (wardrobeError) {
    console.error(`[${requestId}] wardrobe read failed: ${wardrobeError.message}`);
    return jsonResponse(req, 500, { error: "internal_error", requestId });
  }

  const items = (wardrobe ?? []) as WardrobeItem[];
  if (items.length === 0) {
    // An empty wardrobe is not an error and not worth a paid API call.
    return jsonResponse(req, 200, { suggestions: [], reason: "empty_wardrobe", requestId });
  }

  // --- Ask Claude ----------------------------------------------------------
  const client = new Anthropic({ apiKey });

  const userPrompt = [
    "The user is looking at this item:",
    subjectLine,
    "",
    `Their wardrobe (${items.length} items):`,
    ...items.map(describeItem),
  ].join("\n");

  let parsed: { suggestions: Suggestion[] };
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      // Adaptive thinking: pairing judgement is exactly the kind of small
      // reasoning task it helps on, and `effort: "low"` keeps the spend
      // proportionate to a four-item answer.
      thinking: { type: "adaptive" },
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: SUGGESTION_SCHEMA },
      },
      system: [
        // Cached: the system prompt is byte-identical on every request, and it
        // is the only stable prefix here (the wardrobe changes per user).
        { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: userPrompt }],
    });

    if (response.stop_reason === "refusal") {
      console.warn(`[${requestId}] model refused: ${response.stop_details?.category}`);
      return jsonResponse(req, 200, { suggestions: [], reason: "declined", requestId });
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    parsed = JSON.parse(text) as { suggestions: Suggestion[] };
  } catch (err) {
    console.error(`[${requestId}] anthropic call failed: ${String(err)}`);
    return jsonResponse(req, 502, { error: "assistant_failed", requestId });
  }

  // --- Trust nothing the model returned ------------------------------------
  // The schema guarantees shape, not truth: `garment_id` is a string, but
  // nothing stops it being a plausible-looking id that is not in this
  // wardrobe. Filtering against the ids we actually sent is what keeps a
  // hallucinated item from being rendered as something the user owns.
  const ownedIds = new Set(items.map((i) => i.id));
  const suggestions = (parsed.suggestions ?? [])
    .filter((s) => s && typeof s.garment_id === "string" && ownedIds.has(s.garment_id))
    .slice(0, MAX_SUGGESTIONS);

  // --- Record it -----------------------------------------------------------
  // Best-effort: a failed insert costs the cache entry and the quality record,
  // and there is no reason to fail a good answer over it.
  const { data: row, error: insertError } = await supabaseAdmin
    .from("assistant_suggestions")
    .insert({
      user_id: userId,
      subject_garment_id: garmentId ?? null,
      subject_product_id: productId ?? null,
      suggestions,
      model: MODEL,
    })
    .select("id")
    .maybeSingle();

  if (insertError) {
    console.error(`[${requestId}] suggestion insert failed: ${insertError.message}`);
  }

  return jsonResponse(req, 200, {
    suggestionId: row?.id ?? null,
    suggestions,
    requestId,
  });
});
