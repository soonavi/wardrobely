import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useProgress } from "@react-three/drei/native";
import type * as THREE from "three";
import { clearGltfCache, useGltfScene, type GltfSource } from "./gltfSource";
import {
  applyRealisticMaterials,
  normalizeSceneToHeight,
  DEFAULT_TARGET_HEIGHT_UNITS,
  type MaterialRealismOptions,
} from "./normalizeGltfScene";

/**
 * The React/@react-three/fiber layer of the preserved GLTF pipeline: a hook
 * that loads + normalizes a GLB, an error boundary that can actually catch a
 * Suspense rejection inside a `<Canvas>`, and a load-state controller that
 * wires up retry correctly. See ./index.ts for the module-level story.
 *
 * Everything here imports from `@react-three/drei/native` — see the long
 * explanation at the top of ./gltfSource.ts for why that subpath is
 * load-bearing and not a style preference.
 */

// ---------------------------------------------------------------------------
// Loading + normalizing
// ---------------------------------------------------------------------------

export interface UseNormalizedGltfOptions {
  /** Height in world units to scale the model to. Default 1.7. */
  targetHeight?: number;
  /**
   * Run the material conditioning pass (non-PBR -> MeshStandardMaterial,
   * skin-plausible roughness/metalness, cast/receive shadow). Default true.
   * Pass `false` for a GLB whose materials are already production-authored
   * and should be left exactly as exported.
   */
  materials?: false | MaterialRealismOptions;
}

/**
 * Loads a GLB and returns its scene graph, normalized to a consistent
 * size/pose and (by default) material-conditioned.
 *
 * SUSPENDS while loading and THROWS on failure — so callers must be inside
 * both a `<Suspense>` and a `<GltfErrorBoundary>`. `<GltfModel>` below does
 * that for you; use this hook directly only when you need the `THREE.Object3D`
 * to hand to something other than a bare `<primitive>` (for example, to pass
 * to `bodyModel.ts`'s `applyShapeToObject`).
 */
