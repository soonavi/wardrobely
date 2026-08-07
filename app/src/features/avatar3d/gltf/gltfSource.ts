import { useGLTF } from "@react-three/drei/native";

/**
 * GLB/GLTF asset sourcing — the "where does the model come from" half of the
 * preserved GLTF pipeline. See ./index.ts for the module-level story.
 *
 * ---------------------------------------------------------------------------
 * WHY `@react-three/drei/native` AND NOT `@react-three/drei`
 * ---------------------------------------------------------------------------
 * This is the single most important non-obvious thing in this module, and it
 * is why every file here imports from the `/native` subpath:
 *
 *   1. drei's default entry (`@react-three/drei`) re-exports a `web/` folder
 *      of DOM-dependent components — `Html`, `Loader`, `ScrollControls`,
 *      `DragControls`, `useCursor`, `View`, and friends. `web/Html.js` calls
 *      `document.createElement(...)` at render time. There is no `document`
 *      in a React Native runtime, so pulling in the web entry drags DOM-only
 *      code into a bundle that cannot run it. `@react-three/drei/native`
 *      re-exports the same `core/` components with the `web/` folder omitted.
 *      (drei also declares a `react-native` field pointing at
 *      `native/index.cjs.js`, so Metro usually picks the right one anyway —
 *      but the explicit `/native` subpath makes it true for every bundler and
 *      for anyone reading the import.)
 *
 *   2. Far more importantly, resolving through the native graph is what
 *      installs the loader polyfills. `@react-three/fiber/native` monkey-
 *      patches `THREE.FileLoader.prototype.load` and
 *      `THREE.TextureLoader.prototype.load` *as an import side effect*, so
 *      that they route through `expo-asset` (`Asset.fromModule(...)` /
 *      `downloadAsync()`) and `expo-file-system` instead of the browser
 *      `fetch`/`XMLHttpRequest` path stock three.js assumes. Without those
 *      patches, `GLTFLoader` cannot read a Metro-bundled asset at all (a
 *      `require()`d asset is an opaque numeric module id, not a URL) and
 *      remote URL loading is unreliable. This is also why `expo-asset` and
 *      `expo-file-system` are real `dependencies` in package.json even
 *      though no application file imports them directly.
 *
 * The practical rule: import `Canvas`/`useFrame`/`useThree` from
 * `@react-three/fiber/native` and `useGLTF`/`useProgress`/`ContactShadows`
 * from `@react-three/drei/native`. Never from the bare package names.
 *
 * (Note: `expo-three` is NOT needed and is not a dependency. R3F's native
 * `<Canvas>` already creates and owns the expo-gl WebGL context and wires up
 * the polyfills above; `expo-three`'s lower-level `Renderer`/`loadAsync`
 * helpers predate R3F native support, and its package peer-locks `three` to
 * `^0.166.0`, which conflicts with this project's `three@^0.180.0`.)
 */

/**
 * A GLB/GLTF this pipeline can load.
 *
 *   - `number` — a Metro-bundled local asset, i.e. the value returned by
 *     `require("../../../assets/avatar/base-avatar.glb")`. Under Metro a
 *     `require()`d binary asset evaluates to an opaque numeric module id,
 *     which the `expo-asset` polyfill described above resolves to a real
 *     local file URI. **This is the recommended production path.**
 *   - `string` — a remote `https://` URL. Supported, but see
 *     `REMOTE_URL_CAVEAT` below before choosing it.
 *
 * PREFER THE BUNDLED `require()` FORM IN PRODUCTION. A bundled asset removes
 * the network round trip, the cold-start latency, and the entire "asset host
 * is unreachable / the URL rotated" failure mode. `metro.config.js` at the
 * app root already registers `glb`/`gltf`/`bin` as Metro asset extensions
 * precisely so this path needs no further build configuration — that config
 * exists *for this module*, keep it.
 */
export type GltfSource = number | string;

/**
 * Remote GLB loading over HTTPS is a genuinely fragile corner of the
 * Expo + React Native + three.js stack, not a theoretical risk. Multiple
 * upstream react-three-fiber issues report `useGLTF` failing against remote
 * URLs on RN with "Unable to download file" errors and unhandled promise
 * rejections, in ways the well-trodden local `require()`-asset path does not
 * reproduce. That is the reason this module ships a real error boundary and
 * a retry path (see ./GltfModel.tsx) rather than assuming loads succeed.
 *
 * If a remote URL proves unreliable in testing, the fix is to bundle the
 * asset locally — not to rewrite the loading logic.
 *
 * Deliberately no default/fallback URL is exported from this module. An
 * earlier iteration hardcoded a single CloudFront URL as the only source,
 * which was a single point of failure with no local fallback, and the URL
 * drifted out of sync with the docs that described it. If you need an
 * example of the remote shape, it looked like:
 *
 *     const AVATAR_GLB_URL =
 *       "https://<host>/<uuid>/<uuid>.glb";
 *
 * Pass whatever source you need in explicitly instead.
 */
export const REMOTE_URL_CAVEAT =
  "Remote GLB loading over HTTPS is unreliable on React Native; prefer a Metro-bundled require() asset.";

/**
 * drei types `useGLTF`'s path as `string | string[]`, because on the web a
 * model is always a URL. On React Native the `require()`d-asset form is a
 * `number` and is handled by the `expo-asset` polyfill described at the top
 * of this file — the runtime supports it, the published types just don't
 * describe it. This is the one place that mismatch is bridged, so no caller
 * has to repeat the cast.
 */
function toDreiPath(source: GltfSource): string {
  return source as unknown as string;
}

/**
 * Starts fetching/decoding a GLB before anything renders it.
 *
 * Call this at MODULE SCOPE in whatever screen owns the model (i.e. it runs
 * as soon as the route's module is evaluated, which for a lazily-loaded
 * route is when the user navigates to it) rather than in an effect — the
 * point is to overlap the fetch with React's mount work instead of starting
 * it on first render.
 *
 * Safe to call more than once for the same source: drei caches by path, so
 * repeat calls are cheap no-ops.
 */
export function preloadGltf(source: GltfSource): void {
  useGLTF.preload(toDreiPath(source));
}

/**
 * Evicts a source from drei's load cache.
 *
 * THIS IS WHAT MAKES RETRY WORK, and it is not optional. `useGLTF` caches by
 * path — and it caches REJECTED loads too, not just successful ones. Without
 * clearing first, remounting the subtree that calls `useGLTF` just replays
 * the cached rejection instantly and the retry button appears broken. So a
 * retry is always two steps: clear the cache entry, *then* force a remount
 * (see `useGltfLoadState().retry` in ./GltfModel.tsx, which does both).
 */
export function clearGltfCache(source: GltfSource): void {
  useGLTF.clear(toDreiPath(source));
}

/**
 * Loads a GLB and returns its raw scene graph, unnormalized.
 *
 * This suspends (it throws a promise) until the model resolves, and throws a
 * real error if the load fails — so every caller must sit inside BOTH a
 * `<Suspense>` and an error boundary. Prefer `<GltfModel>` from
 * ./GltfModel.tsx, which wires both up correctly; reach for this hook
 * directly only when you need the untouched scene.
 *
 * The returned object is drei's SHARED, CACHED scene for this source. It is
 * not cloned per caller — see `normalizeSceneToHeight`'s note in
 * ./normalizeGltfScene.ts about mutating it, and about
 * `SkeletonUtils.clone()` if two instances ever need to be on screen at once.
 */
export function useGltfScene(source: GltfSource) {
  return useGLTF(toDreiPath(source));
}
