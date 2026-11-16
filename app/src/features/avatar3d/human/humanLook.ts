/**
 * humanLook — turns "who this character is and what they have on" into what
 * the avatar asset understands: which parts are worn, what colour each role
 * and garment is, and what shape the body takes.
 *
 * Pure data in, pure data out (plus one function that applies it to a rig), so
 * the mapping is unit-testable without a renderer.
 */
import * as THREE from "three";

import type { Customization } from "../../creator/customization";
import type { EquippedGarments, GarmentVisual } from "../CharacterAvatar";
import { pickGarmentTemplate, templatePartName, TEMPLATE_INFO, type GarmentTemplateId } from "./garmentTemplates";
import type { HumanRig } from "./humanRig";
import { DEFAULT_HUMAN_SHAPE, resolveShapeWeights, type EyeShapeId, type FaceShapeId, type HumanShape } from "./humanShape";

export type BodyMeasurements = { heightCm?: number | null; weightKg?: number | null };

/** The outerwear slot the mesh avatar adds on top of the four legacy slots. */
export type HumanEquipped = EquippedGarments & { outer?: GarmentVisual };

export type WornGarment = { part: string; template: GarmentTemplateId; color: string; slot: string };

export type HumanLook = {
  /** Names of every optional part to show. */
  worn: string[];
  /** Material role -> hex. */
  roleColors: Record<string, string>;
  garments: WornGarment[];
  shape: HumanShape;
  /** Equipped slots nothing in the asset can draw (accessories today). */
  undrawn: string[];
};

/** The base layer is tonal and deliberately unbranded: it is underwear, not an outfit. */
export const BASE_LAYER_COLOR = "#DDD6CC";

const HAIR_PARTS = new Set([
  "buzz", "short", "sidePart", "bob", "longStraight", "wavy", "curly", "afro", "ponytail", "bun", "braids",
]);
const BROW_PARTS = new Set(["natural", "arched", "straight", "bold"]);
const BEARD_PARTS = new Set(["stubble", "mustache", "goatee", "full"]);
const FACES = new Set<FaceShapeId>(["oval", "round", "square", "heart", "long"]);
const EYES = new Set<EyeShapeId>(["almond", "round", "hooded", "upturned"]);

function finite(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function shapeFromCustomization(c: Customization, m?: BodyMeasurements | null): HumanShape {
  const b = c.body;
  const shape: HumanShape = {
    ...DEFAULT_HUMAN_SHAPE,
    frame: finite(b?.frame),
    height: finite(b?.height),
    volume: finite(b?.volume),
    chest: finite(b?.chest),
    waist: finite(b?.waist),
    hip: finite(b?.hip),
    shoulders: finite(b?.shoulders),
    muscle: finite(b?.muscle),
    // One "chest" slider: on a feminine frame it is mostly cup, on a masculine
    // one mostly ribcage. The resolver fades cup out as the frame goes masculine.
    cup: finite(b?.chest),
    face: FACES.has(c.faceShape as FaceShapeId) ? (c.faceShape as FaceShapeId) : "oval",
    eyes: EYES.has(c.eyeShape as EyeShapeId) ? (c.eyeShape as EyeShapeId) : "almond",
  };
  // Real measurements, when the person has given them, beat the sliders: the
  // point of entering your height is that the avatar is then that tall.
  if (m?.heightCm && m.heightCm > 0) shape.heightCm = m.heightCm;
  if (m?.weightKg && m.weightKg > 0) shape.weightKg = m.weightKg;
  return shape;
}

export function buildHumanLook(
  c: Customization,
  equipped?: HumanEquipped | null,
  measurements?: BodyMeasurements | null
): HumanLook {
  const worn: string[] = [];
  const undrawn: string[] = [];
  const garments: WornGarment[] = [];

  if (HAIR_PARTS.has(c.hairStyle)) worn.push(`Hair_${c.hairStyle}`);
  worn.push(`Brows_${BROW_PARTS.has(c.eyebrows) ? c.eyebrows : "natural"}`);
  if (BEARD_PARTS.has(c.facialHair)) worn.push(`Beard_${c.facialHair}`);
  if (c.accessories.includes("glasses")) worn.push("Acc_glasses");
  if (c.accessories.includes("earrings")) worn.push("Acc_earrings");

  let torsoCovered = false;
  let legsCovered = false;
  const add = (slot: "top" | "outer" | "bottom" | "shoes", visual: GarmentVisual | undefined) => {
    if (!visual) return;
    const template = pickGarmentTemplate({
      slot,
      category: visual.category ?? null,
      name: visual.name ?? null,
      long: visual.long,
    });
    if (!template) {
      undrawn.push(slot);
      return;
    }
    const covers = TEMPLATE_INFO[template].covers;
    if (covers === "torso" || covers === "outer" || covers === "full") torsoCovered = true;
    if (covers === "legs") legsCovered = true;
    const part = templatePartName(template);
    if (garments.some((g) => g.part === part)) return;
    garments.push({ part, template, color: visual.color, slot });
  };
  add("bottom", equipped?.bottom);
  add("top", equipped?.top);
  add("outer", equipped?.outer);
  add("shoes", equipped?.shoes);
  if (equipped?.accessory) undrawn.push("accessory");

  // A dress and trousers cannot both be drawn without one cutting through the
  // other; the dress wins, as it does in the outfit resolver.
  const hasFull = garments.some((g) => TEMPLATE_INFO[g.template].covers === "full");
  const drawn = hasFull
    ? garments.filter((g) => !["legs", "skirt"].includes(TEMPLATE_INFO[g.template].covers))
    : garments;
  if (hasFull) legsCovered = false;

  if (!torsoCovered) worn.push("G_base_top");
  if (!legsCovered) worn.push("G_base_bottom");
  for (const g of drawn) worn.push(g.part);

  return {
    worn,
    garments: drawn,
    undrawn,
    shape: shapeFromCustomization(c, measurements),
    roleColors: {
      skin: c.skinTone,
      hair: c.hairColor,
      iris: c.eyeColor,
      brow: c.eyebrowColor,
      beard: c.facialHairColor,
      base: BASE_LAYER_COLOR,
    },
  };
}

function safeColor(hex: string, fallback: string): THREE.Color {
  const color = new THREE.Color(fallback);
  try {
    if (/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(hex.trim())) color.set(hex.trim().startsWith("#") ? hex.trim() : `#${hex.trim()}`);
  } catch {
    // keep the fallback
  }
  return color;
}

/** Apply a look to a rig. Returns anything the asset did not have. */
export function applyHumanLook(rig: HumanRig, look: HumanLook): { missing: string[]; unknownTargets: string[] } {
  const { missing } = rig.setWorn(look.worn);
  const { unknown } = rig.setShape(resolveShapeWeights(look.shape, rig.manifest));
  for (const [role, hex] of Object.entries(look.roleColors)) {
    for (const material of rig.materialsByRole(role)) material.color.copy(safeColor(hex, "#888888"));
  }
  for (const g of look.garments) {
    const mesh = rig.parts.get(g.part);
    if (!mesh) continue;
    (mesh.material as THREE.MeshStandardMaterial).color.copy(safeColor(g.color, "#8A8F98"));
  }
  for (const mesh of rig.parts.values()) {
    mesh.castShadow = mesh.visible;
    mesh.receiveShadow = false;
  }
  return { missing, unknownTargets: unknown };
}
