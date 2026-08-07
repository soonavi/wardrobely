import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  PixelRatio,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Canvas, useFrame, useThree } from "@react-three/fiber/native";
import { ContactShadows } from "@react-three/drei/native";
import * as THREE from "three";
import { useRouter } from "expo-router";
import { CharacterAvatar } from "./CharacterAvatar";
import { getMyAvatar } from "../../lib/api/avatars";
import { mergeCustomization, type Customization } from "../creator/customization";
import { colors, fonts, radius, spacing, type } from "../../lib/theme";

/**
 * ============================================================================
 * CharacterViewerScreen — the branded "view your 3D character" screen.
 *
 * Loads the signed-in user's `customization` (features/creator/customization
 * .ts) via getMyAvatar, then renders it with <CharacterAvatar> inside a lit,
 * drag-to-rotate / pinch-to-zoom R3F scene.
 *
 * The rendering setup here (ACES tone mapping + sRGB output color space,
 * studio 3-point + hemisphere lighting, drei's <ContactShadows>, capped
 * device pixel ratio, and the refs+useFrame gesture pattern for rotate/zoom)
 * is intentionally the SAME proven approach the original AvatarSpikeScreen
 * used. That screen has since been deleted; the rationale behind each choice
 * (OrbitControls doesn't run on native, why devicePixelRatio needs capping,
 * etc) now lives in src/features/avatar3d/gltf/, which is where the reusable
 * half of that spike was extracted to before it was removed.
 *
 * There's no GLB to fetch here (CharacterAvatar is pure procedural geometry,
 * built synchronously), so this screen has no loading-model/error-boundary/
 * retry machinery for the 3D content itself — only for the network fetch of
 * the user's customization row. The gltf/ module carries that machinery for
 * the day a real rig arrives.
 * ============================================================================
 */

// ---------------------------------------------------------------------------
// Scene scale. CharacterAvatar's internal proportions are fixed constants
// (see its HEAD_RADIUS/HIP_Y/etc) that put the character at roughly 1.55-1.65
// world units tall with feet at y~0 — TARGET_HEIGHT_UNITS below is just a
// calibration reference for the camera/ground/shadow framing, matching
// AvatarSpikeScreen's own normalized avatar height so the "studio" feel is
// consistent across both screens.
// ---------------------------------------------------------------------------
const TARGET_HEIGHT_UNITS = 1.7;
const CAMERA_BASE_DISTANCE = TARGET_HEIGHT_UNITS * 1.95;
const CAMERA_START_Y = TARGET_HEIGHT_UNITS * 0.62;
const CAMERA_TARGET_Y = TARGET_HEIGHT_UNITS * 0.5;
const GROUND_RADIUS = TARGET_HEIGHT_UNITS * 0.62;

// Backdrop + ground: pulled from theme.ts so this screen reads as "branded"
// rather than a copy of the spike's own arbitrary lavender palette — cream
// background (colors.bg) fading up to the soft lavender accent wash
// (colors.accentSoft), with the app's dedicated "avatar silhouette" lavender
// token for the ground disc.
const BACKDROP_BOTTOM_COLOR = colors.bg;
const BACKDROP_TOP_COLOR = colors.accentSoft;
const BACKDROP_WIDTH = 5.0;
const BACKDROP_HEIGHT = 4.4;
const BACKDROP_CENTER_Y = TARGET_HEIGHT_UNITS * 0.6;
const BACKDROP_Z = -(TARGET_HEIGHT_UNITS * 1.6);
const GROUND_COLOR = colors.silhouette;

