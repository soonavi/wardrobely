/**
 * `delete-account` — permanent account deletion.
 *
 * Called by the app from `src/lib/api/account.ts` (`deleteAccount()`), which
 * uses `supabase.functions.invoke("delete-account", { method: "POST" })`. That
 * helper automatically attaches the caller's `Authorization: Bearer <access
 * token>` and `apikey` headers, so this function receives a real, verifiable
 * user JWT and nothing else.
 *
 * RESPONSE SHAPE (must match what account.ts parses):
 *   { success: true }                       -> client treats as success
 *   { success: false, error: "<message>" }  -> client throws with <message>
 *
 * WHY OPERATIONAL FAILURES RETURN HTTP 200
 * ----------------------------------------
 * `functions.invoke` collapses ANY non-2xx into a generic `FunctionsHttpError`
 * whose message is "Edge Function returned a non-2xx status code" and sets
 * `data` to null — the body is discarded. So a 500 with a helpful message
 * shows the user a meaningless string. To give the user something actionable
 * on a recoverable failure, those come back as HTTP 200 with
 * `{ success: false, error }`, which account.ts explicitly checks for. True
 * auth failures (401) and wrong method (405) still use real status codes,
 * because those are protocol-level and there is no useful user-facing message
 * to deliver anyway.
 *
 * IDEMPOTENCY
 * -----------
 * Every step tolerates "already gone": missing storage objects, missing rows,
 * and an already-deleted auth user all count as success. A user whose first
 * attempt half-completed (app killed mid-request, network drop) can press the
 * button again and reach a clean state.
 */

import {
  corsHeaders,
  handlePreflight,
  jsonResponse,
  newRequestId,
} from "../_shared/cors.ts";
import {
  getUserIdFromRequest,
  isMissingTableError,
  supabaseAdmin,
} from "../_shared/supabaseAdmin.ts";

/**
 * Buckets that hold per-user files under a `{user_id}/...` prefix.
 *
 * `garments` is the only one that exists in `schema.sql` today; the other two
 * are named in PRODUCT_SPEC.md §7 and are cleaned up here pre-emptively so
 * that creating them later does not silently start leaking deleted users'
 * files. A bucket that does not exist is skipped without failing the request.
 */
const USER_SCOPED_BUCKETS = ["garments", "avatar-previews", "outfit-thumbnails"];

/** Supabase Storage `list()` page size. 100 is the API default; 1000 is the max. */
const STORAGE_PAGE_SIZE = 1000;

/** Safety valve so a pathological account cannot run the function to timeout. */
const MAX_STORAGE_OBJECTS = 20_000;

/**
 * Tables holding a `user_id` that must be DE-IDENTIFIED rather than deleted.
 *
 * WHY NOT JUST LET THE CASCADE DELETE THEM:
 * `affiliate_clicks` and `affiliate_conversions` are financial records. A
 * conversion is money a brand owes Selv (or has already paid); a click is the
 * evidence backing that invoice, including the snapshotted commission rate. If
 * deleting a user's account deleted their conversions, then:
 *   - a brand could dispute an invoice line we can no longer substantiate;
 *   - our reported revenue would silently change retroactively whenever
 *     someone deleted their account;
 *   - a reversal postback arriving later would have no row to reverse.
 * Nulling `user_id` keeps the commercial record intact while removing the link
 * to the person — which is what a deletion request actually requires. The row
 * is then indistinguishable from a conversion we could never attribute.
 *
 * This runs BEFORE `auth.admin.deleteUser` precisely so it works regardless of
 * how the foreign key was declared: if `user_id` is `on delete cascade`, this
 * is what saves the rows; if it is `on delete set null`, this is a harmless
 * no-op that ran first.
 *
 * Both columns are nullable with `on delete set null` in migration
 * 002_commerce.sql, so this is belt-and-braces rather than strictly required
 * today — but it makes the intent explicit and survives someone later
 * "tidying" those foreign keys into cascades.
 *
 * `product_try_ons` is deliberately NOT in this list. Its `user_id` is
 * `not null references auth.users(id) on delete cascade`, so nulling it is
 * impossible and its rows are destroyed with the account. That means
 * per-product try-on counts DO decrease when a user deletes their account.
 * That is a defensible privacy-forward choice by the schema, but it is a real
 * caveat on a metric quoted to brands, so it is documented rather than hidden
 * (see AFFILIATE_SYSTEM.md §2.4). Changing it would require making
 * `product_try_ons.user_id` nullable — a schema decision, not one to make
 * here.
 */
