import * as THREE from "three";

/**
 * ============================================================================
 * garmentTexture — loads a garment's real product photo as a THREE.Texture,
 * ref-counted and cached by URL, for CharacterAvatar's garment decals.
 *
 * WHY THIS FILE EXISTS SEPARATELY
 * `garmentVisual.ts` is deliberately pure (no three.js, no network, no
 * Supabase) so it can be reasoned about and smoke-tested in isolation. It only
 * decides *which* URL represents a garment. Actually pulling those bytes onto
 * the GPU is stateful, asynchronous, and platform-specific — so it lives here.
 *
 * HOW TEXTURE LOADING WORKS IN THIS RUNTIME (important, and non-obvious)
 * There is no DOM `Image` in React Native, so three's stock `TextureLoader`
 * (which is an `ImageLoader` wrapper) cannot work as-is. We do NOT ship
 * `expo-three`. What makes this work is that **`@react-three/fiber/native`
 * monkey-patches `THREE.TextureLoader.prototype.load` at import time**
 * (see node_modules/@react-three/fiber/native/dist — the `polyfills()` call at
 * the bottom of that bundle, guarded by `Platform.OS !== 'web'`). The patched
 * loader:
 *   1. runs the url through `expo-asset`'s `Asset.fromModule(url).downloadAsync()`,
 *      which downloads a **remote https url** into the app's cache directory,
 *   2. reads its pixel dimensions with React Native's `Image.getSize`,
 *   3. parks `{ data: { localUri }, width, height }` on `texture.image` and
 *      sets `texture.isDataTexture = true`, which is the handshake that makes
 *      expo-gl's native `texImage2D` load the file itself instead of looking
 *      for a DOM element.
 * So remote CDN urls DO load here — but only because r3f/native has been
 * imported somewhere first. CharacterAvatar.tsx imports `useFrame` from
 * `@react-three/fiber/native` at its top, and it is the only consumer of this
 * module, so the patch is always installed long before anything below runs.
 * If this module is ever reused from a file that does not (transitively)
 * import `@react-three/fiber/native`, loading will fail on device — and it
 * will fail *silently into the colour tint*, which is very hard to spot. Keep
 * that dependency in mind rather than assuming the web code path.
 *
 * Two consequences of that native path that shape the code below:
 *   * The polyfill never sets `colorSpace`, so we must — otherwise an sRGB
 *     product photo renders visibly washed out under the studio lighting.
 *   * The decoded bytes live in native memory behind a `localUri`; JS never
 *     sees pixels. There is therefore **no way to resample an oversized
 *     partner image** without adding an image-manipulation dependency. See
 *     the texture-budget notes on `HARD_MAX_TEXTURE_DIMENSION`.
 *
 * CACHING / LIFETIME
 * A user equips and unequips the same product repeatedly while styling, and
 * re-downloading + re-uploading a 1MB PNG on every tap stutters. So textures
 * are cached by url and **ref-counted**: `acquireGarmentTexture` takes a
 * reference, `releaseGarmentTexture` gives it back. A texture with zero
 * references is not disposed immediately — it goes to the back of a small LRU
 * of idle entries so the next equip is instant — but it IS disposed once that
 * LRU overflows, because PRODUCT_SPEC §9 names GPU/texture memory on
 * mid-range Android as a live crash risk and an unbounded cache is exactly
 * how that risk lands.
 * ============================================================================
 */

/** A loaded garment photo plus the metadata the UV projection needs. */
export interface LoadedGarmentTexture {
  texture: THREE.Texture;
  /** `width / height` of the decoded image, used to letterbox rather than stretch it. */
  aspect: number;
}

/**
 * How many zero-reference textures stay resident before the oldest is
 * disposed. Sized for "the user is cycling through a few candidate garments" —
 * three slots plus a handful of recently-tried items — not for a whole
 * wardrobe. Each entry is worth up to ~16MB of GPU memory at the 2K budget, so
 * this is deliberately small.
 */
const MAX_IDLE_TEXTURES = 8;

/**
 * A dead partner CDN doesn't 404, it hangs. Without this the promise never
 * settles, the entry keeps its reference forever, and the decal stays
 * invisible with no explanation. Fifteen seconds is well past a normal mobile
 * fetch and well short of the user giving up.
 */
const LOAD_TIMEOUT_MS = 15_000;

