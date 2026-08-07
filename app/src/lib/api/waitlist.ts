import { supabase } from "../supabase";
import type { WaitlistSignupRow, WaitlistSource } from "../database.types";

/**
 * The Selv+ waitlist — what the wardrobe cap offers instead of a purchase.
 *
 * Selv+ is not for sale. There is no RevenueCat dependency, no StoreKit
 * product, and nothing in v1 charges anyone. `getCurrentPlan()` in
 * src/lib/pricing.ts is hardcoded to "free" precisely because there is no
 * entitlement to read. So the 25-item cap, which is real and enforced twice
 * (in the wardrobe UI and again in `createGarment`), used to end at a button
 * wired to a `// TODO`. This module is what that button does now: record that
 * this user wants the cap lifted, and where they were standing when they
 * wanted it.
 *
 * The design constraint that shapes everything below is that a waitlist is
 * only worth anything if the person believes it. Every failure mode has to
 * read as either "done" or "try that again" — never as a scolding, and never
 * as a raw Postgres string. In particular a second tap is a SUCCESS: the user
 * is on the list, which is exactly what they asked for, and telling them
 * "duplicate key value violates unique constraint" for wanting it twice is
 * the same species of bug as the dead Upgrade button.
 *
 * See supabase/migrations/004_waitlist.sql for the table, its RLS policies,
 * and why `email` is accepted from the client here when
 * `affiliate_clicks.commission_rate_bps` deliberately is not.
 */

/** Local re-declaration, matching the convention in outfits.ts and garments.ts. */
export interface ApiResult<T> {
  data: T | null;
  error: string | null;
}

// Re-exported so the paywall screens can import their row and enum types from
// the same module as the functions that return them, instead of reaching into
// database.types — the same convention api/shop.ts uses for BrandProductRow.
// database.types.ts is the single declaration of both, so a column rename in
// the migration surfaces in exactly one place.
export type { WaitlistSignupRow, WaitlistSource };

export interface JoinWaitlistInput {
  userId: string;
  /** Trimmed and lowercased before it is sent; see `normalizeEmail`. */
  email: string;
  source: WaitlistSource;
}

export interface WaitlistJoinResult {
  signup: WaitlistSignupRow;
  /**
   * True when the row already existed and this call changed nothing.
   *
   * Both values are successes and the caller should say so either way; this
   * flag exists only so the copy can be accurate ("you're on the list"
   * rather than "you're on the list now"), and so the UI can show the address
   * we will actually use — which, for a user who joined earlier from another
   * screen, may not be the one they just typed.
   */
  alreadyJoined: boolean;
}

/** Shown when the write fails for a reason the user can retry past. */
const GENERIC_JOIN_ERROR =
  "Couldn't save your spot just now. Please try again.";

/** Shown for a locally- or database-rejected address. */
const INVALID_EMAIL_ERROR =
  "That doesn't look like an email address — mind checking it?";

/** Shown when the session is gone; RLS refuses the write with no uid. */
const SIGNED_OUT_ERROR = "Please sign in again to join the list.";

/** Unique violation — the user already has a row (the PK is `user_id`). */
const PG_UNIQUE_VIOLATION = "23505";
/** Check-constraint violation — in practice `waitlist_signups_email_shape`. */
const PG_CHECK_VIOLATION = "23514";
/** insufficient_privilege — RLS refused, i.e. `auth.uid()` didn't match. */
const PG_INSUFFICIENT_PRIVILEGE = "42501";

/**
 * Canonical form of an address for storage: trimmed and lowercased.
 *
 * Lowercasing the whole address (not just the domain) is technically lossy —
 * the local part is case-sensitive per RFC 5321 — but no mail provider anyone
 * signs up with actually honours that, and the alternative is treating
 * `Ben@x.com` and `ben@x.com` as two people we announce to twice.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Cheap shape check, mirroring the `waitlist_signups_email_shape` constraint
 * in 004_waitlist.sql closely enough that the database rarely has to reject
 * anything.
 *
 * Deliberately permissive: this is here to catch the empty box and the
 * obvious typo while the user is still looking at the input, not to
 * adjudicate RFC 5322. Anything stricter rejects real addresses, and the only
 * thing that ever truly validates an address is sending to it.
 */
