import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { listGarments } from "../../lib/api/garments";
import { useSignedImageUrl } from "../../lib/hooks/useSignedImageUrl";
import type { GarmentCategory, GarmentRow } from "../../lib/database.types";
import { useAuthStore } from "../../lib/stores/useAuthStore";
import { CATEGORY_OPTIONS } from "./types";
import { colors, radius, type } from "../../lib/theme";

export function WardrobeGridScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = useAuthStore((s) => s.session);
  const userId = session?.user.id;

  const [garments, setGarments] = useState<GarmentRow[]>([]);
  const [selectedCategory, setSelectedCategory] =
    useState<GarmentCategory | null>(null);
  const [tagFilter, setTagFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  const trimmedTagFilter = tagFilter.trim();

  const loadGarments = useCallback(
    async (isRefresh = false) => {
      if (!userId) return;
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const { data, error: fetchError } = await listGarments(userId, {
        category: selectedCategory ?? undefined,
        tag: trimmedTagFilter || undefined,
      });

      if (fetchError) {
        setError(fetchError);
      } else {
        setGarments(data ?? []);
      }

      setLoading(false);
      setRefreshing(false);
      setHasLoadedOnce(true);
    },
    [userId, selectedCategory, trimmedTagFilter]
  );

  const filtersActive = selectedCategory !== null || trimmedTagFilter.length > 0;

  const clearFilters = useCallback(() => {
    setSelectedCategory(null);
    setTagFilter("");
  }, []);

  // loadGarments' identity changes with selectedCategory, so this single
  // focus effect covers both screen focus and filter changes (a separate
  // useEffect on selectedCategory would double-fetch).
  useFocusEffect(
    useCallback(() => {
      loadGarments();
    }, [loadGarments])
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Wardrobe</Text>
        <Pressable
          style={styles.fab}
          onPress={() => router.push("/add-garment")}
          accessibilityLabel="Add garment"
        >
          <Text style={styles.fabText}>+</Text>
        </Pressable>
      </View>

      <FilterChips
        selected={selectedCategory}
        onSelect={setSelectedCategory}
      />

      <View style={styles.tagFilterRow}>
        <TextInput
          style={styles.tagFilterInput}
          value={tagFilter}
          onChangeText={setTagFilter}
          onSubmitEditing={() => loadGarments()}
          placeholder="Filter by tag…"
          placeholderTextColor={colors.faint}
          returnKeyType="search"
        />
        {filtersActive && (
          <Pressable
            style={styles.clearFiltersButton}
            onPress={clearFilters}
          >
            <Text style={styles.clearFiltersText}>Clear</Text>
          </Pressable>
        )}
      </View>

      {error && (
        <View style={styles.errorRow}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={() => loadGarments()}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}

      {loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator />
        </View>
      ) : garments.length === 0 ? (
        <View style={styles.centerFill}>
          {hasLoadedOnce && filtersActive ? (
            <>
              <Text style={styles.emptyText}>
                No garments match these filters.
              </Text>
              <Pressable style={styles.emptyCta} onPress={clearFilters}>
                <Text style={styles.emptyCtaText}>Clear filters</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.emptyText}>
                No garments yet. Add your first item to start building your
                wardrobe.
              </Text>
              <Pressable
                style={styles.emptyCta}
                onPress={() => router.push("/add-garment")}
              >
                <Text style={styles.emptyCtaText}>+ Add a garment</Text>
              </Pressable>
            </>
          )}
        </View>
      ) : (
        <FlatList
          data={garments}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={styles.grid}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadGarments(true)}
            />
          }
          renderItem={({ item }) => (
            <GarmentCard
              garment={item}
              onPress={() => router.push(`/garment/${item.id}`)}
            />
          )}
        />
      )}
    </View>
  );
}

function FilterChips({
  selected,
  onSelect,
}: {
  selected: GarmentCategory | null;
  onSelect: (value: GarmentCategory | null) => void;
}) {
  return (
    <View style={styles.chipsRow}>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={[{ label: "All", value: null }, ...CATEGORY_OPTIONS]}
        keyExtractor={(item) => item.value ?? "all"}
        contentContainerStyle={styles.chipsContainer}
        renderItem={({ item }) => {
          const isActive = item.value === selected;
          return (
            <Pressable
              style={[styles.chip, isActive && styles.chipActive]}
              onPress={() => onSelect(item.value)}
            >
              <Text
                style={[styles.chipText, isActive && styles.chipTextActive]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

function GarmentCard({
  garment,
  onPress,
}: {
  garment: GarmentRow;
  onPress: () => void;
}) {
  const { url } = useSignedImageUrl(garment.image_path);
  const [imageFailed, setImageFailed] = useState(false);

  const showImage = url && !imageFailed;

  return (
    <Pressable style={styles.card} onPress={onPress}>
      {showImage ? (
        <Image
          source={{ uri: url }}
          style={styles.cardImage}
          resizeMode="cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <View style={[styles.cardImage, styles.cardImagePlaceholder]}>
          {imageFailed && (
            <Text style={styles.cardImageErrorText}>Image unavailable</Text>
          )}
        </View>
      )}
      <Text style={styles.cardTitle} numberOfLines={1}>
        {garment.name || garment.category}
      </Text>
      {garment.color ? (
        <Text style={styles.cardSubtitle} numberOfLines={1}>
          {garment.color}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 4,
  },
  title: {
    ...type.title,
  },
  fab: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  fabText: {
    color: colors.onInk,
    fontSize: 24,
    lineHeight: 26,
  },
  chipsRow: {
    paddingVertical: 8,
  },
  tagFilterRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 4,
  },
  tagFilterInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.ink,
  },
  clearFiltersButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  clearFiltersText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.accent,
  },
  chipsContainer: {
    paddingHorizontal: 16,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    marginRight: 8,
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
    paddingBottom: 8,
  },
  cardImage: {
    width: "100%",
    aspectRatio: 1,
    backgroundColor: colors.surfaceAlt,
  },
  cardImagePlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  cardImageErrorText: {
    fontSize: 11,
    color: colors.faint,
    textAlign: "center",
    paddingHorizontal: 8,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.ink,
    marginTop: 6,
    marginHorizontal: 8,
  },
  cardSubtitle: {
    fontSize: 12,
    color: colors.muted,
    marginHorizontal: 8,
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
  emptyCta: {
    marginTop: 16,
    backgroundColor: colors.ink,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  emptyCtaText: {
    color: colors.onInk,
    fontSize: 15,
    fontWeight: "700",
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
    flexShrink: 1,
  },
  retryText: {
    color: colors.accent,
    fontWeight: "700",
    marginLeft: 12,
  },
});
