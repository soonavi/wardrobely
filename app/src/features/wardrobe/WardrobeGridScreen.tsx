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
import { countGarments, listGarments } from "../../lib/api/garments";
import { useGarmentImageUrl } from "../../lib/garmentImage";
import type { GarmentCategory, GarmentRow } from "../../lib/database.types";
import { useAuthStore } from "../../lib/stores/useAuthStore";
import { CATEGORY_OPTIONS } from "./types";
import { colors, radius, type } from "../../lib/theme";
import { SelvPlusWaitlistSheet } from "../paywall/SelvPlusWaitlistSheet";
import {
  canAddGarment,
  FREE_WARDROBE_LIMIT,
  getCurrentPlan,
  remainingFreeSlots,
} from "../../lib/pricing";

export function WardrobeGridScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = useAuthStore((s) => s.session);
  const userId = session?.user.id;

  const [garments, setGarments] = useState<GarmentRow[]>([]);
  /**
   * Size of the WHOLE wardrobe, independent of the active filters.
   *
   * `garments` holds only what the current category/tag filter matched, so it
   * cannot speak for the cap: filtering to a category with three items would
   * otherwise read as "3/25" to a user who owns twenty-five, and wave them
   * into an add-garment flow that `createGarment` then rejects at save time.
   * Null until the first count lands — see the cap logic below for why that
   * distinction matters.
   */
  const [totalGarments, setTotalGarments] = useState<number | null>(null);
  const [selectedCategory, setSelectedCategory] =
    useState<GarmentCategory | null>(null);
  const [tagFilter, setTagFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [waitlistVisible, setWaitlistVisible] = useState(false);

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

      // Fired together: the filtered page the grid renders, and the unfiltered
      // total the cap is judged against. Concurrent rather than sequential
      // because neither depends on the other and the count is a head request
      // with no rows to fetch.
      const [
        { data, error: fetchError },
        { data: total, error: countError },
      ] = await Promise.all([
        listGarments(userId, {
          category: selectedCategory ?? undefined,
          tag: trimmedTagFilter || undefined,
        }),
        countGarments(userId),
      ]);

      if (fetchError) {
        setError(fetchError);
      } else {
        setGarments(data ?? []);
      }

      // A failed count is not surfaced as a screen error — the grid itself
      // loaded fine and blocking it would be a worse outcome than a missing
      // counter. Leaving `totalGarments` null makes the cap fail *open*: the
      // header hides the count rather than showing a wrong one, and the add
      // button stays live so a user under the cap isn't locked out by a
      // transient network blip. `createGarment` re-checks server-side anyway,
      // so a user genuinely at the limit is still refused — just at save time
      // rather than at the button.
      if (!countError) {
        setTotalGarments(total);
      } else {
        // Cleared, not left at the previous value. A retained count is worse
        // than no count in the direction that matters: a stale total sitting
        // at the cap produces a *false block* — the waitlist sheet shown to
        // someone who has since deleted items and genuinely has room — and no
        // later check can undo a button the user was never allowed to press.
        // An unknown total fails the other way, and createGarment still
        // refuses anyone actually at the limit.
        setTotalGarments(null);
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

  // Free-tier wardrobe cap (see src/lib/pricing.ts). `plan` is a stub that
  // always returns "free" because there is no entitlement to read — Selv+ is
  // not for sale in v1 — so the cap is active for every user today.
  const plan = getCurrentPlan();
  // `totalGarments`, never `garments.length` — see the state declaration.
  // While the count is still null the cap is unknown, so `remainingSlots`
  // stays null and the header simply omits the counter.
  const remainingSlots =
    totalGarments === null ? null : remainingFreeSlots(totalGarments, plan);

  const handleAddPress = useCallback(() => {
    // An unknown total fails open (see loadGarments). canAddGarment(0, …) is
    // always true, which is the deliberate choice: `createGarment` enforces
    // the cap against the live server count regardless.
    if (!canAddGarment(totalGarments ?? 0, plan)) {
      // Opens the waitlist sheet, not a purchase flow: there isn't one, and
      // this used to be an Alert whose "Upgrade" button was wired to a TODO.
      // A Modal rather than an Alert because the honest version needs an
      // email input and four states, none of which an Alert can hold.
      setWaitlistVisible(true);
      return;
    }
    router.push("/add-garment");
  }, [totalGarments, plan, router]);

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
        <View>
          <Text style={styles.title}>Wardrobe</Text>
          {remainingSlots !== null && (
            <Text style={styles.itemCount}>
              {totalGarments}/{FREE_WARDROBE_LIMIT} items
            </Text>
          )}
        </View>
        <Pressable
          style={styles.fab}
          onPress={handleAddPress}
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
              <Pressable style={styles.emptyCta} onPress={handleAddPress}>
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

      <SelvPlusWaitlistSheet
        visible={waitlistVisible}
        source="wardrobe_grid"
        onClose={() => setWaitlistVisible(false)}
      />
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
  const { url } = useGarmentImageUrl(garment);
  const [imageFailed, setImageFailed] = useState(false);

  const showImage = url && !imageFailed;
  const fromShop = garment.source === "catalog";

  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View>
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
        {/* Tells an item the user owns apart from one they saved off the
            Shop but haven't bought — the two look identical otherwise, and
            only the second one has somewhere to buy it. */}
        {fromShop && (
          <View style={styles.shopBadge}>
            <Text style={styles.shopBadgeText}>Shop</Text>
          </View>
        )}
      </View>
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
  itemCount: {
    ...type.subtle,
    marginTop: 2,
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
  shopBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    backgroundColor: colors.acid,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  shopBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.ink,
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
