import React from "react";
import { ScrollView, Pressable, StyleSheet, Text, View } from "react-native";
import type { Build } from "../../lib/database.types";
import { AvatarSvg } from "./avatars";
import { colors, radius } from "../../lib/theme";

export interface BuildPickerProps {
  value: Build | null;
  onChange: (build: Build) => void;
  /** Optional width scale (from height/weight) so thumbnails match the user. */
  widthScale?: number;
}

interface BuildOption {
  value: Build;
  label: string;
  hint: string;
}

const BUILD_OPTIONS: BuildOption[] = [
  { value: "slim", label: "Slim", hint: "Leaner frame" },
  { value: "average", label: "Average", hint: "In-between build" },
  { value: "athletic", label: "Athletic", hint: "Toned, defined" },
  { value: "curvy", label: "Curvy", hint: "Fuller hips & bust" },
  { value: "broad", label: "Broad", hint: "Wider shoulders" },
];

/**
 * Horizontal-scrolling row of general-build avatar thumbnails.
 * Tapping one calls onChange; the selected build is highlighted.
 */
export default function BuildPicker({
  value,
  onChange,
  widthScale = 1,
}: BuildPickerProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
    >
      {BUILD_OPTIONS.map((option) => {
        const isSelected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.card, isSelected && styles.cardSelected]}
            accessibilityRole="button"
            accessibilityLabel={`Select ${option.label} build`}
            accessibilityState={{ selected: isSelected }}
          >
            <View style={styles.thumbnailWrap}>
              <AvatarSvg
                build={option.value}
                widthScale={widthScale}
                width={70}
                height={140}
              />
            </View>
            <Text style={[styles.label, isSelected && styles.labelSelected]}>
              {option.label}
            </Text>
            <Text style={styles.hint}>{option.hint}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  card: {
    alignItems: "center",
    justifyContent: "flex-start",
    padding: 10,
    marginRight: 10,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: colors.surfaceAlt,
    width: 104,
  },
  cardSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  thumbnailWrap: {
    height: 140,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: "700",
    color: colors.muted,
    textAlign: "center",
  },
  labelSelected: {
    color: colors.ink,
  },
  hint: {
    marginTop: 2,
    fontSize: 10,
    color: colors.faint,
    textAlign: "center",
  },
});
