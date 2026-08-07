import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { listWishlist, type ProductWithBrand } from "../../lib/api/shop";
import { useAuthStore } from "../../lib/stores/useAuthStore";
import { colors, radius, spacing, type } from "../../lib/theme";
import { ProductCard } from "./ProductCard";

/**
 * Saved products, newest save first.
 *
 * Note that `listWishlist` inner-joins through to the brand, so a saved item
 * whose brand has been paused or whose product was delisted simply isn't in
 * the result. That's intentional in the data layer — the row survives, so it
 * reappears if the brand comes back — which means this screen can legitimately
 * show fewer items than the user remembers saving, without anything being
 * wrong.
 */
export function WishlistScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = useAuthStore((s) => s.session);
  const userId = session?.user.id;

  const [products, setProducts] = useState<ProductWithBrand[]>([]);
  /**
   * Optimistically-removed ids. Kept as a filter over `products` rather than
   * splicing the array, so a failed delete can put the card straight back —
   * the row itself was never thrown away.
   */
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  const loadWishlist = useCallback(
    async (isRefresh = false) => {
      if (!userId) return;

      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const { data, error: fetchError } = await listWishlist(userId);

      if (fetchError) {
        setError(fetchError);
        setProducts([]);
      } else {
        setProducts(data ?? []);
        setRemovedIds(new Set());
      }

      setLoading(false);
      setRefreshing(false);
      setHasLoadedOnce(true);
    },
    [userId]
  );

  useFocusEffect(
    useCallback(() => {
      loadWishlist();
    }, [loadWishlist])
  );

  const handleWishlistChange = useCallback(
    (productId: string, next: boolean) => {
      setRemovedIds((prev) => {
        const copy = new Set(prev);
        if (next) {
          copy.delete(productId);
        } else {
          copy.add(productId);
        }
        return copy;
      });
    },
    []
  );

  const visible = useMemo(
    () => products.filter((product) => !removedIds.has(product.id)),
    [products, removedIds]
  );

  if (!userId) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
        <Header onBack={() => router.back()} />
        <View style={styles.centerFill}>
          <Text style={styles.emptyText}>Sign in to see your wishlist.</Text>
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
            style={styles.cta}
            onPress={() => loadWishlist()}
            accessibilityRole="button"
            accessibilityLabel="Retry loading your wishlist"
          >
            <Text style={styles.ctaText}>Retry</Text>
          </Pressable>
        </View>
      );
    }

    if (!hasLoadedOnce) return null;

    return (
      <View style={styles.centerBlock}>
        <Text style={styles.emptyTitle}>Nothing saved yet</Text>
        <Text style={styles.emptyText}>
          Tap the heart on anything in the shop to keep it here for later.
        </Text>
        <Pressable
          style={styles.cta}
          onPress={() => router.push("/(tabs)/shop")}
          accessibilityRole="button"
          accessibilityLabel="Browse the shop"
        >
          <Text style={styles.ctaText}>Browse the shop</Text>
        </Pressable>
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      <Header onBack={() => router.back()} />

      <View style={styles.titleBlock}>
        <Text style={styles.title}>Wishlist</Text>
        {visible.length > 0 && (
          <Text style={styles.hint}>
            {visible.length} saved · tap a heart to remove
          </Text>
        )}
      </View>

      <FlatList
        data={loading && !refreshing ? [] : visible}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.grid}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadWishlist(true)}
          />
        }
        ListEmptyComponent={renderEmpty()}
        renderItem={({ item }) => (
          <ProductCard
            product={item}
            userId={userId}
            initialWishlisted={!removedIds.has(item.id)}
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
  titleBlock: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: {
    ...type.title,
  },
  hint: {
    ...type.subtle,
    marginTop: 2,
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
  errorText: {
    color: colors.danger,
    textAlign: "center",
  },
  cta: {
    marginTop: spacing.md,
    backgroundColor: colors.ink,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  ctaText: {
    color: colors.onInk,
    fontSize: 15,
    fontWeight: "700",
  },
});
