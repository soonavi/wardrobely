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
  top: { x: 150, y: 210, scale: 1 },
  bottom: { x: 150, y: 400, scale: 1 },
  dress: { x: 150, y: 320, scale: 1.15 },
  outerwear: { x: 150, y: 210, scale: 1.2 },
  shoes: { x: 150, y: 555, scale: 0.6 },
  accessory: { x: 150, y: 90, scale: 0.5 },
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
        cy={55}
        rx={38}
        ry={45}
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      <Path
        d="M 132 92 L 132 125 L 168 125 L 168 92 Z"
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
          M 105 130
          Q 150 118 195 130
          L 205 260
          Q 208 320 200 400
          L 194 430
          Q 150 440 106 430
          L 100 400
          Q 92 320 95 260
          Z
        "
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      {/* Arms */}
      <Path
        d="M 105 140 Q 85 200 88 280 L 100 282 Q 98 205 115 145 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      <Path
        d="M 195 140 Q 215 200 212 280 L 200 282 Q 202 205 185 145 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      {/* Legs */}
      <Path
        d="M 106 430 L 100 585 L 130 585 L 140 432 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      <Path
        d="M 194 430 L 200 585 L 170 585 L 160 432 Z"
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
          M 100 130
          Q 150 116 200 130
          L 208 220
          Q 165 260 165 280
          Q 165 300 210 350
          Q 214 390 200 425
          L 194 430
          Q 150 442 106 430
          L 100 425
          Q 86 390 90 350
          Q 135 300 135 280
          Q 135 260 92 220
          Z
        "
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      {/* Arms */}
      <Path
        d="M 100 140 Q 80 200 84 280 L 96 282 Q 93 205 110 145 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      <Path
        d="M 200 140 Q 220 200 216 280 L 204 282 Q 207 205 190 145 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      {/* Legs */}
      <Path
        d="M 106 430 L 100 585 L 130 585 L 140 432 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      <Path
        d="M 194 430 L 200 585 L 170 585 L 160 432 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
    </>
  );
}

/** Pear: narrower shoulders, wider hips/thighs. */
function PearBody() {
  return (
    <>
      <HeadAndNeck />
      <Path
        d="
          M 115 130
          Q 150 120 185 130
          L 190 220
          Q 200 260 218 340
          Q 224 390 210 425
          L 200 430
          Q 150 445 100 430
          L 90 425
          Q 76 390 82 340
          Q 100 260 110 220
          Z
        "
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      {/* Arms */}
      <Path
        d="M 112 140 Q 95 195 98 275 L 110 277 Q 106 200 122 145 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      <Path
        d="M 188 140 Q 205 195 202 275 L 190 277 Q 194 200 178 145 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      {/* Legs */}
      <Path
        d="M 100 430 L 96 585 L 128 585 L 138 432 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      <Path
        d="M 200 430 L 204 585 L 172 585 L 162 432 Z"
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
          M 108 130
          Q 150 118 192 130
          Q 222 200 218 280
          Q 214 340 198 400
          L 192 428
          Q 150 440 108 428
          L 102 400
          Q 86 340 82 280
          Q 78 200 108 130
          Z
        "
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      {/* Arms */}
      <Path
        d="M 108 145 Q 88 205 92 285 L 104 286 Q 100 210 118 150 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      <Path
        d="M 192 145 Q 212 205 208 285 L 196 286 Q 200 210 182 150 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      {/* Legs (slimmer) */}
      <Path
        d="M 112 428 L 104 585 L 128 585 L 136 430 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      <Path
        d="M 188 428 L 196 585 L 172 585 L 164 430 Z"
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
          M 90 130
          Q 150 112 210 130
          L 200 240
          Q 175 340 168 425
          L 160 430
          Q 150 434 140 430
          L 132 425
          Q 125 340 100 240
          Z
        "
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      {/* Arms */}
      <Path
        d="M 92 140 Q 68 195 74 275 L 88 277 Q 84 200 102 145 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      <Path
        d="M 208 140 Q 232 195 226 275 L 212 277 Q 216 200 198 145 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      {/* Legs (narrow) */}
      <Path
        d="M 140 430 L 130 585 L 152 585 L 150 432 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      <Path
        d="M 160 430 L 170 585 L 148 585 L 150 432 Z"
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
          M 98 130
          Q 150 116 202 130
          L 208 220
          Q 190 250 190 280
          Q 190 305 200 340
          L 195 428
          Q 150 440 105 428
          L 100 340
          Q 110 305 110 280
          Q 110 250 92 220
          Z
        "
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      {/* Arms (defined) */}
      <Path
        d="M 98 140 Q 76 195 82 278 L 96 280 Q 92 205 108 145 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      <Path
        d="M 202 140 Q 224 195 218 278 L 204 280 Q 208 205 192 145 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      {/* Legs (toned, straighter) */}
      <Path
        d="M 108 428 L 102 585 L 132 585 L 140 430 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
      <Path
        d="M 192 428 L 198 585 L 168 585 L 160 430 Z"
        fill={SILHOUETTE_COLOR}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
      />
    </>
  );
}
