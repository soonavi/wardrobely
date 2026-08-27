import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import BuildPicker from "../avatar/BuildPicker";
import { buildWidthScale } from "../avatar/avatars";
import { deleteAccount } from "../../lib/api/account";
import { signOut } from "../../lib/api/auth";
import { updateBodyMetrics } from "../../lib/api/profiles";
import { useAuthStore } from "../../lib/stores/useAuthStore";
import type { Build } from "../../lib/database.types";
import { Wordmark } from "../../components/Wordmark";
import { colors, radius, spacing, type } from "../../lib/theme";
import {
  CM_PER_INCH,
  KG_PER_LB,
  bodyMetricsErrorMessage,
  parseBodyMetrics,
  rangeHint,
  safeMetric,
  safeWidthScale,
  toDisplayValue,
  type Units,
} from "../../lib/bodyMetrics";

/** Format stored metric height for display in the chosen units. */
function formatHeight(heightCm: number | null, units: Units): string {
  if (!heightCm) return "—";
  if (units === "metric") return `${heightCm} cm`;
  const totalInches = Math.round(heightCm / CM_PER_INCH);
  return `${Math.floor(totalInches / 12)}'${totalInches % 12}"`;
}

/** Format stored metric weight for display in the chosen units. */
function formatWeight(weightKg: number | null, units: Units): string {
  if (!weightKg) return "—";
  if (units === "metric") return `${weightKg} kg`;
  return `${Math.round(weightKg / KG_PER_LB)} lbs`;
}

