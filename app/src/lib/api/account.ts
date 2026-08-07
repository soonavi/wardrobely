import { supabase } from "../supabase";

/** Shape of the `delete-account` Edge Function's JSON response body. */
interface DeleteAccountResponse {
  success?: boolean;
  error?: string;
}

/**
 * Permanently delete the signed-in user's account by invoking the
 * `delete-account` Edge Function (it deletes the caller's Storage images
 * and their auth user, which cascades all their DB rows). Using
 * `supabase.functions.invoke` means the client attaches the caller's auth
 * + apikey headers automatically — no manual fetch/token plumbing needed.
 *
 * Throws on transport/function errors or a non-ok payload, so callers
 * should wrap this in a try/catch. On success, best-effort signs the local
 * session out too — signOut failures are ignored since the account (and
 * its session) is already gone server-side at that point.
 */
export async function deleteAccount(): Promise<void> {
  const { data, error } = await supabase.functions.invoke<DeleteAccountResponse>(
    "delete-account",
    { method: "POST" }
  );

  if (error) {
    throw new Error(error.message || "Failed to delete account.");
  }

  if (data && (data.success === false || data.error)) {
    throw new Error(data.error || "Failed to delete account.");
  }

  try {
    await supabase.auth.signOut();
  } catch {
    // Best-effort: the account no longer exists, so a local signOut
    // failure shouldn't stop the caller from treating this as success.
  }
}
