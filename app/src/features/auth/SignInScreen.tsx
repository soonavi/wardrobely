import React, { useEffect, useRef, useState } from "react";
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
import { signInWithOtp, verifyOtp } from "../../lib/api/auth";
import { useAuthStore } from "../../lib/stores/useAuthStore";
import { colors, radius, type } from "../../lib/theme";

type Step = "email" | "code";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 30;

/**
 * Email OTP sign-in / sign-up flow:
 *  1. User enters email, we send a 6-digit code (signInWithOtp).
 *  2. User enters the code, we verify it (verifyOtp) and store the session.
 * The root layout reacts to the session change and redirects automatically,
 * so this screen doesn't need to navigate on success.
 */
export function SignInScreen() {
  const setSession = useAuthStore((s) => s.setSession);

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [justResent, setJustResent] = useState(false);

  const codeInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  function isValidEmail(value: string) {
    return EMAIL_RE.test(value);
  }

  async function sendCode(targetEmail: string) {
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

    const { session, error: verifyError } = await verifyOtp(
      email.trim(),
      trimmedCode
    );

    setLoading(false);

    if (verifyError) {
      setError(verifyError);
      return;
    }

    setSession(session);
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
          <Text style={styles.title}>
            wardrobe<Text style={styles.titleAccent}>Spec</Text>
          </Text>
          <Text style={styles.tagline}>Know what you own. Wear it well.</Text>
          <Text style={styles.subtitle}>
            {step === "email"
              ? "Enter your email to sign in or create an account."
              : `Enter the code we sent to ${email.trim()}.`}
          </Text>

          {step === "email" ? (
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
  title: {
    ...type.title,
    fontSize: 36,
    marginBottom: 4,
    textAlign: "center",
  },
  titleAccent: {
    color: colors.accent,
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
