/**
 * Selv design system — bold Gen Z fashion-tech look:
 * warm ink text on a cream base, digital-lavender as the accent, and an
 * acid-green "pop" for CTAs/highlights. All screens pull colors/spacing/type
 * from here; no hard-coded hex in screen styles.
 *
 * Type uses the bundled brand fonts — Space Grotesk (display) + Inter (UI),
 * loaded via @expo-google-fonts in app/_layout.tsx's useFonts gate. The root
 * layout doesn't render its children until those fonts (and auth/profile
 * state) are ready, so any screen using `type`/`fonts` below can assume the
 * custom families are already registered.
 */
export const colors = {
  /** App background — warm cream. */
  bg: "#F5F2EA",
  /** Cards / inputs. */
  surface: "#FFFFFF",
  /** Slightly sunken surfaces (chips, placeholders). */
  surfaceAlt: "#ECE7DA",
  /** Primary text + filled buttons — warm near-black ink. */
  ink: "#141026",
  /** Secondary text. */
  muted: "#7C7690",
  /** Faint text / placeholders. */
  faint: "#A9A4BF",
  /** Hairline borders. */
  border: "#E7E1D4",
  /** Accent — digital lavender; used for selection, links, FAB. */
  accent: "#5B49D6",
  /** Soft accent wash for selected states. */
  accentSoft: "#EEEDFE",
  /** Acid-green energy pop — CTAs / highlights. Text on it should be ink. */
  acid: "#C7F94B",
  acidDeep: "#A6E01F",
  /** Errors / destructive. */
  danger: "#E24B4A",
  /** Text on ink or accent backgrounds. */
  onInk: "#F5F2EA",
  /** Avatar silhouette fill/stroke — lavender tints. */
  silhouette: "#C9BFFF",
  silhouetteStroke: "#8B7CFF",
} as const;

/**
 * Bundled brand font families, keyed to the useFonts() map in
 * app/_layout.tsx. Names must match exactly — they're how RN looks up the
 * registered custom fonts at render time.
 */
export const fonts = {
  /** Space Grotesk Bold — display/wordmark. */
  display: "SpaceGrotesk_700Bold",
  /** Space Grotesk Medium — secondary display weight. */
  displayMed: "SpaceGrotesk_500Medium",
  /** Inter Regular — body copy. */
  body: "Inter_400Regular",
  /** Inter Medium — emphasized body/buttons. */
  medium: "Inter_500Medium",
  /** Inter SemiBold — labels/section headers. */
  semibold: "Inter_600SemiBold",
} as const;

/** Display face for titles/wordmark. Kept as a named export for back-compat. */
export const displayFont = fonts.display;

export const type = {
  /** Screen titles — bold, tight tracking (grotesk feel). */
  title: {
    fontFamily: fonts.display,
    fontSize: 30,
    color: colors.ink,
    letterSpacing: -0.5,
  },
  /** Section labels — small caps feel. */
  label: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.muted,
    letterSpacing: 1.2,
    textTransform: "uppercase" as const,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink,
  },
  subtle: {
    fontFamily: fonts.body,
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

/** The brand wordmark. */
export const BRAND = "selv";
