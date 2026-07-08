import React, { useCallback, useState } from "react";
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
import { useAuthStore } from "../../lib/stores/useAuthStore";
import { useTryOnStore } from "../../lib/stores/useTryOnStore";
import { getSignedGarmentImageUrls } from "../tryon/imageUrl";
import { colors, radius, type } from "../../lib/theme";

const PREVIEW_STACK_SIZE = 3;

export default function OutfitsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = useAuthStore((s) => s.session);
  const userId = session?.user.id;
  const loadFromOutfit = useTryOnStore((s) => s.loadFromOutfit);

  const [outfits, setOutfits] = useState<OutfitWithItems[]>([]);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [renameTarget, setRenameTarget] = useState<OutfitWithItems | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const [busyOutfitId, setBusyOutfitId] = useState<string | null>(null);

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

    const allPaths = rows.flatMap((o) =>
      o.items.slice(0, PREVIEW_STACK_SIZE).map((i) => i.garment.image_path)
    );
    const urls = await getSignedGarmentImageUrls(allPaths);
    setThumbUrls(urls);

    setLoading(false);
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      loadOutfits();
    }, [loadOutfits])
  );

  async function handleOpenOutfit(outfit: OutfitWithItems) {
    const { data, error: fetchError } = await getOutfit(outfit.id);
    if (fetchError || !data) {
      Alert.alert("Error", fetchError ?? "Could not load outfit.");
      return;
    }
    loadFromOutfit(data);
    router.push("/(tabs)/tryon" as const);
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

      {error && <Text style={styles.errorText}>{error}</Text>}

      {loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator />
        </View>
      ) : outfits.length === 0 ? (
        <View style={styles.centerFill}>
          <Text style={styles.emptyText}>
            No saved outfits yet. Build one in the Try-On studio.
          </Text>
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
                    const url = thumbUrls[outfitItem.garment.image_path];
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
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalSaveButtonText}>Save</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
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
  emptyText: {
    textAlign: "center",
    color: colors.muted,
    fontSize: 15,
  },
  errorText: {
    color: colors.danger,
    paddingHorizontal: 16,
    paddingVertical: 4,
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
