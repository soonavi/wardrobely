import React from "react";
import Svg, { Circle, Ellipse, G, Line, Path, Rect } from "react-native-svg";
import { colors } from "../../lib/theme";
import type {
  BodyType,
  Customization,
  EyeShape,
  FaceShape,
} from "./customization";

/** One equipped garment slot's visual — mirrors avatar3d/garmentVisual.ts's `ResolvedGarmentVisual` (kept as its own type here so this dependency-light preview file doesn't need to import from the 3D feature). */
export interface EquippedSlotVisual {
  /** Hex fill color the slot's shape is tinted with. */
  color: string;
  name?: string;
  /** Dress/long coat — hangs an extra hem flare over the hips, mirroring CharacterAvatar's `long` flag. */
  long?: boolean;
}

/**
 * Optional "wearing the fit" overlay. When provided (even as `{}`),
 * AvatarPreview switches from its default bust-only creator preview to a
 * full-body figure (torso + legs + shoes) so the outfit's garment colors
 * have somewhere to render — see ShareCard.tsx, the only current caller
 * that passes this. Omitting it entirely keeps every existing call site
 * (CharacterCreatorScreen) rendering exactly as before.
 */
export interface AvatarPreviewEquipped {
  top?: EquippedSlotVisual;
  bottom?: EquippedSlotVisual;
  shoes?: EquippedSlotVisual;
}

export interface AvatarPreviewProps {
  customization: Customization;
  /** Rendered width in px (height follows the active viewBox's aspect ratio). Default 260. */
  size?: number;
  /** See AvatarPreviewEquipped. Omit for the plain bust-only creator preview (default, unchanged behavior). */
  equipped?: AvatarPreviewEquipped;
}

const VIEWBOX_W = 240;
/** Default bust-only viewBox height (head + shoulders + upper torso), unchanged from before `equipped` existed. */
const BUST_VIEWBOX_H = 320;
/** Extended viewBox height used when `equipped` is passed, tall enough to fit legs + shoes below the torso. */
const FULL_VIEWBOX_H = 450;

/** Torso bottom edge / hip top — where the legs begin. Matches the bust viewBox's bottom edge so the two modes share the same torso geometry. */
const HIP_TOP = 320;
const LEG_BOTTOM = 404;
const LEG_GAP = 10;
const SHOE_CY = 418;
const SHOE_RY = 13;
/** Dress/coat hem flare bottom — how far a `long` top's skirt panel hangs over the legs. */
const HEM_FLARE_BOTTOM = 366;

/** Head silhouette per face shape, hand-drawn to be visibly distinct. */
const HEAD_PATHS: Record<FaceShape, string> = {
  round:
    "M60,110 C60,60 90,40 120,40 C150,40 180,60 180,110 C180,150 165,180 120,185 C75,180 60,150 60,110 Z",
  oval: "M65,105 C65,55 90,35 120,35 C150,35 175,55 175,105 C175,155 155,195 120,200 C85,195 65,155 65,105 Z",
  square:
    "M58,105 C58,55 88,38 120,38 C152,38 182,55 182,105 L182,150 C182,175 160,185 120,185 C80,185 58,175 58,150 Z",
  heart:
    "M55,100 C55,55 85,35 120,35 C155,35 185,55 185,100 C185,130 165,150 145,165 C135,175 125,185 120,195 C115,185 105,175 95,165 C75,150 55,130 55,100 Z",
  long: "M70,95 C70,50 92,32 120,32 C148,32 170,50 170,95 C170,150 160,195 120,205 C80,195 70,150 70,95 Z",
};

/** Half-widths (shoulder / waist) per body type, used to build the torso trapezoid. */
const TORSO_WIDTHS: Record<BodyType, { shoulder: number; waist: number }> = {
  slim: { shoulder: 55, waist: 45 },
  average: { shoulder: 68, waist: 58 },
  athletic: { shoulder: 78, waist: 55 },
  curvy: { shoulder: 62, waist: 72 },
  broad: { shoulder: 88, waist: 70 },
};

