/**
 * Pure data module for the character creator (no React imports here).
 *
 * PRODUCT PIVOT: users no longer upload a photo or rely on tape
 * measurements to produce an avatar — they build one directly by picking
 * appearance options below. `Customization` is the single source of truth
 * for those choices; it's stored as `avatars.customization` jsonb (see
 * src/lib/api/avatars.ts) and rendered live by AvatarPreview.tsx.
 *
 * Option catalogs are plain arrays of `{ id, label, ... }` so the creator
 * UI can just `.map()` over them — adding a new skin tone/hair color/style
 * is a one-line addition here, no UI changes required.
 */

/** Face silhouette — drives the head outline drawn in AvatarPreview. */
export type FaceShape = "round" | "oval" | "square" | "heart" | "long";

/** Eye silhouette — drives the eye/eyelid path drawn in AvatarPreview. */
export type EyeShape = "round" | "almond" | "hooded" | "upturned";

/** Eyebrow shape. */
export type EyebrowStyle = "natural" | "arched" | "straight" | "bold";

/** Facial hair coverage. */
export type FacialHairStyle = "none" | "stubble" | "mustache" | "goatee" | "full";

/**
 * General body type — intentionally the same union as `Build` in
 * database.types.ts (profiles.build). Onboarding sets profile.build from
 * this value on Save so the app's existing auth gate (which keys off
 * `profile.build`) keeps working unchanged.
 */
export type BodyType = "slim" | "average" | "athletic" | "curvy" | "broad";

/** Wearable extras layered on top of the character preview. */
export type AccessoryId = "none" | "glasses" | "earrings";

/** All appearance choices for a user's character. */
export type Customization = {
  skinTone: string;
  faceShape: FaceShape;
  eyeColor: string;
  eyeShape: EyeShape;
  eyebrows: EyebrowStyle;
  eyebrowColor: string;
  hairStyle: string;
  hairColor: string;
  facialHair: FacialHairStyle;
  facialHairColor: string;
  bodyType: BodyType;
  accessories: string[];
};

/** Generic catalog entry: a pickable option with a stable id + display label. */
export type SwatchOption = { id: string; label: string; hex: string };
export type ChipOption = { id: string; label: string };

/** ---- Skin tones (fair -> deep), ~10 stops for an inclusive default set. ---- */
export const SKIN_TONES: SwatchOption[] = [
  { id: "porcelain", label: "Porcelain", hex: "#FCE4D2" },
  { id: "fair", label: "Fair", hex: "#F3D2B3" },
  { id: "light", label: "Light", hex: "#E8BD94" },
  { id: "light-medium", label: "Light Medium", hex: "#D9A579" },
  { id: "medium", label: "Medium", hex: "#C68A5F" },
  { id: "medium-tan", label: "Medium Tan", hex: "#B27548" },
  { id: "tan", label: "Tan", hex: "#96603A" },
  { id: "deep-tan", label: "Deep Tan", hex: "#7A4A2C" },
  { id: "deep", label: "Deep", hex: "#5C3521" },
  { id: "rich-deep", label: "Rich Deep", hex: "#3C2116" },
];

/** ---- Hair colors: naturals plus a handful of fun/dyed shades. ---- */
export const HAIR_COLORS: SwatchOption[] = [
  { id: "black", label: "Black", hex: "#1B1712" },
  { id: "dark-brown", label: "Dark Brown", hex: "#3B2A1F" },
  { id: "brown", label: "Brown", hex: "#5A3D2B" },
  { id: "chestnut", label: "Chestnut", hex: "#7A4B32" },
  { id: "auburn", label: "Auburn", hex: "#8C4A2F" },
  { id: "red", label: "Red", hex: "#A8442A" },
  { id: "strawberry-blonde", label: "Strawberry Blonde", hex: "#C97B4A" },
  { id: "blonde", label: "Blonde", hex: "#E0C088" },
  { id: "platinum", label: "Platinum", hex: "#EDE6D6" },
  { id: "gray", label: "Silver Gray", hex: "#9C9C9C" },
  { id: "lavender", label: "Lavender", hex: "#B7A6F2" },
  { id: "pink", label: "Pink", hex: "#F2A6C9" },
];

/** ---- Eye colors. ---- */
export const EYE_COLORS: SwatchOption[] = [
  { id: "brown", label: "Brown", hex: "#5B3A21" },
  { id: "dark-brown", label: "Dark Brown", hex: "#2E1D12" },
  { id: "hazel", label: "Hazel", hex: "#7C6A3F" },
  { id: "amber", label: "Amber", hex: "#B07A2E" },
  { id: "green", label: "Green", hex: "#4C7A4E" },
  { id: "blue", label: "Blue", hex: "#3E6FA8" },
  { id: "gray", label: "Gray", hex: "#8593A0" },
  { id: "violet", label: "Violet", hex: "#7A5FA8" },
];

/**
 * Hair styles. `id` is the stable value stored in Customization.hairStyle;
 * AvatarPreview switches on this id to pick the shape it draws.
 */
