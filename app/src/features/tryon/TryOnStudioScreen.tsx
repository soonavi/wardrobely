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
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { listGarments } from "../../lib/api/garments";
import { createOutfit } from "../../lib/api/outfits";
import { useAuthStore } from "../../lib/stores/useAuthStore";
import { useTryOnStore } from "../../lib/stores/useTryOnStore";
import type { GarmentRow } from "../../lib/database.types";
import { AvatarSvg, ANCHOR_ZONES, buildWidthScale } from "../avatar/avatars";
import { getSignedGarmentImageUrl, getSignedGarmentImageUrls } from "./imageUrl";
import { GarmentLayer } from "./GarmentLayer";
import { colors, radius, type } from "../../lib/theme";

const AVATAR_WIDTH = 260;
const AVATAR_HEIGHT = 520;
const AVATAR_VIEWBOX = 600; // matches viewBox height in avatars.tsx

export default function TryOnStudioScreen() {
  const insets = useSafeAreaInsets();
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const userId = session?.user.id;

  const build = profile?.build ?? "average";
  const widthScale = buildWidthScale(profile?.height_cm, profile?.weight_kg);

  const layers = useTryOnStore((s) => s.layers);
  const selectedLayerId = useTryOnStore((s) => s.selectedLayerId);
  const outfitName = useTryOnStore((s) => s.outfitName);
  const addLayer = useTryOnStore((s) => s.addLayer);
  const updateLayer = useTryOnStore((s) => s.updateLayer);
  const removeLayer = useTryOnStore((s) => s.removeLayer);
  const bringToFront = useTryOnStore((s) => s.bringToFront);
  const selectLayer = useTryOnStore((s) => s.selectLayer);

  const [garments, setGarments] = useState<GarmentRow[]>([]);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [loadingGarments, setLoadingGarments] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveModalVisible, setSaveModalVisible] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const loadGarments = useCallback(async () => {
    if (!userId) return;
    setLoadingGarments(true);
    const { data, error: fetchError } = await listGarments(userId);
    if (fetchError) {
      setError(fetchError);
    } else {
      const rows = data ?? [];
      setGarments(rows);
      const urls = await getSignedGarmentImageUrls(rows.map((g) => g.image_path));
      setThumbUrls(urls);
    }
    setLoadingGarments(false);
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      loadGarments();
    }, [loadGarments])
  );

  // Resolve image URLs for layers loaded from a saved outfit (loadFromOutfit
  // sets imageUrl to "" since the store has no async access to storage).
  useEffect(() => {
    const missing = layers.filter((l) => !l.imageUrl);
    if (missing.length === 0) return;

    (async () => {
      for (const layer of missing) {
        const garment = garments.find((g) => g.id === layer.garmentId);
        if (!garment) continue;
        const url = await getSignedGarmentImageUrl(garment.image_path);
        if (url) {
          updateLayer(layer.id, { imageUrl: url });
        }
      }
    })();
  }, [layers, garments]);

  function handleAddGarment(garment: GarmentRow) {
    const url = thumbUrls[garment.image_path];
    if (!url) return;
    // outfit_items is keyed on (outfit_id, garment_id), so the same garment
    // can only appear once per outfit — block duplicate layers up front.
    if (layers.some((l) => l.garmentId === garment.id)) {
      Alert.alert(
        "Already added",
        "This garment is already on the avatar. Adjust or remove the existing layer."
      );
      return;
    }
    const anchor = ANCHOR_ZONES[garment.category];
    addLayer({
      garmentId: garment.id,
      imageUrl: url,
      x: anchor.x,
      y: anchor.y,
      scale: anchor.scale,
      rotation: 0,
    });
  }

  function openSaveModal() {
    if (layers.length === 0) {
      Alert.alert("Add a garment", "Add at least one item before saving.");
      return;
    }
    setNameInput(outfitName ?? "");
    setSaveModalVisible(true);
  }

  async function handleSaveOutfit() {
    if (!userId) return;
    const trimmedName = nameInput.trim();
    if (!trimmedName) {
      setError("Please enter a name for this outfit.");
      return;
    }

    setSaving(true);
    setError(null);

    const { data, error: createError } = await createOutfit(
      userId,
      trimmedName,
      layers.map((layer) => ({
        garment_id: layer.garmentId,
        layer_order: layer.layerOrder,
        x: layer.x,
        y: layer.y,
        scale: layer.scale,
        rotation: layer.rotation,
      }))
    );

    setSaving(false);

    if (createError) {
      setError(createError);
      return;
    }

    if (data) {
      setSaveModalVisible(false);
      Alert.alert("Saved", `"${trimmedName}" was saved to your outfits.`);
    }
  }

  const sortedLayers = [...layers].sort((a, b) => a.layerOrder - b.layerOrder);

  return (
    <GestureHandlerRootView style={styles.root}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.canvasArea}>
          <View style={styles.avatarWrap} pointerEvents="box-none">
            {/*
              Fixed-size stage matching the rendered avatar so layer x/y
              (avatar viewBox coords × CANVAS_SCALE) share the avatar's
              origin. Positioning layers against the whole canvas area
              while the avatar floats centered would misalign them.
            */}
            <View style={styles.stage} pointerEvents="box-none">
              <View style={StyleSheet.absoluteFill} pointerEvents="none">
                <AvatarSvg
                  build={build}
                  widthScale={widthScale}
                  width={AVATAR_WIDTH}
                  height={AVATAR_HEIGHT}
                />
              </View>

              {sortedLayers.map((layer) => (
                <GarmentLayer
                  key={layer.id}
                  layer={scaleLayerToCanvas(layer)}
                  isSelected={layer.id === selectedLayerId}
                  onSelect={() => selectLayer(layer.id)}
                  onChange={(updates) =>
                    updateLayer(layer.id, unscaleLayerFromCanvas(updates))
                  }
                  onRemove={() => removeLayer(layer.id)}
                  onBringToFront={() => bringToFront(layer.id)}
                />
              ))}
            </View>
          </View>

          <Pressable style={styles.saveButton} onPress={openSaveModal}>
            <Text style={styles.saveButtonText}>Save outfit</Text>
          </Pressable>
        </View>

        {error && <Text style={styles.errorText}>{error}</Text>}

        <View style={styles.drawer}>
          <Text style={styles.drawerTitle}>Your garments</Text>
          {loadingGarments ? (
            <ActivityIndicator style={styles.drawerLoading} />
          ) : garments.length === 0 ? (
            <Text style={styles.drawerEmpty}>
              No garments yet. Add some from the Wardrobe tab.
            </Text>
          ) : (
            <FlatList
              horizontal
              data={garments}
              keyExtractor={(item) => item.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.drawerList}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.drawerItem}
                  onPress={() => handleAddGarment(item)}
                >
                  {thumbUrls[item.image_path] ? (
                    <Image
                      source={{ uri: thumbUrls[item.image_path] }}
                      style={styles.drawerItemImage}
                      resizeMode="cover"
                    />
                  ) : (
                    <View
                      style={[styles.drawerItemImage, styles.drawerItemPlaceholder]}
                    />
                  )}
                  <Text style={styles.drawerItemLabel} numberOfLines={1}>
                    {item.name || item.category}
                  </Text>
                </Pressable>
              )}
            />
          )}
        </View>
      </View>

      <Modal
        visible={saveModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSaveModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Name this outfit</Text>
            <TextInput
              style={styles.modalInput}
              value={nameInput}
              onChangeText={setNameInput}
              placeholder="e.g. Friday dinner"
              autoFocus
            />
            {error && <Text style={styles.errorText}>{error}</Text>}
            <View style={styles.modalButtonsRow}>
              <Pressable
                style={styles.modalCancelButton}
                onPress={() => setSaveModalVisible(false)}
                disabled={saving}
              >
                <Text style={styles.modalCancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.modalSaveButton}
                onPress={handleSaveOutfit}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalSaveButtonText}>Save</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </GestureHandlerRootView>
  );
}

