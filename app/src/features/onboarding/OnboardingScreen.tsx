import React, { useEffect, useMemo, useState } from "react";
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
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import BuildPicker from "../avatar/BuildPicker";
import { buildWidthScale } from "../avatar/avatars";
import { updateBodyMetrics } from "../../lib/api/profiles";
import { useAuthStore } from "../../lib/stores/useAuthStore";
import type { Build } from "../../lib/database.types";
import { colors, radius, spacing, type } from "../../lib/theme";

type Units = "imperial" | "metric";

/** Strip anything but digits so pasted/typed input can't produce NaN. */
function digitsOnly(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

/**
 * First-run onboarding: height + weight (imperial/metric toggle) and a
 * general build. Values are stored metric (cm/kg) regardless of the
 * units used for entry. The avatar thumbnails react live to the entered
 * measurements via widthScale.
 */
export function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = useAuthStore((s) => s.session);
  const setProfile = useAuthStore((s) => s.setProfile);
  const userId = session?.user.id;

  const [units, setUnits] = useState<Units>("imperial");
  const [feet, setFeet] = useState("");
  const [inches, setInches] = useState("");
  const [pounds, setPounds] = useState("");
  const [centimeters, setCentimeters] = useState("");
  const [kilograms, setKilograms] = useState("");
  const [build, setBuild] = useState<Build | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Parse current inputs into metric values; null if incomplete/invalid. */
  const metrics = useMemo(() => {
    if (units === "imperial") {
      const ft = parseInt(feet, 10);
      const inch = inches.trim() === "" ? 0 : parseInt(inches, 10);
      const lb = parseInt(pounds, 10);
      if (isNaN(ft) || isNaN(inch) || isNaN(lb)) return null;
      return {
        height_cm: Math.round(ft * 30.48 + inch * 2.54),
        weight_kg: Math.round(lb * 0.453592),
      };
    }
    const cm = parseInt(centimeters, 10);
    const kg = parseInt(kilograms, 10);
    if (isNaN(cm) || isNaN(kg)) return null;
    return { height_cm: cm, weight_kg: kg };
  }, [units, feet, inches, pounds, centimeters, kilograms]);

  const widthScale = buildWidthScale(metrics?.height_cm, metrics?.weight_kg);
  const canContinue = metrics !== null && build !== null && !saving;

  // Clear a stale validation message as soon as the user edits the form.
  useEffect(() => {
    setError(null);
  }, [units, feet, inches, pounds, centimeters, kilograms, build]);

  async function handleContinue() {
    if (!userId || !metrics || !build) return;

    if (metrics.height_cm < 90 || metrics.height_cm > 250) {
      setError("Please enter a height between 3'0\" and 8'2\" (90–250 cm).");
      return;
    }
    if (metrics.weight_kg < 30 || metrics.weight_kg > 300) {
      setError("Please enter a weight between 66 and 660 lbs (30–300 kg).");
      return;
    }

    setSaving(true);
    setError(null);

    const { data, error: saveError } = await updateBodyMetrics(userId, {
      ...metrics,
      build,
    });

    setSaving(false);

    if (saveError) {
      setError(saveError);
      return;
    }

    // Update the shared profile so the root layout's auth gate sees the
    // new measurements immediately (otherwise it would bounce us back here).
    if (data) {
      setProfile(data);
    }

    router.replace("/(tabs)/wardrobe");
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 32 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.brand}>
          wardrobe<Text style={styles.brandAccent}>Spec</Text>
        </Text>
        <Text style={styles.title}>Your measurements</Text>
        <Text style={styles.subtitle}>
          We use these to proportion your try-on avatar. You can change them
          anytime in your profile.
        </Text>

        {/* Units toggle */}
        <View style={styles.unitsRow} accessibilityRole="radiogroup">
          {(["imperial", "metric"] as const).map((u) => {
            const active = units === u;
            return (
              <Pressable
                key={u}
                style={[styles.unitButton, active && styles.unitButtonActive]}
                onPress={() => setUnits(u)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={
                  u === "imperial" ? "Feet and pounds" : "Centimeters and kilograms"
                }
              >
                <Text
                  style={[styles.unitText, active && styles.unitTextActive]}
                >
                  {u === "imperial" ? "ft / lbs" : "cm / kg"}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {units === "imperial" ? (
          <>
            <Text style={styles.label}>Height</Text>
            <View style={styles.inputRow}>
              <TextInput
                style={[styles.input, styles.inputHalf]}
                value={feet}
                onChangeText={(v) => setFeet(digitsOnly(v).slice(0, 1))}
                placeholder="5 ft"
                placeholderTextColor={colors.faint}
                keyboardType="number-pad"
                maxLength={1}
                accessibilityLabel="Height, feet"
              />
              <TextInput
                style={[styles.input, styles.inputHalf]}
                value={inches}
                onChangeText={(v) => setInches(digitsOnly(v).slice(0, 2))}
                placeholder="8 in"
                placeholderTextColor={colors.faint}
                keyboardType="number-pad"
                maxLength={2}
                accessibilityLabel="Height, inches"
              />
            </View>

            <Text style={styles.label}>Weight</Text>
            <TextInput
              style={styles.input}
              value={pounds}
              onChangeText={(v) => setPounds(digitsOnly(v).slice(0, 3))}
              placeholder="150 lbs"
              placeholderTextColor={colors.faint}
              keyboardType="number-pad"
              maxLength={3}
              accessibilityLabel="Weight, pounds"
            />
          </>
        ) : (
          <>
            <Text style={styles.label}>Height</Text>
            <TextInput
              style={styles.input}
              value={centimeters}
              onChangeText={(v) => setCentimeters(digitsOnly(v).slice(0, 3))}
              placeholder="172 cm"
              placeholderTextColor={colors.faint}
              keyboardType="number-pad"
              maxLength={3}
              accessibilityLabel="Height, centimeters"
            />

            <Text style={styles.label}>Weight</Text>
            <TextInput
              style={styles.input}
              value={kilograms}
              onChangeText={(v) => setKilograms(digitsOnly(v).slice(0, 3))}
              placeholder="68 kg"
              placeholderTextColor={colors.faint}
              keyboardType="number-pad"
              maxLength={3}
              accessibilityLabel="Weight, kilograms"
            />
          </>
        )}

        <Text style={styles.label}>General build</Text>
        <View style={styles.pickerWrapper}>
          <BuildPicker value={build} onChange={setBuild} widthScale={widthScale} />
        </View>
        {build === null && (
          <Text style={styles.hintText}>Pick a build to continue.</Text>
        )}

        {error && <Text style={styles.errorText}>{error}</Text>}

        <Pressable
          style={[styles.button, !canContinue && styles.buttonDisabled]}
          onPress={handleContinue}
          disabled={!canContinue}
          accessibilityRole="button"
        >
          {saving ? (
            <ActivityIndicator color={colors.onInk} />
          ) : (
            <Text style={styles.buttonText}>Continue</Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: 48,
  },
  brand: {
    ...type.title,
    fontSize: 20,
    textAlign: "center",
    marginBottom: spacing.lg,
  },
  brandAccent: {
    color: colors.accent,
  },
  title: {
    ...type.title,
    fontSize: 26,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...type.subtle,
    textAlign: "center",
    marginBottom: spacing.lg,
  },
  unitsRow: {
    flexDirection: "row",
    alignSelf: "center",
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    padding: 3,
    marginBottom: spacing.md,
  },
  unitButton: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: radius.pill,
    minHeight: 44,
    justifyContent: "center",
  },
  unitButtonActive: {
    backgroundColor: colors.ink,
  },
  unitText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.muted,
  },
  unitTextActive: {
    color: colors.onInk,
  },
  label: {
    ...type.label,
    marginTop: spacing.md,
    marginBottom: 6,
  },
  inputRow: {
    flexDirection: "row",
    gap: spacing.sm,
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
    minHeight: 48,
  },
  inputHalf: {
    flex: 1,
  },
  pickerWrapper: {
    marginHorizontal: -spacing.lg,
    marginBottom: spacing.md,
  },
  errorText: {
    color: colors.danger,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  hintText: {
    ...type.subtle,
    fontSize: 12,
    textAlign: "center",
    marginTop: -spacing.sm,
    marginBottom: spacing.sm,
  },
  button: {
    backgroundColor: colors.ink,
    paddingVertical: 15,
    borderRadius: radius.md,
    alignItems: "center",
    marginTop: spacing.md,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    color: colors.onInk,
    fontSize: 16,
    fontWeight: "700",
  },
});
