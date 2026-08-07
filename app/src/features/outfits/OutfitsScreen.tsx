import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  deleteOutfit,
  getOutfit,
  listOutfits,
  renameOutfit,
  type OutfitWithItems,
} from "../../lib/api/outfits";
import { getMyAvatar } from "../../lib/api/avatars";
import { useAuthStore } from "../../lib/stores/useAuthStore";
import { resolveGarmentImageUrls } from "../../lib/garmentImage";
import { mergeCustomization, type Customization } from "../creator/customization";
import {
  resolveGarmentColor,
  resolveOutfitSlots,
  type EquipSlot,
} from "../avatar3d/garmentVisual";
import { ShareCard } from "../share/ShareCard";
import { useShareCard } from "../share/useShareCard";
import type { AvatarPreviewEquipped } from "../creator/AvatarPreview";
import { colors, radius, type } from "../../lib/theme";

/**
 * The slots the flat share-card figure can actually tint.
 *
 * `EquipSlot` also contains `accessory` (the 3D character wears it at the
 * neckline), but `AvatarPreview` is a 2D vector illustration with no geometry
 * for one, so there is nowhere to put its colour. Listed explicitly, and typed
 * against `EquipSlot`, so that adding a slot to the shared vocabulary forces a
 * decision here instead of silently going unrendered.
 */
const PREVIEW_SLOTS = ["top", "bottom", "shoes"] as const satisfies readonly EquipSlot[];

/**
 * Which of an outfit's garments the share card shows, per slot.
 *
 * The choice itself — top-most layer wins a contested slot, a dress displaces
 * separate bottoms — is `resolveOutfitSlots` in avatar3d/garmentVisual.ts,
 * shared with CharacterTryOnScreen. This screen used to carry its own copy of
 * that rule, which meant the Outfits grid could preview a different outfit
 * than tapping into it actually put on the character.
 *
 * `hidden` is ignored here on purpose: this is a read-only preview and never
 * writes items back, so there is nothing to carry.
 */
function buildEquippedFromOutfit(outfit: OutfitWithItems): AvatarPreviewEquipped {
  const { bySlot } = resolveOutfitSlots(outfit.items);

  const equipped: AvatarPreviewEquipped = {};
  PREVIEW_SLOTS.forEach((slot) => {
    const item = bySlot[slot];
    if (!item) return;
    equipped[slot] = {
      color: resolveGarmentColor(item.garment),
      name: item.garment.name ?? undefined,
      long: item.garment.category === "dress",
    };
  });

  return equipped;
}

const PREVIEW_STACK_SIZE = 3;

