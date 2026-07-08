module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // Note: no manual reanimated plugin here. Reanimated 4 uses
    // react-native-worklets, whose babel plugin babel-preset-expo (SDK 54)
    // configures automatically. Listing the old
    // "react-native-reanimated/plugin" would break the build.
  };
};
