import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { signInWithOtp, signOut, verifyOtp } from "../../lib/api/auth";
import { recordAgeCheck } from "../../lib/api/profiles";
import { useAuthStore } from "../../lib/stores/useAuthStore";
import { colors, radius, type } from "../../lib/theme";
import { Wordmark } from "../../components/Wordmark";
import { AgeGateStep } from "../age/AgeGateStep";
import type { CivilDate } from "../age/minimumAge";

type Step = "age" | "email" | "code";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 30;

/**
 * Email OTP sign-in / sign-up flow, gated on a minimum account age of 13:
 *  0. User enters their date of birth. Checked locally (features/age).
 *  1. User enters email, we send a 6-digit code (signInWithOtp).
 *  2. User enters the code, we verify it (verifyOtp) and store the session.
 *  3. The birthdate collected in step 0 is recorded against the new session
 *     via the `record_age_check` RPC, which re-runs the check in SQL.
 * The root layout reacts to the session + profile change and redirects
 * automatically, so this screen doesn't need to navigate on success.
 *
 * WHY THE AGE STEP COMES FIRST (LAUNCH_CHECKLIST.md §1)
 * `signInWithOtp` runs with `shouldCreateUser: true`, so step 1 *is* account
 * creation. Putting the age question after it would mean a rejected under-13
 * already has an `auth.users` row and we are knowingly holding a child's email
 * address. Asking first means that account is never created at all.
 *
 * That ordering is a privacy improvement, not the enforcement. The
 * enforcement is `record_age_check` (supabase/migrations/006_age_gate.sql): a
 * `security definer` RPC that repeats the check against `current_date` and is
 * the only thing with permission to write the verdict. A client that skips
 * this screen entirely gets an account whose profile is unverified, which the
 * restrictive UPDATE policy on `profiles` will not let out of onboarding.
 *
 * THIS SCREEN ALSO SERVES ALREADY-SIGNED-IN USERS. Every profile created
 * before the gate shipped has `age_verified_on = null`, and app/_layout.tsx
 * routes those users back here rather than grandfathering them — a compliance
 * control that reports success for checks it never ran is worse than a missing
 * one. They land on step "age" with a session already in hand, answer once,
 * and get a "not you? sign out" escape hatch instead of an email field they
 * don't need.
 */
