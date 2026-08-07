/**
 * Service-role Supabase client shared by every Edge Function in this
 * directory.
 *
 * WHY SERVICE ROLE
 * ----------------
 * All three functions here legitimately need to bypass RLS:
 *   - `affiliate-postback` writes a conversion row on behalf of a brand's
 *     server, which has no Supabase user at all.
 *   - `product-feed-ingest` writes `brand_products` rows authenticated by a
 *     brand API key, again with no Supabase user.
 *   - `delete-account` deletes another schema's rows (`auth.users`) and
 *     storage objects, which no anon/authenticated JWT can do.
 *
 * That makes this module the single most dangerous file in the repo: every
 * caller of it is one missing authorization check away from a full data
 * breach. The rule for anything importing this client is therefore:
 * **authenticate and authorize first, touch this client second.** Each
 * function does its own check (HMAC signature / brand API key / user JWT)
 * before the first query, and derives the tenant id (`brand_id`, `user_id`)
 * from that check — never from the request body.
 *
 * `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically
 * into every Supabase-hosted Edge Function, so in production these are
 * already present without `supabase secrets set`. They still have to be in
 * `.env` for `supabase functions serve` locally.
 */

import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

// Fail loudly at module load rather than at first query. A function that
// boots "fine" and then 500s on every request is far harder to diagnose than
// one that refuses to start — and for the postback endpoint specifically, a
// silent misconfiguration means silently losing revenue events that the
// network will eventually stop retrying.
if (!SUPABASE_URL) {
  throw new Error(
    "[supabaseAdmin] SUPABASE_URL is not set. Supabase injects this " +
      "automatically in hosted Edge Functions; set it in supabase/.env for " +
      "local `supabase functions serve`.",
  );
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "[supabaseAdmin] SUPABASE_SERVICE_ROLE_KEY is not set. Supabase injects " +
      "this automatically in hosted Edge Functions; set it in supabase/.env " +
      "for local `supabase functions serve`. Never commit this value.",
  );
}

/**
 * The service-role client. Bypasses RLS entirely — see the module comment.
 *
 * `persistSession: false` / `autoRefreshToken: false` because an Edge
 * Function is a stateless request handler: there is no storage to persist a
 * session into and no long-lived process to refresh a token on, and leaving
 * them enabled makes the client try to write to a non-existent localStorage.
 */
export const supabaseAdmin: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        // Shows up in Postgres logs / Supabase's request inspector so
        // service-role traffic from Edge Functions is distinguishable from
        // service-role traffic from anywhere else.
        "X-Client-Info": "selv-edge-functions",
      },
    },
  },
);

/**
 * Extract a bearer token from an `Authorization: Bearer <token>` header.
 * Returns `null` when the header is absent or malformed. Case-insensitive on
 * the scheme because clients are inconsistent about `Bearer` vs `bearer`.
 */
export function extractBearerToken(req: Request): string | null {
  const header = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!header) return null;

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;

  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

/**
 * Verify a Supabase user access token and return the user id.
 *
 * This is the *only* sanctioned way for a function in this directory to
 * learn who the caller is. It asks GoTrue to validate the JWT (signature,
 * expiry, and that the user still exists — a locally-verified signature
 * would happily accept a token belonging to an already-deleted account),
 * and returns the `sub` from the verified token.
 *
 * Returns `null` for any invalid/expired/absent token. Callers must treat
 * `null` as 401 and must never fall back to a user id supplied in the
 * request body.
 */
export async function getUserIdFromRequest(req: Request): Promise<string | null> {
  const token = extractBearerToken(req);
  if (!token) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user?.id) return null;

  return data.user.id;
}

/**
 * Postgres error code for "relation does not exist".
 *
 * Used by best-effort cleanup paths that touch tables which may not have
 * been migrated yet (the affiliate tables land in `schema.sql` separately
 * from these functions). Treating a missing table as a no-op keeps
 * `delete-account` working on a database that predates them, instead of
 * failing a user's deletion request over an unrelated table.
 */
export const PG_UNDEFINED_TABLE = "42P01";

/**
 * PostgREST's own code for "table not in the schema cache".
 *
 * PostgREST usually rejects an unknown table at the routing layer before
 * Postgres ever sees the statement, so a missing table surfaces as this
 * rather than as `42P01`. Both have to be checked; checking only the Postgres
 * code silently misses the common case.
 */
export const PGRST_UNDEFINED_TABLE = "PGRST205";

/** True when an error means "that table doesn't exist", from either layer. */
export function isMissingTableError(
  error: { code?: string | null } | null | undefined,
): boolean {
  if (!error?.code) return false;
  return error.code === PG_UNDEFINED_TABLE || error.code === PGRST_UNDEFINED_TABLE;
}

/** Postgres error code for a unique-constraint violation. */
export const PG_UNIQUE_VIOLATION = "23505";