export const HAIR_STYLES: ChipOption[] = [
  { id: "bald", label: "Bald" },
  { id: "buzz", label: "Buzz Cut" },
  { id: "short", label: "Short" },
  { id: "sidePart", label: "Side Part" },
  { id: "bob", label: "Bob" },
  { id: "longStraight", label: "Long Straight" },
  { id: "wavy", label: "Wavy" },
  { id: "curly", label: "Curly" },
  { id: "afro", label: "Afro" },
  { id: "ponytail", label: "Ponytail" },
  { id: "bun", label: "Bun" },
  { id: "braids", label: "Braids" },
];

export const EYEBROW_STYLES: { id: EyebrowStyle; label: string }[] = [
  { id: "natural", label: "Natural" },
  { id: "arched", label: "Arched" },
  { id: "straight", label: "Straight" },
  { id: "bold", label: "Bold" },
];

export const FACIAL_HAIR_STYLES: { id: FacialHairStyle; label: string }[] = [
  { id: "none", label: "Clean" },
  { id: "stubble", label: "Stubble" },
  { id: "mustache", label: "Mustache" },
  { id: "goatee", label: "Goatee" },
  { id: "full", label: "Full Beard" },
];

export const FACE_SHAPES: { id: FaceShape; label: string }[] = [
  { id: "round", label: "Round" },
  { id: "oval", label: "Oval" },
  { id: "square", label: "Square" },
  { id: "heart", label: "Heart" },
  { id: "long", label: "Long" },
];

export const EYE_SHAPES: { id: EyeShape; label: string }[] = [
  { id: "round", label: "Round" },
  { id: "almond", label: "Almond" },
  { id: "hooded", label: "Hooded" },
  { id: "upturned", label: "Upturned" },
];

/** Same copy/order as BuildPicker's BUILD_OPTIONS so the language stays consistent app-wide. */
export const BODY_TYPES: { id: BodyType; label: string; hint: string }[] = [
  { id: "slim", label: "Slim", hint: "Leaner frame" },
  { id: "average", label: "Average", hint: "In-between build" },
  { id: "athletic", label: "Athletic", hint: "Toned, defined" },
  { id: "curvy", label: "Curvy", hint: "Fuller hips & bust" },
  { id: "broad", label: "Broad", hint: "Wider shoulders" },
];

export const ACCESSORIES: ChipOption[] = [
  { id: "none", label: "None" },
  { id: "glasses", label: "Glasses" },
  { id: "earrings", label: "Earrings" },
];

/** Sensible starting point for a brand-new character. */
export const DEFAULT_CUSTOMIZATION: Customization = {
  skinTone: SKIN_TONES[3].hex,
  faceShape: "oval",
  eyeColor: EYE_COLORS[0].hex,
  eyeShape: "almond",
  eyebrows: "natural",
  eyebrowColor: HAIR_COLORS[2].hex,
  hairStyle: "short",
  hairColor: HAIR_COLORS[2].hex,
  facialHair: "none",
  facialHairColor: HAIR_COLORS[2].hex,
  bodyType: "average",
  accessories: [],
};

/**
 * Fill in any missing/invalid fields from `partial` (e.g. a jsonb value
 * loaded from Supabase, which is untyped at the DB boundary) with
 * DEFAULT_CUSTOMIZATION so callers always get a fully-populated
 * Customization back, regardless of how old/incomplete the stored row is.
 */
export function mergeCustomization(
  partial?: Partial<Customization> | null
): Customization {
  const p = partial ?? {};
  return {
    skinTone: typeof p.skinTone === "string" ? p.skinTone : DEFAULT_CUSTOMIZATION.skinTone,
    faceShape: p.faceShape ?? DEFAULT_CUSTOMIZATION.faceShape,
    eyeColor: typeof p.eyeColor === "string" ? p.eyeColor : DEFAULT_CUSTOMIZATION.eyeColor,
    eyeShape: p.eyeShape ?? DEFAULT_CUSTOMIZATION.eyeShape,
    eyebrows: p.eyebrows ?? DEFAULT_CUSTOMIZATION.eyebrows,
    eyebrowColor:
      typeof p.eyebrowColor === "string" ? p.eyebrowColor : DEFAULT_CUSTOMIZATION.eyebrowColor,
    hairStyle: typeof p.hairStyle === "string" ? p.hairStyle : DEFAULT_CUSTOMIZATION.hairStyle,
    hairColor: typeof p.hairColor === "string" ? p.hairColor : DEFAULT_CUSTOMIZATION.hairColor,
    facialHair: p.facialHair ?? DEFAULT_CUSTOMIZATION.facialHair,
    facialHairColor:
      typeof p.facialHairColor === "string"
        ? p.facialHairColor
        : DEFAULT_CUSTOMIZATION.facialHairColor,
    bodyType: p.bodyType ?? DEFAULT_CUSTOMIZATION.bodyType,
    // Copied, not aliased. Every other field here is a primitive, so returning
    // the default by value is safe — but handing back DEFAULT_CUSTOMIZATION's
    // own array means one in-place push/splice by any caller permanently
    // changes the default for every character created afterwards. That would
    // surface as "new characters mysteriously start with glasses on", a very
    // long way from the cause.
    accessories: Array.isArray(p.accessories)
      ? p.accessories.filter((a): a is string => typeof a === "string")
      : [...DEFAULT_CUSTOMIZATION.accessories],
  };
}
