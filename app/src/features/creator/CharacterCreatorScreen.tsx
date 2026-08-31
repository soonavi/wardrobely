import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AvatarPreview } from "./AvatarPreview";
import {
  ACCESSORIES,
  BODY_TYPES,
  EYEBROW_STYLES,
  EYE_COLORS,
  EYE_SHAPES,
  FACIAL_HAIR_STYLES,
  FACE_SHAPES,
  HAIR_COLORS,
  HAIR_STYLES,
  SKIN_TONES,
  DEFAULT_CUSTOMIZATION,
  mergeCustomization,
  type BodyType,
  type ChipOption,
  type Customization,
  type EyeShape,
  type EyebrowStyle,
  type FaceShape,
  type FacialHairStyle,
  type SwatchOption,
} from "./customization";
import { getMyAvatar, saveCustomization } from "../../lib/api/avatars";
import { updateProfile } from "../../lib/api/profiles";
import { useAuthStore } from "../../lib/stores/useAuthStore";
import { Wordmark } from "../../components/Wordmark";
import { colors, fonts, radius, spacing, type } from "../../lib/theme";

type CategoryId =
  | "body"
  | "skin"
  | "face"
  | "eyes"
  | "brows"
  | "hair"
  | "facialHair"
  | "extras";

const CATEGORIES: { id: CategoryId; label: string }[] = [
  { id: "body", label: "Body" },
  { id: "skin", label: "Skin" },
  { id: "face", label: "Face" },
  { id: "eyes", label: "Eyes" },
  { id: "brows", label: "Brows" },
  { id: "hair", label: "Hair" },
  { id: "facialHair", label: "Facial hair" },
  { id: "extras", label: "Extras" },
];

export interface CharacterCreatorScreenProps {
  /**
   * True when this screen is embedded as the onboarding step (see
   * app/onboarding.tsx). On Save it replaces the whole stack into the
   * tabs instead of navigating back, since there's nothing to go back
   * to yet. The root layout's auth gate (app/_layout.tsx) keys off
   * `profile.build`, which Save always keeps in sync with the chosen
   * body type — that's what actually lets onboarding users through.
   */
  onboarding?: boolean;
}

/** Generic row of tappable color swatches. */
function SwatchRow({
  options,
  selected,
  onSelect,
}: {
  options: SwatchOption[];
  selected: string;
  onSelect: (hex: string) => void;
}) {
  return (
    <View style={styles.swatchRow}>
      {options.map((opt) => {
        const active = opt.hex.toLowerCase() === selected.toLowerCase();
        return (
          <Pressable
            key={opt.id}
            onPress={() => onSelect(opt.hex)}
            accessibilityRole="button"
            accessibilityLabel={opt.label}
            accessibilityState={{ selected: active }}
            style={[
              styles.swatch,
              { backgroundColor: opt.hex },
              active && styles.swatchActive,
            ]}
          />
        );
      })}
    </View>
  );
}

