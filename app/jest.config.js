/**
 * Jest configuration for the Selv app.
 *
 * Uses the `jest-expo` preset so the transform pipeline matches what Metro
 * actually ships: babel-preset-expo for TS/JSX, plus the transformIgnorePatterns
 * that let the RN/Expo packages (which publish untranspiled ESM) through Babel.
 *
 * Test convention: `__tests__/<module>.test.ts` colocated next to the module
 * under test. Everything currently covered is pure logic — no renderer, no
 * network — which is deliberate: those are the modules carrying revenue math
 * and body-proportion math, and they are testable without a device.
 *
 * `supabase/` is excluded outright. It holds Deno edge functions that import
 * from `https://` URLs and use Deno globals; Node/jest cannot run them and
 * should not try. tsconfig.json already excludes `supabase/functions` for the
 * same reason.
 */
module.exports = {
  preset: "jest-expo",

  testMatch: ["**/__tests__/**/*.test.ts?(x)"],

  testPathIgnorePatterns: [
    "<rootDir>/node_modules/",
    "<rootDir>/supabase/",
    "<rootDir>/.expo/",
    "<rootDir>/dist/",
  ],

  // Keep the Deno edge functions out of the module/haste map entirely, not
  // just out of test discovery.
  modulePathIgnorePatterns: ["<rootDir>/supabase/"],

  // Metro bundles .glb as an asset and hands back an id; Jest would otherwise
  // try to parse 13 MB of binary glTF as JavaScript.
  moduleNameMapper: {
    "\\.(glb|gltf)$": "<rootDir>/jest/assetStub.js",
  },

  // jest-expo's own allow-list, plus three's `examples/jsm` (ES modules only):
  // the avatar tests load the real .glb through the real GLTFLoader.
  transformIgnorePatterns: [
    "/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|three/examples/jsm))",
    "/node_modules/react-native-reanimated/plugin/",
  ],

  clearMocks: true,
};