/**
 * PRODUCT_SPEC §9's stated budget. We cannot enforce it by downscaling — see
 * the header note about pixels living in native memory — so this is a warning
 * threshold only, to make an over-budget partner feed visible in the logs
 * rather than as a mystery frame-rate drop.
 */
const BUDGET_TEXTURE_DIMENSION = 2048;

/**
 * A hard refusal, one step above the budget. GL_MAX_TEXTURE_SIZE is 4096 on a
 * meaningful share of mid-range Android GPUs; uploading past it doesn't throw,
 * it produces a black texture or drops the context. Falling back to the colour
 * tint is strictly better than either.
 */
const HARD_MAX_TEXTURE_DIMENSION = 4096;

interface CacheEntry {
  url: string;
  /** Live holders. Never evicted while > 0. */
  refs: number;
  promise: Promise<LoadedGarmentTexture | null>;
  /** Settled result, or null while in flight / after a failure. */
  loaded: LoadedGarmentTexture | null;
  /** True once the load resolved to nothing, so `release` can drop the entry and let a later attempt retry. */
  failed: boolean;
  /** Set by `disposeEntry` so a late-arriving load disposes itself instead of resurrecting a freed entry. */
  disposed: boolean;
}

const cache = new Map<string, CacheEntry>();

/** URLs with `refs === 0`, oldest first. Eviction order. */
const idle: string[] = [];

/**
 * One shared loader. Stateless apart from `path`/`crossOrigin` (neither of
 * which we set), and constructing one per call would allocate for nothing.
 */
const loader = new THREE.TextureLoader();

/** Only http(s) urls are loadable here — a storage *path* needs signing first, which is the caller's job. */
function isLoadableUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/**
 * Pull `{width, height}` off whatever `texture.image` turned out to be.
 * `Texture['image']` is `any` in @types/three, and the two runtimes put
 * genuinely different objects there (the r3f/native shim's
 * `{data, width, height}` on device, an `HTMLImageElement` on web), so this
 * narrows structurally instead of trusting either shape.
 */
