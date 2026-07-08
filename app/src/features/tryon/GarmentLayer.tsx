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

export interface GarmentLayerProps {
  layer: TryOnLayer;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (updates: {
    x: number;
    y: number;
    scale: number;
    rotation: number;
  }) => void;
  onRemove: () => void;
  onBringToFront: () => void;
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
  onSelect,
  onChange,
  onRemove,
  onBringToFront,
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

  const panGesture = Gesture.Pan()
    .onStart(() => {
      startX.value = translateX.value;
      startY.value = translateY.value;
    })
    .onUpdate((event) => {
      translateX.value = startX.value + event.translationX;
      translateY.value = startY.value + event.translationY;
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
    })
    .onUpdate((event) => {
      const next = startScale.value * event.scale;
      scale.value = Math.min(Math.max(next, 0.2), 4);
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
    runOnJS(onSelect)();
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

  return (
    <GestureDetector gesture={composedGesture}>
      <Animated.View
        style={[styles.layer, animatedStyle]}
        onTouchEnd={() => {
          if (isSelected) {
            onBringToFront();
          }
        }}
      >
        <View
          style={[
            styles.imageWrap,
            isSelected && styles.imageWrapSelected,
          ]}
        >
          <Image
            source={{ uri: layer.imageUrl }}
            style={styles.image}
            resizeMode="contain"
          />
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
