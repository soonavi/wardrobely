import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { createGarment } from "../../lib/api/garments";
import type { GarmentCategory } from "../../lib/database.types";
import { useAuthStore } from "../../lib/stores/useAuthStore";
import { CATEGORY_OPTIONS } from "./types";
import { colors, radius, type } from "../../lib/theme";

export function AddGarmentScreen() {
  const router = useRouter();
  const session = useAuthStore((s) => s.session);
  const userId = session?.user.id;

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [category, setCategory] = useState<GarmentCategory>("top");
  const [name, setName] = useState("");
  const [color, setColor] = useState("");
  const [brand, setBrand] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handlePermissionDenied(
    canAskAgain: boolean,
    subject: "camera" | "photo library"
  ) {
    if (canAskAgain) {
      Alert.alert(
        "Permission needed",
        `Allow ${subject} access to add a garment photo.`
      );
      return;
    }
    Alert.alert(
      "Permission needed",
      `${
        subject === "camera" ? "Camera" : "Photo library"
      } access is disabled. Enable it in Settings to add a garment photo.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Open Settings", onPress: () => Linking.openSettings() },
      ]
    );
  }

  async function pickFromLibrary() {
    if (saving) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      handlePermissionDenied(permission.canAskAgain, "photo library");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      // SDK 54: MediaTypeOptions is deprecated in favor of string values.
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets.length > 0) {
      setImageUri(result.assets[0].uri);
      setImageFailed(false);
    }
  }

  async function takePhoto() {
    if (saving) return;
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      handlePermissionDenied(permission.canAskAgain, "camera");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets.length > 0) {
      setImageUri(result.assets[0].uri);
      setImageFailed(false);
    }
  }

  async function handleSave() {
    if (saving) return;
    if (!userId) return;
    if (!imageUri) {
      setError("Please add a photo first.");
      return;
    }
    if (!category) {
      setError("Please choose a category.");
      return;
    }

    setSaving(true);
    setError(null);

    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const { data, error: createError } = await createGarment({
      userId,
      imageUri,
      category,
      name: name.trim() || undefined,
      color: color.trim() || undefined,
      brand: brand.trim() || undefined,
      tags,
    });

    setSaving(false);

    if (createError) {
      setError(createError);
      return;
    }

    if (data) {
      router.back();
    }
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Add Garment</Text>

      <View style={styles.imageSection}>
        {imageUri && !imageFailed ? (
          <Image
            source={{ uri: imageUri }}
            style={styles.preview}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <View style={[styles.preview, styles.previewPlaceholder]}>
            <Text style={styles.placeholderText}>
              {imageFailed
                ? "Couldn't load that image. Please pick another."
                : "No image selected"}
            </Text>
          </View>
        )}

        <View style={styles.imageButtonsRow}>
          <Pressable
            style={[styles.secondaryButton, saving && styles.buttonDisabled]}
            onPress={takePhoto}
            disabled={saving}
          >
            <Text style={styles.secondaryButtonText}>Take Photo</Text>
          </Pressable>
          <Pressable
            style={[styles.secondaryButton, saving && styles.buttonDisabled]}
            onPress={pickFromLibrary}
            disabled={saving}
          >
            <Text style={styles.secondaryButtonText}>Choose from Gallery</Text>
          </Pressable>
        </View>
      </View>

      <Text style={styles.label}>Category</Text>
      <View style={styles.categoryRow}>
        {CATEGORY_OPTIONS.map((option) => {
          const isActive = option.value === category;
          return (
            <Pressable
              key={option.value}
              style={[styles.chip, isActive && styles.chipActive]}
              onPress={() => setCategory(option.value)}
            >
              <Text
                style={[styles.chipText, isActive && styles.chipTextActive]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.label}>Name</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="e.g. Blue denim jacket"
      />

      <Text style={styles.label}>Color</Text>
      <TextInput
        style={styles.input}
        value={color}
        onChangeText={setColor}
        placeholder="e.g. Navy"
      />

      <Text style={styles.label}>Brand</Text>
      <TextInput
        style={styles.input}
        value={brand}
        onChangeText={setBrand}
        placeholder="e.g. Levi's"
      />

      <Text style={styles.label}>Tags (comma separated)</Text>
      <TextInput
        style={styles.input}
        value={tagsInput}
        onChangeText={setTagsInput}
        placeholder="e.g. summer, casual, denim"
      />

      {error && <Text style={styles.errorText}>{error}</Text>}

      <Pressable
        style={[styles.saveButton, saving && styles.saveButtonDisabled]}
        onPress={handleSave}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.saveButtonText}>
            {error ? "Retry Save" : "Save Garment"}
          </Text>
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
    padding: 16,
    paddingBottom: 48,
  },
  title: {
    ...type.title,
    fontSize: 24,
    marginBottom: 16,
  },
  imageSection: {
    marginBottom: 16,
  },
  preview: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  previewPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderText: {
    color: colors.faint,
  },
  imageButtonsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    paddingVertical: 10,
    borderRadius: radius.sm,
    alignItems: "center",
  },
  secondaryButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.ink,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  label: {
    ...type.label,
    marginTop: 12,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.ink,
  },
  categoryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
  },
  chipActive: {
    backgroundColor: colors.ink,
  },
  chipText: {
    fontSize: 14,
    color: colors.muted,
  },
  chipTextActive: {
    color: colors.onInk,
  },
  errorText: {
    color: colors.danger,
    marginTop: 12,
  },
  saveButton: {
    backgroundColor: colors.ink,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: "center",
    marginTop: 24,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: colors.onInk,
    fontSize: 16,
    fontWeight: "700",
  },
});
