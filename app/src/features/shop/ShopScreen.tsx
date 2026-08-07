import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  listBrands,
  listWishlist,
  searchProducts,
  type BrandRow,
  type ProductWithBrand,
  type SearchProductsOptions,
} from "../../lib/api/shop";
import type { GarmentCategory } from "../../lib/database.types";
import { useAuthStore } from "../../lib/stores/useAuthStore";
import { CATEGORY_OPTIONS } from "../wardrobe/types";
import { colors, radius, spacing, type } from "../../lib/theme";
import { ProductCard } from "./ProductCard";
import { BrandLogo } from "./productImagery";

/**
 * The Shop tab — the browse surface for partner catalogs, and the top of the
 * revenue funnel (browse -> try on -> tracked click-out).
 *
 * Structure deliberately mirrors WardrobeGridScreen: a `useFocusEffect` over a
 * `useCallback` loader whose identity carries the active filters, so changing a
 * filter and re-focusing the screen both go through one code path instead of a
 * focus effect racing a second `useEffect`.
 */

/** One page of the grid. Small enough that the first screen paints fast, big enough that a flick doesn't page twice. */
const PAGE_SIZE = 20;

/** Debounce on the search box — long enough to skip most keystrokes, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 300;

type SortOption = NonNullable<SearchProductsOptions["sort"]>;

const SORT_OPTIONS: { label: string; value: SortOption }[] = [
  { label: "Newest", value: "newest" },
  { label: "Price ↑", value: "price_asc" },
  { label: "Price ↓", value: "price_desc" },
];

export function ShopScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = useAuthStore((s) => s.session);
  const userId = session?.user.id;

  const [products, setProducts] = useState<ProductWithBrand[]>([]);
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [wishlistIds, setWishlistIds] = useState<Set<string>>(new Set());

  const [searchInput, setSearchInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedCategory, setSelectedCategory] =
    useState<GarmentCategory | null>(null);
  const [sort, setSort] = useState<SortOption>("newest");
  const [onSaleOnly, setOnSaleOnly] = useState(false);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  /**
   * Bumped on every fresh (page-0) load. A page that comes back after its
   * request id has been superseded is dropped, so switching category mid-flight
   * can't append the previous category's second page underneath the new first.
   */
  const requestIdRef = useRef(0);
  /** Guards against `onEndReached` firing repeatedly while a page is already in flight. */
  const loadingMoreRef = useRef(false);

  // Debounce the search box. The early return keeps a settled query from
  // arming a pointless timer on every unrelated re-render.
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === debouncedQuery) return;
    const handle = setTimeout(() => setDebouncedQuery(trimmed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput, debouncedQuery]);

  const filtersActive =
    debouncedQuery.length > 0 || selectedCategory !== null || onSaleOnly;

  const clearFilters = useCallback(() => {
    setSearchInput("");
    setDebouncedQuery("");
    setSelectedCategory(null);
    setOnSaleOnly(false);
  }, []);

  const loadProducts = useCallback(
    async (isRefresh = false) => {
      if (!userId) return;

      const requestId = ++requestIdRef.current;
      loadingMoreRef.current = false;

      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const { data, error: fetchError } = await searchProducts({
        query: debouncedQuery || undefined,
        category: selectedCategory ?? undefined,
        onSaleOnly: onSaleOnly || undefined,
        sort,
        limit: PAGE_SIZE,
        offset: 0,
      });

      if (requestId !== requestIdRef.current) return;

      if (fetchError) {
        setError(fetchError);
        setProducts([]);
        setHasMore(false);
      } else {
        const rows = data ?? [];
        setProducts(rows);
        // A short page means the catalog is exhausted; only a full page can
        // possibly have more behind it.
        setHasMore(rows.length === PAGE_SIZE);
      }

      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
      setHasLoadedOnce(true);
    },
    [userId, debouncedQuery, selectedCategory, onSaleOnly, sort]
  );

  const loadMore = useCallback(async () => {
    if (!userId) return;
    if (loadingMoreRef.current || loading || refreshing || !hasMore) return;
    // Never page off an empty result set — `onEndReached` fires immediately for
    // a list shorter than the viewport, which would otherwise request page 2
    // of a catalog that has no page 1.
    if (products.length === 0) return;

    loadingMoreRef.current = true;
    const requestId = requestIdRef.current;
    setLoadingMore(true);

    const { data, error: fetchError } = await searchProducts({
      query: debouncedQuery || undefined,
      category: selectedCategory ?? undefined,
      onSaleOnly: onSaleOnly || undefined,
      sort,
      limit: PAGE_SIZE,
      offset: products.length,
    });

    loadingMoreRef.current = false;

    if (requestId !== requestIdRef.current) {
      setLoadingMore(false);
      return;
    }

    if (fetchError) {
      // Stop paging rather than retrying into the same failure on every scroll;
      // pull-to-refresh is the recovery path.
      setError(fetchError);
      setHasMore(false);
    } else {
      const rows = data ?? [];
      setProducts((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...rows.filter((row) => !seen.has(row.id))];
      });
      setHasMore(rows.length === PAGE_SIZE);
    }

    setLoadingMore(false);
  }, [
    userId,
    debouncedQuery,
    selectedCategory,
    onSaleOnly,
    sort,
    hasMore,
    loading,
    refreshing,
    products.length,
  ]);

  const loadBrandRail = useCallback(async () => {
    const { data } = await listBrands();
    if (data) setBrands(data);
    // A failed brand fetch just hides the rail — it's a shortcut, not the
    // content, and an error banner for it would sit above a working grid.
  }, []);

  const loadWishlistIds = useCallback(async () => {
    if (!userId) return;
    const { data } = await listWishlist(userId);
    if (data) setWishlistIds(new Set(data.map((product) => product.id)));
    // Also silent: a missed read only means a heart renders unfilled, and the
    // toggle's upsert makes that harmless.
  }, [userId]);

  const handleWishlistChange = useCallback(
    (productId: string, next: boolean) => {
      setWishlistIds((prev) => {
        const copy = new Set(prev);
        if (next) {
          copy.add(productId);
        } else {
          copy.delete(productId);
        }
        return copy;
      });
    },
    []
  );

  useEffect(() => {
    loadBrandRail();
  }, [loadBrandRail]);

  // `loadProducts`' identity carries the filters, so this one focus effect
  // covers both screen focus and every filter/sort change.
  useFocusEffect(
    useCallback(() => {
      loadProducts();
    }, [loadProducts])
  );

  useFocusEffect(
    useCallback(() => {
      loadWishlistIds();
    }, [loadWishlistIds])
  );

  if (!userId) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.centerFill}>
          <Text style={styles.emptyText}>Sign in to browse the shop.</Text>
        </View>
      </View>
    );
  }

  const renderEmpty = () => {
    if (loading) {
      return (
        <View style={styles.centerBlock}>
          <ActivityIndicator />
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.centerBlock}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            style={styles.emptyCta}
            onPress={() => loadProducts()}
            accessibilityRole="button"
            accessibilityLabel="Retry loading products"
          >
            <Text style={styles.emptyCtaText}>Retry</Text>
          </Pressable>
        </View>
      );
    }

    if (!hasLoadedOnce) return null;

    if (filtersActive) {
      return (
        <View style={styles.centerBlock}>
          <Text style={styles.emptyText}>
            Nothing matches those filters yet.
          </Text>
          <Pressable
            style={styles.emptyCta}
            onPress={clearFilters}
            accessibilityRole="button"
            accessibilityLabel="Clear all shop filters"
          >
            <Text style={styles.emptyCtaText}>Clear filters</Text>
          </Pressable>
        </View>
      );
    }

    // No filters and still nothing: the catalog itself is empty. Distinct copy
    // on purpose — this is what a fresh install against an unseeded database
    // shows, and "no results" would read as a broken search.
    return (
      <View style={styles.centerBlock}>
        <Text style={styles.emptyTitle}>The shop is still stocking up</Text>
        <Text style={styles.emptyText}>
          No partner brands are live yet. Check back soon — everything you find
          here will be tryable on your avatar before you buy.
        </Text>
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Shop</Text>
          <Text style={styles.subtitle}>Try before you buy</Text>
        </View>
        <Pressable
          style={styles.wishlistButton}
          onPress={() => router.push("/wishlist")}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`Open your wishlist, ${wishlistIds.size} saved`}
        >
          <Text style={styles.wishlistButtonText}>♥</Text>
        </Pressable>
      </View>

      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          value={searchInput}
          onChangeText={setSearchInput}
          placeholder="Search products or brands…"
          placeholderTextColor={colors.faint}
          returnKeyType="search"
          autoCorrect={false}
          accessibilityLabel="Search the shop"
        />
        {searchInput.length > 0 && (
          <Pressable
            style={styles.searchClearButton}
            onPress={() => setSearchInput("")}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <Text style={styles.searchClearText}>Clear</Text>
          </Pressable>
        )}
      </View>

      <CategoryChips selected={selectedCategory} onSelect={setSelectedCategory} />

      {error && products.length > 0 && (
        <View style={styles.errorRow}>
          <Text style={styles.errorText} numberOfLines={2}>
            {error}
          </Text>
          <Pressable
            onPress={() => loadProducts()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Retry loading products"
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}

      <FlatList
        // Blanking the data while a fresh page loads keeps the spinner in the
        // empty slot instead of leaving the previous filter's results on screen.
        data={loading && !refreshing ? [] : products}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.grid}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadProducts(true)}
          />
        }
        ListHeaderComponent={
          <View>
            <BrandRail
              brands={brands}
              onSelect={(brand) => router.push(`/brand/${brand.id}`)}
            />
            <SortRow
              sort={sort}
              onSort={setSort}
              onSaleOnly={onSaleOnly}
              onToggleSale={() => setOnSaleOnly((prev) => !prev)}
            />
          </View>
        }
        ListEmptyComponent={renderEmpty()}
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footer}>
              <ActivityIndicator />
            </View>
          ) : null
        }
        onEndReached={() => {
          void loadMore();
        }}
        onEndReachedThreshold={0.6}
        renderItem={({ item }) => (
          <ProductCard
            product={item}
            userId={userId}
            initialWishlisted={wishlistIds.has(item.id)}
            onWishlistChange={handleWishlistChange}
            onPress={() => router.push(`/product/${item.id}`)}
          />
        )}
      />
    </View>
  );
}

