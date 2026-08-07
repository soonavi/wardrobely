import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { AvatarPreview, type AvatarPreviewEquipped } from "../creator/AvatarPreview";
import type { Customization } from "../creator/customization";
import { Wordmark } from "../../components/Wordmark";
import { colors, fonts, spacing } from "../../lib/theme";

/**
 * Fixed 9:16 export size (in dp, not device pixels). react-native-view-shot's
 * captureRef (see shareCard.ts) captures at the view's native resolution,
 * which already factors in the device's pixel ratio — so on a typical 3x
 * device this 360x640 card yields a crisp ~1080x1920 PNG, right at the
 * Instagram/TikTok Stories & Reels spec, with no extra upscaling needed.
 */
export const SHARE_CARD_WIDTH = 360;
export const SHARE_CARD_HEIGHT = Math.round((SHARE_CARD_WIDTH * 16) / 9); // 640

export interface ShareCardProps {
  customization: Customization;
  /** The fit being shown off. Omit (or pass `{}`) to share a bare character. */
  equipped?: AvatarPreviewEquipped;
  /** Outfit name shown as the card's headline. Falls back to a friendly default when blank/omitted. */
  outfitName?: string;
  /** Profile display_name (WITHOUT the leading "@" — this component adds it). Falls back to "my fit" when omitted. */
  handle?: string;
  /**
   * Attached to the card's root View so shareCard.ts's captureAndShare /
   * captureAndSaveToPhotos can snapshot it. Render this component
   * off-screen (position: absolute, moved well outside the visible
   * viewport, `collapsable={false}` so Android's view-flattening optimizer
   * doesn't strip it from the native tree) and pass a `useShareCard()`
   * hook's `cardRef` here.
   */
  cardRef?: React.RefObject<View | null>;
}

/**
 * The polished, on-brand, vertical (9:16) share card — the app's #1 growth
 * mechanic ("every shared outfit is an ad"). Deliberately a PURE
 * React-Native/SVG view (no @react-three/fiber Canvas anywhere in this
 * tree): react-native-view-shot returns a black frame when it captures a
 * live GL surface on iOS, so the character here is AvatarPreview's flat 2D
 * SVG, re-tinted with the outfit's garment colors via the `equipped` prop,
 * rather than a screenshot of the 3D try-on scene. That's what makes this
 * card reliably capturable cross-platform.
 */
export function ShareCard({ customization, equipped, outfitName, handle, cardRef }: ShareCardProps) {
  const displayHandle = handle?.trim() ? `@${handle.trim()}` : "my fit";
  const title = outfitName?.trim() || "Today's fit";

  return (
    <View ref={cardRef} collapsable={false} style={styles.card}>
      {/* Soft brand blobs — same lavender/acid/silhouette palette as the rest of the app, just dialed down in opacity so they read as a soft glow behind the content instead of solid shapes. */}
      <View style={[styles.blob, styles.blobLavender]} />
      <View style={[styles.blob, styles.blobAcid]} />
      <View style={[styles.blob, styles.blobSilhouette]} />

      <View style={styles.headerRow}>
        <Wordmark size={22} color={colors.onInk} markColor={colors.acid} />
        <Text style={styles.headerLabel}>MY FIT</Text>
      </View>

      <View style={styles.stage}>
        <View style={styles.stageGlow} />
        <AvatarPreview customization={customization} size={200} equipped={equipped ?? {}} />
      </View>

      <View style={styles.captionBlock}>
        <Text style={styles.outfitName} numberOfLines={2}>
          {title}
        </Text>
        <Text style={styles.handle}>{displayHandle}</Text>
      </View>

      <View style={styles.footer}>
        <View style={styles.footerDivider} />
        <Text style={styles.footerText}>made on selv · design your own</Text>
      </View>
    </View>
  );
}

export default ShareCard;

const styles = StyleSheet.create({
  card: {
    width: SHARE_CARD_WIDTH,
    height: SHARE_CARD_HEIGHT,
    backgroundColor: colors.ink,
    overflow: "hidden",
    alignItems: "center",
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  blob: {
    position: "absolute",
    borderRadius: 999,
  },
  blobLavender: {
    width: 260,
    height: 260,
    top: -90,
    right: -80,
    backgroundColor: colors.accent,
    opacity: 0.35,
  },
  blobAcid: {
    width: 220,
    height: 220,
    bottom: -70,
    left: -70,
    backgroundColor: colors.acid,
    opacity: 0.22,
  },
  blobSilhouette: {
    width: 150,
    height: 150,
    bottom: 170,
    right: -55,
    backgroundColor: colors.silhouette,
    opacity: 0.16,
  },
  headerRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerLabel: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    letterSpacing: 2,
    color: colors.acid,
  },
  stage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  },
  stageGlow: {
    position: "absolute",
    width: 240,
    height: 240,
    borderRadius: 999,
    backgroundColor: colors.accentSoft,
    opacity: 0.14,
  },
  captionBlock: {
    width: "100%",
    alignItems: "center",
    marginTop: spacing.sm,
  },
  outfitName: {
    fontFamily: fonts.display,
    fontSize: 26,
    color: colors.onInk,
    textAlign: "center",
    letterSpacing: -0.4,
  },
  handle: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.silhouette,
    marginTop: 4,
  },
  footer: {
    width: "100%",
    alignItems: "center",
    marginTop: spacing.md,
  },
  footerDivider: {
    width: 40,
    height: 2,
    borderRadius: 1,
    backgroundColor: "rgba(245,242,234,0.25)",
    marginBottom: spacing.sm,
  },
  footerText: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: "rgba(245,242,234,0.55)",
    letterSpacing: 0.4,
  },
});
