import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  getWaitlistSignup,
  joinWaitlist,
  updateWaitlistEmail,
  type WaitlistSource,
} from "../../lib/api/waitlist";
import { useAuthStore } from "../../lib/stores/useAuthStore";
import { wardrobeLimitMessage } from "../../lib/pricing";
import { colors, radius, spacing, type } from "../../lib/theme";

/**
 * What the Free wardrobe cap opens instead of a paywall.
 *
 * Selv+ cannot be bought. There is no in-app purchase in v1 and no
 * entitlement to read, so a screen that offered to sell it would be lying and
 * a button labelled "Upgrade" would be lying twice — the previous version of
 * this flow shipped exactly that, wired to a `// TODO`. Everything visible
 * here is written to survive being read literally: Selv+ is *coming*, this is
 * a list, joining is free and is not a purchase, and no price appears
 * anywhere. (That last one is also what keeps App Store Guideline 3.1.2 off
 * the v1 review surface: nothing in the app sells anything.)
 *
 * One component, two entry points — the wardrobe grid's "+" when the user is
 * already at the cap, and the add-garment screen's save-time guard for
 * someone who deep-linked past it. They differ only by the `source` they
 * record, which is the analytically interesting part: "people want this" is
 * a much weaker signal than "people want this at the exact moment they run
 * out of room". Duplicating the UI per entry point would have meant two sets
 * of copy drifting apart, and this copy is the whole product decision.
 */

/** The states a user can be in while this sheet is up. */
type SheetStatus =
  /** Reading their existing signup, if any — the sheet has just opened. */
  | "checking"
  /** Form is showing and idle. */
  | "idle"
  /** Write in flight. */
  | "submitting"
  /** They are on the list, whether from this tap or an earlier one. */
  | "joined";

export interface SelvPlusWaitlistSheetProps {
  visible: boolean;
  /** Which wall the user hit; recorded on the signup row. */
  source: WaitlistSource;
  /** Dismissal — the backdrop, the "Not now" button, and Android back. */
  onClose: () => void;
}

