import React from "react";
import Svg, { Ellipse, G, Path } from "react-native-svg";
import type { Build, GarmentCategory } from "../../lib/database.types";
import { colors } from "../../lib/theme";

const VIEWBOX_WIDTH = 300;
const VIEWBOX_HEIGHT = 600;
const SILHOUETTE_COLOR = colors.silhouette;
const SILHOUETTE_STROKE = colors.silhouetteStroke;

export interface AvatarSvgProps {
  build: Build;
  /**
   * Horizontal scale factor derived from the user's height/weight
   * (see buildWidthScale). 1 = the silhouette's neutral proportions.
   */
  widthScale?: number;
  width?: number;
  height?: number;
}

/**
 * Derive a subtle horizontal scale from height/weight (BMI relative to a
 * neutral 22), clamped so the silhouette always stays recognizable.
 * Returns 1 when either value is missing.
 */
export function buildWidthScale(
  heightCm: number | null | undefined,
  weightKg: number | null | undefined
): number {
  if (!heightCm || !weightKg) return 1;
  const bmi = weightKg / Math.pow(heightCm / 100, 2);
  return Math.min(Math.max(Math.sqrt(bmi / 22), 0.85), 1.25);
}

/** Per-build base narrowing/widening applied on top of widthScale. */
const BUILD_X_SCALE: Record<Build, number> = {
  slim: 0.88,
  average: 1,
  athletic: 1,
  curvy: 1,
  broad: 1.04,
};

/**
 * Default placement (viewBox coordinates, center point + relative scale)
 * for each garment category, used to position a newly-added try-on layer
 * before the user drags/pinches it into place.
 */
export const ANCHOR_ZONES: Record<
  GarmentCategory,
  { x: number; y: number; scale: number }
> = {
  top: { x: 150, y: 180, scale: 1 },
  bottom: { x: 150, y: 400, scale: 1 },
  dress: { x: 150, y: 300, scale: 1.15 },
  outerwear: { x: 150, y: 180, scale: 1.2 },
  shoes: { x: 150, y: 560, scale: 0.6 },
  accessory: { x: 150, y: 95, scale: 0.5 },
};

/**
 * Renders a warm-taupe silhouette for the given build on a 300x600
 * viewBox, horizontally scaled around the center by the build's base
 * factor × the height/weight-derived widthScale.
 */
export function AvatarSvg({
  build,
  widthScale = 1,
  width = 150,
  height = 300,
}: AvatarSvgProps) {
  const s = BUILD_X_SCALE[build] * widthScale;
  return (
    <Svg
      width={width}
      height={height}
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
    >
      <G transform={`translate(${(VIEWBOX_WIDTH / 2) * (1 - s)},0) scale(${s},1)`}>
        {renderBody(build)}
      </G>
    </Svg>
  );
}

function renderBody(build: Build) {
  switch (build) {
    case "slim":
      return <RectangleBody />;
    case "average":
      return <AppleBody />;
    case "athletic":
      return <AthleticBody />;
    case "curvy":
      return <HourglassBody />;
    case "broad":
      return <InvertedTriangleBody />;
    default:
      return <RectangleBody />;
  }
}

/** Head + neck shared by all silhouettes. */
function HeadAndNeck() {
  return (
    <>
      <Ellipse
        cx={150}
        cy={48}
        rx={34}
        ry={38}
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      <Path
        d="M 132 86 L 132 104 L 168 104 L 168 86 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
    </>
  );
}

/** Rectangle: straight torso, shoulders ~= hips, minimal waist taper. */
function RectangleBody() {
  return (
    <>
      <HeadAndNeck />
      <Path
        d="
          M 105 104
          Q 150 95 195 104
          L 205 198
          Q 208 241 200 298
          L 194 320
          Q 150 327 106 320
          L 100 298
          Q 92 241 95 198
          Z
        "
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      {/* Arms */}
      <Path
        d="M 105 111 Q 85 251 88 438 L 100 443 Q 98 263 115 123 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      <Path
        d="M 195 111 Q 215 251 212 438 L 200 443 Q 202 263 185 123 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      {/* Legs */}
      <Path
        d="M 106 320 L 100 585 L 130 585 L 140 323 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      <Path
        d="M 194 320 L 200 585 L 170 585 L 160 323 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
    </>
  );
}

