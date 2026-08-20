import { supabase } from "../supabase";
import type { Build, ProfileRow } from "../database.types";
import {
  minimumAgeMessage,
  toIsoDate,
  type CivilDate,
} from "../../features/age/minimumAge";

export interface ApiResult<T> {
  data: T | null;
  error: string | null;
}

/** Fetch the profile row for a given user id (defaults to current user). */
export async function getProfile(
  userId: string
): Promise<ApiResult<ProfileRow>> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as ProfileRow | null, error: null };
}

export interface BodyMetricsInput {
  height_cm: number;
  weight_kg: number;
  build: Build;
}

/** Update the current user's height, weight, and general build. */
export async function updateBodyMetrics(
  userId: string,
  metrics: BodyMetricsInput
): Promise<ApiResult<ProfileRow>> {
  const { data, error } = await supabase
    .from("profiles")
    .update(metrics)
    .eq("id", userId)
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as ProfileRow, error: null };
}

/** Update the current user's display name. */
export async function updateDisplayName(
  userId: string,
  displayName: string
): Promise<ApiResult<ProfileRow>> {
  const { data, error } = await supabase
    .from("profiles")
    .update({ display_name: displayName })
    .eq("id", userId)
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as ProfileRow, error: null };
}

/**
 * Generic profile update.
 *
 * The `Pick` list is the whole client-writable surface of this table, and it
 * deliberately excludes `birth_year`/`age_verified_on`. That is not a
 * stylistic omission: 006_age_gate.sql revokes column-level UPDATE on those
 * two and re-grants only the columns named here, so adding them would compile
 * and then fail at PostgREST with a 42501 whose text points at permissions and
 * whose cause is the age gate. They move only through `recordAgeCheck` below.
 */
export async function updateProfile(
  userId: string,
  updates: Partial<
    Pick<ProfileRow, "display_name" | "height_cm" | "weight_kg" | "build">
  >
): Promise<ApiResult<ProfileRow>> {
  const { data, error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", userId)
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as ProfileRow, error: null };
}

// -{75}
// Age gate (13+) — LAUNCH_CHECKLIST.md §1
// ---------------------------------------------------------------------------

/**
 * What went wrong when recording an age check, beyond the message.
 *
 * `rejected` is the one distinction callers actually branch on: it means the
 * *database* refused this person for being under 13, as opposed to a network
 * blip, an expired session, or a fat-fingered year. The sign-in screen signs
 * the user out on a rejection — at that point we have actual knowledge that
 * the account belongs to someone under 13, and COPPA's standard is about
 * exactly that knowledge — but must not sign anyone out because their Wi-Fi
 * dropped.
 */
export interface AgeCheckResult extends ApiResult<ProfileRow> {
  rejected: boolean;
}

/**
 * Turn a `record_age_check` failure into something a user can read.
 *
 * The RPC signals with SQLSTATEs rather than message text so this mapping
 * doesn't depend on wording — same contract as `describeClickError` in
 * api/affiliate.ts:
 *
 *   42501  unauthenticated (the session went away mid-flow)
 *   22004  null date — a bug here, not a user error
 *   22007  future or implausible date
 *   P0001  under 13. The only one that is a verdict about the person.
 *
 * `error.message` is deliberately not surfaced. Postgres would happily hand
 * the raw `record_age_check: minimum age is 13` to the screen, and a database
 * function name in a rejection message is both noise and a small map of the
 * backend.
 *
 * The under-13 string is `minimumAgeMessage()` — the same function the
 * client-side gate uses — so a user who is refused locally and a user who is
 * refused by the server read the identical sentence. Two copies would drift,
 * and the drift shows up as "it said one thing when I tapped Continue and
 * something else a second later".
 */
function describeAgeCheckError(error: { code?: string | null }): {
  message: string;
  rejected: boolean;
} {
  switch (error.code) {
    case "P0001":
      return { message: minimumAgeMessage(), rejected: true };
    case "42501":
      return { message: "Your session expired. Please sign in again.", rejected: false };
    case "22007":
    case "22004":
      return {
        message: "That date doesn't look right. Check the day, month and year.",
        rejected: false,
      };
    default:
      return {
        message: "Couldn't confirm your date of birth. Please try again.",
        rejected: false,
      };
  }
}

/**
 * Normalise the RPC payload to a single row.
 *
 * `record_age_check` returns a non-SETOF composite, which PostgREST renders as
 * a bare object — but the same schema-cache/version quirk that makes a to-one
 * embed come back as a single-element array elsewhere in this codebase applies
 * here too, and `createCheckoutLink` already carries the same three lines for
 * the same reason. Accepting both shapes is cheap insurance on a path where
 * failing means an eligible user cannot get into the app at all.
 */
function firstProfileRow(
  data: ProfileRow | ProfileRow[] | null
): ProfileRow | null {
  if (!data) return null;
  const row = Array.isArray(data) ? (data[0] ?? null) : data;
  return row && typeof row.id === "string" ? row : null;
}

/**
 * Run the 13+ age check against the database and record its verdict.
 *
 * Delegates to the `record_age_check` RPC rather than updating `profiles`,
 * for the same reason `createCheckoutLink` delegates to
 * `create_affiliate_click`: the row carries a term the client must not be able
 * to state. There, a forged commission rate invoices a partner for their own
 * order value. Here, a forged age verdict is a 12-year-old with an account and
 * a privacy policy (legal/PRIVACY_POLICY.md §12) claiming we do not have any.
 * The column-level grants in 006_age_gate.sql mean there is no second path to
 * keep in sync — a direct update of either column fails with 42501 — so do not
 * "simplify" this into `updateProfile`.
 *
 * The screen has already run `checkBirthdate` before calling this, and that is
 * not redundant. The client-side pass exists to keep a rejected under-13 away
 * from the email step entirely, so Supabase never creates an `auth.users` row
 * for them (`signInWithOtp` runs with `shouldCreateUser: true`, so requesting
 * a code *is* creating an account). This call is the one that decides.
 *
 * WHAT LEAVES THE DEVICE: a `YYYY-MM-DD` string, once, as an RPC argument. It
 * is not stored — the function evaluates it against `current_date` and keeps
 * only the year and the verification date. That is the whole privacy argument
 * for the two-column design, and it only holds as long as this stays the sole
 * call site that touches a birthdate.
 */
export async function recordAgeCheck(
  birthdate: CivilDate
): Promise<AgeCheckResult> {
  const { data, error } = await supabase.rpc("record_age_check", {
    p_birthdate: toIsoDate(birthdate),
  });

  if (error) {
    const { message, rejected } = describeAgeCheckError(error);
    return { data: null, error: message, rejected };
  }

  const profile = firstProfileRow(data);
  if (!profile) {
    // The RPC raises on every failure it knows about, so an empty success body
    // means something upstream (a proxy, a schema-cache miss) mangled the
    // response. Treat it as a failure rather than as a pass: the caller must
    // not conclude "verified" from a body that never said so, and a retry is
    // one tap.
    return {
      data: null,
      error: "Couldn't confirm your date of birth. Please try again.",
      rejected: false,
    };
  }

  return { data: profile, error: null, rejected: false };
}