export default function OutfitsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = useAuthStore((s) => s.session);
  const userId = session?.user.id;
  const profile = useAuthStore((s) => s.profile);

  const [outfits, setOutfits] = useState<OutfitWithItems[]>([]);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [renameTarget, setRenameTarget] = useState<OutfitWithItems | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const [busyOutfitId, setBusyOutfitId] = useState<string | null>(null);

  // --- Share ---------------------------------------------------------------
  // `shareOutfit` is both "which outfit is currently queued for sharing" and
  // (via its id) which card shows the busy overlay below.
  const [customization, setCustomization] = useState<Customization | null>(null);
  const [shareOutfit, setShareOutfit] = useState<OutfitWithItems | null>(null);
  const { cardRef: shareCardRef, share: shareCard } = useShareCard();

  useEffect(() => {
    (async () => {
      const { data } = await getMyAvatar();
      // mergeCustomization always returns a fully-populated Customization,
      // even from a null/failed fetch, so this never leaves `customization`
      // stuck at null (which would otherwise hang a queued share forever).
      setCustomization(mergeCustomization(data?.customization as Partial<Customization> | null | undefined));
    })();
  }, []);

  useEffect(() => {
    if (!shareOutfit || !customization) return;
    let cancelled = false;

    (async () => {
      // Give the off-screen <ShareCard> (re-rendered with the new
      // outfit/customization this same tick) a couple of frames to actually
      // paint before snapshotting it.
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (cancelled) return;

      const result = await shareCard();
      if (cancelled) return;

      if (!result.ok && result.error) {
        Alert.alert("Couldn't share", result.error);
      }
      setShareOutfit(null);
    })();

    return () => {
      cancelled = true;
    };
  }, [shareOutfit, customization, shareCard]);

  function handleShare(outfit: OutfitWithItems) {
    if (shareOutfit) return;
    setShareOutfit(outfit);
  }

  const loadOutfits = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);

    const { data, error: fetchError } = await listOutfits(userId);
    if (fetchError) {
      setError(fetchError);
      setLoading(false);
      return;
    }

    const rows = data ?? [];
    setOutfits(rows);

    // Keyed by garment id, not image_path: a catalog-sourced garment has no
    // path at all, and the same garment can appear across several outfits.
    const previewGarments = rows.flatMap((o) =>
      o.items.slice(0, PREVIEW_STACK_SIZE).map((i) => i.garment)
    );
    const urls = await resolveGarmentImageUrls(previewGarments);
    setThumbUrls(urls);

    setLoading(false);
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      loadOutfits();
    }, [loadOutfits])
  );

  async function handleOpenOutfit(outfit: OutfitWithItems) {
    if (busyOutfitId) return;
    setBusyOutfitId(outfit.id);
    const { data, error: fetchError } = await getOutfit(outfit.id);
    setBusyOutfitId(null);

    if (fetchError || !data) {
      Alert.alert("Error", fetchError ?? "Could not load outfit.");
      return;
    }

    /*
     * One handoff: the `?outfitId=` param. The Try On tab renders the 3D
     * CharacterTryOnScreen, which keeps per-slot equipped state of its own.
     * The id is passed rather than the fetched rows because a route param is
     * that screen's existing, already-proven entry contract (the Shop's
     * `?productId=` deep link works the same way) and it survives a cold deep
     * link, where handing over in-memory objects can't.
     *
     * This used to *also* prime the legacy 2D studio's zustand store, so that
     * studio would be holding the same outfit when the 3D screen offered it as
     * the accessories fallback. Both the offer and the studio are gone —
     * accessories have a 3D slot now — so that write went with them.
     *
     * The redundant fetch this implies (the 3D screen re-reads the outfit by
     * id) buys the error above: a broken outfit fails here, on the screen the
     * user tapped, instead of after yanking them to another tab.
     */
    router.push({
      pathname: "/(tabs)/tryon",
      params: { outfitId: data.id },
    });
  }

  function openRenameModal(outfit: OutfitWithItems) {
    setRenameTarget(outfit);
    setRenameInput(outfit.name ?? "");
  }

  async function handleRenameConfirm() {
    if (!renameTarget) return;
    const trimmed = renameInput.trim();
    if (!trimmed) return;

    setBusyOutfitId(renameTarget.id);
    const { error: renameError } = await renameOutfit(renameTarget.id, trimmed);
    setBusyOutfitId(null);

    if (renameError) {
      Alert.alert("Error", renameError);
      return;
    }

    setRenameTarget(null);
    loadOutfits();
  }

  function handleDelete(outfit: OutfitWithItems) {
    Alert.alert(
      "Delete outfit",
      `Delete "${outfit.name ?? "this outfit"}"? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setBusyOutfitId(outfit.id);
            const { error: deleteError } = await deleteOutfit(outfit.id);
            setBusyOutfitId(null);
            if (deleteError) {
              Alert.alert("Error", deleteError);
              return;
            }
            setOutfits((prev) => prev.filter((o) => o.id !== outfit.id));
          },
        },
      ]
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Outfits</Text>
      </View>

      {error && (
        <View style={styles.errorRow}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={loadOutfits} hitSlop={8}>
            <Text style={styles.errorRetryText}>Retry</Text>
          </Pressable>
        </View>
      )}

      {loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator />
        </View>
      ) : outfits.length === 0 ? (
        <View style={styles.centerFill}>
          <Text style={styles.emptyTitle}>No saved outfits yet</Text>
          <Text style={styles.emptyText}>
            Layer some garments onto your avatar in the Try-On studio, then
            save the look to see it here.
          </Text>
          <Pressable
            style={styles.emptyCta}
            onPress={() => router.push("/(tabs)/tryon" as const)}
          >
            <Text style={styles.emptyCtaText}>Go to Try-On studio</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={outfits}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={styles.grid}
          renderItem={({ item }) => (
            <Pressable
              style={styles.card}
              onPress={() => handleOpenOutfit(item)}
              onLongPress={() => openRenameModal(item)}
              disabled={busyOutfitId === item.id}
            >
              <View style={styles.previewStack}>
                {item.items.length === 0 ? (
                  <View style={[styles.previewImage, styles.previewPlaceholder]} />
                ) : (
                  item.items.slice(0, PREVIEW_STACK_SIZE).map((outfitItem, index) => {
                    const url = thumbUrls[outfitItem.garment_id];
                    return (
                      <View
                        key={outfitItem.garment_id}
                        style={[
                          styles.previewImageWrap,
                          {
                            left: index * 14,
                            top: index * 10,
                            zIndex: index,
                          },
                        ]}
                      >
                        {url ? (
                          <Image
                            source={{ uri: url }}
                            style={styles.previewImage}
                            resizeMode="cover"
                          />
                        ) : (
                          <View style={[styles.previewImage, styles.previewPlaceholder]} />
                        )}
                      </View>
                    );
                  })
                )}
              </View>

              <Text style={styles.cardTitle} numberOfLines={1}>
                {item.name || "Untitled outfit"}
              </Text>
              <Text style={styles.cardSubtitle}>
                {new Date(item.created_at).toLocaleDateString()}
              </Text>

              <View style={styles.cardActionsRow}>
                <Pressable
                  style={styles.cardActionButton}
                  onPress={() => handleShare(item)}
                >
                  <Text style={styles.cardActionText}>Share</Text>
                </Pressable>
                <Pressable
                  style={styles.cardActionButton}
                  onPress={() => openRenameModal(item)}
                >
                  <Text style={styles.cardActionText}>Rename</Text>
                </Pressable>
                <Pressable
                  style={styles.cardActionButton}
                  onPress={() => handleDelete(item)}
                >
                  <Text style={[styles.cardActionText, styles.cardActionDanger]}>
                    Delete
                  </Text>
                </Pressable>
              </View>

              {(busyOutfitId === item.id || shareOutfit?.id === item.id) && (
                <View style={styles.cardBusyOverlay}>
                  <ActivityIndicator color={colors.accent} />
                </View>
              )}
            </Pressable>
          )}
        />
      )}

      <Modal
        visible={renameTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setRenameTarget(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Rename outfit</Text>
            <TextInput
              style={styles.modalInput}
              value={renameInput}
              onChangeText={setRenameInput}
              placeholder="Outfit name"
              autoFocus
            />
            <View style={styles.modalButtonsRow}>
              <Pressable
                style={styles.modalCancelButton}
                onPress={() => setRenameTarget(null)}
              >
                <Text style={styles.modalCancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.modalSaveButton}
                onPress={handleRenameConfirm}
                disabled={busyOutfitId === renameTarget?.id}
              >
                {busyOutfitId === renameTarget?.id ? (
                  <ActivityIndicator color={colors.onInk} />
                ) : (
                  <Text style={styles.modalSaveButtonText}>Save</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Off-screen ShareCard — mounted only once `customization` has
          loaded, moved well outside the viewport so it's laid out (for
          captureRef) without ever being visible. Reflects whichever outfit
          is currently queued via handleShare/`shareOutfit`; see this
          screen's top-level useEffect for the capture-after-paint timing. */}
      {customization && (
        <View style={styles.offscreenCapture} pointerEvents="none">
          <ShareCard
            cardRef={shareCardRef}
            customization={customization}
            equipped={shareOutfit ? buildEquippedFromOutfit(shareOutfit) : {}}
            outfitName={shareOutfit?.name ?? undefined}
            handle={profile?.display_name ?? undefined}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  offscreenCapture: {
    position: "absolute",
    top: -10000,
    left: 0,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 4,
  },
  title: {
    ...type.title,
  },
  grid: {
    paddingHorizontal: 12,
    paddingBottom: 24,
  },
  card: {
    flex: 1,
    margin: 6,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    padding: 10,
  },
  previewStack: {
    width: "100%",
    aspectRatio: 1,
    marginBottom: 8,
  },
  previewImageWrap: {
    position: "absolute",
    width: "70%",
    height: "70%",
  },
  previewImage: {
    width: "100%",
    height: "100%",
    borderRadius: 8,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.surface,
  },
  previewPlaceholder: {
    backgroundColor: colors.surfaceAlt,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.ink,
  },
  cardSubtitle: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  cardActionsRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
  },
  cardActionButton: {
    paddingVertical: 4,
  },
  cardActionText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.accent,
  },
  cardActionDanger: {
    color: colors.danger,
  },
  centerFill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontFamily: type.title.fontFamily,
    fontSize: 18,
    fontWeight: "700",
    color: colors.ink,
    marginBottom: 6,
    textAlign: "center",
  },
  emptyText: {
    textAlign: "center",
    color: colors.muted,
    fontSize: 15,
  },
  emptyCta: {
    marginTop: 20,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
  },
  emptyCtaText: {
    color: colors.onInk,
    fontWeight: "700",
    fontSize: 14,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  errorText: {
    color: colors.danger,
    flex: 1,
  },
  errorRetryText: {
    color: colors.accent,
    fontWeight: "700",
    fontSize: 13,
    marginLeft: 12,
  },
  cardBusyOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // rgba equivalent of colors.bg (#F5F2EA) at 0.7 opacity — React Native
    // style values can't reference theme hex through an opacity shorthand.
    backgroundColor: "rgba(245,242,234,0.7)",
    alignItems: "center",
    justifyContent: "center",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 20,
  },
  modalTitle: {
    fontFamily: type.title.fontFamily,
    fontSize: 18,
    fontWeight: "700",
    color: colors.ink,
    marginBottom: 12,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.ink,
  },
  modalButtonsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  modalCancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
  },
  modalCancelButtonText: {
    fontWeight: "600",
    color: colors.ink,
  },
  modalSaveButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
    alignItems: "center",
  },
  modalSaveButtonText: {
    fontWeight: "700",
    color: colors.onInk,
  },
});