/**
 * Layer x/y/scale are stored in the same 300x600 coordinate space as the
 * avatar's SVG viewBox. Since the on-screen avatar is rendered at
 * AVATAR_WIDTH x AVATAR_HEIGHT, we scale store coordinates up to canvas
 * pixels for display, and back down when committing gesture changes.
 */
const CANVAS_SCALE = AVATAR_HEIGHT / AVATAR_VIEWBOX;

function scaleLayerToCanvas<T extends { x: number; y: number; scale: number }>(
  layer: T
): T {
  return {
    ...layer,
    x: layer.x * CANVAS_SCALE,
    y: layer.y * CANVAS_SCALE,
    scale: layer.scale,
  };
}

function unscaleLayerFromCanvas(updates: {
  x: number;
  y: number;
  scale: number;
  rotation: number;
}) {
  return {
    x: updates.x / CANVAS_SCALE,
    y: updates.y / CANVAS_SCALE,
    scale: updates.scale,
    rotation: updates.rotation,
  };
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  canvasArea: {
    flex: 0.75,
    backgroundColor: colors.bg,
  },
  avatarWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stage: {
    width: AVATAR_WIDTH,
    height: AVATAR_HEIGHT,
  },
  saveButton: {
    position: "absolute",
    right: 16,
    bottom: 16,
    backgroundColor: colors.accent,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: radius.pill,
  },
  saveButtonText: {
    color: colors.onInk,
    fontWeight: "700",
    fontSize: 14,
  },
  errorText: {
    color: colors.danger,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  drawer: {
    flex: 0.25,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingTop: 8,
  },
  drawerTitle: {
    ...type.label,
    marginHorizontal: 16,
    marginBottom: 6,
  },
  drawerLoading: {
    marginTop: 12,
  },
  drawerEmpty: {
    marginHorizontal: 16,
    color: colors.faint,
    fontSize: 13,
  },
  drawerList: {
    paddingHorizontal: 12,
    gap: 10,
  },
  drawerItem: {
    width: 76,
    marginRight: 10,
    alignItems: "center",
  },
  drawerItemImage: {
    width: 68,
    height: 68,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  drawerItemPlaceholder: {
    backgroundColor: colors.surfaceAlt,
  },
  drawerItemLabel: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 4,
    textAlign: "center",
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
