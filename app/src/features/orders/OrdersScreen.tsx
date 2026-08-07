import React, { useCallback, useState } from "react";
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
import {
  listMyOrders,
  type ConversionWithProduct,
} from "../../lib/api/affiliate";
import { formatPrice } from "../../lib/commerce/commission";
import type {
  ConversionStatus,
  GarmentCategory,
} from "../../lib/database.types";
import { useAuthStore } from "../../lib/stores/useAuthStore";
import { colors, radius, spacing, type } from "../../lib/theme";
import { ProductImage } from "../shop/productImagery";

/**
 * The user's purchase history, assembled from partner postbacks.
 *
 * Two deliberate omissions, both about whose information this is:
 *
 * 1. **No commission.** `affiliate_conversions` carries
 *    `commission_cents` and `commission_rate_bps` — what Selv earned on the
 *    sale and on what terms. That is our revenue data and our commercial
 *    relationship with the brand; showing a shopper "we made $6.40 on this"
 *    invites them to read their own purchase as a markup (it isn't — they
 *    paid the brand's price either way) and leaks negotiated rates that
 *    partners expect to stay between us. The disclosure obligation is met
 *    where it belongs — next to the Buy button, before the click — not by
 *    itemising our P&L in their order history.
 *
 * 2. **No network vocabulary.** `pending`/`approved`/`paid`/`reversed`
 *    describe where the money is in *our* pipeline, not what happened to the
 *    user's order. `approved` and `paid` are the same event to them (the
 *    brand confirmed the sale); the difference is only whether the network
 *    has settled with us yet. See STATUS_LABELS below.
 *
 * This is also not a receipt: it lags the purchase, can be missing entirely
 * if a network dropped the subid, and the brand's own confirmation email is
 * the authoritative record. The footer says so rather than implying we know
 * more than we do.
 */

/** Internal conversion lifecycle -> what it means to the person who bought it. */
const STATUS_LABELS: Record<ConversionStatus, string> = {
  pending: "Processing",
  // Both mean "the brand confirmed this sale". The split between them is
  // purely about whether the network has paid *us*, which is not the user's
  // business and would read as a delay on their order if surfaced.
  approved: "Confirmed",
  paid: "Confirmed",
  reversed: "Refunded",
};

function statusLabel(status: ConversionStatus): string {
  return STATUS_LABELS[status] ?? "Processing";
}

/**
 * The tile drawn for an order whose product row is gone.
 *
 * `ProductImage` needs a category to pick its pictogram and `order.product` is
 * null in that case, so there is nothing to pass. This is not a guess about
 * what was bought — it is the same tile `productImagery` itself falls back to
 * for a category it doesn't recognise (`UNKNOWN_CATEGORY_TILE`), reached the
 * only way a non-nullable `category` prop allows. Every delisted order draws
 * the identical tile, which reads as "we no longer know what this was" rather
 * than as a confident wrong answer, and it keeps the row the same shape as its
 * neighbours instead of punching a hole in the list.
 */
const DELISTED_ITEM_TILE: GarmentCategory = "top";

function formatOrderDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

export function OrdersScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = useAuthStore((s) => s.session);
  const userId = session?.user.id;

  const [orders, setOrders] = useState<ConversionWithProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOrders = useCallback(
    async (isRefresh = false) => {
      if (!userId) {
        setLoading(false);
        return;
      }

      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const { data, error: fetchError } = await listMyOrders(userId);

      if (fetchError) {
        setError(fetchError);
      } else {
        setOrders(data ?? []);
      }

      setLoading(false);
      setRefreshing(false);
    },
    [userId]
  );

  useFocusEffect(
    useCallback(() => {
      loadOrders();
    }, [loadOrders])
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>Your orders</Text>
      </View>

      {error && orders.length > 0 && (
        <View style={styles.errorRow}>
          <Text style={styles.errorText} numberOfLines={1}>
            {error}
          </Text>
          <Pressable onPress={() => loadOrders()} hitSlop={8}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}

      {loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator />
        </View>
      ) : error && orders.length === 0 ? (
        <View style={styles.centerFill}>
          <Text style={styles.emptyTitle}>Couldn&apos;t load your orders</Text>
          <Text style={styles.emptyText}>{error}</Text>
          <Pressable style={styles.emptyCta} onPress={() => loadOrders()}>
            <Text style={styles.emptyCtaText}>Try again</Text>
          </Pressable>
        </View>
      ) : orders.length === 0 ? (
        <View style={styles.centerFill}>
          <Text style={styles.emptyTitle}>No orders yet</Text>
          <Text style={styles.emptyText}>
            Anything you buy through Selv shows up here once the brand
            confirms it.
          </Text>
          <Pressable
            style={styles.emptyCta}
            onPress={() => router.push("/(tabs)/shop")}
          >
            <Text style={styles.emptyCtaText}>Browse the Shop</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadOrders(true)}
            />
          }
          ListFooterComponent={
            <Text style={styles.footerNote}>
              Orders are reported by the brand and can take a few days to
              appear. Your confirmation email from the brand is the official
              receipt.
            </Text>
          }
          renderItem={({ item }) => <OrderRow order={item} />}
        />
      )}
    </View>
  );
}

