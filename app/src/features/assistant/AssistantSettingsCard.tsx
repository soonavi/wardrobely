import React, { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";

import {
  getAssistantPreferences,
  setAssistantEnabled,
  setSuggestionFrequency,
  type SuggestionFrequency,
} from "../../lib/api/assistant";
import { colors, radius, spacing, type } from "../../lib/theme";

/**
 * ============================================================================
 * Assistant settings — the on/off switch and how chatty it is.
 * ============================================================================
 * Self-contained so `ProfileScreen` drops it in as one element rather than
 * growing another block of state, and so the consent copy lives next to the
 * control that acts on it instead of drifting from it.
 *
 * WHY THE COPY SAYS WHAT IT SAYS
 * The switch turns on a feature that sends the user's wardrobe to Anthropic.
 * `009_assistant.sql` defaults it off precisely so nobody is opted into that
 * silently, and a toggle labelled "Wardrobe assistant" with no further detail
 * would undo that care at the last step — the user would be consenting to a
 * name, not to the thing. So the description names the recipient, names what
 * is sent, and names what is not. It is longer than a settings row usually
 * wants to be, and that is the correct trade for the only screen where this
 * decision gets made.
 */

const FREQUENCIES: Array<{ value: SuggestionFrequency; label: string; hint: string }> = [
  { value: "minimal", label: "Rarely", hint: "Only when you ask" },
  { value: "balanced", label: "Balanced", hint: "When you add or try something on" },
  { value: "frequent", label: "Often", hint: "Whenever there's a good pairing" },
];

interface Props {
  userId: string;
}

export function AssistantSettingsCard({ userId }: Props) {
  const [enabled, setEnabled] = useState(false);
  const [frequency, setFrequency] = useState<SuggestionFrequency>("balanced");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: loadError } = await getAssistantPreferences(userId);
    if (loadError) {
      setError(loadError);
    } else if (data) {
      setEnabled(data.enabled);
      setFrequency(data.suggestionFrequency);
      setError(null);
    }
    setLoading(false);
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function toggle(next: boolean) {
    // Optimistic, then reconciled. A switch that waits on a round trip before
    // moving feels broken, but a switch that silently stays moved after a
    // failed write is worse — it would tell the user their wardrobe is private
    // when the server still has the feature on, or vice versa. So the failure
    // path puts it back and says why.
    setEnabled(next);
    setSaving(true);
    const { data, error: saveError } = await setAssistantEnabled(userId, next);
    setSaving(false);

    if (saveError || !data) {
      setEnabled(!next);
      setError("Couldn't save that. Check your connection and try again.");
      return;
    }
    setEnabled(data.enabled);
    setError(null);
  }

  async function chooseFrequency(next: SuggestionFrequency) {
    const previous = frequency;
    setFrequency(next);
    const { error: saveError } = await setSuggestionFrequency(userId, next);
    if (saveError) {
      setFrequency(previous);
      setError("Couldn't save that. Check your connection and try again.");
    }
  }

  if (loading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Wardrobe assistant</Text>
          <Text style={styles.subtitle}>
            Suggests things from your wardrobe that go with whatever you&rsquo;re looking at.
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={toggle}
          disabled={saving}
          trackColor={{ false: colors.border, true: colors.accent }}
        />
      </View>

      <Text style={styles.disclosure}>
        When this is on, the details of your wardrobe — category, colour, brand, tags and any
        measurements — are sent to Anthropic&rsquo;s Claude to generate suggestions. Your photos
        are never sent. Turn it off and nothing leaves Selv.
      </Text>

      {enabled ? (
        <View style={styles.frequencyBlock}>
          <Text style={styles.frequencyLabel}>How often</Text>
          <View style={styles.frequencyRow}>
            {FREQUENCIES.map((option) => {
              const active = option.value === frequency;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => void chooseFrequency(option.value)}
                  style={[styles.chip, active && styles.chipActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.frequencyHint}>
            {FREQUENCIES.find((f) => f.value === frequency)?.hint}
          </Text>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  headerText: { flex: 1, gap: 2 },
  title: { ...type.label, color: colors.ink },
  subtitle: { ...type.body, color: colors.muted },
  disclosure: { ...type.subtle, color: colors.muted, lineHeight: 18 },
  frequencyBlock: { gap: spacing.xs, marginTop: spacing.xs },
  frequencyLabel: { ...type.label, color: colors.ink },
  frequencyRow: { flexDirection: "row", gap: spacing.xs },
  chip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipLabel: { ...type.subtle, color: colors.ink },
  chipLabelActive: { color: colors.surface },
  frequencyHint: { ...type.subtle, color: colors.muted },
  error: { ...type.subtle, color: colors.danger },
});
