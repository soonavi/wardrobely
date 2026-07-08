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
import { signOut } from "../../lib/api/auth";
import { updateBodyMetrics } from "../../lib/api/profiles";
import { useAuthStore } from "../../lib/stores/useAuthStore";
import type { Build } from "../../lib/database.types";
import { colors, radius, spacing, type } from "../../lib/theme";

type Units = "imperial" | "metric";

/** Format stored metric height for display in the chosen units. */
function formatHeight(heightCm: number | null, units: Units): string {
  if (!heightCm) return "—";
  if (units === "metric") return `${heightCm} cm`;
  const totalInches = Math.round(heightCm / 2.54);
  return `${Math.floor(totalInches / 12)}'${totalInches % 12}"`;
}

/** Format stored metric weight for display in the chosen units. */
function formatWeight(weightKg: number | null, units: Units): string {
  if (!weightKg) return "—";
  if (units === "metric") return `${weightKg} kg`;
  return `${Math.round(weightKg / 0.453592)} lbs`;
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
  const [error, setError] = useState<string | null>(null);

  const widthScale = buildWidthScale(profile?.height_cm, profile?.weight_kg);

  useFocusEffect(
    React.useCallback(() => {
      setEditing(false);
      setError(null);
    }, [])
  );

  function startEditing() {
    if (units === "metric") {
      setHeightInput(profile?.height_cm ? String(profile.height_cm) : "");
      setWeightInput(profile?.weight_kg ? String(profile.weight_kg) : "");
    } else {
      const totalInches = profile?.height_cm
        ? Math.round(profile.height_cm / 2.54)
        : 0;
      setHeightInput(totalInches ? String(totalInches) : "");
      setWeightInput(
        profile?.weight_kg
          ? String(Math.round(profile.weight_kg / 0.453592))
          : ""
      );
    }
    setEditing(true);
  }

  /** Parse inputs (height in cm or total inches; weight in kg or lbs). */
  function parseMetrics(): { height_cm: number; weight_kg: number } | null {
    const h = parseInt(heightInput, 10);
    const w = parseInt(weightInput, 10);
    if (isNaN(h) || isNaN(w)) return null;
    if (units === "metric") return { height_cm: h, weight_kg: w };
    return {
      height_cm: Math.round(h * 2.54),
      weight_kg: Math.round(w * 0.453592),
    };
  }

  async function saveMetrics(overrides?: { build?: Build }) {
    if (!userId || !profile) return;

    const parsed = editing ? parseMetrics() : null;
    const height_cm = parsed?.height_cm ?? profile.height_cm;
    const weight_kg = parsed?.weight_kg ?? profile.weight_kg;
    const build = overrides?.build ?? profile.build;

    if (!height_cm || !weight_kg || !build) {
      setError("Please fill in height and weight.");
      return;
    }
    if (height_cm < 90 || height_cm > 250 || weight_kg < 30 || weight_kg > 300) {
      setError("Those measurements look out of range — please double-check.");
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

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Profile</Text>

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
                  onPress={() => {
                    setUnits(u);
                    setEditing(false);
                  }}
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
            {units === "imperial" && (
              <Text style={styles.hintText}>
                Enter height in total inches (5'8" = 68).
              </Text>
            )}
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
        <View style={styles.pickerWrapper}>
          <BuildPicker
            value={profile?.build ?? null}
            onChange={(build) => saveMetrics({ build })}
            widthScale={widthScale}
          />
        </View>
        {saving && <ActivityIndicator style={{ marginTop: 8 }} />}
      </View>

      {error && <Text style={styles.errorText}>{error}</Text>}

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
  title: {
    ...type.title,
    marginBottom: spacing.md,
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
  errorText: {
    color: colors.danger,
    marginBottom: spacing.sm,
    textAlign: "center",
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
});