function imageDimensions(image: unknown): { width: number; height: number } | null {
  if (typeof image !== "object" || image === null) return null;
  const candidate = image as { width?: unknown; height?: unknown };
  const width = typeof candidate.width === "number" ? candidate.width : 0;
  const height = typeof candidate.height === "number" ? candidate.height : 0;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

/**
 * Settings that have to be right before the first GPU upload.
 *
 * `colorSpace` is the one that visibly breaks if forgotten: the r3f/native
 * shim leaves it at the default (no-conversion) value, and an sRGB photo
 * sampled as linear renders pale and chalky next to the character's other
 * materials.
 *
 * Mipmaps are off on purpose. Product photos are arbitrary sizes, and a
 * non-power-of-two texture cannot be mipmapped on the GLES2 path expo-gl may
 * hand us; three would silently fall back and warn. Skipping them also saves
 * a third of the texture memory, which matters more here than the small
 * minification-quality win — the decal is rendered at roughly screen size.
 */
function configureTexture(texture: THREE.Texture): void {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.anisotropy = 1;
  texture.needsUpdate = true;
}

/**
 * The raw load. **Never rejects** — every failure path (bad url, offline, 404,
 * dead CDN, undecodable bytes, over-budget dimensions, timeout) resolves to
 * `null`, which callers read as "render the colour tint". A rejected promise
 * here would surface as a red screen over the canvas, and the whole point of
 * this feature is that a missing partner image is a cosmetic downgrade rather
 * than a broken try-on.
 */
function loadTexture(url: string): Promise<LoadedGarmentTexture | null> {
  return new Promise<LoadedGarmentTexture | null>((resolve) => {
    let settled = false;

    /**
     * Guards the double-settle the timeout makes possible: if the CDN answers
     * *after* we gave up, the texture it hands us has no owner, so dispose it
     * here rather than leaking a GPU allocation nobody will ever release.
     */
    const finish = (value: LoadedGarmentTexture | null): void => {
      if (settled) {
        value?.texture.dispose();
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const timer: ReturnType<typeof setTimeout> = setTimeout(
      () => finish(null),
      LOAD_TIMEOUT_MS
    );

    if (!isLoadableUrl(url)) {
      finish(null);
      return;
    }

    try {
      loader.load(
        url,
        (texture) => {
          const dimensions = imageDimensions(texture.image);
          if (!dimensions) {
            texture.dispose();
            finish(null);
            return;
          }

          const largest = Math.max(dimensions.width, dimensions.height);
          if (largest > HARD_MAX_TEXTURE_DIMENSION) {
            console.warn(
              `[garmentTexture] refusing ${largest}px texture (max ${HARD_MAX_TEXTURE_DIMENSION}px): ${url}`
            );
            texture.dispose();
            finish(null);
            return;
          }
          if (largest > BUDGET_TEXTURE_DIMENSION) {
            console.warn(
              `[garmentTexture] ${largest}px texture exceeds the ${BUDGET_TEXTURE_DIMENSION}px budget and cannot be downscaled on-device: ${url}`
            );
          }

          configureTexture(texture);
          finish({ texture, aspect: dimensions.width / dimensions.height });
        },
        undefined,
        () => finish(null)
      );
    } catch {
      // `TextureLoader.load` is not supposed to throw synchronously, but the
      // native shim does real work (expo-asset, file system) on the way in.
      finish(null);
    }
  });
}

function removeFromIdle(url: string): void {
  const index = idle.indexOf(url);
  if (index !== -1) idle.splice(index, 1);
}

/** Free an entry's GPU texture and forget it. Safe to call on an in-flight entry — the `disposed` flag catches the late resolution. */
function disposeEntry(entry: CacheEntry): void {
  entry.disposed = true;
  entry.loaded?.texture.dispose();
  entry.loaded = null;
  removeFromIdle(entry.url);
  if (cache.get(entry.url) === entry) cache.delete(entry.url);
}

function evictIdle(): void {
  while (idle.length > MAX_IDLE_TEXTURES) {
    const url = idle[0];
    const entry = cache.get(url);
    if (!entry) {
      idle.shift();
      continue;
    }
    disposeEntry(entry);
  }
}

/**
 * Take a reference on the texture for `url`, loading it if this is the first
 * caller. Resolves to `null` on any failure — see `loadTexture`.
 *
 * **The reference is taken synchronously**, before the promise is returned, so
 * a caller that acquires and then unmounts before the download finishes still
 * has a matching `releaseGarmentTexture` to make. Every `acquire` must be
 * paired with exactly one `release`, including when the result was `null`.
 */
export function acquireGarmentTexture(
  url: string
): Promise<LoadedGarmentTexture | null> {
  const existing = cache.get(url);
  if (existing) {
    existing.refs += 1;
    removeFromIdle(url);
    return existing.promise;
  }

  const entry: CacheEntry = {
    url,
    refs: 1,
    // Replaced immediately below; `promise` is non-optional so the entry is
    // never observable in a half-built state.
    promise: Promise.resolve(null),
    loaded: null,
    failed: false,
    disposed: false,
  };

  entry.promise = loadTexture(url).then((result) => {
    if (entry.disposed) {
      // Released and evicted while in flight — nothing is going to render
      // this, so hand back the GPU memory now.
      result?.texture.dispose();
      return null;
    }
    if (!result) {
      entry.failed = true;
      // A zero-reference failure is dropped rather than cached, so coming back
      // online (or the partner fixing their CDN) is enough to retry. While
      // references are still held we keep the entry so concurrent callers
      // share the one failed attempt instead of stampeding a dead host.
      if (entry.refs === 0) disposeEntry(entry);
      return null;
    }
    entry.loaded = result;
    return result;
  });

  cache.set(url, entry);
  return entry.promise;
}

/**
 * Give back a reference taken by `acquireGarmentTexture`. On the last release
 * the texture becomes evictable but is kept resident until the idle LRU
 * overflows, so re-equipping the garment the user just took off is instant.
 */
export function releaseGarmentTexture(url: string): void {
  const entry = cache.get(url);
  if (!entry) return;

  entry.refs = Math.max(0, entry.refs - 1);
  if (entry.refs > 0) return;

  if (entry.failed) {
    disposeEntry(entry);
    return;
  }

  removeFromIdle(url);
  idle.push(url);
  evictIdle();
}

/**
 * Drop the entire cache, disposing every texture including ones still
 * referenced. For teardown paths that are tearing down the GL context anyway
 * (a hard sign-out, a dev reload); not part of the normal equip/unequip cycle,
 * which should use `releaseGarmentTexture`.
 */
export function disposeAllGarmentTextures(): void {
  for (const entry of Array.from(cache.values())) {
    disposeEntry(entry);
  }
  cache.clear();
  idle.length = 0;
}

/** Resident entry count (referenced + idle). Exposed for diagnostics and tests, not for control flow. */
export function garmentTextureCacheSize(): number {
  return cache.size;
}