/** Eye ellipse dimensions + outer-corner rotation per eye shape. */
const EYE_DIMS: Record<EyeShape, { rx: number; ry: number; rotate: number }> = {
  round: { rx: 12, ry: 12, rotate: 0 },
  almond: { rx: 14, ry: 8, rotate: 0 },
  hooded: { rx: 13, ry: 8, rotate: 0 },
  upturned: { rx: 13, ry: 8, rotate: 8 },
};

function torsoPath(shoulderHalf: number, waistHalf: number): string {
  const top = 205;
  const bottom = 320;
  return `M ${120 - shoulderHalf} ${top} L ${120 + shoulderHalf} ${top} L ${
    120 + waistHalf
  } ${bottom} L ${120 - waistHalf} ${bottom} Z`;
}

/** Left/right leg rect geometry (x + shared width) derived from the torso's waist half-width, so the legs pick up cleanly where the torso trapezoid ends. */
function legGeometry(waistHalf: number): { leftX: number; rightX: number; width: number } {
  const width = waistHalf - LEG_GAP / 2;
  return {
    leftX: 120 - waistHalf,
    rightX: 120 + LEG_GAP / 2,
    width,
  };
}

/** A dress/long-coat hem — a trapezoid that flares wider than the waist as it falls over the hips/upper legs. */
function hemFlarePath(waistHalf: number): string {
  const top = HIP_TOP;
  const bottom = HEM_FLARE_BOTTOM;
  const bottomHalf = waistHalf + 14;
  return `M ${120 - waistHalf} ${top} L ${
    120 + waistHalf
  } ${top} L ${120 + bottomHalf} ${bottom} L ${120 - bottomHalf} ${bottom} Z`;
}

function Eye({
  cx,
  cy,
  eyeColor,
  eyeShape,
  skinTone,
  mirrored,
}: {
  cx: number;
  cy: number;
  eyeColor: string;
  eyeShape: EyeShape;
  skinTone: string;
  mirrored: boolean;
}) {
  const dims = EYE_DIMS[eyeShape];
  const rotate = mirrored ? -dims.rotate : dims.rotate;
  return (
    <G transform={`translate(${cx} ${cy}) rotate(${rotate})`}>
      <Ellipse
        cx={0}
        cy={0}
        rx={dims.rx}
        ry={dims.ry}
        fill="#FFFFFF"
        stroke="#2A2430"
        strokeWidth={1.2}
      />
      <Circle cx={0} cy={1} r={dims.ry * 0.75} fill={eyeColor} />
      <Circle cx={0} cy={1} r={dims.ry * 0.32} fill="#1B1722" />
      <Circle cx={-dims.ry * 0.25} cy={-dims.ry * 0.3} r={dims.ry * 0.14} fill="#FFFFFF" opacity={0.85} />
      {eyeShape === "hooded" && (
        <Path
          d={`M ${-dims.rx - 2} ${-dims.ry * 0.15} Q 0 ${-dims.ry * 1.5} ${
            dims.rx + 2
          } ${-dims.ry * 0.15} Q 0 ${-dims.ry * 0.1} ${-dims.rx - 2} ${-dims.ry * 0.15} Z`}
          fill={skinTone}
        />
      )}
    </G>
  );
}

const EYEBROW_PATHS: Record<string, string> = {
  natural: "M -14 2 Q 0 -4 14 2 Q 0 0 -14 2 Z",
  arched: "M -14 4 Q 0 -10 14 4 Q 0 -2 -14 4 Z",
  straight: "M -14 -2 L 14 -2 L 14 2 L -14 2 Z",
  bold: "M -15 6 Q 0 -9 15 6 Q 0 2 -15 6 Z",
};

function Eyebrow({
  cx,
  cy,
  style,
  color,
  mirrored,
}: {
  cx: number;
  cy: number;
  style: string;
  color: string;
  mirrored: boolean;
}) {
  const d = EYEBROW_PATHS[style] ?? EYEBROW_PATHS.natural;
  return (
    <G transform={`translate(${cx} ${cy}) scale(${mirrored ? -1 : 1},1)`}>
      <Path d={d} fill={color} />
    </G>
  );
}

