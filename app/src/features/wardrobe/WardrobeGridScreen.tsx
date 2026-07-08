import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      });

      if (fetchError) {
        setError(fetchError);
      } else {
        setGarments(data ?? []);
      }

      setLoading(false);
      setRefreshing(false);
    },
    [userId, selectedCategory]
  );

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

      {error && <Text style={styles.errorText}>{error}</Text>}

      {loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator />
        </View>
      ) : garments.length === 0 ? (
        <View style={styles.centerFill}>
          <Text style={styles.emptyText}>
            No garments yet. Tap + to add your first item.
          </Text>
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

  return (
    <Pressable style={styles.card} onPress={onPress}>
      {url ? (
        <Image source={{ uri: url }} style={styles.cardImage} resizeMode="cover" />
      ) : (
        <View style={[styles.cardImage, styles.cardImagePlaceholder]} />
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
  errorText: {
    color: colors.danger,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
});
