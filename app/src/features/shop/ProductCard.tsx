import React, { useCallback } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import type { ProductWithBrand } from "../../lib/api/shop";
import {
  discountPercent,
  effectivePriceCents,
  formatPrice,
  isOnSale,
} from "../../lib/commerce/commission";
import { colors, radius, spacing, type } from "../../lib/theme";
import { ProductImage } from "./productImagery";
import { useWishlist } from "./useWishlist";

export interface ProductCardProps {
  product: ProductWithBrand;
  onPress: () => void;
  /** Signed-in user. The heart is hidden when absent — there's nowhere to save to. */
  userId: string | undefined;
  /** Whether this product is already wishlisted, if the parent already knows (see useWishlist). */
  initialWishlisted?: boolean;
  /** Fired on optimistic change and on rollback, so a parent grid can track its own set. */
  onWishlistChange?: (productId: string, wishlisted: boolean) => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * One product in a 2-column grid. Shared by the Shop browse grid, a brand's
 * storefront and the wishlist, so all three stay pixel-identical.
 *
 * Images here are **public partner CDN urls**, not objects in our private
 * Supabase Storage bucket, so this must not go through `useSignedImageUrl` the
 * way wardrobe cards do — the signing round trip would fail on a url that isn't
 * a storage path. `ProductImage` renders the uri directly and owns the (very
 * routine) case of a partner url that 404s; see productImagery.tsx.
 */
export function ProductCard({
  product,
  onPress,
  userId,
  initialWishlisted,
  onWishlistChange,
  style,
}: ProductCardProps) {
  const handleWishlistChange = useCallback(
    (next: boolean) => {
      onWishlistChange?.(product.id, next);
    },
    [onWishlistChange, product.id]
  );

  const { wishlisted, pending, toggle } = useWishlist(userId, product.id, {
    initial: initialWishlisted,
    onChange: handleWishlistChange,
  });

  // Never read `price_cents` raw: partner feeds leave stale sale prices behind,
  // and effectivePriceCents/isOnSale are the only things that know that.
  const price = formatPrice(effectivePriceCents(product), product.currency);
  const onSale = isOnSale(product);
  const percentOff = discountPercent(product);

  return (
    <Pressable
      style={[styles.card, style]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${product.brand.name} ${product.name}, ${price}${
        product.in_stock ? "" : ", out of stock"
      }`}
    >
      <View style={styles.imageWrap}>
        <ProductImage
          uri={product.image_url}
          category={product.category}
          style={styles.image}
        />

        {percentOff !== null && (
          <View style={styles.saleBadge}>
            <Text style={styles.saleBadgeText}>{percentOff}% off</Text>
          </View>
        )}

        {!product.in_stock && (
          <View style={styles.stockOverlay}>
            <Text style={styles.stockOverlayText}>Out of stock</Text>
          </View>
        )}

        {userId ? (
          <Pressable
            style={styles.heartButton}
            onPress={toggle}
            disabled={pending}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityState={{ selected: wishlisted, disabled: pending }}
            accessibilityLabel={
              wishlisted
                ? `Remove ${product.name} from your wishlist`
                : `Save ${product.name} to your wishlist`
            }
          >
            <Text
              style={[styles.heartText, wishlisted && styles.heartTextActive]}
            >
              {wishlisted ? "♥" : "♡"}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <Text style={styles.brand} numberOfLines={1}>
        {product.brand.name}
      </Text>
      <Text style={styles.name} numberOfLines={2}>
        {product.name}
      </Text>

      <View style={styles.priceRow}>
        <Text style={[styles.price, onSale && styles.priceOnSale]}>{price}</Text>
        {onSale && (
          <Text style={styles.priceWas}>
            {formatPrice(product.price_cents, product.currency)}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    // Caps a lone trailing card at half the row instead of letting `flex: 1`
    // stretch it across the full width of an odd-numbered grid.
    maxWidth: "50%",
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    paddingBottom: spacing.sm,
  },
  imageWrap: {
    width: "100%",
    aspectRatio: 1,
  },
  image: {
    width: "100%",
    height: "100%",
    backgroundColor: colors.surfaceAlt,
  },
  saleBadge: {
    position: "absolute",
    top: spacing.sm,
    left: spacing.sm,
    backgroundColor: colors.acid,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  saleBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.ink,
  },
  stockOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceAlt,
    opacity: 0.82,
  },
  stockOverlayText: {
    ...type.label,
    color: colors.ink,
  },
  heartButton: {
    position: "absolute",
    top: spacing.xs,
    right: spacing.xs,
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  heartText: {
    fontSize: 17,
    lineHeight: 20,
    color: colors.muted,
  },
  heartTextActive: {
    color: colors.accent,
  },
  brand: {
    ...type.label,
    fontSize: 10,
    marginTop: spacing.sm,
    marginHorizontal: spacing.sm,
  },
  name: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.ink,
    marginTop: 2,
    marginHorizontal: spacing.sm,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
    marginTop: spacing.xs,
    marginHorizontal: spacing.sm,
  },
  price: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.ink,
  },
  priceOnSale: {
    color: colors.danger,
  },
  priceWas: {
    fontSize: 12,
    color: colors.faint,
    textDecorationLine: "line-through",
  },
});