/** Hair is split into a "back" layer (drawn behind the head, e.g. afro/ponytail/braids) and a "front" layer (drawn on top, e.g. the cap/fringe). */
function getHairLayers(
  hairStyle: string,
  hairColor: string
): { back: React.ReactNode; front: React.ReactNode } {
  const shortCap = (
    <Path
      d="M56,112 C56,50 84,30 120,30 C156,30 184,50 184,112 C184,86 158,42 120,42 C82,42 56,86 56,112 Z"
      fill={hairColor}
    />
  );
  const buzzCap = (
    <Path
      d="M60,100 C60,54 88,36 120,36 C152,36 180,54 180,100 C180,88 158,46 120,46 C82,46 60,88 60,100 Z"
      fill={hairColor}
    />
  );

  switch (hairStyle) {
    case "bald":
      return { back: null, front: null };

    case "buzz":
      return { back: null, front: buzzCap };

    case "sidePart":
      return {
        back: null,
        front: (
          <G>
            {shortCap}
            <Path d="M104,38 L92,62" stroke={hairColor} strokeWidth={3} strokeLinecap="round" />
          </G>
        ),
      };

    case "bob":
      return {
        back: null,
        front: (
          <G>
            {shortCap}
            <Path d="M54,95 Q50,140 58,178 L80,178 Q80,140 78,95 Z" fill={hairColor} />
            <Path d="M186,95 Q190,140 182,178 L160,178 Q160,140 162,95 Z" fill={hairColor} />
          </G>
        ),
      };

    case "longStraight":
      return {
        back: null,
        front: (
          <G>
            {shortCap}
            <Path d="M54,95 Q46,180 56,260 L82,260 Q76,180 78,95 Z" fill={hairColor} />
            <Path d="M186,95 Q194,180 184,260 L158,260 Q164,180 162,95 Z" fill={hairColor} />
          </G>
        ),
      };

    case "wavy":
      return {
        back: null,
        front: (
          <G>
            {shortCap}
            <Path
              d="M54,95 Q46,170 52,220 Q60,230 54,240 Q66,250 58,258 Q70,262 64,255 L82,255 Q78,170 78,95 Z"
              fill={hairColor}
            />
            <Path
              d="M186,95 Q194,170 188,220 Q180,230 186,240 Q174,250 182,258 Q170,262 176,255 L158,255 Q162,170 162,95 Z"
              fill={hairColor}
            />
          </G>
        ),
      };

    case "curly":
      return {
        back: null,
        front: (
          <G>
            {buzzCap}
            <Circle cx={60} cy={70} r={16} fill={hairColor} />
            <Circle cx={95} cy={38} r={15} fill={hairColor} />
            <Circle cx={120} cy={30} r={16} fill={hairColor} />
            <Circle cx={145} cy={38} r={15} fill={hairColor} />
            <Circle cx={180} cy={70} r={16} fill={hairColor} />
            <Circle cx={185} cy={100} r={15} fill={hairColor} />
            <Circle cx={55} cy={100} r={15} fill={hairColor} />
            <Circle cx={70} cy={128} r={13} fill={hairColor} />
            <Circle cx={170} cy={128} r={13} fill={hairColor} />
          </G>
        ),
      };

    case "afro":
      return {
        back: <Circle cx={120} cy={100} r={82} fill={hairColor} />,
        front: null,
      };

    case "ponytail":
      return {
        back: (
          <Path
            d="M150,55 Q185,90 178,150 Q174,190 190,230 Q170,220 168,180 Q160,120 150,55 Z"
            fill={hairColor}
          />
        ),
        front: shortCap,
      };

    case "bun":
      return {
        back: null,
        front: (
          <G>
            {shortCap}
            <Circle cx={120} cy={26} r={17} fill={hairColor} />
          </G>
        ),
      };

    case "braids":
      return {
        back: (
          <G>
            <Path d="M66,100 Q60,160 66,230 L82,230 Q78,160 80,100 Z" fill={hairColor} />
            <Path d="M174,100 Q180,160 174,230 L158,230 Q162,160 160,100 Z" fill={hairColor} />
            <Line x1={68} y1={140} x2={80} y2={140} stroke="#000000" opacity={0.15} strokeWidth={2} />
            <Line x1={68} y1={175} x2={80} y2={175} stroke="#000000" opacity={0.15} strokeWidth={2} />
            <Line x1={160} y1={140} x2={172} y2={140} stroke="#000000" opacity={0.15} strokeWidth={2} />
            <Line x1={160} y1={175} x2={172} y2={175} stroke="#000000" opacity={0.15} strokeWidth={2} />
          </G>
        ),
        front: shortCap,
      };

    case "short":
    default:
      return { back: null, front: shortCap };
  }
}

