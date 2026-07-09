import React, { useEffect } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import type { TryOnLayer } from "../../lib/stores/useTryOnStore";
import { colors } from "../../lib/theme";

const LAYER_BASE_SIZE = 140;
const MIN_SCALE = 0.3;
const MAX_SCALE = 4;

export interface GarmentLayerProps {
  layer: TryOnLayer;
  isSelected: boolean;
  /** Stage bounds (canvas px) the layer's center point is clamped within, so it can never be dragged fully off-stage. */
  stageWidth: number;
  stageHeight: number;
  onSelect: () => void;
  onChange: (updates: {
    x: number;
    y: number;
    scale: number;
    rotation: number;
  }) => void;
  onRemove: () => void;
  onBringToFront: () => void;
  /** Retry resolving the garment image after a failed load. */
  onRetryImage: () => void;
  /** Called when the resolved image URL fails to actually load (e.g. expired signed URL). */
  onImageLoadError: () => void;
}

/**
 * A single draggable/pinchable/rotatable garment image on the try-on
 * canvas. Position/scale/rotation are driven by reanimated shared values
 * synced from the layer prop, and gesture updates are pushed back up to
 * the try-on store via onChange so it stays the single source of truth.
 */
export function GarmentLayer({
  layer,
  isSelected,
  stageWidth,
  stageHeight,
  onSelect,
  onChange,
  onRemove,
  onBringToFront,
  onRetryImage,
  onImageLoadError,
}: GarmentLayerProps) {
  const translateX = useSharedValue(layer.x);
  const translateY = useSharedValue(layer.y);
  const scale = useSharedValue(layer.scale);
  const rotation = useSharedValue(layer.rotation);

  // Track gesture-start values so pan/pinch/rotate compose from a stable base.
  const startX = useSharedValue(layer.x);
  const startY = useSharedValue(layer.y);
  const startScale = useSharedValue(layer.scale);
  const startRotation = useSharedValue(layer.rotation);

  useEffect(() => {
    translateX.value = layer.x;
    translateY.value = layer.y;
    scale.value = layer.scale;
    rotation.value = layer.rotation;
  }, [layer.x, layer.y, layer.scale, layer.rotation]);

  /**
   * Push the final gesture values back to the store. Gesture callbacks run
   * as worklets on the UI thread, so JS props must be invoked via runOnJS —
   * calling onChange/onSelect directly from a worklet crashes at runtime.
   */
  function commitFromJS(x: number, y: number, s: number, r: number) {
    onChange({ x, y, scale: s, rotation: r });
  }

  /**
   * Selects this layer and brings it to front as soon as the user starts
   * interacting with it, so whichever garment they're touching is always
   * on top and its remove affordance is visible.
   */
  function activateFromJS() {
    onSelect();
    onBringToFront();
  }

  const panGesture = Gesture.Pan()
    .onStart(() => {
      startX.value = translateX.value;
      startY.value = translateY.value;
      runOnJS(activateFromJS)();
    })
    .onUpdate((event) => {
      // Clamp so the layer's center point can never leave the stage —
      // otherwise a user could drag a garment fully off-screen with no
      // way to select and recover it.
      const nextX = startX.value + event.translationX;
      const nextY = startY.value + event.translationY;
      translateX.value = Math.min(Math.max(nextX, 0), stageWidth);
      translateY.value = Math.min(Math.max(nextY, 0), stageHeight);
    })
    .onEnd(() => {
      runOnJS(commitFromJS)(
        translateX.value,
        translateY.value,
        scale.value,
        rotation.value
      );
    });

  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      startScale.value = scale.value;
      runOnJS(activateFromJS)();
    })
    .onUpdate((event) => {
      const next = startScale.value * event.scale;
      scale.value = Math.min(Math.max(next, MIN_SCALE), MAX_SCALE);
    })
    .onEnd(() => {
      runOnJS(commitFromJS)(
        translateX.value,
        translateY.value,
        scale.value,
        rotation.value
      );
    });

  const rotationGesture = Gesture.Rotation()
    .onStart(() => {
      startRotation.value = rotation.value;
      runOnJS(activateFromJS)();
    })
    .onUpdate((event) => {
      rotation.value = startRotation.value + event.rotation;
    })
    .onEnd(() => {
      runOnJS(commitFromJS)(
        translateX.value,
        translateY.value,
        scale.value,
        rotation.value
      );
    });

  const tapGesture = Gesture.Tap().onEnd(() => {
    runOnJS(activateFromJS)();
  });

  const composedGesture = Gesture.Simultaneous(
    Gesture.Simultaneous(panGesture, pinchGesture),
    Gesture.Simultaneous(rotationGesture, tapGesture)
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value - LAYER_BASE_SIZE / 2 },
      { translateY: translateY.value - LAYER_BASE_SIZE / 2 },
      { scale: scale.value },
      { rotateZ: `${rotation.value}rad` },
    ],
  }));

  const showBroken = !layer.imageUrl || layer.imageError;

  return (
    <GestureDetector gesture={composedGesture}>
      <Animated.View style={[styles.layer, animatedStyle]}>
        <View
          style={[
            styles.imageWrap,
            isSelected && styles.imageWrapSelected,
          ]}
        >
          {showBroken ? (
            <Pressable style={styles.brokenWrap} onPress={onRetryImage}>
              <Text style={styles.brokenText}>
                {layer.imageError ? "Failed to load" : "Loading…"}
              </Text>
              {layer.imageError && (
                <Text style={styles.brokenRetryText}>Tap to retry</Text>
              )}
            </Pressable>
          ) : (
            <Image
              source={{ uri: layer.imageUrl }}
              style={styles.image}
              resizeMode="contain"
              onError={onImageLoadError}
            />
          )}
        </View>
        {isSelected && (
          <Pressable
            style={styles.removeButton}
            onPress={onRemove}
            hitSlop={10}
            accessibilityLabel="Remove garment layer"
          >
            <Text style={styles.removeButtonText}>×</Text>
          </Pressable>
        )}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: "absolute",
    width: LAYER_BASE_SIZE,
    height: LAYER_BASE_SIZE,
  },
  imageWrap: {
    width: "100%",
    height: "100%",
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "transparent",
  },
  imageWrapSelected: {
    borderColor: colors.accent,
    borderStyle: "dashed",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  brokenWrap: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceAlt,
    borderRadius: 8,
    padding: 6,
  },
  brokenText: {
    fontSize: 11,
    color: colors.muted,
    textAlign: "center",
  },
  brokenRetryText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.accent,
    textAlign: "center",
    marginTop: 2,
  },
  removeButton: {
    position: "absolute",
    top: -12,
    right: -12,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  removeButtonText: {
    color: colors.onInk,
    fontSize: 16,
    lineHeight: 18,
    fontWeight: "700",
  },
});
