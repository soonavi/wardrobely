import React from "react";
import { Text, View } from "react-native";
import { colors, fonts } from "../lib/theme";

type WordmarkProps = {
  /** Font size of the wordmark (px). Default 28. */
  size?: number;
  /** Wordmark text color. Defaults to colors.ink. */
  color?: string;
  /** Reflection color. Defaults to deep lavender. */
  reflectionColor?: string;
  /** Show the mirrored reflection beneath the wordmark. Default true. */
  reflection?: boolean;
  /** @deprecated kept for backward-compat; the reflection logo has no square mark. */
  markColor?: string;
};

/**
 * The Selv "Reflection" wordmark (the brand's chosen logo): lowercase "selv"
 * in the display font, with a faded, vertically mirrored copy beneath it — a
 * digital reflection of yourself (no divider line; the fade does the work).
 * Pass `reflection={false}` in very tight spaces to render just the wordmark.
 */
export function Wordmark({
  size = 28,
  color = colors.ink,
  reflectionColor = colors.accent,
  reflection = true,
}: WordmarkProps) {
  const base = {
    fontFamily: fonts.display,
    fontSize: size,
    lineHeight: size * 0.92,
    letterSpacing: -size * 0.045,
  } as const;

  return (
    <View style={{ alignItems: "center" }}>
      <Text allowFontScaling={false} style={[base, { color }]}>
        selv
      </Text>
      {reflection ? (
        <Text
          allowFontScaling={false}
          style={[
            base,
            {
              color: reflectionColor,
              opacity: 0.26,
              marginTop: size * 0.06,
              transform: [{ scaleY: -1 }],
            },
          ]}
        >
          selv
        </Text>
      ) : null}
    </View>
  );
}

export default Wordmark;
