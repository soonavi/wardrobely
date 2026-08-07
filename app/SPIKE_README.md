# GLB / GLTF pipeline — deferred, but preserved

> **Status: nothing in the app renders a GLB today, on purpose.**
>
> This file used to document a live, reachable "Day 1 avatar render spike"
> screen. That screen is gone. The product pivoted to a **procedural**
> three.js character (`src/features/avatar3d/CharacterAvatar.tsx`) built
> entirely from primitives — no external asset to download, host, or rig.
>
> Real GLB assets are **deferred, not cancelled.** The loading machinery the
> spike proved out was extracted into
> **`src/features/avatar3d/gltf/`** and kept as working, typechecked code
> rather than as prose. If you are about to ship real 3D assets, start there
> — do not rebuild the pipeline.

## Where the pipeline lives now

| File | What |
|---|---|
| `src/features/avatar3d/gltf/index.ts` | Barrel + the module-level story: what's here, the four easy-to-get-wrong things, and a step-by-step "when a rig with morph targets arrives, do this". Read this first. |
| `src/features/avatar3d/gltf/gltfSource.ts` | `GltfSource` (a Metro `require()`d asset or a URL), `preloadGltf`, `clearGltfCache`, `useGltfScene`. Also carries the full explanation of why every import comes from `@react-three/drei/native`. |
| `src/features/avatar3d/gltf/normalizeGltfScene.ts` | Pure three.js: scale an arbitrary export to a consistent height with its feet on the floor, condition its materials, detect morph targets. No React, no R3F. |
| `src/features/avatar3d/gltf/GltfModel.tsx` | The React layer: `useNormalizedGltf`, `GltfModel`, `GltfErrorBoundary`, `useGltfLoadState` (loading/error/retry), and `GltfAsset` composing all of it in the one order that works. |
| `metro.config.js` | Registers `.glb`/`.gltf`/`.bin` as Metro asset extensions. Exists **for this pipeline** — keep it. It costs nothing while unused and is what makes the bundled-asset path a one-line change later. |

Nothing imports `gltf/` yet. It is still typechecked on every `tsc --noEmit`
run, because `tsconfig.json` includes `**/*.ts` / `**/*.tsx` rather than
tracing from an entrypoint.

## The gotchas this pipeline encodes

These are the things that cost real debugging time. Each one is also
commented at its call site in the module above.

- **Import from `@react-three/drei/native`, never `@react-three/drei`.**
  Two separate reasons. (1) drei's default entry re-exports a `web/` folder
  of DOM-dependent components — `Html` literally calls
  `document.createElement`, and there is no `document` in a React Native
  runtime. (2) More importantly, resolving through the native graph is what
  installs the loader polyfills: `@react-three/fiber/native` monkey-patches
  `THREE.FileLoader.prototype.load` and `THREE.TextureLoader.prototype.load`
  *as an import side effect* so they route through `expo-asset` /
  `expo-file-system` instead of the browser `fetch`/`XHR` path stock
  three.js assumes. Without those patches a `require()`d asset (an opaque
  numeric module id, not a URL) cannot be read at all. Same rule for
  `@react-three/fiber/native`.

- **Bundle the GLB with `require()` in production. Don't fetch a remote
  URL.** Remote HTTPS GLB loading is a genuinely fragile corner of the
  Expo + RN + three.js stack, not a theoretical risk — multiple upstream
  react-three-fiber issues report `useGLTF` failing against remote URLs on
  RN with "Unable to download file" and unhandled promise rejections, in
  ways the local `require()` path does not reproduce. A bundled asset also
  removes the network round trip and the "asset host went away / the URL
  rotated" failure mode. The previous iteration hardcoded a single
  CloudFront URL as the only source, with no local fallback, and the URL
  silently drifted out of sync with this document — that URL is deliberately
  **not** carried forward.

- **Retry needs a cache clear *and* a remount.** `useGLTF` caches by path,
  and it caches **rejected** loads as well as successful ones. Clearing
  alone changes nothing on screen; remounting alone replays the cached
  rejection instantly. `useGltfLoadState().retry` does both.

- **The error boundary must be mounted inside `<Canvas>`.**
  @react-three/fiber renders its children through its own react-reconciler
  root, so a boundary declared in the outer RN tree is not guaranteed to
  catch a throw from a hook (like `useGLTF`, via a rejected Suspense
  promise) inside the Canvas subtree. The catch: anything rendered inside
  that boundary must be valid R3F JSX, **not** RN `<View>`s — so the
  boundary renders nothing into the scene on error and reports upward, and
  the human-facing error UI lives in RN views *beside* the Canvas.

- **Normalization must reset the transform before measuring.** drei caches
  the scene object by path and hands the same object back on a remount or
  Fast Refresh; measuring without resetting first compounds the previous
  normalization instead of recomputing it. Same reasoning is why the
  material pass is guarded by a `userData` flag.

- **One instance at a time.** The normalization mutates drei's shared cached
  scene in place. If two instances of the same GLB ever need to be on screen
  simultaneously, clone per instance with three-stdlib's
  `SkeletonUtils.clone()` (not `Object3D.clone()` — it rebinds skinned
  meshes to the cloned skeleton).

- **Shape is already wired for real blendshapes.** `bodyModel.ts`'s
  `applyShapeToObject` prefers real morph targets and only falls back to a
  whole-mesh axis scale when a scene has none. It needs no changes when a
  rigged GLB lands — see the "when a rig arrives" section in
  `gltf/index.ts`.

## Runtime / build notes that still apply

- **You need a custom dev client, not Expo Go.** Expo Go bundles a fixed,
  pre-built set of native modules per SDK version, and you cannot change
  which `expo-gl` it runs — it's baked into the Expo Go binary. Any drift
  between the installed `expo-gl`/`expo-asset`/`expo-file-system` versions
  and Expo Go's reproduces the SDK-53-era version-mismatch failure on real
  devices. `expo-dev-client` compiles *these* exact native module versions
  into a build of *this* app, so what you test is what you get.

  ```sh
  npx expo run:ios      # or run:android — one native build
  npx expo start --dev-client   # then iterate normally
  ```

- **Test on a physical device, not just a simulator.** Multiple upstream
  react-three-fiber/Expo issues report `EXC_BAD_ACCESS` crashes and
  unreliable rendering under iOS Simulator's OpenGL ES emulation. A real
  iPhone is the only reliable signal for anything GL-related.

- **Native module versions are pinned to the SDK-54 bundled set** —
  `expo-gl ~16.0.10`, `expo-asset ~12.0.13`, `expo-file-system ~19.0.23` —
  not "whatever is newest on npm". `expo-asset` and `expo-file-system` are
  real `dependencies` even though no application file imports them
  directly: the R3F native polyfills described above use them internally.

- **`expo-three` is deliberately NOT a dependency.** R3F's native `<Canvas>`
  already creates and owns the expo-gl context and its own
  GLTFLoader/FileLoader polyfills; `expo-three`'s lower-level
  `Renderer`/`loadAsync` helpers predate R3F native support and aren't
  needed once R3F owns the render loop. It is also effectively unmaintained
  and peer-locks `three` to `^0.166.0`, which conflicts with this project's
  `three@^0.180.0`.

- **Gestures run on the JS thread** in the surviving 3D screens
  (`.runOnJS(true)` on pan/pinch), which lets the callbacks mutate plain
  refs directly instead of needing Reanimated shared values — simpler to
  reason about, at some cost to drag smoothness. Worth revisiting only if a
  perf pass says so.
