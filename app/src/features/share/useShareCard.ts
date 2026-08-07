/**
 * Capture -> share pipeline for the share-card growth loop (see
 * ShareCard.tsx for the branded 9:16 view being captured, and
 * CharacterTryOnScreen.tsx / OutfitsScreen.tsx for the two screens that
 * wire a "Share" action to this).
 *
 * RELIABILITY DECISION: this captures a PURE React-Native/SVG view via
 * react-native-view-shot's `captureRef`. It deliberately never targets the
 * live @react-three/fiber GL canvas — react-native-view-shot returns a
 * black frame when it snapshots a GL surface on iOS, which is exactly why
 * ShareCard re-draws the character as AvatarPreview's flat 2D SVG (tinted
 * with the outfit's garment colors) instead of screenshotting the 3D
 * try-on scene. As long as callers only ever point `cardRef` at a mounted
 * <ShareCard>, this keeps working cross-platform.
 *
 * This file is pure logic (no JSX) on purpose, so screens stay in charge of
 * actually mounting <ShareCard> — see useShareCard's doc comment below for
 * the expected render shape.
 */
import { useCallback, useRef, useState, type RefObject } from "react";
import type { View } from "react-native";
import { captureRef } from "react-native-view-shot";
import * as Sharing from "expo-sharing";
import * as MediaLibrary from "expo-media-library";

export interface ShareCardResult {
  ok: boolean;
  /** User-facing message on failure; null on success. */
  error: string | null;
}

/** PNG, full quality — this is a static branded graphic, not a photo, so there's no reason to trade quality for file size. */
const CAPTURE_OPTIONS = {
  format: "png" as const,
  quality: 1,
};

function messageFor(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * Snapshot the view at `viewRef` (expected to be a mounted, laid-out
 * `<ShareCard cardRef={viewRef} />`) to a local PNG file. Returns null (and
 * never throws) if there's nothing to capture yet, so callers can surface
 * one consistent error path instead of a try/catch of their own.
 */
async function captureCardToFile(viewRef: RefObject<View | null>): Promise<
  { uri: string; error: null } | { uri: null; error: string }
> {
  if (!viewRef.current) {
    return { uri: null, error: "Nothing to share yet — please try again." };
  }

  try {
    const uri = await captureRef(viewRef.current, CAPTURE_OPTIONS);
    return { uri, error: null };
  } catch (err) {
    return { uri: null, error: messageFor(err, "Couldn't capture your share card.") };
  }
}

/**
 * Capture the share card and hand it to the OS share sheet via
 * expo-sharing. Guards `isAvailableAsync` first (some Android configs and
 * most simulators/emulators have no share target registered) and never
 * throws — every failure mode (nothing to capture, capture error, sharing
 * unavailable, user's share-sheet error) comes back as `{ ok: false, error }`.
 */
export async function captureAndShare(viewRef: RefObject<View | null>): Promise<ShareCardResult> {
  const captured = await captureCardToFile(viewRef);
  if (!captured.uri) {
    return { ok: false, error: captured.error };
  }

  try {
    const available = await Sharing.isAvailableAsync();
    if (!available) {
      return { ok: false, error: "Sharing isn't available on this device." };
    }

    await Sharing.shareAsync(captured.uri, {
      mimeType: "image/png",
      dialogTitle: "Share your fit",
      UTI: "public.png",
    });

    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: messageFor(err, "Couldn't open the share sheet.") };
  }
}

/**
 * Capture the share card and save it straight to the device's camera roll
 * via expo-media-library. Requests write-only "add to library" permission
 * first (not full photo-library read access, since saving is all this
 * needs) — a prior denial surfaces as a clear, actionable error instead of
 * a silent no-op.
 */
export async function captureAndSaveToPhotos(viewRef: RefObject<View | null>): Promise<ShareCardResult> {
  const captured = await captureCardToFile(viewRef);
  if (!captured.uri) {
    return { ok: false, error: captured.error };
  }

  try {
    const { status } = await MediaLibrary.requestPermissionsAsync(/* writeOnly */ true);
    if (status !== "granted") {
      return {
        ok: false,
        error: "Selv needs Photos access to save your fit — enable it in Settings.",
      };
    }

    await MediaLibrary.saveToLibraryAsync(captured.uri);
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: messageFor(err, "Couldn't save to your photos.") };
  }
}

export type ShareCardBusyState = "idle" | "sharing" | "saving";

/**
 * Convenience hook bundling a `View` ref for an off-screen `<ShareCard>`
 * plus busy-state-tracked wrappers around the two capture functions above.
 * Screens using this hook are expected to render, somewhere in their tree
 * (position absolute, moved well off-screen so it's laid out but never
 * visible or disruptive):
 *
 *   const { cardRef, share, saveToPhotos, busy } = useShareCard();
 *   ...
 *   <View style={{ position: "absolute", top: -10000, left: 0 }} pointerEvents="none">
 *     <ShareCard cardRef={cardRef} customization={...} equipped={...} />
 *   </View>
 *
 * then call `share()` / `saveToPhotos()` from a button's onPress once that
 * off-screen card reflects the outfit to be shared.
 */
export function useShareCard() {
  const cardRef = useRef<View>(null);
  const [busy, setBusy] = useState<ShareCardBusyState>("idle");

  const share = useCallback(async (): Promise<ShareCardResult> => {
    setBusy("sharing");
    const result = await captureAndShare(cardRef);
    setBusy("idle");
    return result;
  }, []);

  const saveToPhotos = useCallback(async (): Promise<ShareCardResult> => {
    setBusy("saving");
    const result = await captureAndSaveToPhotos(cardRef);
    setBusy("idle");
    return result;
  }, []);

  return { cardRef, busy, isBusy: busy !== "idle", share, saveToPhotos };
}