export function SignInScreen() {
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const setSession = useAuthStore((s) => s.setSession);
  const setProfile = useAuthStore((s) => s.setProfile);

  const [step, setStep] = useState<Step>("age");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [justResent, setJustResent] = useState(false);

  /**
   * The birthdate that passed the local check, held until there is a session
   * to attach it to. Kept in component state and nowhere else — not in the
   * store, not in AsyncStorage — because it is the one piece of data this
   * flow touches that we have promised not to retain. If the app is killed
   * mid-flow it is gone, and the user is simply asked again, which is the
   * correct outcome.
   */
  const [verifiedBirthdate, setVerifiedBirthdate] = useState<CivilDate | null>(
    null
  );
  const [recordingAge, setRecordingAge] = useState(false);
  const [ageError, setAgeError] = useState<string | null>(null);

  const codeInputRef = useRef<TextInput>(null);
  // Guards the recording effect against firing twice for one birthdate — the
  // effect re-runs whenever the profile in the store changes, and a concurrent
  // profile fetch in the root layout is exactly what makes that happen.
  const recordingRef = useRef(false);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  /**
   * Record the age check against the database as soon as there is a session to
   * attach it to.
   *
   * Runs in both directions this screen is reached from: a brand-new signup
   * (the birthdate was collected in step "age" before the account existed) and
   * a returning user whose profile predates the gate (the root layout sent
   * them here, and the age step collected it just now, with a session already
   * live).
   *
   * WHY AN EFFECT RATHER THAN AN AWAIT INSIDE handleVerifyCode. The session
   * arrives from two places — the `verifyOtp` return value and the
   * `onAuthStateChange` subscription in the root layout — and the layout
   * refetches the profile whenever the session's user id changes. A fetch
   * issued before this RPC commits comes back with `age_verified_on: null` and
   * overwrites the row we just stored, which would strand a verified user on
   * the age step. Keying off `profile?.age_verified_on` means that clobber
   * simply re-triggers the recording, which the RPC is written to accept: it
   * upserts, so re-running it is idempotent in effect. The flow self-heals
   * instead of racing.
   */
  const recordAge = useCallback(
    async (birthdate: CivilDate) => {
      recordingRef.current = true;
      setRecordingAge(true);
      setAgeError(null);

      const { data, error: checkError, rejected } = await recordAgeCheck(birthdate);

      setRecordingAge(false);
      recordingRef.current = false;

      if (checkError) {
        setAgeError(checkError);
        // Drop the date on any failure so a retry re-collects it rather than
        // looping on a value the server has already refused.
        setVerifiedBirthdate(null);
        setStep("age");

        if (rejected) {
          // The database refused this person for being under 13, so we now
          // have actual knowledge of whose account this is — the standard
          // COPPA turns on. Ending the session is the least we can do from
          // the client; the account itself is removable from the profile
          // screen's delete flow, and this path exists at all only for
          // accounts that predate the gate (a new signup is stopped before
          // `auth.users` ever gets a row).
          await signOut();
          setSession(null);
          setProfile(null);
        }
        return;
      }

      setProfile(data);
    },
    [setProfile, setSession]
  );

  useEffect(() => {
    if (!session || !verifiedBirthdate) return;
    if (profile?.age_verified_on) return;
    if (recordingRef.current) return;
    void recordAge(verifiedBirthdate);
  }, [session, verifiedBirthdate, profile?.age_verified_on, recordAge]);

  /**
   * The age step passed locally. What happens next depends on whether there is
   * already an account attached to this device:
   *
   *  - No session (the normal signup): move on to the email step. Nothing has
   *    been sent to the server yet, and nothing will be until the OTP is
   *    verified — which is the point, because requesting an OTP creates the
   *    account.
   *  - A session already (a profile that predates the gate): the recording
   *    effect above picks the birthdate up immediately and there is no email
   *    to collect.
   */
  function handleAgeGatePass(birthdate: CivilDate) {
    setAgeError(null);
    setVerifiedBirthdate(birthdate);
    if (!session) setStep("email");
  }

  /**
   * Escape hatch for the signed-in-but-unverified case: someone handed a
   * borrowed phone, or a shared device where the session belongs to someone
   * else. Without this the only way out of the gate would be to answer for a
   * person who isn't there — which is precisely the answer we don't want.
   */
  async function handleSignOutFromGate() {
    setAgeError(null);
    setVerifiedBirthdate(null);
    await signOut();
    setSession(null);
    setProfile(null);
  }

  function isValidEmail(value: string) {
    return EMAIL_RE.test(value);
  }

  async function sendCode(targetEmail: string) {
    // The one choke point that actually creates an account: `signInWithOtp`
    // runs with `shouldCreateUser: true`, so this call — not the verify step —
    // is where an `auth.users` row appears. The age question having been
    // answered first is the entire reason a rejected under-13 never gets one,
    // and today that ordering is guaranteed only by `step` state.
    //
    // So it is asserted here rather than assumed. A future deep link into the
    // email step, a "skip for now" affordance, or a reordering of the flow
    // would otherwise quietly restore the thing this design exists to prevent,
    // and it would do so without a failing test — no unit test can see a
    // component's step machine. Both callers funnel through here, which is why
    // the guard lives in `sendCode` and not in `handleSendCode`.
    if (!verifiedBirthdate) {
      setStep("age");
      setAgeError(null);
      return false;
    }

    setLoading(true);
    setError(null);

    const { error: sendError } = await signInWithOtp(targetEmail);

    setLoading(false);

    if (sendError) {
      setError(sendError);
      return false;
    }

    return true;
  }

  async function handleSendCode() {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError("Please enter your email address.");
      return;
    }
    if (!isValidEmail(trimmedEmail)) {
      setError("That doesn't look like a valid email address.");
      return;
    }

    const ok = await sendCode(trimmedEmail);
    if (ok) {
      setStep("code");
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      setTimeout(() => codeInputRef.current?.focus(), 50);
    }
  }

  async function handleResendCode() {
    if (resendCooldown > 0 || loading) return;
    const trimmedEmail = email.trim();
    setCode("");
    setJustResent(false);
    const ok = await sendCode(trimmedEmail);
    if (ok) {
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      setJustResent(true);
    }
  }

  async function handleVerifyCode() {
    const trimmedCode = code.trim();
    if (!trimmedCode) {
      setError("Please enter the code we emailed you.");
      return;
    }
    if (trimmedCode.length !== CODE_LENGTH || !/^\d+$/.test(trimmedCode)) {
      setError(`Enter the ${CODE_LENGTH}-digit code from your email.`);
      return;
    }

    setLoading(true);
    setError(null);
    setJustResent(false);

    // Renamed from `session` since the store's `session` is now read at the
    // top of this component for the age gate — shadowing it inside the one
    // handler that assigns it is exactly the sort of thing that reads as
    // correct right up until someone edits around it.
    const { session: nextSession, error: verifyError } = await verifyOtp(
      email.trim(),
      trimmedCode
    );

    setLoading(false);

    if (verifyError) {
      setError(verifyError);
      return;
    }

    // The recording effect above takes it from here: the session lands in the
    // store, and the birthdate collected in step "age" is written through
    // `record_age_check` before the root layout will route past (auth).
    setSession(nextSession);
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 24}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.content}>
          <View style={styles.wordmarkRow}>
            <Wordmark size={34} />
          </View>
          <Text style={styles.tagline}>Know what you own. Wear it well.</Text>
          <Text style={styles.subtitle}>
            {step === "age"
              ? session
                ? "One quick thing before you carry on."
                : "Let's start with a quick question."
              : step === "email"
                ? "Enter your email to sign in or create an account."
                : `Enter the code we sent to ${email.trim()}.`}
          </Text>

          {/*
            The age step deliberately says nothing about 13 until after a
            refusal — see the neutral-age-screen note in AgeGateStep. The
            subtitles above are the same for both entry points for the same
            reason: "one quick thing" gives nothing away about what answer
            gets you through.
          */}
          {step === "age" ? (
            <AgeGateStep
              onPass={handleAgeGatePass}
              submitting={recordingAge}
              error={ageError}
              onEditWhileErrored={() => setAgeError(null)}
              footer={
                session ? (
                  <Pressable
                    style={styles.linkButton}
                    onPress={handleSignOutFromGate}
                    disabled={recordingAge}
                    accessibilityRole="button"
                  >
                    <Text style={styles.linkButtonText}>Not you? Sign out</Text>
                  </Pressable>
                ) : null
              }
            />
          ) : step === "email" ? (
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                if (error) setError(null);
              }}
              placeholder="you@example.com"
              placeholderTextColor={colors.faint}
              keyboardType="email-address"
              textContentType="emailAddress"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              returnKeyType="go"
              onSubmitEditing={handleSendCode}
              editable={!loading}
              accessibilityLabel="Email address"
            />
          ) : (
            <TextInput
              ref={codeInputRef}
              style={styles.input}
              value={code}
              onChangeText={(v) => {
                setCode(v.replace(/[^0-9]/g, "").slice(0, CODE_LENGTH));
                if (error) setError(null);
              }}
              placeholder="123456"
              placeholderTextColor={colors.faint}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="sms-otp"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="go"
              onSubmitEditing={handleVerifyCode}
              editable={!loading}
              accessibilityLabel="Verification code"
            />
          )}

          {/*
            The age step brings its own error line and its own Continue button
            (AgeGateStep owns both, so that its inline validation lands right
            under the fields it is complaining about). Everything below is the
            email/code steps' shared footer and must not double up on it.
          */}
          {step !== "age" && (
            <>
              {error && <Text style={styles.errorText}>{error}</Text>}
              {!error && justResent && (
                <Text style={styles.successText}>Sent a new code.</Text>
              )}

              <Pressable
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={step === "email" ? handleSendCode : handleVerifyCode}
                disabled={loading}
                accessibilityRole="button"
              >
                {loading ? (
                  <ActivityIndicator color={colors.onInk} />
                ) : (
                  <Text style={styles.buttonText}>
                    {step === "email" ? "Send Code" : "Verify Code"}
                  </Text>
                )}
              </Pressable>
            </>
          )}

          {step === "code" && (
            <>
              <Pressable
                style={styles.linkButton}
                onPress={handleResendCode}
                disabled={loading || resendCooldown > 0}
                accessibilityRole="button"
              >
                <Text
                  style={[
                    styles.linkButtonText,
                    resendCooldown > 0 && styles.linkButtonTextDisabled,
                  ]}
                >
                  {resendCooldown > 0
                    ? `Resend code (${resendCooldown}s)`
                    : "Resend code"}
                </Text>
              </Pressable>

              <Pressable
                style={styles.linkButton}
                onPress={() => {
                  setStep("email");
                  setCode("");
                  setError(null);
                  setJustResent(false);
                  setResendCooldown(0);
                }}
                disabled={loading}
                accessibilityRole="button"
              >
                <Text style={styles.linkButtonText}>Use a different email</Text>
              </Pressable>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  wordmarkRow: {
    alignItems: "center",
    marginBottom: 8,
  },
  tagline: {
    fontFamily: type.title.fontFamily,
    fontStyle: "italic",
    fontSize: 14,
    color: colors.muted,
    marginBottom: 28,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 15,
    color: colors.muted,
    marginBottom: 24,
    textAlign: "center",
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.ink,
    marginBottom: 12,
    minHeight: 48,
  },
  errorText: {
    color: colors.danger,
    marginBottom: 12,
    textAlign: "center",
  },
  successText: {
    color: colors.accent,
    marginBottom: 12,
    textAlign: "center",
  },
  button: {
    backgroundColor: colors.ink,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: "center",
    marginTop: 4,
    minHeight: 48,
    justifyContent: "center",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: colors.onInk,
    fontSize: 16,
    fontWeight: "700",
  },
  linkButton: {
    marginTop: 16,
    alignItems: "center",
    minHeight: 32,
    justifyContent: "center",
  },
  linkButtonText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: "600",
  },
  linkButtonTextDisabled: {
    color: colors.muted,
  },
});