const DE_IDENTIFY_TABLES = ["affiliate_clicks", "affiliate_conversions"];

/**
 * Tables that are explicitly deleted rather than relied on to cascade.
 *
 * `profiles`, `garments`, `avatars` and `outfits` all declare
 * `references auth.users(id) on delete cascade` in schema.sql, and
 * `outfit_items` cascades from `outfits`, so deleting the auth user is
 * sufficient for those. They are still listed here and deleted explicitly
 * first, because:
 *   (a) it makes the deletion set auditable from this file rather than
 *       requiring a reader to cross-check every FK in schema.sql, and
 *   (b) if a future migration ever adds one of these tables without the
 *       cascade (easy to do), this keeps working instead of silently
 *       orphaning a deleted user's wardrobe.
 * Deleting rows that would have cascaded anyway is harmless and cheap.
 */
const OWNED_TABLES = ["garments", "outfits", "avatars", "profiles"];

/**
 * Recursively collect every storage object path under `prefix` in `bucket`.
 *
 * Supabase Storage has no real directories — `list()` returns entries whose
 * `id` is null to represent a synthetic folder. Today garment paths are flat
 * (`{uid}/{garment_id}.jpg`), but recursing means a future nested layout does
 * not quietly leave files behind after a deletion.
 */
async function listAllObjects(
  bucket: string,
  prefix: string,
  requestId: string,
): Promise<{ paths: string[]; bucketMissing: boolean }> {
  const paths: string[] = [];
  const queue: string[] = [prefix];
  let bucketMissing = false;

  while (queue.length > 0 && paths.length < MAX_STORAGE_OBJECTS) {
    const current = queue.shift() as string;
    let offset = 0;

    for (;;) {
      const { data, error } = await supabaseAdmin.storage
        .from(bucket)
        .list(current, { limit: STORAGE_PAGE_SIZE, offset });

      if (error) {
        const message = error.message.toLowerCase();
        if (message.includes("not found") || message.includes("does not exist")) {
          bucketMissing = true;
        } else {
          console.warn(
            `[delete-account ${requestId}] storage list failed for ` +
              `${bucket}/${current}:`,
            error.message,
          );
        }
        break;
      }

      const entries = data ?? [];
      for (const entry of entries) {
        const fullPath = `${current}/${entry.name}`;
        // `id === null` marks a synthetic folder rather than an object.
        if (entry.id === null) {
          queue.push(fullPath);
        } else {
          paths.push(fullPath);
        }
      }

      if (entries.length < STORAGE_PAGE_SIZE) break;
      offset += STORAGE_PAGE_SIZE;
    }
  }

  return { paths, bucketMissing };
}

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const requestId = newRequestId();

  if (req.method !== "POST") {
    return jsonResponse(req, 405, {
      success: false,
      error: "Method not allowed. Use POST.",
      request_id: requestId,
    });
  }

  try {
    // --- 1. Identify the caller ---------------------------------------------
    //
    // SECURITY-CRITICAL: the user id comes ONLY from the verified JWT. The
    // request body is never read, and there is deliberately no `user_id`
    // parameter to read. If this function accepted an id from the payload,
    // any authenticated user — or anyone who obtained the anon key — could
    // permanently delete any other account by guessing or harvesting a uuid.
    // There is no undo. `getUserIdFromRequest` asks GoTrue to validate the
    // token (signature, expiry, and that the user still exists), so a forged
    // or stale token resolves to null and gets a 401.
    const userId = await getUserIdFromRequest(req);

    if (!userId) {
      return jsonResponse(req, 401, {
        success: false,
        error: "Not signed in.",
        request_id: requestId,
      });
    }

    console.log(`[delete-account ${requestId}] starting deletion for user ${userId}`);

    // --- 2. Storage ----------------------------------------------------------
    // Storage first: it is the only step that is NOT covered by any cascade.
    // If we deleted the auth user first and then failed here, the objects
    // would be permanently orphaned — no row, no owner, and no way for the
    // user to ever trigger cleanup again.
    let removedObjects = 0;

    for (const bucket of USER_SCOPED_BUCKETS) {
      const { paths, bucketMissing } = await listAllObjects(bucket, userId, requestId);

      if (bucketMissing) {
        // Expected for the buckets that are specced but not yet created.
        continue;
      }
      if (paths.length === 0) continue;

      // `remove()` accepts a batch; chunk it so an account with a large
      // wardrobe does not build one enormous request.
      for (let i = 0; i < paths.length; i += 100) {
        const chunk = paths.slice(i, i + 100);
        const { error } = await supabaseAdmin.storage.from(bucket).remove(chunk);

        if (error) {
          // Do not abort. A storage failure must not block the account
          // deletion itself — leaving a user unable to delete their account
          // because of a transient storage error is a worse outcome (and a
          // compliance problem) than a few residual files, which are logged
          // here for manual cleanup.
          console.error(
            `[delete-account ${requestId}] failed removing ${chunk.length} ` +
              `objects from ${bucket}:`,
            error.message,
          );
        } else {
          removedObjects += chunk.length;
        }
      }
    }

    // --- 3. De-identify financial / analytics rows ---------------------------
    // See the comment on DE_IDENTIFY_TABLES. Best-effort per table: a missing
    // table (the affiliate schema may not be migrated yet) or a NOT NULL
    // `user_id` column both degrade to a logged warning rather than failing
    // the user's deletion request.
    for (const table of DE_IDENTIFY_TABLES) {
      const { error } = await supabaseAdmin
        .from(table)
        .update({ user_id: null })
        .eq("user_id", userId);

      if (error && !isMissingTableError(error)) {
        console.warn(
          `[delete-account ${requestId}] could not de-identify ${table}:`,
          error.message,
        );
      }
    }

    // --- 4. Owned rows -------------------------------------------------------
    // Order matters: children before parents, so an explicit delete never
    // trips a restrictive foreign key. `outfit_items` is intentionally absent
    // — it has no `user_id` and cascades from `outfits`.
    for (const table of OWNED_TABLES) {
      const { error } = await supabaseAdmin
        .from(table)
        .delete()
        .eq(table === "profiles" ? "id" : "user_id", userId);

      if (error && !isMissingTableError(error)) {
        console.warn(
          `[delete-account ${requestId}] could not delete from ${table}:`,
          error.message,
        );
      }
    }

    // --- 5. The auth user ----------------------------------------------------
    // Last, because it is the irreversible one and because every cascade in
    // schema.sql hangs off it. Once this succeeds the user's session is dead
    // and they can never re-authenticate to retry the earlier steps.
    const { error: deleteUserError } = await supabaseAdmin.auth.admin.deleteUser(
      userId,
    );

    if (deleteUserError) {
      const message = deleteUserError.message.toLowerCase();

      // Idempotency: a retry after a partially-completed first attempt finds
      // the user already gone. That is the desired end state, not an error.
      const alreadyGone =
        message.includes("not found") || message.includes("user_not_found");

      if (!alreadyGone) {
        console.error(
          `[delete-account ${requestId}] auth.admin.deleteUser failed for ` +
            `${userId}:`,
          deleteUserError.message,
        );
        // 200 + success:false so account.ts surfaces this exact sentence to
        // the user — see the module comment.
        return jsonResponse(req, 200, {
          success: false,
          error:
            "We couldn't finish deleting your account. Please try again, or " +
            `contact support with reference ${requestId}.`,
          request_id: requestId,
        });
      }

      console.log(
        `[delete-account ${requestId}] user ${userId} already deleted — ` +
          "treating as success (idempotent retry).",
      );
    }

    console.log(
      `[delete-account ${requestId}] completed for user ${userId} ` +
        `(${removedObjects} storage objects removed)`,
    );

    return jsonResponse(req, 200, {
      success: true,
      request_id: requestId,
    });
  } catch (err) {
    console.error(
      `[delete-account ${requestId}] unhandled error:`,
      err instanceof Error ? err.stack ?? err.message : String(err),
    );
    return new Response(
      JSON.stringify({
        success: false,
        error:
          "We couldn't finish deleting your account. Please try again, or " +
          `contact support with reference ${requestId}.`,
        request_id: requestId,
      }),
      // 200 rather than 500 so the message above actually reaches the user.
      { status: 200, headers: corsHeaders(req) },
    );
  }
});