// Studio lighting — same warm-key / cool-fill / rim three-point rig as
// AvatarSpikeScreen, tuned for a slightly smaller, closer-to-camera subject.
const HEMI_SKY_COLOR = colors.accentSoft;
const HEMI_GROUND_COLOR = "#FFF3E2";
const HEMI_INTENSITY = 0.6;
const KEY_LIGHT_COLOR = "#FFE8CC";
const KEY_LIGHT_INTENSITY = 1.3;
const KEY_LIGHT_POSITION: [number, number, number] = [2.2, 3.8, 2.8];
const FILL_LIGHT_COLOR = "#D8E0FF";
const FILL_LIGHT_INTENSITY = 0.34;
const FILL_LIGHT_POSITION: [number, number, number] = [-2.6, 1.5, -1.3];
const RIM_LIGHT_COLOR = "#FFFFFF";
const RIM_LIGHT_INTENSITY = 0.55;
const RIM_LIGHT_POSITION: [number, number, number] = [0, 3.2, -3.0];

const CONTACT_SHADOW_OPACITY = 0.5;
const CONTACT_SHADOW_BLUR = 2.6;
const CONTACT_SHADOW_RESOLUTION = 256;
const CONTACT_SHADOW_SCALE = GROUND_RADIUS * 2.3;
const CONTACT_SHADOW_FAR = TARGET_HEIGHT_UNITS * 0.9;

const IDLE_ROTATE_SPEED = 0.15; // radians/sec, paused while dragging
const MAX_DEVICE_PIXEL_RATIO = 2;
const TONE_MAPPING_EXPOSURE = 1.1;

const ROTATE_SPEED = 0.012; // radians per pixel of horizontal drag
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2.4;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * A soft vertical gradient plane built from per-vertex colors (NOT a canvas
 * texture — there's no `document` on React Native). Same technique as
 * AvatarSpikeScreen's useVerticalGradientPlaneGeometry, replicated locally.
 */
function useVerticalGradientPlaneGeometry(
  width: number,
  height: number,
  topColor: string,
  bottomColor: string
): THREE.PlaneGeometry {
  return useMemo(() => {
    const heightSegments = 24;
    const geometry = new THREE.PlaneGeometry(width, height, 1, heightSegments);
    const top = new THREE.Color(topColor);
    const bottom = new THREE.Color(bottomColor);
    const tmp = new THREE.Color();
    const position = geometry.attributes.position;
    const colorArray = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      const t = (position.getY(i) + height / 2) / height;
      tmp.copy(bottom).lerp(top, t);
      colorArray[i * 3] = tmp.r;
      colorArray[i * 3 + 1] = tmp.g;
      colorArray[i * 3 + 2] = tmp.b;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colorArray, 3));
    return geometry;
  }, [width, height, topColor, bottomColor]);
}

function StudioBackdrop() {
  const geometry = useVerticalGradientPlaneGeometry(
    BACKDROP_WIDTH,
    BACKDROP_HEIGHT,
    BACKDROP_TOP_COLOR,
    BACKDROP_BOTTOM_COLOR
  );
  return (
    <mesh position={[0, BACKDROP_CENTER_Y, BACKDROP_Z]} geometry={geometry}>
      <meshBasicMaterial vertexColors toneMapped={false} />
    </mesh>
  );
}

function Ground() {
  return (
    <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <circleGeometry args={[GROUND_RADIUS, 64]} />
      <meshStandardMaterial color={GROUND_COLOR} roughness={0.92} metalness={0} />
    </mesh>
  );
}

/**
 * Applies drag-to-rotate (reading `rotationRef`, written by the pan gesture
 * below) plus a gentle idle auto-rotate that pauses while the user is
 * actively dragging. Mirrors AvatarSpikeScreen's BodyGroup rotation half
 * (this screen doesn't need BodyGroup's body-shape-application half, since
 * CharacterAvatar shapes itself from `customization` internally).
 */
function RotatingGroup({
  rotationRef,
  isDraggingRef,
  children,
}: {
  rotationRef: React.RefObject<number>;
  isDraggingRef: React.RefObject<boolean>;
  children: React.ReactNode;
}) {
  const ref = useRef<THREE.Group>(null);

  useFrame((_state, delta) => {
    if (!isDraggingRef.current) {
      rotationRef.current += IDLE_ROTATE_SPEED * delta;
    }
    if (ref.current) {
      ref.current.rotation.y = rotationRef.current;
    }
  });

  return <group ref={ref}>{children}</group>;
}