export function useNormalizedGltf(
  source: GltfSource,
  options: UseNormalizedGltfOptions = {}
): THREE.Object3D {
  const { targetHeight = DEFAULT_TARGET_HEIGHT_UNITS, materials = {} } = options;
  const { scene } = useGltfScene(source);

  // Keyed on the scene object itself, not on `source`: drei hands back the
  // same cached object for a given source, and normalization is idempotent
  // by design (see normalizeSceneToHeight step 1), so re-running against an
  // unchanged object is both cheap and safe.
  const normalized = useMemo(
    () => normalizeSceneToHeight(scene, targetHeight),
    [scene, targetHeight]
  );

  const materialOptions = materials === false ? null : materials;

  useEffect(() => {
    if (!materialOptions) return;
    applyRealisticMaterials(normalized, materialOptions);
    // Intentionally not depending on the options object identity: the pass is
    // idempotent per material and re-running it on every render of an inline
    // object literal would be pure waste.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalized]);

  return normalized;
}

export interface GltfModelProps extends UseNormalizedGltfOptions {
  source: GltfSource;
}

/**
 * Renders a loaded, normalized GLB into an R3F scene. Mount inside a
 * `<Suspense>` + `<GltfErrorBoundary>` pair — or just use `<GltfAsset>`,
 * which composes all three.
 */
export function GltfModel({ source, ...options }: GltfModelProps) {
  const normalized = useNormalizedGltf(source, options);
  return <primitive object={normalized} />;
}

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

interface GltfErrorBoundaryProps {
  onError: (error: unknown) => void;
  children: React.ReactNode;
}

/**
 * Catches a failed GLB load.
 *
 * Two non-obvious constraints are baked into this component:
 *
 *   1. React's error boundary API exists ONLY as a class component. There is
 *      no hook equivalent. That is why this is the one class in the module.
 *
 *   2. IT MUST BE MOUNTED INSIDE `<Canvas>`. @react-three/fiber renders its
 *      children through its own react-reconciler root, so an error boundary
 *      declared in the outer React Native tree is not guaranteed to catch a
 *      throw originating from a hook — like `useGLTF`, whose Suspense promise
 *      rejects — inside the Canvas subtree. Suspense and error boundaries are
 *      features of react-reconciler itself, so they behave identically inside
 *      R3F's tree; the catch is that anything rendered as a fallback in here
 *      must be valid three.js/R3F JSX, NOT React Native `<View>`s.
 *
 * Consequently this renders nothing into the 3D scene on error and reports
 * upward via `onError`. The actual human-facing error UI (Text, a Retry
 * button) belongs in plain RN views rendered as a SIBLING of `<Canvas>`, not
 * inside it. `useGltfLoadState` below is designed to drive exactly that.
 */
export class GltfErrorBoundary extends React.Component<
  GltfErrorBoundaryProps,
  { hasError: boolean }
> {
  constructor(props: GltfErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Load state + retry
// ---------------------------------------------------------------------------

export interface GltfLoadState {
  /** True while a load is in flight and no error has been reported. */
  loading: boolean;
  /** Human-readable failure message, or null. */
  error: string | null;
  /**
   * Pass as `key` to `<GltfErrorBoundary>` (or to `<GltfAsset>`). Changing it
   * is what forces the subtree calling `useGLTF` to remount after a retry.
   */
  retryKey: number;
  /** Hand to `<GltfErrorBoundary onError={...}>`. */
  onError: (error: unknown) => void;
  /** Wire to a Retry button rendered OUTSIDE `<Canvas>`. */
  retry: () => void;
}

/**
 * Owns the "is it loading / did it fail / let me try again" state for one GLB
 * source, so a screen doesn't have to re-derive the retry dance.
 *
 * THE RETRY DANCE, and why it is two steps rather than one:
 *
 *   1. `clearGltfCache(source)` — drei's `useGLTF` caches by path, and it
 *      caches REJECTED loads as well as successful ones. Skip this and the
 *      remount below instantly replays the cached rejection, so the Retry
 *      button looks broken even though it fired.
 *   2. bump `retryKey` — clearing the cache alone changes nothing on screen,
 *      because the component tree still holds the thrown state. The `key`
 *      change is what tears down and rebuilds the subtree so `useGLTF` runs
 *      again against a now-empty cache.
 *
 * `loading` comes from drei's `useProgress()`, which reports on three.js's
 * global `DefaultLoadingManager` — i.e. it is not scoped to this one source.
 * That is fine when a screen loads a single model, which is the intended
 * shape here; a screen loading several concurrently should track per-source
 * state itself rather than trusting this flag.
 */
export function useGltfLoadState(source: GltfSource): GltfLoadState {
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const { active } = useProgress();

  const onError = useCallback((caught: unknown) => {
    setError(
      caught instanceof Error ? caught.message : "The 3D model failed to load."
    );
  }, []);

  const retry = useCallback(() => {
    clearGltfCache(source);
    setError(null);
    setRetryKey((key) => key + 1);
  }, [source]);

  return { loading: active && !error, error, retryKey, onError, retry };
}

// ---------------------------------------------------------------------------
// Composed convenience
// ---------------------------------------------------------------------------

export interface GltfAssetProps extends GltfModelProps {
  /** From `useGltfLoadState`. */
  onError: (error: unknown) => void;
  /**
   * From `useGltfLoadState`. Applied as the boundary's `key`, which is what
   * makes retry remount the loading subtree.
   */
  retryKey: number;
  /**
   * Rendered next to the model inside the same boundary/Suspense — e.g. a
   * garment parented to the same group. Must be R3F JSX, not RN views.
   */
  children?: React.ReactNode;
}

/**
 * `<GltfErrorBoundary>` + `<Suspense>` + `<GltfModel>`, composed in the one
 * order that works. Drop this inside a `<Canvas>` and render the loading
 * spinner / error overlay / Retry button as plain RN views SIBLING to that
 * Canvas, driven by the same `useGltfLoadState` result.
 *
 *     const gltf = useGltfLoadState(AVATAR_SOURCE);
 *     // ...
 *     <Canvas>
 *       <GltfAsset source={AVATAR_SOURCE} retryKey={gltf.retryKey} onError={gltf.onError} />
 *     </Canvas>
 *     {gltf.loading && <ActivityIndicator />}
 *     {gltf.error && <Pressable onPress={gltf.retry}><Text>Retry</Text></Pressable>}
 *
 * The Suspense fallback is `null` on purpose: a fallback rendered here would
 * have to be R3F JSX, and "show nothing in the scene while loading, show the
 * spinner in the RN layer" is the behaviour that actually reads well.
 */
export function GltfAsset({
  source,
  onError,
  retryKey,
  children,
  ...options
}: GltfAssetProps) {
  return (
    <GltfErrorBoundary key={retryKey} onError={onError}>
      <Suspense fallback={null}>
        <GltfModel source={source} {...options} />
        {children}
      </Suspense>
    </GltfErrorBoundary>
  );
}