/** Hourglass: defined shoulders and hips of similar width, cinched waist. */
function HourglassBody() {
  return (
    <>
      <HeadAndNeck />
      <Path
        d="
          M 100 104
          Q 150 94 200 104
          L 208 169
          Q 165 198 165 212
          Q 165 226 210 262
          Q 214 291 200 316
          L 194 320
          Q 150 329 106 320
          L 100 316
          Q 86 291 90 262
          Q 135 226 135 212
          Q 135 198 92 169
          Z
        "
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      {/* Arms */}
      <Path
        d="M 100 111 Q 80 251 84 438 L 96 443 Q 93 263 110 123 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      <Path
        d="M 200 111 Q 220 251 216 438 L 204 443 Q 207 263 190 123 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      {/* Legs */}
      <Path
        d="M 106 320 L 100 585 L 130 585 L 140 323 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      <Path
        d="M 194 320 L 200 585 L 170 585 L 160 323 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
    </>
  );
}

/** Apple: fuller midsection, narrower hips, slimmer legs. */
function AppleBody() {
  return (
    <>
      <HeadAndNeck />
      <Path
        d="
          M 108 104
          Q 150 95 192 104
          Q 222 154 218 212
          Q 214 255 198 298
          L 192 319
          Q 150 327 108 319
          L 102 298
          Q 86 255 82 212
          Q 78 154 108 104
          Z
        "
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      {/* Arms */}
      <Path
        d="M 108 123 Q 88 263 92 450 L 104 452 Q 100 275 118 134 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      <Path
        d="M 192 123 Q 212 263 208 450 L 196 452 Q 200 275 182 134 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      {/* Legs (slimmer) */}
      <Path
        d="M 112 317 L 104 585 L 128 585 L 136 320 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      <Path
        d="M 188 317 L 196 585 L 172 585 L 164 320 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
    </>
  );
}

/** Inverted triangle: broad shoulders tapering to narrow hips. */
function InvertedTriangleBody() {
  return (
    <>
      <HeadAndNeck />
      <Path
        d="
          M 90 104
          Q 150 91 210 104
          L 200 183
          Q 175 255 168 316
          L 160 320
          Q 150 323 140 320
          L 132 316
          Q 125 255 100 183
          Z
        "
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      {/* Arms */}
      <Path
        d="M 92 111 Q 68 239 74 426 L 88 431 Q 84 251 102 123 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      <Path
        d="M 208 111 Q 232 239 226 426 L 212 431 Q 216 251 198 123 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      {/* Legs (narrow) */}
      <Path
        d="M 140 320 L 130 585 L 152 585 L 150 323 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      <Path
        d="M 160 320 L 170 585 L 148 585 L 150 323 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
    </>
  );
}

/** Athletic: broad-ish shoulders, defined waist, muscular straight legs. */
function AthleticBody() {
  return (
    <>
      <HeadAndNeck />
      <Path
        d="
          M 98 104
          Q 150 94 202 104
          L 208 169
          Q 190 190 190 212
          Q 190 230 200 255
          L 195 319
          Q 150 327 105 319
          L 100 255
          Q 110 230 110 212
          Q 110 190 92 169
          Z
        "
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      {/* Arms (defined) */}
      <Path
        d="M 98 111 Q 76 239 82 433 L 96 438 Q 92 263 108 123 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      <Path
        d="M 202 111 Q 224 239 218 433 L 204 438 Q 208 263 192 123 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      {/* Legs (toned, straighter) */}
      <Path
        d="M 108 317 L 102 585 L 132 585 L 140 320 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      <Path
        d="M 192 317 L 198 585 L 168 585 L 160 320 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
    </>
  );
}