/** Pinch-zoom by dollying the camera along its original line of sight, always looking at roughly chest height. */
function CameraRig({ zoomRef }: { zoomRef: React.RefObject<number> }) {
  const { camera } = useThree();
  const directionRef = useRef(new THREE.Vector3(0, 0, 1));

  useEffect(() => {
    directionRef.current.copy(camera.position).normalize();
  }, [camera]);

  useFrame(() => {
    const distance = CAMERA_BASE_DISTANCE / zoomRef.current;
    camera.position.copy(directionRef.current).multiplyScalar(distance);
    camera.lookAt(0, CAMERA_TARGET_Y, 0);
  });

  return null;
}

/** Loads the signed-in user's saved customization. Distinguishes "no row yet" / "row but never used the creator" from a real fetch error, since each needs a different fallback UI. */
function useMyCustomization() {
  const [customization, setCustomization] = useState<Customization | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasCustomization, setHasCustomization] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error: fetchError } = await getMyAvatar();

    setLoading(false);

    if (fetchError) {
      setError(fetchError);
      return;
    }

    // `customization` defaults to `{}` at the DB level (see database.types.ts)
    // for avatar rows created before the character creator existed (or never
    // touched by it) — only treat this as "has a character" when it actually
    // carries at least one saved field.
    const raw = data?.customization;
    const populated = !!raw && Object.keys(raw).length > 0;
    setHasCustomization(populated);
    setCustomization(populated ? mergeCustomization(raw as Partial<Customization>) : null);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { customization, hasCustomization, loading, error, reload: load };
}

