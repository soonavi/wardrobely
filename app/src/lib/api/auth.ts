import { supabase } from "../supabase";
import type { Session } from "@supabase/supabase-js";

export interface AuthResult {
  session: Session | null;
  error: string | null;
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

  return { error: error ? error.message : null };
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
    return { session: null, error: error.message };
  }

  return { session: data.session, error: null };
}

/**
 * Create a new account with email + password.
 * Supabase will also send a confirmation email if email confirmations
 * are enabled on the project; the session may be null until confirmed.
 */
export async function signUp(
  email: string,
  password: string
): Promise<AuthResult> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });

  if (error) {
    return { session: null, error: error.message };
  }

  return { session: data.session, error: null };
}

/** Sign in with an existing email + password account. */
export async function signIn(
  email: string,
  password: string
): Promise<AuthResult> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { session: null, error: error.message };
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
