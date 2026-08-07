import React, { useCallback, useEffect, useState } from "react";
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
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { deleteGarment, getGarment, updateGarment } from "../../lib/api/garments";
import { getProduct, type ProductWithBrand } from "../../lib/api/shop";
import { createCheckoutLink } from "../../lib/api/affiliate";
import { effectivePriceCents, formatPrice } from "../../lib/commerce/commission";
import { useGarmentImageUrl } from "../../lib/garmentImage";
import { useAuthStore } from "../../lib/stores/useAuthStore";
import type { GarmentCategory, GarmentRow } from "../../lib/database.types";
import { CATEGORY_OPTIONS } from "./types";
import { colors, radius, spacing, type } from "../../lib/theme";

/** View / edit / delete a single garment. */
export function GarmentDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useAuthStore((s) => s.session);
  const userId = session?.user.id;

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
  const [imageFailed, setImageFailed] = useState(false);

  // Set for garments saved from the Shop; drives the Buy / View-in-shop
  // block below. Null while it loads, and stays null (with `productError`
  // shown in its place) if the partner delisted the item since it was saved.
  const [product, setProduct] = useState<ProductWithBrand | null>(null);
  const [productLoading, setProductLoading] = useState(false);
  const [productError, setProductError] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);

  const { url: imageUrl, loading: imageLoading } = useGarmentImageUrl(garment);

  const applyGarmentToForm = useCallback((data: GarmentRow) => {
    setCategory(data.category);
    setName(data.name ?? "");
    setColor(data.color ?? "");
    setBrand(data.brand ?? "");
    setTagsInput(data.tags.join(", "));
  }, []);

  const loadGarment = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);

    const { data, error: fetchError } = await getGarment(id);

    if (fetchError) {
      setError(fetchError);
    } else if (data) {
      setGarment(data);
      applyGarmentToForm(data);
      setImageFailed(false);
    }

    setLoading(false);
  }, [id, applyGarmentToForm]);

  useFocusEffect(
    useCallback(() => {
      loadGarment();
    }, [loadGarment])
  );

  const catalogProductId = garment?.product_id ?? null;

  useEffect(() => {
    if (!catalogProductId) {
      setProduct(null);
      setProductError(null);
      return;
    }

    let cancelled = false;
    setProductLoading(true);
    setProductError(null);

    getProduct(catalogProductId).then(({ data, error: fetchError }) => {
      if (cancelled) return;
      setProductLoading(false);
      if (fetchError || !data) {
        setProduct(null);
        setProductError(fetchError ?? "This item is no longer available.");
        return;
      }
      setProduct(data);
    });

    return () => {
      cancelled = true;
    };
  }, [catalogProductId]);

  /**
   * Same tracked-handoff contract as the try-on studio's Buy bar: if the
   * click can't be recorded we surface that instead of opening an untracked
   * link (see createCheckoutLink's doc comment). `source: "outfit"` because
   * this is a Buy from something already in the user's wardrobe/outfits,
   * which is a different funnel from browsing the Shop.
   */
  async function handleBuy(target: ProductWithBrand) {
    if (!userId || buying) return;
    setBuying(true);

    const { data, error: linkError } = await createCheckoutLink({
      userId,
      product: target,
      source: "outfit",
    });

    if (linkError || !data) {
      setBuying(false);
      Alert.alert(
        "Couldn't open this item",
        linkError ?? "Please check your connection and try again."
      );
      return;
    }

    try {
      await Linking.openURL(data.url);
    } catch {
      Alert.alert(
        "Couldn't open this item",
        "We couldn't open your browser. Please try again."
      );
    } finally {
      setBuying(false);
    }
  }

  function handleCancel() {
    if (!garment) return;
    applyGarmentToForm(garment);
    setError(null);
    router.back();
  }

  async function handleSave() {
    if (!garment || saving) return;

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
    if (!garment || deleting || saving) return;

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
            // `image_path` is null for catalog-sourced garments, whose
            // imagery lives on the partner's CDN; deleteGarment skips the
            // storage removal in that case.
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
      {imageUrl && !imageFailed ? (
        <Image
          source={{ uri: imageUrl }}
          style={styles.image}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <View style={[styles.image, styles.imagePlaceholder]}>
          {imageLoading ? (
            <ActivityIndicator />
          ) : imageFailed ? (
            <Text style={styles.imagePlaceholderText}>
              Image unavailable
            </Text>
          ) : null}
        </View>
      )}

      {/* Shop provenance — only for garments saved from the catalog. A
          user-photographed garment has nowhere to buy and no PDP to link. */}
      {catalogProductId && (
        <View style={styles.shopCard}>
          <Text style={styles.shopCardLabel}>From the Shop</Text>

          {productLoading ? (
            <ActivityIndicator style={styles.shopCardLoading} />
          ) : productError ? (
            <Text style={styles.shopCardUnavailable}>{productError}</Text>
          ) : product ? (
            <>
              <Pressable
                style={[styles.buyButton, buying && styles.buttonDisabled]}
                onPress={() => handleBuy(product)}
                disabled={buying || saving || deleting}
                accessibilityRole="button"
              >
                {buying ? (
                  <ActivityIndicator color={colors.ink} />
                ) : (
                  <Text style={styles.buyButtonText}>
                    {`Buy — ${formatPrice(
                      effectivePriceCents(product),
                      product.currency
                    )}`}
                  </Text>
                )}
              </Pressable>
              {/* FTC 16 CFR Part 255 — disclose the material connection
                  right next to the affiliate link, not elsewhere. */}
              <Text style={styles.shopCardDisclosure}>
                Selv earns a commission
              </Text>
            </>
          ) : null}

          <Pressable
            style={styles.viewInShopButton}
            onPress={() => router.push(`/product/${catalogProductId}`)}
            accessibilityRole="button"
          >
            <Text style={styles.viewInShopButtonText}>View in shop →</Text>
          </Pressable>
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
              disabled={saving || deleting}
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
        editable={!saving && !deleting}
      />

      <Text style={styles.label}>Color</Text>
      <TextInput
        style={styles.input}
        value={color}
        onChangeText={setColor}
        placeholder="e.g. Navy"
        editable={!saving && !deleting}
      />

      <Text style={styles.label}>Brand</Text>
      <TextInput
        style={styles.input}
        value={brand}
        onChangeText={setBrand}
        placeholder="e.g. Levi's"
        editable={!saving && !deleting}
      />

      <Text style={styles.label}>Tags (comma separated)</Text>
      <TextInput
        style={styles.input}
        value={tagsInput}
        onChangeText={setTagsInput}
        placeholder="e.g. summer, casual, denim"
        editable={!saving && !deleting}
      />

      {error && <Text style={styles.errorText}>{error}</Text>}

      <Pressable
        style={[styles.saveButton, saving && styles.buttonDisabled]}
        onPress={handleSave}
        disabled={saving || deleting}
      >
        {saving ? (
          <ActivityIndicator color={colors.onInk} />
        ) : (
          <Text style={styles.saveButtonText}>Save Changes</Text>
        )}
      </Pressable>

      <Pressable
        style={[styles.cancelButton, (saving || deleting) && styles.buttonDisabled]}
        onPress={handleCancel}
        disabled={saving || deleting}
      >
        <Text style={styles.cancelButtonText}>Cancel</Text>
      </Pressable>

      <Pressable
        style={[styles.deleteButton, deleting && styles.buttonDisabled]}
        onPress={handleDelete}
        disabled={deleting || saving}
      >
        {deleting ? (
          <ActivityIndicator color={colors.danger} />
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
  imagePlaceholderText: {
    color: colors.faint,
    fontSize: 13,
  },
  label: {
    ...type.label,
    marginTop: 12,
    marginBottom: 6,
  },
  shopCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  shopCardLabel: {
    ...type.label,
    marginBottom: spacing.sm,
  },
  shopCardLoading: {
    marginVertical: spacing.sm,
  },
  shopCardUnavailable: {
    fontSize: 13,
    color: colors.muted,
    marginBottom: spacing.sm,
  },
  buyButton: {
    backgroundColor: colors.acid,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: "center",
  },
  buyButtonText: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "700",
  },
  shopCardDisclosure: {
    fontSize: 11,
    color: colors.muted,
    textAlign: "center",
    marginTop: 6,
  },
  viewInShopButton: {
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 4,
  },
  viewInShopButtonText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: "700",
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
  cancelButton: {
    paddingVertical: 12,
    borderRadius: radius.md,
    alignItems: "center",
    marginTop: 10,
  },
  cancelButtonText: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: "600",
  },
  deleteButton: {
    borderWidth: 1,
    borderColor: colors.danger,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: "center",
    marginTop: 20,
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
