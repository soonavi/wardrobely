import { supabase } from "../supabase";
import type { ApiResult } from "./garments";

/**
 * ============================================================================
 * Wardrobe assistant — client API.
 * ============================================================================
 * Thin wrapper over the `wardrobe-assistant` Edge Function and the
 * `assistant_preferences` table (migration 009).
 *
 * The screens never call `supabase` directly — the convention the rest of
 * `lib/api/*` follows — and they never see the raw Edge Function error codes;
 * `AssistantOutcome` below turns them into the three states a screen actually
 * has to render differently.
 */

export type SuggestionFrequency = "minimal" | "balanced" | "frequent";

export interface AssistantPreferences {
  enabled: boolean;
  promptedAt: string | null;
  suggestionFrequency: SuggestionFrequency;
}

export interface AssistantSuggestion {
  garmentId: string;
  reason: string;
}

/**
 * Why the three "no suggestions" cases are separate variants rather than an
 * empty array with a message.
 *
 * "You turned this off", "you have nothing else in your wardrobe" and "we had
 * no good pairings" are three different screens: the first needs the settings
 * toggle, the second needs an add-garment prompt, the third needs nothing at
 * all. Collapsing them into `suggestions: []` is how a disabled feature ends
 * up looking broken.
 */
export type AssistantOutcome =
  | { status: "ok"; suggestionId: string | null; suggestions: AssistantSuggestion[] }
  | { status: "disabled" }
  | { status: "empty_wardrobe" }
  | { status: "unavailable"; message: string };

interface AssistantResponseBody {
  suggestionId?: string | null;
  suggestions?: Array<{ garment_id: string; reason: string }>;
  reason?: string;
  error?: string;
  requestId?: string;
}

/** Read the caller's assistant settings. A missing row means never opted in. */
export async function getAssistantPreferences(
  userId: string,
): Promise<ApiResult<AssistantPreferences>> {
  const { data, error } = await supabase
    .from("assistant_preferences")
    .select("enabled, prompted_at, suggestion_frequency")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return { data: null, error: error.message };

  // Defaults mirror 009's column defaults exactly. A screen must render the
  // same thing for "no row" as the database would for a fresh one, or the
  // toggle appears to change state the first time it is saved.
  return {
    data: {
      enabled: data?.enabled ?? false,
      promptedAt: data?.prompted_at ?? null,
      suggestionFrequency:
        (data?.suggestion_frequency as SuggestionFrequency | undefined) ?? "balanced",
    },
    error: null,
  };
}

/**
 * Turn the assistant on or off.
 *
 * Upsert rather than update: the row does not exist until the user has an
 * opinion, and creating it lazily here means onboarding does not have to
 * remember to seed one for every account.
 *
 * `promptedAt` is stamped whenever a value is written, so a user who declines
 * is not asked again — the distinction 009's column comment describes.
 */
export async function setAssistantEnabled(
  userId: string,
  enabled: boolean,
): Promise<ApiResult<AssistantPreferences>> {
  const { data, error } = await supabase
    .from("assistant_preferences")
    .upsert(
      { user_id: userId, enabled, prompted_at: new Date().toISOString() },
      { onConflict: "user_id" },
    )
    .select("enabled, prompted_at, suggestion_frequency")
    .single();

  if (error) return { data: null, error: error.message };

  return {
    data: {
      enabled: data.enabled,
      promptedAt: data.prompted_at,
      suggestionFrequency: data.suggestion_frequency as SuggestionFrequency,
    },
    error: null,
  };
}

export async function setSuggestionFrequency(
  userId: string,
  frequency: SuggestionFrequency,
): Promise<ApiResult<null>> {
  const { error } = await supabase
    .from("assistant_preferences")
    .upsert(
      { user_id: userId, suggestion_frequency: frequency },
      { onConflict: "user_id" },
    );

  return error ? { data: null, error: error.message } : { data: null, error: null };
}

/**
 * Ask the assistant what goes with one item.
 *
 * Exactly one of `garmentId` / `productId`, matching
 * `assistant_suggestions_one_subject` in 009 and the function's own guard.
 * Passing both, or neither, is a programming error and is caught here rather
 * than costing a round trip.
 */
export async function getSuggestions(subject: {
  garmentId?: string;
  productId?: string;
}): Promise<AssistantOutcome> {
  const { garmentId, productId } = subject;

  if ((garmentId ? 1 : 0) + (productId ? 1 : 0) !== 1) {
    return {
      status: "unavailable",
      message: "Ask for suggestions about exactly one item.",
    };
  }

  const { data, error } = await supabase.functions.invoke<AssistantResponseBody>(
    "wardrobe-assistant",
    { body: garmentId ? { garmentId } : { productId } },
  );

  // `functions.invoke` reports a non-2xx as an error, so the disabled case —
  // a deliberate 403 — arrives here rather than in `data`. Reading the body is
  // the only way to tell it apart from a real failure.
  if (error) {
    const code = (data as AssistantResponseBody | null)?.error;
    if (code === "assistant_disabled") return { status: "disabled" };
    return {
      status: "unavailable",
      message: "Couldn't reach the assistant. Try again in a moment.",
    };
  }

  if (data?.error === "assistant_disabled") return { status: "disabled" };
  if (data?.reason === "empty_wardrobe") return { status: "empty_wardrobe" };

  return {
    status: "ok",
    suggestionId: data?.suggestionId ?? null,
    suggestions: (data?.suggestions ?? []).map((s) => ({
      garmentId: s.garment_id,
      reason: s.reason,
    })),
  };
}

/**
 * Record that a suggestion was dismissed or acted on.
 *
 * These two columns are the only ones 009 grants the client, and they are the
 * only measure of whether the assistant is any good. Failing silently is
 * acceptable — the user's action already happened in the UI and re-raising a
 * write failure would interrupt them over a metric.
 */
export async function markSuggestion(
  suggestionId: string,
  outcome: "dismissed" | "acted",
): Promise<void> {
  // Built as two literal branches rather than `{ [column]: ... }`. A computed
  // key widens to `{ [x: string]: string }`, which defeats the narrow Update
  // type in database.types.ts — the type whose whole job is to stop a caller
  // writing a column 009 revoked the grant for. Losing that check to save a
  // line would make the type decorative.
  const patch =
    outcome === "dismissed"
      ? { dismissed_at: new Date().toISOString() }
      : { acted_at: new Date().toISOString() };

  await supabase
    .from("assistant_suggestions")
    .update(patch)
    .eq("id", suggestionId);
}