/** Generic row of tappable option chips (single-select). */
function ChipRow({
  options,
  selected,
  onSelect,
}: {
  options: { id: string; label: string }[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <View style={styles.chipRow}>
      {options.map((opt) => {
        const active = opt.id === selected;
        return (
          <Pressable
            key={opt.id}
            onPress={() => onSelect(opt.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * The character creator: a live 2D preview pinned at the top, category
 * tabs, and the selected category's options below. Replaces the old
 * photo-upload / measurement-only avatar flow — see customization.ts for
 * the full data model this screen edits.
 */
export function CharacterCreatorScreen({ onboarding = false }: CharacterCreatorScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = useAuthStore((s) => s.session);
  const setProfile = useAuthStore((s) => s.setProfile);
  const userId = session?.user.id;

  const [customization, setCustomization] = useState<Customization>(DEFAULT_CUSTOMIZATION);
  const [activeCategory, setActiveCategory] = useState<CategoryId>("body");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  /**
   * Bumped on every load so a response that lands after unmount — or after a
   * Retry already superseded it — is discarded instead of setting state.
   */
  const loadIdRef = useRef(0);

  const loadAvatar = useCallback(async () => {
    const loadId = ++loadIdRef.current;
    setLoading(true);
    setLoadError(null);

    const { data, error: fetchError } = await getMyAvatar();
    if (loadId !== loadIdRef.current) return;

    if (fetchError) {
      // Do NOT fall through to DEFAULT_CUSTOMIZATION here. Save upserts
      // exactly what this screen is holding (saveCustomization writes the
      // whole `customization` column), so presenting defaults after a failed
      // read would let one tap overwrite a character we merely failed to
      // fetch. The loadError branch in render replaces the editor with a
      // Retry, which is what actually keeps Save out of reach.
      setLoadError(fetchError);
    } else if (data?.customization) {
      setCustomization(mergeCustomization(data.customization as Partial<Customization>));
    }
    // A *successful* query with no row — or a row predating the creator,
    // whose `customization` defaults to `{}` — is a genuine new-user state
    // (this screen is also the onboarding step), so defaults are correct and
    // Save must stay available there.

    setLoading(false);
  }, []);

  // Load any previously-saved customization on mount, and again on Retry.
  useEffect(() => {
    loadAvatar();
    return () => {
      // Bumping the generation counter is what cancels an in-flight
      // loadAvatar(): it re-reads loadIdRef.current after its await and bails
      // when the value moved (see the guard above). Mutating the LIVE ref on
      // the way out is therefore the entire point of this cleanup.
      //
      // react-hooks/exhaustive-deps warns here because a ref read in cleanup
      // is usually a stale-DOM-node bug, and its stock remedy — copy
      // loadIdRef.current into a local inside the effect and use the copy —
      // would increment a snapshot instead of the ref the running load is
      // watching, silently disabling the cancellation. The warning does not
      // apply to a generation counter, so it is suppressed rather than
      // "fixed".
      // eslint-disable-next-line react-hooks/exhaustive-deps
      loadIdRef.current++;
    };
  }, [loadAvatar]);

  function update(patch: Partial<Customization>) {
    setCustomization((prev) => ({ ...prev, ...patch }));
  }

  function toggleAccessory(id: string) {
    if (id === "none") {
      update({ accessories: [] });
      return;
    }
    setCustomization((prev) => ({
      ...prev,
      accessories: prev.accessories.includes(id)
        ? prev.accessories.filter((a) => a !== id)
        : [...prev.accessories, id],
    }));
  }

  async function handleSave() {
    if (!userId || saving) return;

    setSaving(true);
    setSaveError(null);

    const { error: upsertError } = await saveCustomization(customization);
    if (upsertError) {
      setSaving(false);
      setSaveError(upsertError);
      return;
    }

    // Keep profile.build in sync with the chosen body type — this is the
    // field the root layout's auth gate checks, so saving here is what
    // actually completes onboarding for new users.
    const { data: profileData, error: profileError } = await updateProfile(userId, {
      build: customization.bodyType,
    });

    setSaving(false);

    if (profileError) {
      setSaveError(profileError);
      return;
    }

    if (profileData) {
      setProfile(profileData);
    }

    if (onboarding) {
      router.replace("/(tabs)/wardrobe");
    } else {
      router.back();
    }
  }

  const bodyTypeChips: ChipOption[] = useMemo(
    () => BODY_TYPES.map((b) => ({ id: b.id, label: b.label })),
    []
  );

  function renderCategory() {
    switch (activeCategory) {
      case "body":
        return (
          <ChipRow
            options={bodyTypeChips}
            selected={customization.bodyType}
            onSelect={(id) => update({ bodyType: id as BodyType })}
          />
        );
      case "skin":
        return (
          <SwatchRow
            options={SKIN_TONES}
            selected={customization.skinTone}
            onSelect={(hex) => update({ skinTone: hex })}
          />
        );
      case "face":
        return (
          <ChipRow
            options={FACE_SHAPES}
            selected={customization.faceShape}
            onSelect={(id) => update({ faceShape: id as FaceShape })}
          />
        );
      case "eyes":
        return (
          <>
            <Text style={styles.sectionLabel}>Shape</Text>
            <ChipRow
              options={EYE_SHAPES}
              selected={customization.eyeShape}
              onSelect={(id) => update({ eyeShape: id as EyeShape })}
            />
            <Text style={styles.sectionLabel}>Color</Text>
            <SwatchRow
              options={EYE_COLORS}
              selected={customization.eyeColor}
              onSelect={(hex) => update({ eyeColor: hex })}
            />
          </>
        );
      case "brows":
        return (
          <>
            <Text style={styles.sectionLabel}>Style</Text>
            <ChipRow
              options={EYEBROW_STYLES}
              selected={customization.eyebrows}
              onSelect={(id) => update({ eyebrows: id as EyebrowStyle })}
            />
            <Text style={styles.sectionLabel}>Color</Text>
            <SwatchRow
              options={HAIR_COLORS}
              selected={customization.eyebrowColor}
              onSelect={(hex) => update({ eyebrowColor: hex })}
            />
          </>
        );
      case "hair":
        return (
          <>
            <Text style={styles.sectionLabel}>Style</Text>
            <ChipRow
              options={HAIR_STYLES}
              selected={customization.hairStyle}
              onSelect={(id) => update({ hairStyle: id })}
            />
            <Text style={styles.sectionLabel}>Color</Text>
            <SwatchRow
              options={HAIR_COLORS}
              selected={customization.hairColor}
              onSelect={(hex) => update({ hairColor: hex })}
            />
          </>
        );
      case "facialHair":
        return (
          <>
            <Text style={styles.sectionLabel}>Style</Text>
            <ChipRow
              options={FACIAL_HAIR_STYLES}
              selected={customization.facialHair}
              onSelect={(id) => update({ facialHair: id as FacialHairStyle })}
            />
            <Text style={styles.sectionLabel}>Color</Text>
            <SwatchRow
              options={HAIR_COLORS}
              selected={customization.facialHairColor}
              onSelect={(hex) => update({ facialHairColor: hex })}
            />
          </>
        );
      case "extras":
        return (
          <View style={styles.chipRow}>
            {ACCESSORIES.map((opt) => {
              const active =
                opt.id === "none"
                  ? customization.accessories.length === 0
                  : customization.accessories.includes(opt.id);
              return (
                <Pressable
                  key={opt.id}
                  onPress={() => toggleAccessory(opt.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        );
      default:
        return null;
    }
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  // The editor (and with it Save) stays off-screen until a load succeeds —
  // see loadAvatar above for why a failed read must not reach Save.
  if (loadError) {
    return (
      <View style={[styles.loadingContainer, styles.errorFill]}>
        <Text style={styles.errorTitle}>Couldn&apos;t load your character</Text>
        <Text style={styles.errorMessage} numberOfLines={4}>
          {loadError}
        </Text>
        <Pressable style={styles.retryButton} onPress={loadAvatar} accessibilityRole="button">
          <Text style={styles.retryButtonText}>Retry</Text>
        </Pressable>
        {!onboarding && (
          <Pressable
            onPress={() => router.back()}
            style={styles.errorBackButton}
            accessibilityRole="button"
          >
            <Text style={styles.backButtonText}>← Back</Text>
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.headerRow}>
          {!onboarding ? (
            <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityRole="button">
              <Text style={styles.backButtonText}>← Back</Text>
            </Pressable>
          ) : (
            <View style={styles.brandRow}>
              <Wordmark size={24} />
            </View>
          )}
        </View>

        <Text style={styles.title}>Design your Selv</Text>
        <Text style={styles.subtitle}>
          Customize your character — skin, face, hair, and more. This is how
          you&apos;ll show up in try-on, no photo required.
        </Text>

        <View style={styles.previewWrap}>
          <AvatarPreview customization={customization} size={220} />
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabsRow}
        >
          {CATEGORIES.map((cat) => {
            const active = cat.id === activeCategory;
            return (
              <Pressable
                key={cat.id}
                onPress={() => setActiveCategory(cat.id)}
                style={[styles.tab, active && styles.tabActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.tabText, active && styles.tabTextActive]}>
                  {cat.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.optionsCard}>{renderCategory()}</View>

        {saveError && <Text style={styles.errorText}>{saveError}</Text>}

        <Pressable
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={saving}
          accessibilityRole="button"
        >
          {saving ? (
            <ActivityIndicator color={colors.ink} />
          ) : (
            <Text style={styles.saveButtonText}>
              {onboarding ? "Save & continue" : "Save"}
            </Text>
          )}
        </Pressable>

        {/*
          Not shown during onboarding (there's nothing saved to preview yet
          on a brand-new account) — this jumps to the fully-3D, procedurally-
          built rendering of the SAME customization the 2D preview above
          shows live (see src/features/avatar3d/CharacterAvatar.tsx). It
          reads whatever was last saved via getMyAvatar, so unsaved edits
          made since opening this screen won't show there until Save.
        */}
        {!onboarding && (
          <Pressable
            style={styles.preview3dButton}
            onPress={() => router.push("/character")}
            accessibilityRole="button"
          >
            <Text style={styles.preview3dButtonText}>Preview in 3D →</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

export default CharacterCreatorScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: 48,
  },
  headerRow: {
    minHeight: 28,
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  brandRow: {
    alignItems: "center",
  },
  backButton: {
    alignSelf: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  backButtonText: {
    color: colors.accent,
    fontFamily: fonts.medium,
    fontSize: 15,
  },
  title: {
    ...type.title,
    fontSize: 26,
    textAlign: "center",
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...type.subtle,
    textAlign: "center",
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
  },
  previewWrap: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
  },
  tabsRow: {
    gap: spacing.xs,
    paddingBottom: spacing.sm,
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    marginRight: 8,
  },
  tabActive: {
    backgroundColor: colors.accent,
  },
  tabText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.muted,
  },
  tabTextActive: {
    color: colors.onInk,
  },
  optionsCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
    minHeight: 140,
  },
  sectionLabel: {
    ...type.label,
    marginBottom: spacing.sm,
  },
  swatchRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: spacing.sm,
  },
  swatch: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.border,
  },
  swatchActive: {
    borderColor: colors.accent,
    borderWidth: 3,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: "transparent",
  },
  chipActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  chipText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.muted,
  },
  chipTextActive: {
    color: colors.accent,
  },
  errorText: {
    color: colors.danger,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  errorFill: {
    paddingHorizontal: spacing.xl,
  },
  errorTitle: {
    ...type.title,
    fontSize: 20,
    textAlign: "center",
    marginBottom: spacing.xs,
  },
  errorMessage: {
    ...type.subtle,
    textAlign: "center",
    marginBottom: spacing.md,
  },
  retryButton: {
    backgroundColor: colors.acid,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: radius.md,
    alignItems: "center",
  },
  retryButtonText: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "700",
  },
  errorBackButton: {
    marginTop: spacing.md,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  saveButton: {
    backgroundColor: colors.acid,
    paddingVertical: 16,
    borderRadius: radius.md,
    alignItems: "center",
    marginTop: spacing.xs,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "700",
  },
  preview3dButton: {
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  preview3dButtonText: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: "700",
  },
});
