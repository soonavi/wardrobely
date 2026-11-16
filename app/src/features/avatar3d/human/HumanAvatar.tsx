/**
 * HumanAvatar — the character, as an actual human body.
 *
 * Drop-in for `CharacterAvatar` (same `customization` / `equipped` / `animate`
 * props) and the component the 3D screens mount. It loads the bundled
 * `selv-human.glb`, hands it to `HumanRig`, and keeps the rig in step with the
 * character's look, body shape and outfit.
 *
 * If the asset fails to load or to parse, it renders the old primitive
 * avatar instead and reports why. A character made of capsules is a worse
 * avatar; a blank canvas is a broken screen.
 */
import React, { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

import type { Customization } from "../../creator/customization";
import { CharacterAvatar } from "../CharacterAvatar";
import { GltfErrorBoundary } from "../gltf/GltfModel";
import { preloadGltf, useGltfScene } from "../gltf/gltfSource";
import { useFrame } from "../r3f";
import { HUMAN_AVATAR_SOURCE } from "./humanAsset";
import { applyHumanLook, buildHumanLook, type BodyMeasurements, type HumanEquipped } from "./humanLook";
import { applyIdle, STANCE_POSE } from "./humanPose";
import { HumanRig } from "./humanRig";

export interface HumanAvatarProps {
  customization: Customization;
  equipped?: HumanEquipped;
  /** Breathing and a slow weight shift. Default true. */
  animate?: boolean;
  /** Real height/weight from the profile, when the person has entered them. */
  measurements?: BodyMeasurements | null;
  /** Called once the mesh is on screen, with the stature it resolved to. */
  onReady?: (info: { statureCm: number }) => void;
  /** Called if the mesh could not be used and the primitive avatar took over. */
  onFallback?: (reason: unknown) => void;
}

/** Start fetching and parsing the avatar before a 3D screen mounts. */
export function preloadHumanAvatar(): void {
  try {
    preloadGltf(HUMAN_AVATAR_SOURCE);
  } catch {
    // Preloading is an optimisation; a failure here resurfaces on mount.
  }
}

function HumanMesh({ customization, equipped, animate = true, measurements, onReady }: HumanAvatarProps) {
  const gltf = useGltfScene(HUMAN_AVATAR_SOURCE);

  // One private copy of the scene per mounted avatar: drei caches a single
  // scene per asset, and this component rewrites geometry and materials.
  const rig = useMemo(() => {
    const scene = cloneSkinned(gltf.scene);
    const built = new HumanRig(scene);
    built.isolateMaterials();
    return built;
  }, [gltf.scene]);

  useEffect(() => () => rig.dispose(), [rig]);

  const look = useMemo(
    () => buildHumanLook(customization, equipped, measurements),
    [customization, equipped, measurements]
  );

  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  // Layout effect: the look must be on the rig before the first frame draws,
  // or the avatar flashes the asset's neutral body in the base layer.
  useLayoutEffect(() => {
    const { missing, unknownTargets } = applyHumanLook(rig, look);
    if (__DEV__ && (missing.length || unknownTargets.length)) {
      console.warn("[HumanAvatar] asset is missing", { parts: missing, targets: unknownTargets });
    }
    readyRef.current?.({ statureCm: Math.round(rig.statureMetres * 1000) / 10 });
  }, [rig, look]);

  useFrame((state) => {
    applyIdle(rig, STANCE_POSE, state.clock.elapsedTime, animate ? 1 : 0);
  });

  return <primitive object={rig.root} />;
}

export function HumanAvatar(props: HumanAvatarProps) {
  const [failed, setFailed] = useState(false);
  const onFallback = props.onFallback;

  if (failed) {
    const { outer: _outer, ...legacy } = props.equipped ?? {};
    return <CharacterAvatar customization={props.customization} equipped={legacy} animate={props.animate} />;
  }

  return (
    <GltfErrorBoundary
      onError={(error) => {
        console.warn("[HumanAvatar] falling back to the primitive avatar:", error);
        setFailed(true);
        onFallback?.(error);
      }}
    >
      <Suspense fallback={null}>
        <HumanMesh {...props} />
      </Suspense>
    </GltfErrorBoundary>
  );
}

export default HumanAvatar;
