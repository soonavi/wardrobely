import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { colors, radius } from "../../lib/theme";
import {
  birthdateVerdictMessage,
  checkBirthdate,
  type BirthdateFields,
  type CivilDate,
} from "./minimumAge";

/**
 * The age step of the sign-in flow — Selv's 13+ gate
 * (LAUNCH_CHECKLIST.md §1, legal/PRIVACY_POLICY.md §12).
 *
 * WHY IT IS THE *FIRST* STEP, BEFORE THE EMAIL FIELD.
 * `signInWithOtp` runs with `shouldCreateUser: true`, so asking for a code is
 * the same act as creating an account. If the age question came after it, a
 * rejected under-13 would already have an `auth.users` row and we would be
 * holding a child's email address with actual knowledge of whose it is.
 * Asking first means that account is never created — which is a better COPPA
 * posture than creating it and deleting it afterwards, and it is why this
 * component is rendered by SignInScreen rather than living behind the auth
 * gate as its own route.
 *
 * WHAT THIS COMPONENT DECIDES: nothing that anyone is bound by. It runs
 * `checkBirthdate` locally so the answer is instant and so the email step is
 * never reached by someone under 13, then hands the parsed date up. The
 * binding decision is `record_age_check` in the database
 * (supabase/migrations/006_age_gate.sql), which repeats the same test in SQL
 * and is the only thing permitted to write the verdict. Everything here is
 * bypassable by anyone holding the anon key, and that is fine, because
 * bypassing it gets you an account that cannot finish onboarding.
 *
 * A NEUTRAL AGE SCREEN. The copy asks for a date of birth and does not
 * mention 13 until after a refusal, and the refusal does not say which answer
 * would have worked. That is the FTC's guidance on age screens: a screen that
 * announces the threshold up front is a screen that teaches the answer, and
 * "you must be 13+" above an empty date field is an instruction to type a
 * different year.
 *
 * THREE FIELDS, NOT A DATE PICKER. A native picker means scrolling thirteen
 * years back from today's default, which is slow and — worse — starts the
 * user on a date that is guaranteed to fail. It also hands us a `Date`, i.e.
 * an instant with a timezone attached, which is exactly what
 * `minimumAge.ts` exists to keep out of this calculation.
 */
export interface AgeGateStepProps {
  /**
   * Called with the parsed birthdate once it passes the local check. The
   * parent is responsible for the database call — this component deliberately
   * does not import the API layer, matching the house rule that screens talk
   * to `src/lib/api/*` and leaf components take props.
   */
  onPass: (birthdate: CivilDate) => void;
  /** True while the parent is recording the check; disables the form. */
  submitting?: boolean;
  /**
   * An error from the parent (usually the database's own refusal). Rendered
   * in place of the local one, because if the server has spoken it has the
   * last word.
   */
  error?: string | null;
  /** Clears the parent's error as soon as the user edits anything. */
  onEditWhileErrored?: () => void;
  /**
   * Rendered under the button when present — the "not you? sign out" escape
   * hatch shown to an already-signed-in user whose profile predates the gate.
   * Omitted during a fresh signup, where there is no session to leave.
   */
  footer?: React.ReactNode;
}

const EMPTY_FIELDS: BirthdateFields = { day: "", month: "", year: "" };

