/**
 * The bundled human avatar asset.
 *
 * `require()` (not a URL) on purpose: Metro bundles the .glb with the app, so
 * the avatar works offline and never waits on a network fetch. The file is
 * generated - do not edit it by hand. Rebuild it with:
 *
 *   cd tools/avatar-build && python -m selv_avatar.build --out ../../app/assets/avatar/selv-human.glb
 *
 * See tools/avatar-build/README.md for where the source data comes from and
 * what licence it is under (CC0 1.0).
 */
import type { GltfSource } from "../gltf/gltfSource";

// eslint-disable-next-line @typescript-eslint/no-require-imports
export const HUMAN_AVATAR_SOURCE: GltfSource = require("../../../../assets/avatar/selv-human.glb");