function CategoryChips({
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
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={`Filter by ${item.label}`}
            >
              <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                {item.label}
              </Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

function SortRow({
  sort,
  onSort,
  onSaleOnly,
  onToggleSale,
}: {
  sort: SortOption;
  onSort: (value: SortOption) => void;
  onSaleOnly: boolean;
  onToggleSale: () => void;
}) {
  return (
    <View style={styles.sortRow}>
      {SORT_OPTIONS.map((option) => {
        const isActive = option.value === sort;
        return (
          <Pressable
            key={option.value}
            style={[styles.sortChip, isActive && styles.sortChipActive]}
            onPress={() => onSort(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={`Sort by ${option.label}`}
          >
            <Text
              style={[styles.sortChipText, isActive && styles.sortChipTextActive]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
      <Pressable
        style={[styles.saleChip, onSaleOnly && styles.saleChipActive]}
        onPress={onToggleSale}
        accessibilityRole="button"
        accessibilityState={{ selected: onSaleOnly }}
        accessibilityLabel="Show only products on sale"
      >
        <Text
          style={[styles.saleChipText, onSaleOnly && styles.saleChipTextActive]}
        >
          On sale
        </Text>
      </Pressable>
    </View>
  );
}

function BrandRail({
  brands,
  onSelect,
}: {
  brands: BrandRow[];
  onSelect: (brand: BrandRow) => void;
}) {
  if (brands.length === 0) return null;

  return (
    <View style={styles.rail}>
      <Text style={styles.railLabel}>Brands</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.railContent}
      >
        {brands.map((brand) => (
          <BrandRailItem
            key={brand.id}
            brand={brand}
            onPress={() => onSelect(brand)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function BrandRailItem({
  brand,
  onPress,
}: {
  brand: BrandRow;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={styles.brandItem}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Browse ${brand.name}`}
    >
      {/*
        Shared with BrandScreen's storefront header, so a partner's logo — or
        the monogram standing in for one — is identical in both places. A rail
        of six is the surface where a missing logo is most obvious, since the
        gap sits between two that loaded.
      */}
      <BrandLogo
        name={brand.name}
        logoUrl={brand.logo_url}
        style={styles.brandLogo}
        textStyle={styles.brandInitial}
      />
      <Text style={styles.brandName} numberOfLines={1}>
        {brand.name}
      </Text>
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
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
  },
  title: {
    ...type.title,
  },
  subtitle: {
    ...type.subtle,
    marginTop: 2,
  },
  wishlistButton: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  wishlistButtonText: {
    fontSize: 19,
    lineHeight: 22,
    color: colors.accent,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: spacing.sm,
    fontSize: 14,
    color: colors.ink,
  },
  searchClearButton: {
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  searchClearText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.accent,
  },
  chipsRow: {
    paddingVertical: spacing.sm,
  },
  chipsContainer: {
    paddingHorizontal: spacing.md,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    marginRight: spacing.sm,
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
  rail: {
    paddingBottom: spacing.sm,
  },
  railLabel: {
    ...type.label,
    marginBottom: spacing.sm,
  },
  railContent: {
    gap: 14,
    paddingRight: spacing.md,
  },
  brandItem: {
    width: 64,
    alignItems: "center",
  },
  brandLogo: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  brandInitial: {
    fontSize: 20,
  },
  brandName: {
    fontSize: 11,
    color: colors.muted,
    marginTop: spacing.xs,
    textAlign: "center",
  },
  sortRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  sortChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  sortChipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  sortChipText: {
    fontSize: 13,
    color: colors.muted,
  },
  sortChipTextActive: {
    color: colors.accent,
    fontWeight: "600",
  },
  saleChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  saleChipActive: {
    backgroundColor: colors.acid,
    borderColor: colors.acidDeep,
  },
  saleChipText: {
    fontSize: 13,
    color: colors.muted,
  },
  saleChipTextActive: {
    color: colors.ink,
    fontWeight: "700",
  },
  grid: {
    flexGrow: 1,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
  },
  gridRow: {
    gap: 12,
    marginBottom: 12,
  },
  footer: {
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  centerFill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  centerBlock: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  emptyTitle: {
    fontFamily: type.title.fontFamily,
    fontSize: 20,
    color: colors.ink,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  emptyText: {
    textAlign: "center",
    color: colors.muted,
    fontSize: 15,
  },
  emptyCta: {
    marginTop: spacing.md,
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
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    gap: spacing.sm,
  },
  errorText: {
    color: colors.danger,
    flexShrink: 1,
    textAlign: "center",
  },
  retryText: {
    color: colors.accent,
    fontWeight: "700",
  },
});