export function AgeGateStep({
  onPass,
  submitting = false,
  error = null,
  onEditWhileErrored,
  footer,
}: AgeGateStepProps) {
  const [fields, setFields] = useState<BirthdateFields>(EMPTY_FIELDS);
  const [localError, setLocalError] = useState<string | null>(null);

  const monthRef = useRef<TextInput>(null);
  const yearRef = useRef<TextInput>(null);

  // The parent's error wins: it is the database's answer, and it arrives after
  // the local check has already passed.
  const shownError = error ?? localError;

  function setField(key: keyof BirthdateFields, raw: string, maxLength: number) {
    // Digits only, capped at the field width. Doing it here rather than
    // leaning on `keyboardType="number-pad"` matters because that keyboard is
    // a hint, not a constraint — a hardware keyboard, a paste, or an
    // autofill will all happily deliver letters.
    const value = raw.replace(/[^0-9]/g, "").slice(0, maxLength);
    setFields((current) => ({ ...current, [key]: value }));
    if (localError) setLocalError(null);
    if (error) onEditWhileErrored?.();

    // Advance on a full field so the whole date is one uninterrupted run of
    // taps. Only on *reaching* the width, never on backspacing into it.
    if (value.length === maxLength) {
      if (key === "day") monthRef.current?.focus();
      if (key === "month") yearRef.current?.focus();
    }
  }

  function handleContinue() {
    if (submitting) return;

    const verdict = checkBirthdate(fields);
    if (verdict.status !== "ok") {
      setLocalError(birthdateVerdictMessage(verdict));
      return;
    }

    setLocalError(null);
    onPass(verdict.birthdate);
  }

  return (
    <>
      <Text style={styles.prompt}>What's your date of birth?</Text>
      <Text style={styles.help}>
        We use this once to check you're old enough for Selv. We don't keep it.
      </Text>

      <View style={styles.row}>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Day</Text>
          <TextInput
            style={styles.input}
            value={fields.day}
            onChangeText={(v) => setField("day", v, 2)}
            placeholder="DD"
            placeholderTextColor={colors.faint}
            keyboardType="number-pad"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            maxLength={2}
            returnKeyType="next"
            editable={!submitting}
            accessibilityLabel="Day of birth"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Month</Text>
          <TextInput
            ref={monthRef}
            style={styles.input}
            value={fields.month}
            onChangeText={(v) => setField("month", v, 2)}
            placeholder="MM"
            placeholderTextColor={colors.faint}
            keyboardType="number-pad"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={2}
            returnKeyType="next"
            editable={!submitting}
            accessibilityLabel="Month of birth"
          />
        </View>

        <View style={[styles.field, styles.yearField]}>
          <Text style={styles.fieldLabel}>Year</Text>
          <TextInput
            ref={yearRef}
            style={styles.input}
            value={fields.year}
            onChangeText={(v) => setField("year", v, 4)}
            placeholder="YYYY"
            placeholderTextColor={colors.faint}
            keyboardType="number-pad"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={4}
            returnKeyType="go"
            onSubmitEditing={handleContinue}
            editable={!submitting}
            accessibilityLabel="Year of birth"
          />
        </View>
      </View>

      {shownError && <Text style={styles.errorText}>{shownError}</Text>}

      <Pressable
        style={[styles.button, submitting && styles.buttonDisabled]}
        onPress={handleContinue}
        disabled={submitting}
        accessibilityRole="button"
      >
        {submitting ? (
          <ActivityIndicator color={colors.onInk} />
        ) : (
          <Text style={styles.buttonText}>Continue</Text>
        )}
      </Pressable>

      {footer}
    </>
  );
}

// Mirrors the input/button styles in features/auth/SignInScreen.tsx so the age
// step reads as the same screen it is rendered inside, rather than as a
// separate one that happens to appear first.
const styles = StyleSheet.create({
  prompt: {
    fontSize: 16,
    color: colors.ink,
    fontWeight: "600",
    marginBottom: 6,
    textAlign: "center",
  },
  help: {
    fontSize: 13,
    color: colors.muted,
    marginBottom: 20,
    textAlign: "center",
  },
  row: {
    flexDirection: "row",
    gap: 10,
  },
  field: {
    flex: 1,
  },
  // The year needs four characters where the others need two.
  yearField: {
    flex: 1.6,
  },
  fieldLabel: {
    fontSize: 12,
    color: colors.muted,
    marginBottom: 4,
    marginLeft: 2,
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
    textAlign: "center",
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
});
