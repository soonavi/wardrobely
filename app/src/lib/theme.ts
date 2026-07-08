import { Platform } from "react-native";

/**
 * wardrobeSpec design system — "tailor's studio" aesthetic:
 * warm ivory paper, near-black ink, terracotta accent, serif display
 * type (system serif — no font loading needed, works in Expo Go).
 * All screens pull colors/spacing/type from here; no hard-coded hex
 * values in screen styles.
 */
export const colors = {
  /** App background — warm ivory, like pattern paper. */
  bg: "#FAF7F2",
  /** Cards / inputs. */
  surface: "#FFFFFF",
  /** Slightly sunken surfaces (chips, placeholders). */
  surfaceAlt: "#F1EBE3",
  /** Primary text + filled buttons — warm near-black ink. */
  ink: "#1C1814",
  /** Secondary text. */
  muted: "#8A8075",
  /** Faint text / placeholders. */
  faint: "#B5AB9F",
  /** Hairline borders. */
  border: "#E6DFD4",
  /** Accent — terracotta, used sparingly (selection, links, FAB). */
  accent: "#B4552D",
  /** Soft accent wash for selected states. */
  accentSoft: "#F6E7DE",
  /** Errors / destructive. */
  danger: "#A63A2B",
  /** Text on ink or accent backgrounds. */
  onInk: "#FBF8F3",
  /** Avatar silhouette fill/stroke — warm taupe. */
  silhouette: "#CFC5B6",
  silhouetteStroke: "#A99C89",
} as const;

/** Serif display face for titles/wordmark; falls back per platform. */
export const displayFont = Platform.select({
  ios: "Georgia",
  android: "serif",
  default: "serif",
});

export const type = {
  /** Screen titles — editorial serif. */
  title: {
    fontFamily: displayFont,
    fontSize: 30,
    fontWeight: "700" as const,
    color: colors.ink,
    letterSpacing: 0.2,
  },
  /** Section labels — small caps feel. */
  label: {
    fontSize: 12,
    fontWeight: "700" as const,
    color: colors.muted,
    letterSpacing: 1.2,
    textTransform: "uppercase" as const,
  },
  body: {
    fontSize: 15,
    color: colors.ink,
  },
  subtle: {
    fontSize: 14,
    color: colors.muted,
  },
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

/** The brand wordmark, styled as two-tone in screens: wardrobe + Spec. */
export const BRAND = "wardrobeSpec";