export function CharacterViewerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { customization, hasCustomization, loading, error, reload } = useMyCustomization();

  const rotationRef = useRef(0);
  const zoomRef = useRef(1);
  const pinchStartZoomRef = useRef(1);
  const isDraggingRef = useRef(false);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .onBegin(() => {
          isDraggingRef.current = true;
        })
        .onChange((event) => {
          rotationRef.current += event.changeX * ROTATE_SPEED;
        })
        .onFinalize(() => {
          isDraggingRef.current = false;
        })
        .runOnJS(true),
    []
  );

  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .onStart(() => {
          pinchStartZoomRef.current = zoomRef.current;
        })
        .onChange((event) => {
          zoomRef.current = clamp(pinchStartZoomRef.current * event.scale, MIN_ZOOM, MAX_ZOOM);
        })
        .runOnJS(true),
    []
  );

  const composedGesture = useMemo(
    () => Gesture.Simultaneous(panGesture, pinchGesture),
    [panGesture, pinchGesture]
  );

  const handleCanvasCreated = useCallback((state: { gl: THREE.WebGLRenderer }) => {
    const { gl } = state;
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = TONE_MAPPING_EXPOSURE;
    gl.setPixelRatio(Math.min(PixelRatio.get(), MAX_DEVICE_PIXEL_RATIO));
  }, []);

  // --- Resolved-before-3D states ---------------------------------------

  if (loading) {
    return (
      <View style={[styles.root, styles.centerFill]}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.overlayText}>Loading your character…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.root, styles.centerFill]}>
        <Text style={styles.errorTitle}>Couldn&apos;t load your character</Text>
        <Text style={styles.errorMessage} numberOfLines={4}>
          {error}
        </Text>
        <Pressable style={styles.primaryButton} onPress={reload} accessibilityRole="button">
          <Text style={styles.primaryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!hasCustomization || !customization) {
    return (
      <View style={[styles.root, styles.centerFill]}>
        <Text style={styles.title}>No character yet</Text>
        <Text style={[styles.overlayText, styles.promptBody]}>
          Design your Selv in the character creator first — skin, hair, face, body, and
          more — then come back here to see it in 3D.
        </Text>
        <Pressable
          style={styles.primaryButton}
          onPress={() => router.push("/create-avatar")}
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>Open character creator</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <GestureDetector gesture={composedGesture}>
        <View style={styles.canvasWrap}>
          <Canvas
            style={styles.canvas}
            camera={{
              position: [0, CAMERA_START_Y, CAMERA_BASE_DISTANCE],
              fov: 30,
              near: 0.05,
              far: 50,
            }}
            gl={{ antialias: true }}
            shadows="soft"
            onCreated={handleCanvasCreated}
          >
            <color attach="background" args={[BACKDROP_BOTTOM_COLOR]} />

            <hemisphereLight
              color={HEMI_SKY_COLOR}
              groundColor={HEMI_GROUND_COLOR}
              intensity={HEMI_INTENSITY}
            />
            <directionalLight
              position={KEY_LIGHT_POSITION}
              intensity={KEY_LIGHT_INTENSITY}
              color={KEY_LIGHT_COLOR}
              castShadow
              shadow-mapSize-width={1024}
              shadow-mapSize-height={1024}
              shadow-camera-near={0.1}
              shadow-camera-far={8}
              shadow-camera-left={-0.9}
              shadow-camera-right={0.9}
              shadow-camera-top={1.9}
              shadow-camera-bottom={-0.1}
              shadow-bias={-0.0015}
            />
            <directionalLight
              position={FILL_LIGHT_POSITION}
              intensity={FILL_LIGHT_INTENSITY}
              color={FILL_LIGHT_COLOR}
            />
            <directionalLight
              position={RIM_LIGHT_POSITION}
              intensity={RIM_LIGHT_INTENSITY}
              color={RIM_LIGHT_COLOR}
            />

            <StudioBackdrop />
            <Ground />

            <ContactShadows
              position={[0, 0.005, 0]}
              opacity={CONTACT_SHADOW_OPACITY}
              scale={CONTACT_SHADOW_SCALE}
              blur={CONTACT_SHADOW_BLUR}
              far={CONTACT_SHADOW_FAR}
              resolution={CONTACT_SHADOW_RESOLUTION}
              color={colors.ink}
            />

            <RotatingGroup rotationRef={rotationRef} isDraggingRef={isDraggingRef}>
              <CharacterAvatar customization={customization} />
            </RotatingGroup>

            <CameraRig zoomRef={zoomRef} />
          </Canvas>
        </View>
      </GestureDetector>

      <View style={[styles.legend, { top: insets.top + spacing.sm }]} pointerEvents="box-none">
        <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityRole="button">
          <Text style={styles.backButtonText}>← Back</Text>
        </Pressable>
        <View pointerEvents="none">
          <Text style={styles.legendTitle}>Your character</Text>
          <Text style={styles.legendNote}>Drag to rotate · pinch to zoom</Text>
        </View>
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Pressable
          style={styles.editButton}
          onPress={() => router.push("/create-avatar")}
          accessibilityRole="button"
        >
          <Text style={styles.editButtonText}>Edit your character →</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default CharacterViewerScreen;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centerFill: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  canvasWrap: {
    flex: 1,
  },
  canvas: {
    flex: 1,
  },
  legend: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    alignItems: "flex-start",
    gap: spacing.xs,
  },
  backButton: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  backButtonText: {
    color: colors.accent,
    fontFamily: fonts.medium,
    fontSize: 15,
  },
  legendTitle: {
    fontFamily: type.title.fontFamily,
    fontSize: 20,
    fontWeight: "700",
    color: colors.ink,
  },
  legendNote: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  editButton: {
    backgroundColor: colors.acid,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: "center",
  },
  editButtonText: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "700",
  },
  title: {
    ...type.title,
    fontSize: 24,
    textAlign: "center",
    marginBottom: spacing.xs,
  },
  promptBody: {
    textAlign: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  overlayText: {
    marginTop: spacing.sm,
    fontSize: 13,
    color: colors.muted,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.danger,
    marginBottom: 4,
    textAlign: "center",
  },
  errorMessage: {
    fontSize: 12,
    color: colors.muted,
    textAlign: "center",
    marginBottom: spacing.md,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderRadius: radius.pill,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 14,
  },
});
