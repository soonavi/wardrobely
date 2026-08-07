// Metro bundler config.
//
// The one non-default line here registers .glb/.gltf/.bin as Metro ASSET
// extensions rather than source files. It exists for the preserved GLB
// loading pipeline in src/features/avatar3d/gltf/ (see that folder's
// index.ts, and SPIKE_README.md at the app root).
//
// Why it stays even though nothing loads a GLB today: @react-three/drei's
// useGLTF can take either a remote https URL or a require()'d local asset,
// and the documented production path is the local require() — which needs
// Metro to treat these binary extensions as assets instead of trying to
// parse them as JavaScript. Keeping it configured means dropping a real
// avatar .glb into assets/ later is a one-line change with no build-config
// surprises. It costs nothing while unused.
//
// This otherwise matches Expo's default Metro config untouched, so it does
// not affect any existing screen or asset in the app.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push("glb", "gltf", "bin");

module.exports = config;
