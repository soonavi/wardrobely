import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  getBrand,
  listWishlist,
  searchProducts,
  type BrandRow,
  type ProductWithBrand,
} from "../../lib/api/shop";
import { useAuthStore } from "../../lib/stores/useAuthStore";
import { colors, radius, spacing, type } from "../../lib/theme";
import { ProductCard } from "./ProductCard";
import { BrandLogo } from "./productImagery";

/** One page of a brand's catalog. Matches ShopScreen so paging feels identical. */
const PAGE_SIZE = 20;

/**
 * A single partner's storefront: their identity up top, their catalog below in
 * the same grid the Shop tab uses (same `ProductCard`, so a product looks the
 * same wherever it's found).
 */
export function BrandScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useAuthStore((s) => s.session);
  const userId = session?.user.id;

  const [brand, setBrand] = useState<BrandRow | null>(null);
  const [products, setProducts] = useState<ProductWithBrand[]>([]);
  const [wishlistIds, setWishlistIds] = useState<Set<string>>(new Set());
  /**
   * Bumped on every successful (re)load and used as the logo's `key`, which
   * remounts it and so clears any remembered load failure. Pull-to-refresh is
   * the one gesture that should retry a logo the CDN dropped on flaky wifi;
   * without this the failure would stick until the screen itself unmounted.
   */
  const [logoAttempt, setLogoAttempt] = useState(0);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const requestIdRef = useRef(0);
  const loadingMoreRef = useRef(false);

  const loadBrand = useCallback(
    async (isRefresh = false) => {
      if (!id) return;

      const requestId = ++requestIdRef.current;
      loadingMoreRef.current = false;

      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const [brandResult, productsResult] = await Promise.all([
        getBrand(id),
        searchProducts({ brandId: id, limit: PAGE_SIZE, offset: 0 }),
      ]);

      if (requestId !== requestIdRef.current) return;

      if (brandResult.error) {
        setError(brandResult.error);
        setBrand(null);
      } else if (brandResult.data) {
        setBrand(brandResult.data);
        setLogoAttempt((n) => n + 1);
      }

      if (productsResult.error) {
        // Only surface the catalog error when the brand itself loaded — a
        // missing brand already explains why there are no products.
        if (!brandResult.error) setError(productsResult.error);
        setProducts([]);
        setHasMore(false);
      } else {
        const rows = productsResult.data ?? [];
        setProducts(rows);
        setHasMore(rows.length === PAGE_SIZE);
      }

      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
      setHasLoadedOnce(true);
    },
    [id]
  );

  const loadMore = useCallback(async () => {
    if (!id) return;
    if (loadingMoreRef.current || loading || refreshing || !hasMore) return;
    if (products.length === 0) return;

    loadingMoreRef.current = true;
    const requestId = requestIdRef.current;
    setLoadingMore(true);

    const { data, error: fetchError } = await searchProducts({
      brandId: id,
      limit: PAGE_SIZE,
      offset: products.length,
    });

    loadingMoreRef.current = false;

    if (requestId !== requestIdRef.current) {
      setLoadingMore(false);
      return;
    }

    if (fetchError) {
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
  }, [id, hasMore, loading, refreshing, products.length]);

  const loadWishlistIds = useCallback(async () => {
    if (!userId) return;
    const { data } = await listWishlist(userId);
    if (data) setWishlistIds(new Set(data.map((product) => product.id)));
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

  useFocusEffect(
    useCallback(() => {
      loadBrand();
    }, [loadBrand])
  );

  useFocusEffect(
    useCallback(() => {
      loadWishlistIds();
    }, [loadWishlistIds])
  );

  const openWebsite = useCallback(async () => {
    if (!brand?.website_url) return;
    try {
      await Linking.openURL(brand.website_url);
    } catch {
      // A malformed website_url from a partner record shouldn't crash the
      // storefront; the catalog below is still perfectly usable.
    }
  }, [brand?.website_url]);

  if (!userId) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
        <Header onBack={() => router.back()} />
        <View style={styles.centerFill}>
          <Text style={styles.emptyText}>Sign in to browse this brand.</Text>
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
        <Header onBack={() => router.back()} />
        <View style={styles.centerFill}>
          <ActivityIndicator />
        </View>
      </View>
    );
  }

  if (!brand) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
        <Header onBack={() => router.back()} />
        <View style={styles.centerFill}>
          <Text style={styles.emptyTitle}>Brand unavailable</Text>
          <Text style={styles.emptyText}>
            {error ?? "This brand isn't in the shop right now."}
          </Text>
          <Pressable
            style={styles.emptyCta}
            onPress={() => loadBrand()}
            accessibilityRole="button"
            accessibilityLabel="Retry loading this brand"
          >
            <Text style={styles.emptyCtaText}>Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      <Header onBack={() => router.back()} />

      <FlatList
        data={products}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.grid}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadBrand(true)}
          />
        }
        ListHeaderComponent={
          <View style={styles.brandHeader}>
            <BrandLogo
              key={logoAttempt}
              name={brand.name}
              logoUrl={brand.logo_url}
              style={styles.logo}
              textStyle={styles.logoInitial}
            />

            <Text style={styles.brandName}>{brand.name}</Text>

            {brand.tagline ? (
              <Text style={styles.tagline}>{brand.tagline}</Text>
            ) : null}

            {brand.description ? (
              <Text style={styles.description}>{brand.description}</Text>
            ) : null}

            {brand.website_url ? (
              <Pressable
                onPress={openWebsite}
                hitSlop={8}
                accessibilityRole="link"
                accessibilityLabel={`Open ${brand.name}'s website in your browser`}
              >
                <Text style={styles.websiteLink}>Visit website ↗</Text>
              </Pressable>
            ) : null}

            {error && products.length > 0 ? (
              <Text style={styles.errorText}>{error}</Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          error ? (
            <View style={styles.centerBlock}>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable
                style={styles.emptyCta}
                onPress={() => loadBrand()}
                accessibilityRole="button"
                accessibilityLabel="Retry loading this brand's products"
              >
                <Text style={styles.emptyCtaText}>Retry</Text>
              </Pressable>
            </View>
          ) : hasLoadedOnce ? (
            <View style={styles.centerBlock}>
              <Text style={styles.emptyText}>
                {brand.name} hasn&apos;t listed any products yet.
              </Text>
            </View>
          ) : null
        }
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

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable
        onPress={onBack}
        style={styles.backButton}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Text style={styles.backButtonText}>← Back</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backButton: {
    paddingVertical: spacing.xs,
    paddingRight: spacing.sm,
  },
  backButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.accent,
  },
  brandHeader: {
    alignItems: "center",
    paddingBottom: spacing.lg,
  },
  logo: {
    width: 76,
    height: 76,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  logoInitial: {
    fontSize: 28,
  },
  brandName: {
    ...type.title,
    fontSize: 26,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  tagline: {
    ...type.subtle,
    marginTop: spacing.xs,
    textAlign: "center",
  },
  description: {
    ...type.body,
    color: colors.muted,
    lineHeight: 21,
    marginTop: spacing.md,
    textAlign: "center",
  },
  websiteLink: {
    ...type.label,
    color: colors.accent,
    marginTop: spacing.md,
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
  errorText: {
    color: colors.danger,
    textAlign: "center",
    marginTop: spacing.sm,
  },
});