export function SelvPlusWaitlistSheet({
  visible,
  source,
  onClose,
}: SelvPlusWaitlistSheetProps) {
  const session = useAuthStore((s) => s.session);
  const userId = session?.user.id;
  const sessionEmail = session?.user.email ?? "";

  const [status, setStatus] = useState<SheetStatus>("checking");
  const [email, setEmail] = useState("");
  const [joinedEmail, setJoinedEmail] = useState<string | null>(null);
  const [alreadyJoined, setAlreadyJoined] = useState(false);
  const [editingEmail, setEditingEmail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-resolve on every open rather than once on mount: the sheet is mounted
  // for the life of its screen, and the user may have joined from the other
  // entry point in between. Cheap (one indexed read on the PK) and the cost
  // of getting it wrong is showing a signed-up user a form that can only
  // fail.
  useEffect(() => {
    if (!visible) return;

    let cancelled = false;

    // Prefill from the session so the common case is one tap. Falls back to
    // an empty box for a session with no email claim (phone-only auth), which
    // the form then requires — better than posting an empty string the
    // database would reject anyway.
    setEmail(sessionEmail);
    setEditingEmail(false);
    setError(null);
    setStatus("checking");
    // Cleared, not carried over: a stale `joinedEmail` from a previous open
    // would send handleSubmit down the update path for a user this open
    // believes has no row yet.
    setJoinedEmail(null);
    setAlreadyJoined(false);

    if (!userId) {
      // No session, no row to look up. Let the form render; the write will
      // fail with the sign-in message if they get that far.
      setStatus("idle");
      return;
    }

    void (async () => {
      const { data } = await getWaitlistSignup(userId);
      if (cancelled) return;

      if (data) {
        setJoinedEmail(data.email);
        setEmail(data.email);
        setAlreadyJoined(true);
        setStatus("joined");
        return;
      }

      // A failed read is not surfaced: not being able to tell whether they
      // already joined is not a reason to refuse to let them join. The insert
      // resolves it either way — a duplicate comes back as `alreadyJoined`.
      setStatus("idle");
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, userId, sessionEmail]);

  const handleSubmit = useCallback(async () => {
    if (status === "submitting") return;

    if (!userId) {
      setError("Please sign in again to join the list.");
      return;
    }

    setStatus("submitting");
    setError(null);

    // Editing an existing signup and creating one are different writes: the
    // primary key means there is no second insert, so a typo'd address is
    // only fixable through update.
    if (joinedEmail !== null) {
      const { data, error: updateError } = await updateWaitlistEmail(
        userId,
        email
      );

      if (updateError || !data) {
        setError(updateError ?? "Couldn't save your spot just now.");
        setStatus("joined");
        return;
      }

      setJoinedEmail(data.email);
      setEditingEmail(false);
      setStatus("joined");
      return;
    }

    const { data, error: joinError } = await joinWaitlist({
      userId,
      email,
      source,
    });

    if (joinError || !data) {
      setError(joinError ?? "Couldn't save your spot just now.");
      setStatus("idle");
      return;
    }

    setJoinedEmail(data.signup.email);
    setAlreadyJoined(data.alreadyJoined);
    setStatus("joined");
  }, [status, userId, joinedEmail, email, source]);

  const showForm = status === "idle" || status === "submitting" || editingEmail;
  const submitting = status === "submitting";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.overlay}>
          {/* The backdrop is its own layer rather than a Pressable wrapping
              the card, so the card doesn't have to swallow its own taps with
              a no-op onPress — which would also announce the whole sheet to
              screen readers as one button. */}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityLabel="Dismiss"
          />
          <View style={styles.card}>
            <Text style={styles.eyebrow}>Coming soon</Text>
            <Text style={styles.title}>Selv+ is on the way</Text>

            {/* The shared cap copy, so this sheet and the save-time guard in
                createGarment() can never say different numbers. */}
            <Text style={styles.body}>{wardrobeLimitMessage()}</Text>

            {status === "checking" ? (
              <View style={styles.checkingRow}>
                <ActivityIndicator color={colors.accent} />
              </View>
            ) : showForm ? (
              <>
                <Text style={styles.body}>
                  {editingEmail
                    ? "Where should we send it instead?"
                    : "It isn't for sale yet. Leave your email and we'll tell you the day it opens — that's the only reason we'll use it."}
                </Text>

                <Text style={styles.label}>Email</Text>
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={(next) => {
                    setEmail(next);
                    if (error) setError(null);
                  }}
                  placeholder="you@example.com"
                  placeholderTextColor={colors.faint}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  textContentType="emailAddress"
                  editable={!submitting}
                  returnKeyType="go"
                  onSubmitEditing={handleSubmit}
                  accessibilityLabel="Email address for the Selv+ waitlist"
                />

                {error && <Text style={styles.errorText}>{error}</Text>}

                <Pressable
                  style={[
                    styles.primaryButton,
                    submitting && styles.buttonDisabled,
                  ]}
                  onPress={handleSubmit}
                  disabled={submitting}
                  accessibilityRole="button"
                  accessibilityLabel={
                    editingEmail
                      ? "Save my email address"
                      : "Join the Selv+ waitlist"
                  }
                >
                  {submitting ? (
                    <ActivityIndicator color={colors.ink} />
                  ) : (
                    <Text style={styles.primaryButtonText}>
                      {editingEmail
                        ? "Save email"
                        : error
                        ? "Try again"
                        : "Join the list"}
                    </Text>
                  )}
                </Pressable>

                <Text style={styles.fineprint}>
                  Joining is free and isn't a purchase. Nothing is charged, and
                  your wardrobe stays exactly as it is.
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.successHeadline}>
                  {alreadyJoined
                    ? "You're already on the list."
                    : "You're on the list."}
                </Text>
                <Text style={styles.body}>
                  We'll email {joinedEmail ?? "you"} when Selv+ opens. Until
                  then nothing changes — and nothing is charged.
                </Text>

                {error && <Text style={styles.errorText}>{error}</Text>}

                <Pressable
                  style={styles.primaryButton}
                  onPress={onClose}
                  accessibilityRole="button"
                >
                  <Text style={styles.primaryButtonText}>Got it</Text>
                </Pressable>

                {/* The one row per user is a primary key, so there is no
                    second signup to correct a typo with. This is the way
                    back — see updateWaitlistEmail. */}
                <Pressable
                  style={styles.linkButton}
                  onPress={() => {
                    setEditingEmail(true);
                    setError(null);
                  }}
                  accessibilityRole="button"
                >
                  <Text style={styles.linkButtonText}>
                    Use a different email
                  </Text>
                </Pressable>
              </>
            )}

            {showForm && (
              <Pressable
                style={styles.linkButton}
                onPress={onClose}
                accessibilityRole="button"
              >
                <Text style={styles.linkButtonText}>Not now</Text>
              </Pressable>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  card: {
    width: "100%",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  eyebrow: {
    ...type.label,
    color: colors.accent,
    marginBottom: spacing.xs,
  },
  title: {
    ...type.title,
    fontSize: 24,
    marginBottom: spacing.sm,
  },
  body: {
    ...type.body,
    color: colors.muted,
    marginBottom: spacing.sm,
  },
  successHeadline: {
    ...type.body,
    fontSize: 17,
    color: colors.ink,
    fontWeight: "700",
    marginBottom: spacing.xs,
  },
  checkingRow: {
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  label: {
    ...type.label,
    marginTop: spacing.sm,
    marginBottom: spacing.xs + 2,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.ink,
  },
  errorText: {
    color: colors.danger,
    marginTop: spacing.sm,
  },
  primaryButton: {
    // Acid green is the app's CTA pop, and it reads as an action rather than
    // as the ink-filled "commit" buttons used for saving real data. Text on
    // acid is ink, per the theme's note on colors.acid.
    backgroundColor: colors.acid,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: "center",
    marginTop: spacing.md,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "700",
  },
  linkButton: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  linkButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.muted,
  },
  fineprint: {
    ...type.subtle,
    fontSize: 12,
    color: colors.faint,
    marginTop: spacing.sm,
  },
});
