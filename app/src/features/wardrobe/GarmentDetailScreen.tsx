import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import {
  deleteGarment,
  getGarment,
  updateGarment,
} from "../../lib/api/garments";
import { useSignedImageUrl } from "../../lib/hooks/useSignedImageUrl";
import type { GarmentCategory, GarmentRow } from "../../lib/database.types";
import { CATEGORY_OPTIONS } from "./types";
import { colors, radius, type } from "../../lib/theme";

/** View / edit / delete a single garment. */
export function GarmentDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [garment, setGarment] = useState<GarmentRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [category, setCategory] = useState<GarmentCategory>("top");
  const [name, setName] = useState("");
  const [color, setColor] = useState("");
  const [brand, setBrand] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { url: imageUrl, loading: imageLoading } = useSignedImageUrl(
    garment?.image_path
  );

  const loadGarment = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);

    const { data, error: fetchError } = await getGarment(id);

    if (fetchError) {
      setError(fetchError);
    } else if (data) {
      setGarment(data);
      setCategory(data.category);
      setName(data.name ?? "");
      setColor(data.color ?? "");
      setBrand(data.brand ?? "");
      setTagsInput(data.tags.join(", "));
    }

    setLoading(false);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      loadGarment();
    }, [loadGarment])
  );

  async function handleSave() {
    if (!garment) return;

    setSaving(true);
    setError(null);

    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const { data, error: updateError } = await updateGarment(garment.id, {
      category,
      name: name.trim() || null,
      color: color.trim() || null,
      brand: brand.trim() || null,
      tags,
    });

    setSaving(false);

    if (updateError) {
      setError(updateError);
      return;
    }

    if (data) {
      setGarment(data);
      Alert.alert("Saved", "Garment updated.");
    }
  }

  function handleDelete() {
    if (!garment) return;

    Alert.alert(
      "Delete garment",
      "Are you sure you want to delete this garment? This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setDeleting(true);
            const { error: deleteError } = await deleteGarment(
              garment.id,
              garment.image_path
            );
            setDeleting(false);

            if (deleteError) {
              setError(deleteError);
              return;
            }

            router.back();
          },
        },
      ]
    );
  }

  if (loading) {
    return (
      <View style={styles.centerFill}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!garment) {
    return (
      <View style={styles.centerFill}>
        <Text style={styles.errorText}>{error ?? "Garment not found."}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {imageUrl ? (
        <Image source={{ uri: imageUrl }} style={styles.image} />
      ) : (
        <View style={[styles.image, styles.imagePlaceholder]}>
          {imageLoading && <ActivityIndicator />}
        </View>
      )}

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
        style={[styles.saveButton, saving && styles.buttonDisabled]}
        onPress={handleSave}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.saveButtonText}>Save Changes</Text>
        )}
      </Pressable>

      <Pressable
        style={[styles.deleteButton, deleting && styles.buttonDisabled]}
        onPress={handleDelete}
        disabled={deleting}
      >
        {deleting ? (
          <ActivityIndicator color="#c0392b" />
        ) : (
          <Text style={styles.deleteButtonText}>Delete Garment</Text>
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
  image: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 16,
  },
  imagePlaceholder: {
    alignItems: "center",
    justifyContent: "center",
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
  saveButtonText: {
    color: colors.onInk,
    fontSize: 16,
    fontWeight: "700",
  },
  deleteButton: {
    borderWidth: 1,
    borderColor: colors.danger,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: "center",
    marginTop: 12,
  },
  deleteButtonText: {
    color: colors.danger,
    fontSize: 16,
    fontWeight: "700",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  centerFill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
});
