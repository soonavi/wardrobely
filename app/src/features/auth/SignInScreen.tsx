import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { signInWithOtp, verifyOtp } from "../../lib/api/auth";
import { useAuthStore } from "../../lib/stores/useAuthStore";
import { colors, radius, type } from "../../lib/theme";

type Step = "email" | "code";

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

  async function handleSendCode() {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError("Please enter your email address.");
      return;
    }

    setLoading(true);
    setError(null);

    const { error: sendError } = await signInWithOtp(trimmedEmail);

    setLoading(false);

    if (sendError) {
      setError(sendError);
      return;
    }

    setStep("code");
  }

  async function handleVerifyCode() {
    const trimmedCode = code.trim();
    if (!trimmedCode) {
      setError("Please enter the code we emailed you.");
      return;
    }

    setLoading(true);
    setError(null);

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
      behavior={Platform.OS === "ios" ? "padding" : undefined}
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
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loading}
          />
        ) : (
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={setCode}
            placeholder="123456"
            keyboardType="number-pad"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loading}
          />
        )}

        {error && <Text style={styles.errorText}>{error}</Text>}

        <Pressable
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={step === "email" ? handleSendCode : handleVerifyCode}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>
              {step === "email" ? "Send Code" : "Verify Code"}
            </Text>
          )}
        </Pressable>

        {step === "code" && (
          <Pressable
            style={styles.linkButton}
            onPress={() => {
              setStep("email");
              setCode("");
              setError(null);
            }}
            disabled={loading}
          >
            <Text style={styles.linkButtonText}>Use a different email</Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
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
  },
  errorText: {
    color: colors.danger,
    marginBottom: 12,
    textAlign: "center",
  },
  button: {
    backgroundColor: colors.ink,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: "center",
    marginTop: 4,
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
  },
  linkButtonText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: "600",
  },
});