function OrderRow({ order }: { order: ConversionWithProduct }) {
  // Both joins are nullable on purpose (see ConversionWithProduct): a product
  // can be delisted and a brand paused long after a real purchase. The order
  // still happened, so it renders with whatever is left rather than vanishing.
  const product = order.product;
  const title = product?.name ?? "Item no longer listed";
  const brandName = order.brand?.name ?? "—";
  const date = formatOrderDate(order.occurred_at);
  const refunded = order.status === "reversed";

  return (
    <View style={styles.row}>
      {/*
        The Shop's shared image component rather than a raw <Image> beside a
        grey square. Two reasons this screen can't hand-roll it any more: the
        seeded demo catalog stores `selv-asset:` uris, which name bundled
        artwork and which no <Image> can ever fetch, and real partner CDN urls
        rot on a schedule nobody tells us about. ProductImage paints the
        bundled category tile underneath and lets the photo cover it if and
        when it arrives, so this row is never blank, never a broken-image icon,
        and never changes height between the three outcomes.

        No screen-level failure memory is passed: unlike product detail, which
        renders the same url as both a hero and a thumbnail, an order list
        renders each url exactly once, so the component's own per-url memory is
        all that's needed.
      */}
      <ProductImage
        uri={product?.image_url}
        category={product?.category ?? DELISTED_ITEM_TILE}
        style={styles.thumb}
      />

      <View style={styles.rowBody}>
        <Text style={styles.rowBrand} numberOfLines={1}>
          {brandName}
        </Text>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {title}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {date}
        </Text>
      </View>

      <View style={styles.rowTrailing}>
        <Text style={styles.rowTotal}>
          {formatPrice(order.order_total_cents, order.currency)}
        </Text>
        <View style={[styles.statusPill, refunded && styles.statusPillRefunded]}>
          <Text
            style={[styles.statusText, refunded && styles.statusTextRefunded]}
          >
            {statusLabel(order.status)}
          </Text>
        </View>
      </View>
    </View>
  );
}

export default OrdersScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    paddingHorizontal: spacing.md,
    paddingTop: 4,
    paddingBottom: spacing.sm,
    gap: 4,
  },
  backText: {
    color: colors.accent,
    fontWeight: "700",
    fontSize: 14,
  },
  title: {
    ...type.title,
  },
  list: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  // Frame only. ProductImage supplies the fill (its own `surfaceAlt` backstop
  // plus the category tile over it) and clips to this radius, so the local
  // grey-square placeholder these styles used to carry is gone with it.
  thumb: {
    width: 64,
    height: 64,
    borderRadius: radius.sm,
  },
  rowBody: {
    flex: 1,
  },
  rowBrand: {
    ...type.label,
    marginBottom: 2,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.ink,
  },
  rowMeta: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  rowTrailing: {
    alignItems: "flex-end",
    gap: 6,
  },
  rowTotal: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.ink,
  },
  statusPill: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  statusPillRefunded: {
    backgroundColor: colors.surfaceAlt,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.accent,
  },
  statusTextRefunded: {
    color: colors.muted,
  },
  footerNote: {
    fontSize: 12,
    color: colors.faint,
    textAlign: "center",
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  errorText: {
    color: colors.danger,
    flexShrink: 1,
  },
  retryText: {
    color: colors.accent,
    fontWeight: "700",
    marginLeft: spacing.sm,
  },
  centerFill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: {
    fontFamily: type.title.fontFamily,
    fontSize: 18,
    fontWeight: "700",
    color: colors.ink,
    marginBottom: 6,
    textAlign: "center",
  },
  emptyText: {
    textAlign: "center",
    color: colors.muted,
    fontSize: 15,
  },
  emptyCta: {
    marginTop: spacing.md,
    backgroundColor: colors.ink,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  emptyCtaText: {
    color: colors.onInk,
    fontSize: 15,
    fontWeight: "700",
  },
});