export function isPlausibleEmail(email: string): boolean {
  const trimmed = email.trim();
  return trimmed.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

/**
 * Put the user on the Selv+ waitlist.
 *
 * Returns `{ alreadyJoined: true }` rather than an error when they are
 * already on it. That case is reached by an ordinary insert hitting the
 * primary key, not by checking first and then inserting: the check-then-write
 * version has a race (two taps, two reads that both see nothing, one of which
 * then fails anyway) and costs a round trip on the common path, whereas
 * letting the constraint decide is atomic and only pays for the read in the
 * duplicate case.
 *
 * `upsert(..., { ignoreDuplicates: true })` — the shape `addToWishlist` uses
 * in api/shop.ts — is not usable here for two reasons: it returns no row on
 * conflict, so it cannot tell "joined" from "already joined" or report which
 * address we hold, and the non-ignoring variant would need UPDATE on `source`
 * and `created_at`, which the migration revokes on purpose.
 */
export async function joinWaitlist(
  input: JoinWaitlistInput
): Promise<ApiResult<WaitlistJoinResult>> {
  const email = normalizeEmail(input.email);

  if (!isPlausibleEmail(email)) {
    return { data: null, error: INVALID_EMAIL_ERROR };
  }

  const { data, error } = await supabase
    .from("waitlist_signups")
    .insert({ user_id: input.userId, email, source: input.source })
    .select()
    .single();

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      // Already on the list. Read back the row we lost the race to (or wrote
      // on a previous visit) so the caller can name the address we actually
      // hold, which may differ from the one just typed.
      const { data: existing, error: readError } = await getWaitlistSignup(
        input.userId
      );

      if (readError) {
        return { data: null, error: readError };
      }

      if (existing) {
        return { data: { signup: existing, alreadyJoined: true }, error: null };
      }

      // A unique violation with nothing readable behind it should be
      // impossible: the PK collided, so a row exists, and the select policy
      // scopes to the same uid the insert policy just matched. Rather than
      // invent a row, fail — but do it with the retry copy, because the user
      // is in fact on the list and a retry will land here again harmlessly.
      return { data: null, error: GENERIC_JOIN_ERROR };
    }

    if (error.code === PG_CHECK_VIOLATION) {
      return { data: null, error: INVALID_EMAIL_ERROR };
    }

    if (error.code === PG_INSUFFICIENT_PRIVILEGE) {
      return { data: null, error: SIGNED_OUT_ERROR };
    }

    return { data: null, error: GENERIC_JOIN_ERROR };
  }

  return {
    data: { signup: data, alreadyJoined: false },
    error: null,
  };
}

/**
 * The user's waitlist row, or `null` when they haven't joined.
 *
 * `null` data with `null` error is the "not joined" answer and is not a
 * failure — `maybeSingle` rather than `single` so an absent row doesn't
 * arrive as a PostgrestError the caller has to decode. Used to open the sheet
 * in the right state instead of showing the form to someone who already
 * signed up and then rejecting their tap.
 */
export async function getWaitlistSignup(
  userId: string
): Promise<ApiResult<WaitlistSignupRow | null>> {
  const { data, error } = await supabase
    .from("waitlist_signups")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return { data: null, error: GENERIC_JOIN_ERROR };
  }

  return { data: data ?? null, error: null };
}

/**
 * Change the address on an existing signup.
 *
 * Exists because the primary key means there is no second chance at the
 * insert: someone who typo'd, or who joined on an Apple private-relay address
 * they never read, would otherwise be permanently on a list that cannot reach
 * them while the UI tells them they're all set.
 *
 * Only `email` moves. `source` and `created_at` are not merely omitted here —
 * the migration revokes UPDATE and re-grants it on `email` alone, so a future
 * caller that tries to rewrite when or where the signup happened is refused
 * by the database rather than by this function's argument list.
 */
export async function updateWaitlistEmail(
  userId: string,
  email: string
): Promise<ApiResult<WaitlistSignupRow>> {
  const normalized = normalizeEmail(email);

  if (!isPlausibleEmail(normalized)) {
    return { data: null, error: INVALID_EMAIL_ERROR };
  }

  const { data, error } = await supabase
    .from("waitlist_signups")
    .update({ email: normalized })
    .eq("user_id", userId)
    .select()
    .single();

  if (error) {
    if (error.code === PG_CHECK_VIOLATION) {
      return { data: null, error: INVALID_EMAIL_ERROR };
    }

    if (error.code === PG_INSUFFICIENT_PRIVILEGE) {
      return { data: null, error: SIGNED_OUT_ERROR };
    }

    return { data: null, error: GENERIC_JOIN_ERROR };
  }

  return { data, error: null };
}