function getFacialHair(style: string, color: string): React.ReactNode {
  switch (style) {
    case "mustache":
      return <Path d="M100,148 Q120,142 140,148 Q120,154 100,148 Z" fill={color} />;
    case "goatee":
      return (
        <G>
          <Path d="M100,148 Q120,142 140,148 Q120,154 100,148 Z" fill={color} />
          <Ellipse cx={120} cy={180} rx={16} ry={14} fill={color} />
        </G>
      );
    case "full":
      return (
        <Path
          d="M62,120 Q60,170 90,190 Q120,200 150,190 Q180,170 178,120 Q178,150 150,175 Q120,188 90,175 Q62,150 62,120 Z"
          fill={color}
        />
      );
    case "stubble":
      return (
        <G opacity={0.45}>
          {[
            [78, 155],
            [88, 165],
            [98, 172],
            [110, 178],
            [120, 181],
            [130, 178],
            [142, 172],
            [152, 165],
            [162, 155],
            [83, 145],
            [157, 145],
            [70, 135],
            [170, 135],
            [120, 188],
          ].map(([x, y], i) => (
            <Circle key={i} cx={x} cy={y} r={1.6} fill={color} />
          ))}
        </G>
      );
    case "none":
    default:
      return null;
  }
}

function getAccessories(accessories: string[]): React.ReactNode {
  return (
    <>
      {accessories.includes("glasses") && (
        <G>
          <Rect x={80} y={104} width={28} height={20} rx={8} fill="rgba(255,255,255,0.12)" stroke={colors.ink} strokeWidth={3} />
          <Rect x={132} y={104} width={28} height={20} rx={8} fill="rgba(255,255,255,0.12)" stroke={colors.ink} strokeWidth={3} />
          <Line x1={108} y1={114} x2={132} y2={114} stroke={colors.ink} strokeWidth={3} />
        </G>
      )}
      {accessories.includes("earrings") && (
        <G>
          <Circle cx={59} cy={132} r={4} fill="#D8B65A" stroke={colors.ink} strokeWidth={1} />
          <Circle cx={181} cy={132} r={4} fill="#D8B65A" stroke={colors.ink} strokeWidth={1} />
        </G>
      )}
    </>
  );
}

/**
 * Live, dependency-light 2D preview of a `Customization` using
 * react-native-svg. Not photoreal — a clean, friendly vector character
 * illustration that visibly changes with every option, meant to be the
 * immediate visual payoff while the creator's 3D pipeline is built later
 * (see SCOPE LIMITS: this never touches the GLB avatar).
 */
