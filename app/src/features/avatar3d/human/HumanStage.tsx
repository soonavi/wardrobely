/**
 * HumanStage — a self-contained 3D stage for the human avatar: canvas, studio
 * lighting, ground shadow, a camera that frames the face, bust or whole body,
 * and drag-to-turn.
 *
 * The character creator uses it as its live preview, so the thing you are
 * designing is the thing you will be dressed as — not a 2D drawing standing
 * in for it.
 */
import React, { useCallback, useMemo, useRef, useState } from "react";
import { PanResponder, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import * as THREE from "three";
import { ContactShadows } from "@react-three/drei/native";

import type { Customization } from "../../creator/customization";
import { colors } from "../../../lib/theme";
import { Canvas, useFrame, useThree } from "../r3f";
import { HumanAvatar } from "./HumanAvatar";
import type { BodyMeasurements, HumanEquipped } from "./humanLook";

export type StageFraming = "full" | "bust" | "face";

/** Camera target height and distance, as fractions of the avatar's stature. */
const FRAMING: Record<StageFraming, { target: number; distance: number }> = {
  full: { target: 0.52, distance: 2.32 },
  bust: { target: 0.84, distance: 0.98 },
  face: { target: 0.925, distance: 0.52 },
};

const DRAG_RADIANS_PER_PIXEL = 0.011;

function Turntable({ rotation, children }: { rotation: React.RefObject<number>; children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (ref.current) ref.current.rotation.y = rotation.current ?? 0;
  });
  return <group ref={ref}>{children}</group>;
}

function StageCamera({ framing, statureM }: { framing: StageFraming; statureM: number }) {
  const { camera } = useThree();
  const current = useRef<{ y: number; d: number } | null>(null);
  useFrame((_state, delta) => {
    const f = FRAMING[framing];
    const goal = { y: f.target * statureM, d: f.distance * statureM };
    if (!current.current) current.current = { ...goal };
    // Ease toward the new framing: switching from "body" to "face" should
    // travel, not cut.
    const k = 1 - Math.exp(-delta * 6);
    current.current.y += (goal.y - current.current.y) * k;
    current.current.d += (goal.d - current.current.d) * k;
    camera.position.set(0, current.current.y + current.current.d * 0.04, current.current.d);
    camera.lookAt(0, current.current.y, 0);
  });
  return null;
}

export interface HumanStageProps {
  customization: Customization;
  equipped?: HumanEquipped;
  measurements?: BodyMeasurements | null;
  framing?: StageFraming;
  /** Drag horizontally to turn the character. Default true. */
  interactive?: boolean;
  /** Starting rotation in radians (0 faces the camera). */
  initialRotation?: number;
  style?: StyleProp<ViewStyle>;
  background?: string;
  onReady?: (info: { statureCm: number }) => void;
}

export function HumanStage({
  customization,
  equipped,
  measurements,
  framing = "full",
  interactive = true,
  initialRotation = 0,
  style,
  background = colors.bg,
  onReady,
}: HumanStageProps) {
  const rotation = useRef(initialRotation);
  const dragStart = useRef(0);
  const [statureM, setStatureM] = useState(1.66);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => interactive && Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderGrant: () => {
          dragStart.current = rotation.current;
        },
        onPanResponderMove: (_e, g) => {
          rotation.current = dragStart.current + g.dx * DRAG_RADIANS_PER_PIXEL;
        },
        onPanResponderTerminationRequest: () => true,
      }),
    [interactive]
  );

  const handleReady = useCallback(
    (info: { statureCm: number }) => {
      if (info.statureCm > 0) setStatureM(info.statureCm / 100);
      onReady?.(info);
    },
    [onReady]
  );

  const handleCreated = useCallback((state: { gl: THREE.WebGLRenderer }) => {
    state.gl.outputColorSpace = THREE.SRGBColorSpace;
    state.gl.toneMapping = THREE.ACESFilmicToneMapping;
    state.gl.toneMappingExposure = 1.08;
  }, []);

  return (
    <View style={[styles.root, { backgroundColor: background }, style]} {...responder.panHandlers}>
      <Canvas
        style={styles.canvas}
        camera={{ position: [0, 0.9, 3.9], fov: 30, near: 0.05, far: 50 }}
        gl={{ antialias: true, preserveDrawingBuffer: Platform.OS === "web" }}
        onCreated={handleCreated}
      >
        <color attach="background" args={[background]} />
        <hemisphereLight color="#FFFFFF" groundColor="#C9BFAE" intensity={1.0} />
        <directionalLight position={[1.6, 2.6, 3.2]} intensity={2.0} color="#FFF1DF" />
        <directionalLight position={[-2.4, 1.2, 1.6]} intensity={0.65} color="#DCE5FF" />
        <directionalLight position={[0.4, 2.2, -3.0]} intensity={0.8} color="#FFFFFF" />
        <ContactShadows position={[0, 0.004, 0]} opacity={0.42} scale={2.4} blur={2.6} far={1.5} resolution={256} color={colors.ink} />
        <Turntable rotation={rotation}>
          <HumanAvatar customization={customization} equipped={equipped} measurements={measurements} onReady={handleReady} />
        </Turntable>
        <StageCamera framing={framing} statureM={statureM} />
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { overflow: "hidden" },
  canvas: { flex: 1 },
});

export default HumanStage;
