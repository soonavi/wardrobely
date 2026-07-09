import { supabase } from "../supabase";
import type { Session } from "@supabase/supabase-js";

export interface AuthResult {
  session: Session | null;
  error: string | null;
}

/**
 * Map raw Supabase auth errors to copy that makes sense in an OTP flow.
 * Supabase's own messages are written with password auth in mind (or are
 * terse network errors), so we rewrite the common ones here.
 */
function friendlyAuthError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("token has expired") || lower.includes("otp_expired")) {
    return "That code has expired. Request a new one and try again.";
  }
  if (lower.includes("invalid") && lower.includes("otp")) {
    return "That code isn't right. Double-check it and try again.";
  }
  if (lower.includes("invalid") && lower.includes("token")) {
    return "That code isn't right. Double-check it and try again.";
  }
  if (lower.includes("rate limit") || lower.includes("too many")) {
    return "Too many attempts. Please wait a moment before trying again.";
  }
  if (lower.includes("network") || lower.includes("fetch")) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  return message;
}

/**
 * Send a one-time-password code to the given email. If the user doesn't
 * exist yet, Supabase creates the account (shouldCreateUser: true) so the
 * same flow covers both sign-up and sign-in.
 */
export async function signInWithOtp(
  email: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
    },
  });

  return { error: error ? friendlyAuthError(error.message) : null };
}

/** Verify the 6-digit OTP code sent to the user's email. */
export async function verifyOtp(
  email: string,
  token: string
): Promise<AuthResult> {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "email",
  });

  if (error) {
    return { session: null, error: friendlyAuthError(error.message) };
  }

  return { session: data.session, error: null };
}

/** Sign out the current user. */
export async function signOut(): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signOut();
  return { error: error ? error.message : null };
}

/** Get the current session, if any. */
export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/**
 * Subscribe to auth state changes (sign in, sign out, token refresh).
 * Returns an unsubscribe function.
 */
export function onAuthStateChange(
  callback: (session: Session | null) => void
): () => void {
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });

  return () => subscription.unsubscribe();
}