export function AvatarPreview({ customization, size = 260, equipped }: AvatarPreviewProps) {
  const {
    skinTone,
    faceShape,
    eyeColor,
    eyeShape,
    eyebrows,
    eyebrowColor,
    hairStyle,
    hairColor,
    facialHair,
    facialHairColor,
    bodyType,
    accessories,
  } = customization;

  const headPath = HEAD_PATHS[faceShape] ?? HEAD_PATHS.oval;
  const torsoWidths = TORSO_WIDTHS[bodyType] ?? TORSO_WIDTHS.average;
  const hair = getHairLayers(hairStyle, hairColor);

  // `equipped` (even `{}`) opts into the full-body figure — see
  // AvatarPreviewEquipped's doc comment. Undefined (every pre-existing call
  // site) keeps the original bust-only viewBox/rendering untouched.
  const fullBody = !!equipped;
  const viewBoxH = fullBody ? FULL_VIEWBOX_H : BUST_VIEWBOX_H;
  const topColor = equipped?.top?.color ?? colors.surfaceAlt;
  const bottomColor = equipped?.bottom?.color ?? colors.surfaceAlt;
  const shoesColor = equipped?.shoes?.color ?? colors.surfaceAlt;
  const legs = legGeometry(torsoWidths.waist);

  return (
    <Svg width={size} height={(size * viewBoxH) / VIEWBOX_W} viewBox={`0 0 ${VIEWBOX_W} ${viewBoxH}`}>
      {/* Torso / shoulders — hints at body type via shoulder/waist width; tinted with the equipped top's color when a fit is worn. */}
      <Path
        d={torsoPath(torsoWidths.shoulder, torsoWidths.waist)}
        fill={topColor}
        stroke={colors.border}
        strokeWidth={2}
      />

      {fullBody && (
        <G>
          {/* Legs — tinted with the equipped bottom's color (or a neutral fallback). */}
          <Rect
            x={legs.leftX}
            y={HIP_TOP}
            width={legs.width}
            height={LEG_BOTTOM - HIP_TOP}
            rx={10}
            fill={bottomColor}
            stroke={colors.border}
            strokeWidth={1.5}
          />
          <Rect
            x={legs.rightX}
            y={HIP_TOP}
            width={legs.width}
            height={LEG_BOTTOM - HIP_TOP}
            rx={10}
            fill={bottomColor}
            stroke={colors.border}
            strokeWidth={1.5}
          />

          {/* Shoes — tinted with the equipped shoes color (or a neutral fallback). */}
          <Ellipse
            cx={legs.leftX + legs.width / 2}
            cy={SHOE_CY}
            rx={legs.width * 0.62}
            ry={SHOE_RY}
            fill={shoesColor}
            stroke={colors.border}
            strokeWidth={1.5}
          />
          <Ellipse
            cx={legs.rightX + legs.width / 2}
            cy={SHOE_CY}
            rx={legs.width * 0.62}
            ry={SHOE_RY}
            fill={shoesColor}
            stroke={colors.border}
            strokeWidth={1.5}
          />

          {/* A worn dress/long coat hangs a skirt hem over the hips, drawn after the legs so it layers on top. */}
          {equipped?.top?.long && (
            <Path
              d={hemFlarePath(torsoWidths.waist)}
              fill={topColor}
              stroke={colors.border}
              strokeWidth={2}
            />
          )}
        </G>
      )}

      {/* Hair drawn behind the head (afro / ponytail tail / braids). */}
      {hair.back}

      {/* Neck. */}
      <Path d="M104,180 L104,208 L136,208 L136,180 Z" fill={skinTone} />

      {/* Head. */}
      <Path d={headPath} fill={skinTone} stroke="rgba(0,0,0,0.08)" strokeWidth={1.5} />

      {/* Hair drawn on top of the head (cap / fringe / bun / sides). */}
      {hair.front}

      {/* Eyebrows. */}
      <Eyebrow cx={92} cy={95} style={eyebrows} color={eyebrowColor} mirrored={false} />
      <Eyebrow cx={148} cy={95} style={eyebrows} color={eyebrowColor} mirrored={true} />

      {/* Eyes. */}
      <Eye cx={92} cy={112} eyeColor={eyeColor} eyeShape={eyeShape} skinTone={skinTone} mirrored={false} />
      <Eye cx={148} cy={112} eyeColor={eyeColor} eyeShape={eyeShape} skinTone={skinTone} mirrored={true} />

      {/* Simple friendly smile. */}
      <Path d="M100,160 Q120,172 140,160" stroke="#7A4A42" strokeWidth={4} fill="none" strokeLinecap="round" />

      {/* Facial hair, drawn over the lower face. */}
      {getFacialHair(facialHair, facialHairColor)}

      {/* Accessories (glasses / earrings). */}
      {getAccessories(accessories)}
    </Svg>
  );
}

export default AvatarPreview;
