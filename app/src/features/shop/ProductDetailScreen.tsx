import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  getProduct,
  saveProductToWardrobe,
  type ProductWithBrand,
} from "../../lib/api/shop";
import { createCheckoutLink } from "../../lib/api/affiliate";
import type { WaitlistSource } from "../../lib/api/waitlist";
import {
  discountPercent,
  effectivePriceCents,
  formatPrice,
  isOnSale,
} from "../../lib/commerce/commission";
import { wardrobeLimitMessage } from "../../lib/pricing";
import { useAuthStore } from "../../lib/stores/useAuthStore";
import { colors, radius, spacing, type } from "../../lib/theme";
import { SelvPlusWaitlistSheet } from "../paywall/SelvPlusWaitlistSheet";
import { ProductImage } from "./productImagery";
import { useWishlist } from "./useWishlist";

/**
 * Product detail — where browsing turns into either a try-on or a tracked
 * click-out. Three actions, in deliberate priority order:
 *
 *   1. **Try it on** — the reason Selv exists, and the step that makes the
 *      other two convert. Styled in `colors.acid` so it reads as the primary
 *      action even though "Buy" is the one that earns money.
 *   2. **Save to wardrobe** — copies the product into the user's wardrobe so
 *      it can be styled into outfits.
 *   3. **Buy at <brand>** — mints an affiliate click and hands off to the
 *      partner's site.
 */

/**
 * Which wall a waitlist signup from this screen is attributed to.
 *
 * Reusing `add_garment` here would have typechecked and needed no comment, and
 * that is exactly why it was rejected: `source` is the entire analytic point of
 * the table (004_waitlist.sql), and a row that claims the user ran out of room
 * while uploading a photo — when they were actually saving something they found
 * in the Shop — is a lie in the only report this feature exists to produce.
 *
 * `shop_save` reaches live databases via
 * supabase/migrations/005_waitlist_shop_source.sql and is inlined in
 * supabase/schema.sql for fresh projects. Because database.types.ts mirrors
 * that SQL by hand, the three must move together: widening the union without
 * the migration turns a compile-time guarantee into a runtime insert failure.
 */
const WAITLIST_SOURCE: WaitlistSource = "shop_save";

