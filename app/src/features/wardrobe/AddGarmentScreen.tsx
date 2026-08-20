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
import { colors, radius, spacing, type } from "../../lib/theme";
import { SelvPlusWaitlistSheet } from "../paywall/SelvPlusWaitlistSheet";
import { wardrobeLimitMessage } from "../../lib/pricing";

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
  const [waitlistVisible, setWaitlistVisible] = useState(false);

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
      // The wardrobe cap is normally enforced before the user ever reaches
      // this screen (see WardrobeGridScreen's "Add item" gate), but
      // createGarment() re-checks it right before insert as a defensive
      // guard (e.g. against deep-linking straight into add-garment once
      // already at the cap). Surface that specific case as the Selv+
      // waitlist sheet instead of a generic inline error — the same sheet
      // the grid opens, so the two walls read identically and differ only in
      // the `source` they record.
      if (createError === wardrobeLimitMessage()) {
        setWaitlistVisible(true);
        return;
      }
      setError(createError);
      return;
    }

    if (data) {
      router.back();
    }
  }

  return (
    <>
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
              <Text style={styles.secondaryButtonText}>
                Choose from Gallery
              </Text>
            </Pressable>
          </View>

          {/*
            LAUNCH_CHECKLIST.md §5 / MARKETING_STRATEGY.md §11: the data
            promise has to live on the upload screen itself, not behind a
            privacy-policy link, and has to be readable at the moment the
            photo is chosen. So it sits directly under the two picker
            buttons, always expanded — no "learn more" disclosure.

            Deliberately styled as a quiet note (surfaceAlt + muted text),
            not a warning: §11 asks for clear data controls, and a danger-
            coloured banner would read as a risk alert about an action we are
            actively inviting the user to take.

            Every clause is verified, not aspirational:
            - "never used to train AI models" — nothing in this app trains a
              model, and no third-party image processor is wired up. The
              remove.bg step described in legal/DATA_HANDLING.md §2c is not
              built; createGarment() uploads straight to our own bucket.
              Matches legal/PRIVACY_POLICY.md §7.
            - "stored privately / never sold" — the `garments` bucket is
              private with owner-only RLS; PRIVACY_POLICY.md lines 17 and 93.
            - "one tap and a confirm ... erased from storage" — deleteGarment()
              in lib/api/garments.ts removes the storage object *before* the
              row and aborts if that fails, and a user photo always carries an
              image_path. The confirm step is named rather than glossed as a
              bare "one tap", because GarmentDetailScreen does show an Alert —
              the same "one tap and one confirmation" wording the privacy
              policy uses for account deletion.
          */}
          <View style={styles.dataNote}>
            <Text style={styles.dataNoteTitle}>Your photos stay yours</Text>
            <Text style={styles.dataNoteBody}>
              Photos of your clothes are stored privately, never sold, and
              never used to train AI models. Delete an item whenever you like
              — one tap and a confirm, and its photo is erased from our
              storage too.
            </Text>
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
            <ActivityIndicator color={colors.onInk} />
          ) : (
            <Text style={styles.saveButtonText}>
              {error ? "Retry Save" : "Save Garment"}
            </Text>
          )}
        </Pressable>
      </ScrollView>

      {/* Dismissing returns to the wardrobe: the user is at the cap, so this
          form cannot succeed no matter what they do next, and leaving them
          on an unsaveable screen is the same dead end the old "Upgrade"
          button was. Matches the previous Alert, which called router.back()
          from both of its actions. */}
      <SelvPlusWaitlistSheet
        visible={waitlistVisible}
        source="add_garment"
        onClose={() => {
          setWaitlistVisible(false);
          router.back();
        }}
      />
    </>
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
  dataNote: {
    marginTop: spacing.sm,
    padding: spacing.sm + spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
  },
  dataNoteTitle: {
    fontFamily: type.body.fontFamily,
    fontWeight: "600",
    fontSize: 13,
    color: colors.ink,
    marginBottom: 2,
  },
  dataNoteBody: {
    fontFamily: type.body.fontFamily,
    fontSize: 12,
    lineHeight: 17,
    color: colors.muted,
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