/** Account info + body measurements (height/weight/build) + sign out. */
export function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = useAuthStore((s) => s.session);
  const setSession = useAuthStore((s) => s.setSession);
  const profile = useAuthStore((s) => s.profile);
  const setProfile = useAuthStore((s) => s.setProfile);
  const userId = session?.user.id;

  const [units, setUnits] = useState<Units>("imperial");
  const [editing, setEditing] = useState(false);
  const [heightInput, setHeightInput] = useState("");
  const [weightInput, setWeightInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sanitised on both sides: `safeMetric` keeps a negative stored value from
  // making buildWidthScale's sqrt(bmi/22) NaN, and `safeWidthScale` catches
  // anything non-finite that gets past it. A NaN here would reach an SVG
  // scale() transform and blank the silhouette. See lib/bodyMetrics.ts.
  const widthScale = safeWidthScale(
    buildWidthScale(safeMetric(profile?.height_cm), safeMetric(profile?.weight_kg))
  );

  useFocusEffect(
    React.useCallback(() => {
      setEditing(false);
      setError(null);
    }, [])
  );

  function startEditing() {
    const heightCm = safeMetric(profile?.height_cm);
    const weightKg = safeMetric(profile?.weight_kg);
    // toDisplayValue clamps into the on-screen range, so the field can never
    // be pre-filled with a number that save would then reject.
    setHeightInput(
      heightCm === null ? "" : String(toDisplayValue("height", heightCm, units))
    );
    setWeightInput(
      weightKg === null ? "" : String(toDisplayValue("weight", weightKg, units))
    );
    setEditing(true);
  }

  /** Convert whatever is currently typed into the other unit system so edits survive a unit toggle. */
  function convertInputsToUnits(nextUnits: Units) {
    if (nextUnits === units) return;

    // Round-trip through metric using the same helpers the save path uses, so
    // toggling units can never manufacture a value outside the next system's
    // range. Anything unparseable is left alone for the user to fix.
    const h = parseInt(heightInput.trim(), 10);
    if (Number.isFinite(h) && h > 0) {
      const heightCm =
        units === "metric" ? h : Math.round(h * CM_PER_INCH);
      setHeightInput(String(toDisplayValue("height", heightCm, nextUnits)));
    }

    const w = parseInt(weightInput.trim(), 10);
    if (Number.isFinite(w) && w > 0) {
      const weightKg = units === "metric" ? w : Math.round(w * KG_PER_LB);
      setWeightInput(String(toDisplayValue("weight", weightKg, nextUnits)));
    }
  }

  function handleUnitsChange(nextUnits: Units) {
    if (editing) {
      convertInputsToUnits(nextUnits);
    }
    setUnits(nextUnits);
  }

  async function saveMetrics(overrides?: { build?: Build }) {
    if (!userId || !profile || saving) return;

    // While editing, whatever is typed is the source of truth and must pass
    // validation. When not editing (the build picker saves without opening the
    // form) the already-stored values are reused as-is.
    let height_cm: number | null;
    let weight_kg: number | null;

    if (editing) {
      const parsed = parseBodyMetrics(heightInput, weightInput, units);
      if (!parsed.ok) {
        setError(bodyMetricsErrorMessage(parsed.issues));
        return;
      }
      height_cm = parsed.heightCm;
      weight_kg = parsed.weightKg;
    } else {
      height_cm = safeMetric(profile.height_cm);
      weight_kg = safeMetric(profile.weight_kg);
    }

    const build = overrides?.build ?? profile.build;

    if (!height_cm || !weight_kg || !build) {
      setError("Add your height and weight first, then pick a build.");
      return;
    }

    setSaving(true);
    setError(null);

    const { data, error: saveError } = await updateBodyMetrics(userId, {
      height_cm,
      weight_kg,
      build,
    });

    setSaving(false);

    if (saveError) {
      setError(saveError);
      return;
    }

    if (data) {
      setProfile(data);
    }
    setEditing(false);
  }

  function handleSignOut() {
    Alert.alert("Sign out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          setSigningOut(true);
          const { error: signOutError } = await signOut();
          setSigningOut(false);

          if (signOutError) {
            setError(signOutError);
            return;
          }

          setSession(null);
          router.replace("/(auth)/sign-in");
        },
      },
    ]);
  }

  /**
   * Apple App Store Guideline 5.1.1(v): account deletion must be reachable
   * in-app. Two-step confirmation, then calls the `delete-account` Edge
   * Function (deletes Storage images + the auth user, cascading all DB
   * rows) and signs the local session out. The root layout's auth gate
   * would eventually pick up the cleared session on its own, but we also
   * explicitly clear it + navigate here (same as handleSignOut above) so
   * the app leaves this screen immediately instead of waiting on the
   * auth-state-change event to propagate.
   */
  function handleDeleteAccount() {
    Alert.alert(
      "Delete account?",
      "This permanently deletes your avatar, closet photos, saved outfits, and account. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setDeletingAccount(true);
            try {
              await deleteAccount();
              setSession(null);
              router.replace("/(auth)/sign-in");
            } catch {
              setDeletingAccount(false);
              Alert.alert(
                "Couldn't delete account",
                "We couldn't delete your account. Please try again or contact support."
              );
            }
          },
        },
      ]
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.headerRow}>
        <Text style={styles.title}>Profile</Text>
        <Wordmark size={22} />
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Email</Text>
        <Text style={styles.value}>{session?.user.email ?? "—"}</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <Text style={styles.label}>Measurements</Text>
          <View style={styles.unitsRow}>
            {(["imperial", "metric"] as const).map((u) => {
              const active = units === u;
              return (
                <Pressable
                  key={u}
                  style={[styles.unitButton, active && styles.unitButtonActive]}
                  onPress={() => handleUnitsChange(u)}
                >
                  <Text
                    style={[styles.unitText, active && styles.unitTextActive]}
                  >
                    {u === "imperial" ? "ft/lbs" : "cm/kg"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {editing ? (
          <>
            <View style={styles.inputRow}>
              <TextInput
                style={[styles.input, styles.inputHalf]}
                value={heightInput}
                onChangeText={setHeightInput}
                placeholder={units === "metric" ? "Height (cm)" : "Height (in)"}
                placeholderTextColor={colors.faint}
                keyboardType="number-pad"
                maxLength={3}
              />
              <TextInput
                style={[styles.input, styles.inputHalf]}
                value={weightInput}
                onChangeText={setWeightInput}
                placeholder={units === "metric" ? "Weight (kg)" : "Weight (lbs)"}
                placeholderTextColor={colors.faint}
                keyboardType="number-pad"
                maxLength={3}
              />
            </View>
            {/* Shown for both unit systems, and states the accepted range up
                front so the limits read as guidance rather than a surprise at
                save time. */}
            <Text style={styles.hintText}>{rangeHint(units)}</Text>
            <View style={styles.editButtonsRow}>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => setEditing(false)}
                disabled={saving}
              >
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.primaryButton}
                onPress={() => saveMetrics()}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color={colors.onInk} />
                ) : (
                  <Text style={styles.primaryButtonText}>Save</Text>
                )}
              </Pressable>
            </View>
          </>
        ) : (
          <View style={styles.metricsRow}>
            <View style={styles.metricBlock}>
              <Text style={styles.metricValue}>
                {formatHeight(profile?.height_cm ?? null, units)}
              </Text>
              <Text style={styles.metricLabel}>Height</Text>
            </View>
            <View style={styles.metricBlock}>
              <Text style={styles.metricValue}>
                {formatWeight(profile?.weight_kg ?? null, units)}
              </Text>
              <Text style={styles.metricLabel}>Weight</Text>
            </View>
            <Pressable style={styles.editLink} onPress={startEditing}>
              <Text style={styles.editLinkText}>Edit</Text>
            </Pressable>
          </View>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>General build</Text>
        <View style={styles.pickerWrapper} pointerEvents={saving ? "none" : "auto"}>
          <BuildPicker
            value={profile?.build ?? null}
            onChange={(build) => saveMetrics({ build })}
            widthScale={widthScale}
          />
        </View>
        {saving && <ActivityIndicator style={{ marginTop: 8 }} />}
      </View>

      {/*
        Shop surfaces the user owns. Both live outside the tab bar, so this
        is their only entry point once the user has navigated away from the
        Shop tab — hence a plain nav section rather than another CTA button.
      */}
      <View style={styles.card}>
        <Text style={styles.label}>Shopping</Text>
        <Pressable
          style={styles.navRow}
          onPress={() => router.push("/wishlist")}
          accessibilityRole="button"
        >
          <Text style={styles.value}>Saved items</Text>
          <Text style={styles.navRowChevron}>→</Text>
        </Pressable>
        <View style={styles.navRowDivider} />
        <Pressable
          style={styles.navRow}
          onPress={() => router.push("/orders")}
          accessibilityRole="button"
        >
          <Text style={styles.value}>Your orders</Text>
          <Text style={styles.navRowChevron}>→</Text>
        </Pressable>
      </View>

      {error && <Text style={styles.errorText}>{error}</Text>}

      {/*
        PRODUCT PIVOT: the character creator (skin/face/hair/body/etc,
        no photo or measurements required) is now how users set up and
        edit their avatar — see src/features/creator/. Reachable here so
        it isn't only a one-time onboarding step.
      */}
      <Pressable
        style={styles.editCharacterButton}
        onPress={() => router.push("/create-avatar")}
      >
        <Text style={styles.editCharacterButtonText}>Edit your character →</Text>
      </Pressable>

      {/*
        The fully-3D, procedurally-built (no external asset) rendering of the
        same customization the character creator edits — see
        src/features/avatar3d/CharacterAvatar.tsx / CharacterViewerScreen.tsx.
      */}
      <Pressable
        style={styles.view3dButton}
        onPress={() => router.push("/character")}
      >
        <Text style={styles.view3dButtonText}>View your character in 3D →</Text>
      </Pressable>

      {/*
        The dev/spike entrypoint that used to sit here ("Open 3D avatar
        spike →") is gone, and so is the screen behind it — /avatar-spike
        and its route file were deleted along with the hardcoded remote GLB
        they depended on. The reusable part of that work (GLB loading,
        cache-clear-on-retry, Suspense error handling) was extracted first
        and lives in src/features/avatar3d/gltf/, unrouted, waiting for a
        real rig. There is nothing to deep-link to.
      */}

      <Pressable
        style={[styles.signOutButton, signingOut && styles.buttonDisabled]}
        onPress={handleSignOut}
        disabled={signingOut}
      >
        {signingOut ? (
          <ActivityIndicator color={colors.danger} />
        ) : (
          <Text style={styles.signOutButtonText}>Sign Out</Text>
        )}
      </Pressable>

      <View style={styles.dangerZone}>
        <Text style={styles.dangerZoneLabel}>Danger zone</Text>
        <Pressable
          style={[
            styles.deleteAccountButton,
            deletingAccount && styles.buttonDisabled,
          ]}
          onPress={handleDeleteAccount}
          disabled={deletingAccount}
        >
          {deletingAccount ? (
            <ActivityIndicator color={colors.onInk} />
          ) : (
            <Text style={styles.deleteAccountButtonText}>Delete account</Text>
          )}
        </Pressable>
        <Text style={styles.dangerZoneHint}>
          Permanently deletes your data. This can&apos;t be undone.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing.md,
    paddingBottom: 48,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  title: {
    ...type.title,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  label: {
    ...type.label,
    marginBottom: 6,
  },
  value: {
    fontSize: 16,
    color: colors.ink,
  },
  unitsRow: {
    flexDirection: "row",
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    padding: 2,
  },
  unitButton: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  unitButtonActive: {
    backgroundColor: colors.ink,
  },
  unitText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.muted,
  },
  unitTextActive: {
    color: colors.onInk,
  },
  metricsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
  },
  metricBlock: {},
  metricValue: {
    fontFamily: type.title.fontFamily,
    fontSize: 22,
    color: colors.ink,
  },
  metricLabel: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  editLink: {
    marginLeft: "auto",
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  editLinkText: {
    color: colors.accent,
    fontWeight: "700",
    fontSize: 14,
  },
  inputRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.ink,
  },
  inputHalf: {
    flex: 1,
  },
  hintText: {
    fontSize: 12,
    color: colors.faint,
    marginTop: 6,
  },
  editButtonsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  secondaryButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
  },
  secondaryButtonText: {
    fontWeight: "600",
    color: colors.ink,
  },
  primaryButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
    alignItems: "center",
  },
  primaryButtonText: {
    fontWeight: "700",
    color: colors.onInk,
  },
  pickerWrapper: {
    marginHorizontal: -spacing.md,
  },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
  },
  navRowChevron: {
    color: colors.accent,
    fontWeight: "700",
    fontSize: 15,
  },
  navRowDivider: {
    height: 1,
    backgroundColor: colors.border,
  },
  errorText: {
    color: colors.danger,
    marginBottom: spacing.sm,
    textAlign: "center",
  },
  editCharacterButton: {
    backgroundColor: colors.acid,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  editCharacterButtonText: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "700",
  },
  view3dButton: {
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  view3dButtonText: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: "700",
  },
  signOutButton: {
    borderWidth: 1,
    borderColor: colors.danger,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  signOutButtonText: {
    color: colors.danger,
    fontSize: 16,
    fontWeight: "700",
  },
  dangerZone: {
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  dangerZoneLabel: {
    ...type.label,
    color: colors.danger,
    marginBottom: spacing.sm,
  },
  deleteAccountButton: {
    backgroundColor: colors.danger,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: "center",
  },
  deleteAccountButtonText: {
    color: colors.onInk,
    fontSize: 16,
    fontWeight: "700",
  },
  dangerZoneHint: {
    fontSize: 12,
    color: colors.muted,
    marginTop: spacing.sm,
    textAlign: "center",
  },
});