export function ProductDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useAuthStore((s) => s.session);
  const userId = session?.user.id;

  const [product, setProduct] = useState<ProductWithBrand | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [buying, setBuying] = useState(false);
  const [waitlistVisible, setWaitlistVisible] = useState(false);

  const {
    wishlisted,
    pending: wishlistPending,
    toggle: toggleWishlist,
  } = useWishlist(userId, product?.id);

  const loadProduct = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);

    const { data, error: fetchError } = await getProduct(id);

    if (fetchError) {
      setError(fetchError);
      setProduct(null);
    } else if (data) {
      setProduct(data);
      setSelectedImageIndex(0);
      setFailedImages(new Set());
    }

    setLoading(false);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      loadProduct();
    }, [loadProduct])
  );

  // Reset the size only when the product itself changes — refocusing after a
  // try-on or a trip to the brand's site should not silently clear a choice
  // the user already made.
  useEffect(() => {
    setSelectedSize(null);
  }, [id]);

  /** Hero + thumbnails. Deduped because feeds often repeat the primary shot in `extra_image_urls`. */
  const images = useMemo(() => {
    if (!product) return [];
    const all = [product.image_url, ...product.extra_image_urls];
    return Array.from(
      new Set(all.filter((url) => typeof url === "string" && url.length > 0))
    );
  }, [product]);

  const heroUri = images[selectedImageIndex] ?? images[0];

  /**
   * Failure is tracked per-url at screen level, not inside each `<ProductImage>`,
   * because the hero and its thumbnail render the *same* url. Sharing the set
   * means one 404 is discovered once: tapping a dead thumbnail goes straight to
   * the placeholder instead of flashing a broken hero on the way there.
   *
   * `loadProduct` clears it, so pull-to-reload is a genuine retry rather than a
   * re-render of remembered failures.
   */
  const markImageFailed = useCallback((uri: string) => {
    setFailedImages((prev) => {
      if (prev.has(uri)) return prev;
      const copy = new Set(prev);
      copy.add(uri);
      return copy;
    });
  }, []);

  const handleTryOn = useCallback(() => {
    if (!product) return;
    // The entire contract with the try-on screen: push the route with a
    // `productId` param. The try-on feature owns everything after this line.
    router.push({
      pathname: "/(tabs)/tryon",
      params: { productId: product.id },
    });
  }, [product, router]);

  const handleSaveToWardrobe = useCallback(async () => {
    if (!product || !userId || saving) return;

    setSaving(true);
    const { data, error: saveError } = await saveProductToWardrobe(
      userId,
      product
    );
    setSaving(false);

    if (saveError) {
      // The Shop is the *third* place the 25-item free cap can be hit, and
      // until now the only one that dead-ended: `saveProductToWardrobe`
      // re-checks the cap before inserting (a cap enforced only at the
      // wardrobe's own entry points isn't enforced at all) and returns the
      // shared `wardrobeLimitMessage()` copy, which since the waitlist landed
      // tells the user they can join a list. Shown in a bare Alert that was an
      // invitation with nothing to tap.
      //
      // Detected by identity against `wardrobeLimitMessage()` rather than by
      // matching on the text, which is the same test AddGarmentScreen makes
      // against `createGarment` — and, per the comment on that function in
      // lib/pricing.ts, the signal the shared copy exists to provide. There is
      // no structured one to prefer: `saveProductToWardrobe` returns
      // `ApiResult<GarmentRow>`, whose `error` is a bare `string | null` that
      // carries Postgres messages the rest of the time, so the cap has no code
      // or discriminant to key off. Adding one means changing lib/api/shop.ts
      // and `ApiResult` — and every call site of both — which is a larger
      // change than this dead end warrants; comparing against the one exported
      // function that produces the string is exact, and moving the copy can
      // only break both call sites together rather than silently one of them.
      if (saveError === wardrobeLimitMessage()) {
        setWaitlistVisible(true);
        return;
      }

      Alert.alert("Couldn't save to wardrobe", saveError);
      return;
    }

    if (data) {
      Alert.alert(
        "Saved to your wardrobe",
        `${product.name} is in your wardrobe — style it into an outfit any time.`
      );
    }
  }, [product, userId, saving]);

  const handleBuy = useCallback(async () => {
    if (!product || !userId || buying) return;

    if (product.sizes.length > 0 && !selectedSize) {
      Alert.alert(
        "Pick a size first",
        "Choose a size so we send you to the right product page."
      );
      return;
    }

    setBuying(true);
    const { data, error: linkError } = await createCheckoutLink({
      userId,
      product,
      source: "shop",
    });
    setBuying(false);

    if (linkError || !data) {
      // createCheckoutLink deliberately returns no URL when the click can't be
      // recorded — an untracked click-out looks identical to a successful one
      // and silently loses the commission, so failing visibly is correct.
      Alert.alert(
        "Couldn't open the store",
        linkError ?? "We couldn't create a checkout link. Please try again."
      );
      return;
    }

    try {
      // The *system* browser, via react-native's Linking — not expo-web-browser.
      // Two reasons: it avoids adding a dependency, and an affiliate network's
      // tracking cookie set in the system browser persists into the same
      // browser the user checks out in later. An in-app web view sandboxes that
      // cookie and can drop the attribution the click was minted for.
      await Linking.openURL(data.url);
    } catch {
      Alert.alert(
        "Couldn't open the store",
        "We couldn't open your browser. Please try again."
      );
    }
  }, [product, userId, buying, selectedSize]);

  if (!userId) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
        <ScreenHeader onBack={() => router.back()} />
        <View style={styles.centerFill}>
          <Text style={styles.emptyText}>Sign in to view this product.</Text>
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
        <ScreenHeader onBack={() => router.back()} />
        <ProductDetailSkeleton />
      </View>
    );
  }

  if (!product) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
        <ScreenHeader onBack={() => router.back()} />
        <View style={styles.centerFill}>
          <Text style={styles.emptyTitle}>This product isn&apos;t available</Text>
          <Text style={styles.emptyText}>
            {error ??
              "It may have sold out or been delisted by the brand. Try something else in the shop."}
          </Text>
          <Pressable
            style={styles.emptyCta}
            onPress={() => loadProduct()}
            accessibilityRole="button"
            accessibilityLabel="Retry loading this product"
          >
            <Text style={styles.emptyCtaText}>Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const price = formatPrice(effectivePriceCents(product), product.currency);
  const onSale = isOnSale(product);
  const percentOff = discountPercent(product);
  const busy = saving || buying;

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      <ScreenHeader
        onBack={() => router.back()}
        right={
          <Pressable
            style={styles.heartButton}
            onPress={toggleWishlist}
            disabled={wishlistPending}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityState={{
              selected: wishlisted,
              disabled: wishlistPending,
            }}
            accessibilityLabel={
              wishlisted
                ? "Remove from your wishlist"
                : "Save to your wishlist"
            }
          >
            <Text
              style={[styles.heartText, wishlisted && styles.heartTextActive]}
            >
              {wishlisted ? "♥" : "♡"}
            </Text>
          </Pressable>
        }
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroWrap}>
          <ProductImage
            uri={heroUri}
            category={product.category}
            style={styles.hero}
            failed={heroUri ? failedImages.has(heroUri) : false}
            onFailed={markImageFailed}
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
        </View>

        {images.length > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.thumbStrip}
          >
            {images.map((uri, index) => {
              const isActive = index === selectedImageIndex;
              return (
                <Pressable
                  key={uri}
                  style={[styles.thumb, isActive && styles.thumbActive]}
                  onPress={() => setSelectedImageIndex(index)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                  accessibilityLabel={`Show image ${index + 1} of ${images.length}`}
                >
                  {/*
                    A failed thumbnail keeps its slot and shows the same
                    placeholder the hero would. Dropping it instead would
                    renumber every "Show image N of M" label after it and
                    reflow the strip under the user's thumb mid-tap.
                  */}
                  <ProductImage
                    uri={uri}
                    category={product.category}
                    style={styles.thumbImage}
                    failed={failedImages.has(uri)}
                    onFailed={markImageFailed}
                  />
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        <Pressable
          onPress={() => router.push(`/brand/${product.brand_id}`)}
          hitSlop={6}
          accessibilityRole="link"
          accessibilityLabel={`Browse all products from ${product.brand.name}`}
        >
          <Text style={styles.brandLink}>{product.brand.name}</Text>
        </Pressable>

        <Text style={styles.productName}>{product.name}</Text>

        <View style={styles.priceRow}>
          <Text style={[styles.price, onSale && styles.priceOnSale]}>
            {price}
          </Text>
          {onSale && (
            <Text style={styles.priceWas}>
              {formatPrice(product.price_cents, product.currency)}
            </Text>
          )}
        </View>

        {!product.in_stock && (
          <Text style={styles.stockNote}>
            This item is currently out of stock at {product.brand.name}.
          </Text>
        )}

        {product.description ? (
          <Text style={styles.description}>{product.description}</Text>
        ) : null}

        {product.color ? (
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Color</Text>
            <Text style={styles.metaValue}>{product.color}</Text>
          </View>
        ) : null}

        {product.tags.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Tags</Text>
            <View style={styles.tagWrap}>
              {product.tags.map((tag) => (
                <View key={tag} style={styles.tag}>
                  <Text style={styles.tagText}>{tag}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {product.sizes.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Size</Text>
            <View style={styles.sizeWrap}>
              {product.sizes.map((size) => {
                const isActive = size === selectedSize;
                return (
                  <Pressable
                    key={size}
                    style={[styles.sizeChip, isActive && styles.sizeChipActive]}
                    onPress={() => setSelectedSize(isActive ? null : size)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isActive }}
                    accessibilityLabel={`Size ${size}`}
                  >
                    <Text
                      style={[
                        styles.sizeChipText,
                        isActive && styles.sizeChipTextActive,
                      ]}
                    >
                      {size}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

        <Pressable
          style={[styles.tryOnButton, busy && styles.buttonDisabled]}
          onPress={handleTryOn}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`Try ${product.name} on your avatar`}
        >
          <Text style={styles.tryOnButtonText}>Try it on</Text>
        </Pressable>

        <Pressable
          style={[styles.secondaryButton, busy && styles.buttonDisabled]}
          onPress={handleSaveToWardrobe}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`Save ${product.name} to your wardrobe`}
        >
          {saving ? (
            <ActivityIndicator color={colors.ink} />
          ) : (
            <Text style={styles.secondaryButtonText}>Save to wardrobe</Text>
          )}
        </Pressable>

        <Pressable
          style={[styles.buyButton, busy && styles.buttonDisabled]}
          onPress={handleBuy}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`Buy ${product.name} at ${product.brand.name}, opens in your browser`}
        >
          {buying ? (
            <ActivityIndicator color={colors.onInk} />
          ) : (
            <Text style={styles.buyButtonText}>Buy at {product.brand.name}</Text>
          )}
        </Pressable>

        {/*
          Affiliate disclosure. Sits directly under the Buy button, in readable
          body-sized muted text rather than fine print, because the FTC's
          endorsement guides require the disclosure to be clear, conspicuous and
          adjacent to the link it applies to — and because a user who finds out
          later feels tricked, which costs more than the commission.
        */}
        <Text style={styles.disclosure}>
          Selv earns a commission on purchases made through this link. It costs
          you nothing extra.
        </Text>
      </ScrollView>

      {/*
        Dismissing just closes, unlike AddGarmentScreen — which navigates back,
        because a user at the cap can never make that form succeed. Here only
        one of the three actions is blocked: "Try it on" and "Buy" both still
        work at the cap, and bouncing the user off a product page they can
        still act on would be its own dead end.
      */}
      <SelvPlusWaitlistSheet
        visible={waitlistVisible}
        source={WAITLIST_SOURCE}
        onClose={() => setWaitlistVisible(false)}
      />
    </View>
  );
}

function ScreenHeader({
  onBack,
  right,
}: {
  onBack: () => void;
  right?: React.ReactNode;
}) {
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
      {right ?? null}
    </View>
  );
}

/** Themed placeholder blocks, so the screen has the shape of its content while it loads. */
function ProductDetailSkeleton() {
  return (
    <View style={styles.skeleton}>
      <View style={[styles.skeletonBlock, styles.skeletonHero]} />
      <View style={[styles.skeletonBlock, styles.skeletonLineSm]} />
      <View style={[styles.skeletonBlock, styles.skeletonLineLg]} />
      <View style={[styles.skeletonBlock, styles.skeletonLineMd]} />
      <View style={[styles.skeletonBlock, styles.skeletonButton]} />
      <View style={[styles.skeletonBlock, styles.skeletonButton]} />
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
    justifyContent: "space-between",
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
  heartButton: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  heartText: {
    fontSize: 18,
    lineHeight: 21,
    color: colors.muted,
  },
  heartTextActive: {
    color: colors.accent,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingBottom: 48,
  },
  heroWrap: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: radius.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
  },
  hero: {
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
    paddingHorizontal: 12,
    paddingVertical: spacing.xs,
  },
  saleBadgeText: {
    fontSize: 12,
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
    fontSize: 14,
    color: colors.ink,
  },
  thumbStrip: {
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  thumb: {
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.border,
    overflow: "hidden",
  },
  thumbActive: {
    borderColor: colors.accent,
  },
  thumbImage: {
    width: 60,
    height: 60,
    backgroundColor: colors.surfaceAlt,
  },
  brandLink: {
    ...type.label,
    color: colors.accent,
    marginTop: spacing.md,
  },
  productName: {
    fontFamily: type.title.fontFamily,
    fontSize: 24,
    letterSpacing: -0.4,
    color: colors.ink,
    marginTop: spacing.xs,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  price: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.ink,
  },
  priceOnSale: {
    color: colors.danger,
  },
  priceWas: {
    fontSize: 15,
    color: colors.faint,
    textDecorationLine: "line-through",
  },
  stockNote: {
    ...type.subtle,
    color: colors.danger,
    marginTop: spacing.sm,
  },
  description: {
    ...type.body,
    color: colors.muted,
    lineHeight: 21,
    marginTop: spacing.md,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  metaLabel: {
    ...type.label,
  },
  metaValue: {
    ...type.body,
  },
  sectionLabel: {
    ...type.label,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  tagWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  tag: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
  },
  tagText: {
    fontSize: 13,
    color: colors.muted,
  },
  sizeWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  sizeChip: {
    minWidth: 52,
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  sizeChipActive: {
    borderColor: colors.ink,
    backgroundColor: colors.ink,
  },
  sizeChipText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.ink,
  },
  sizeChipTextActive: {
    color: colors.onInk,
  },
  tryOnButton: {
    backgroundColor: colors.acid,
    borderWidth: 1,
    borderColor: colors.acidDeep,
    paddingVertical: 18,
    borderRadius: radius.md,
    alignItems: "center",
    marginTop: spacing.xl,
  },
  tryOnButtonText: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "700",
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.ink,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  secondaryButtonText: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "700",
  },
  buyButton: {
    backgroundColor: colors.ink,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  buyButtonText: {
    color: colors.onInk,
    fontSize: 16,
    fontWeight: "700",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  disclosure: {
    ...type.subtle,
    fontSize: 13,
    textAlign: "center",
    marginTop: spacing.sm,
  },
  centerFill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
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
  skeleton: {
    paddingHorizontal: spacing.md,
  },
  skeletonBlock: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
  },
  skeletonHero: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: radius.lg,
  },
  skeletonLineSm: {
    height: 12,
    width: "30%",
    marginTop: spacing.md,
  },
  skeletonLineLg: {
    height: 24,
    width: "75%",
    marginTop: spacing.sm,
  },
  skeletonLineMd: {
    height: 18,
    width: "40%",
    marginTop: spacing.sm,
  },
  skeletonButton: {
    height: 52,
    width: "100%",
    marginTop: spacing.lg,
  },
});
