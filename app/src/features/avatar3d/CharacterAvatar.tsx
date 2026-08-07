import React, { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber/native";
import * as THREE from "three";
import type {
  BodyType,
  Customization,
  EyeShape,
  FaceShape,
} from "../creator/customization";
import {
  acquireGarmentTexture,
  releaseGarmentTexture,
  type LoadedGarmentTexture,
} from "./garmentTexture";

/**
 * ============================================================================
 * CharacterAvatar — a fully PROCEDURAL, stylized "3D-emoji" character built
 * entirely from three.js primitives (spheres, capsules, cylinders, boxes,
 * toruses + a few InstancedMeshes for bumpy hair/stubble). No GLB, no
 * external 3D *geometry* of any kind — every shape here is generated at
 * runtime, so this works unmodified in a bare Expo dev client (no asset
 * pipeline, no bundler config beyond what already ships).
 *
 * The one thing that is fetched rather than generated is garment imagery: an
 * equipped garment can carry a `textureUrl` (its real product photo), which is
 * planar-projected onto a thin "decal" shell floating just outside the
 * procedural garment mesh — see the GARMENT DECALS section below. That path is
 * entirely additive and entirely optional: with no `textureUrl`, or when the
 * image fails to load, the character renders exactly as it always did.
 *
 * The look is deliberately NOT photoreal and NOT a blocky mannequin: smooth,
 * rounded, low-ish-poly shapes (think Zepeto/Bitmoji-lite) with big soft
 * eyes, a friendly smile, and simple neutral clothing so the body doesn't
 * read as nude. Every field on `Customization` (see
 * features/creator/customization.ts) maps to a geometry or material choice
 * below — see the per-section comments for exactly which.
 *
 * Construction strategy: the whole character is assembled IMPERATIVELY into
 * a single THREE.Group inside `buildCharacterGroup`, memoized on the
 * customization fields that affect it. This (rather than a fully declarative
 * R3F JSX tree) is what lets us cheaply reuse materials across many meshes,
 * use InstancedMesh for the bumpy hair/stubble looks, and precisely control
 * disposal — three.js GPU resources (geometries/materials) are NOT garbage
 * collected by JS alone, so the previous group's resources are explicitly
 * disposed (see `disposeObject3D`) whenever a new one is built or this
 * component unmounts.
 * ============================================================================
 */

// ---------------------------------------------------------------------------
// Try-on: a wardrobe garment or shop product "equipped" onto one body slot.
// Still a small shape — see features/avatar3d/garmentVisual.ts for how a
// GarmentRow / ProductWithBrand is turned into it — but no longer color-only:
// `textureUrl` carries the garment's real photo, which gets projected onto the
// slot's front (GARMENT DECALS, below).
//
// `color` remains mandatory and remains what actually gets rendered most of
// the time: it tints the procedural garment mesh, it is what shows before the
// photo has downloaded, it is the fallback when the download fails, and it
// fills the sides and back of the garment that a single flat-lay photo can
// say nothing about.
//
// `long` encodes "dress→top(long)" from the category→slot mapping: a dress
// equips into the `top` slot same as a shirt, but with `long: true` so
// buildTorsoAndNeck also hangs an a-line skirt panel down over the hips/upper
// legs — and so the dress's photo is projected across that whole silhouette
// rather than stopping at the hip.
// ---------------------------------------------------------------------------
export interface GarmentVisual {
  color: string;
  name?: string;
  long?: boolean;
  /** Remote image of the actual garment, planar-projected onto the slot's front. */
  textureUrl?: string;
}

/**
 * Which renderable slot currently has a wardrobe garment or shop product
 * equipped — see garmentVisual.ts's `mapCategoryToSlot` for the category to
 * slot mapping every caller shares.
 *
 * `accessory` is the neckline slot (see buildNeckAccessory). It is the only
 * slot that renders as a pure colour tint with no photo decal, because the
 * `accessory` category is a catch-all — scarves, belts, caps, wallets — and no
 * single procedural shape can be all of them. See buildNeckAccessory for the
 * full reasoning, including why it does not touch the character's own
 * creator-chosen glasses/earrings.
 */
export interface EquippedGarments {
  top?: GarmentVisual;
  bottom?: GarmentVisual;
  shoes?: GarmentVisual;
  accessory?: GarmentVisual;
}

// ---------------------------------------------------------------------------
// Proportions — arbitrary but internally-consistent "world units". The
// viewer screen (CharacterViewerScreen) normalizes the built group's actual
// bounding box to a target on-screen height (the same technique
// AvatarSpikeScreen uses for its GLB via useNormalizedAvatarScene), so these
// numbers only need to be proportionate to each other, not any real-world
// scale.
// ---------------------------------------------------------------------------
const HEAD_RADIUS = 0.16;
const LEG_LENGTH = 0.74;
const HIP_Y = LEG_LENGTH; // top of the legs = bottom of the hip/lower-torso cylinder
const LOWER_TORSO_HEIGHT = 0.16;
const WAIST_Y = HIP_Y + LOWER_TORSO_HEIGHT;
const UPPER_TORSO_HEIGHT = 0.3;
const SHOULDER_Y = WAIST_Y + UPPER_TORSO_HEIGHT;
const NECK_HEIGHT = 0.06;
const NECK_TOP_Y = SHOULDER_Y + NECK_HEIGHT;
// Slight overlap (0.8x radius instead of a full radius) so the head nests
// into the neck with no visible gap at the join.
const HEAD_CENTER_Y = NECK_TOP_Y + HEAD_RADIUS * 0.8;

// ---------------------------------------------------------------------------
// Neutral clothing / feature colors — NOT part of Customization. These keep
// the body from reading as nude (a soft top + trousers + simple shoes) and
// give the face non-customizable but essential details (mouth, pupils, eye
// sparkle) a fixed, friendly color regardless of the rest of the palette.
// ---------------------------------------------------------------------------
const NEUTRAL_TOP_COLOR = "#B9AFE0"; // soft lavender-gray tee — echoes theme.colors.accent family
const NEUTRAL_BOTTOM_COLOR = "#4A4458"; // warm charcoal-plum trousers
const NEUTRAL_SHOE_COLOR = "#2E2A38";
const MOUTH_COLOR = "#8A5A4E";
const PUPIL_COLOR = "#1B1722";
const GLASSES_COLOR = "#2A2430";
const EARRING_COLOR = "#D8B65A";
/**
 * Never actually rendered — the neckline accessory meshes only exist when the
 * `accessory` slot is equipped, and an equipped item always resolves a colour
 * (see garmentVisual.ts's resolveGarmentColor, which falls back to a palette
 * pick and can't return nothing). It exists so createMaterials can build the
 * full material set unconditionally, exactly like every other material here.
 */
const NEUTRAL_ACCESSORY_COLOR = "#8A8794";

// ---------------------------------------------------------------------------
// Body type -> shoulder/waist/hip/limb radii. This is the direct mapping for
// `Customization.bodyType`: each entry widens/narrows the torso silhouette
// (via the two tapered CylinderGeometry sections that form the torso — see
// buildTorsoAndNeck) and thickens/thins the arm & leg capsules, which is what
// "overall mass" means here.
// ---------------------------------------------------------------------------
type BodyMetrics = {
  shoulderR: number;
  waistR: number;
  hipR: number;
  armR: number;
  legR: number;
};

const BODY_METRICS: Record<BodyType, BodyMetrics> = {
  slim: { shoulderR: 0.15, waistR: 0.105, hipR: 0.115, armR: 0.042, legR: 0.055 },
  average: { shoulderR: 0.185, waistR: 0.14, hipR: 0.15, armR: 0.05, legR: 0.065 },
  athletic: { shoulderR: 0.205, waistR: 0.125, hipR: 0.14, armR: 0.056, legR: 0.07 },
  curvy: { shoulderR: 0.165, waistR: 0.14, hipR: 0.195, armR: 0.048, legR: 0.068 },
  broad: { shoulderR: 0.22, waistR: 0.165, hipR: 0.18, armR: 0.06, legR: 0.076 },
};

// ---------------------------------------------------------------------------
// Face shape -> non-uniform scale applied ONLY to the head sphere mesh
// itself (never to its children — eyes/hair/etc stay at fixed fractions of
// HEAD_RADIUS so they don't distort). This is intentionally subtle per the
// spec ("vary head proportions subtly"); square/heart additionally get a
// small jaw/chin accent mesh (see buildJawAccent) for a bit more read.
// ---------------------------------------------------------------------------
const FACE_SHAPE_SCALE: Record<FaceShape, { x: number; y: number; z: number }> = {
  round: { x: 1.04, y: 0.98, z: 1.0 },
  oval: { x: 0.96, y: 1.08, z: 1.0 },
  square: { x: 1.06, y: 0.94, z: 1.0 },
  heart: { x: 1.0, y: 1.02, z: 0.98 },
  long: { x: 0.92, y: 1.18, z: 0.98 },
};

// ---------------------------------------------------------------------------
// Eye shape -> eye-white scale (rx/ry, flattened toward the face) + outer-
// corner tilt (radians, mirrored per side). `hooded` additionally adds a
// small skin-tone eyelid cap over the top of the eye.
// ---------------------------------------------------------------------------
const EYE_SHAPE_PARAMS: Record<EyeShape, { rx: number; ry: number; tilt: number }> = {
  round: { rx: 1.05, ry: 1.05, tilt: 0 },
  almond: { rx: 1.2, ry: 0.7, tilt: 0.05 },
  hooded: { rx: 1.1, ry: 0.72, tilt: 0 },
  upturned: { rx: 1.08, ry: 0.75, tilt: 0.24 },
};

// ---------------------------------------------------------------------------
// Eyebrow style -> box thickness + arch rotation (mirrored per side so both
// brows arch symmetrically "up and out" toward the temples).
// ---------------------------------------------------------------------------
const EYEBROW_STYLE_PARAMS: Record<string, { thickness: number; arch: number }> = {
  natural: { thickness: 0.09, arch: 0.18 },
  arched: { thickness: 0.065, arch: 0.36 },
  straight: { thickness: 0.09, arch: 0.02 },
  bold: { thickness: 0.15, arch: 0.22 },
};

/**
 * Disposes every geometry/material found under `root` (including inside
 * InstancedMeshes, which extend THREE.Mesh and carry the same fields). Typed
 * via a small local shape rather than `THREE.Mesh` so TypeScript doesn't
 * assume every traversed Object3D (groups included) actually has a geometry/
 * material — most don't.
 */
function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const maybeMesh = obj as unknown as {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };
    maybeMesh.geometry?.dispose();
    if (maybeMesh.material) {
      const materials = Array.isArray(maybeMesh.material)
        ? maybeMesh.material
        : [maybeMesh.material];
      materials.forEach((m) => m.dispose());
    }
  });
}

// ===========================================================================
// GARMENT DECALS — putting the real product photo onto the character.
//
// THE PROBLEM WITH THE OBVIOUS APPROACH
// Assigning a garment photo as `map` on the torso cylinder does not work. A
// CylinderGeometry's default UVs wrap u around theta, so a flat-lay photo gets
// smeared 360 degrees around the body and the back of the character shows a
// mirrored, stretched copy of the front. It reads as a rendering bug, not as
// clothing.
//
// WHAT WE DO INSTEAD: A PLANAR-PROJECTED DECAL SHELL
// The tinted procedural garment mesh is left completely untouched — it still
// covers the body, in the garment's colour, exactly as before. On top of it we
// add a second, near-identical shell scaled outward by DECAL_INFLATE, carrying
// its own material whose `map` is the product photo. That shell's UVs are
// recomputed as a *planar projection*: the image is projected along a single
// axis (front-on for tops and bottoms; tilted outward for shoes, which are
// photographed in profile — see `shoeProjection`) across the slot's bounding
// box, so the photo lands on the character the same way it sits in the product
// listing.
//
// WHAT IS DELIBERATELY *NOT* TEXTURED
// Sleeves. A flat-lay photo spreads a garment's sleeves out sideways while
// this character's arms hang down, so there is no projection that puts the
// photo's sleeves on the character's arms; folding them into the torso's
// bounding box would only shrink the body of the garment to make room for
// them. Sleeves therefore stay the same flat tint they have always been —
// which is right when the garment carries a real colour, and is the weakest
// part of the result when it doesn't (see resolveGarmentColor's palette
// fallback in garmentVisual.ts).
//
// Two shells rather than one is what makes the fallbacks honest:
//   * before the photo downloads, and forever if it fails, the decal is simply
//     `visible = false` and the character looks exactly as it did pre-texture;
//   * where a cutout PNG is transparent, the decal's fragments are discarded
//     and the *tinted* shell shows through — so the garment's real silhouette
//     reads without leaving a hole in the clothing and exposing bare skin.
//
// EDGES
// Two masks are baked into a per-vertex RGBA colour attribute (three multiplies
// `diffuseColor` by it, alpha included, when the colour attribute has 4
// components) and multiplied together:
//   1. a *facing* fade from the dot product of the vertex normal with the
//      projection axis, so the photo is fully opaque dead-on and dissolves as
//      the surface turns away — a soft wrap at the silhouette instead of a
//      hard cut into the tint at the exact halfway point;
//   2. a *footprint* fade at the borders of the letterboxed image, because the
//      texture is clamped-to-edge and would otherwise smear its border pixels
//      across the parts of the mesh the aspect-preserving fit doesn't cover.
// With `transparent: true` and `alphaTest: 0.5`, values under the threshold are
// discarded outright and values between it and 1 blend into the tint beneath,
// which is what actually produces the soft edge.
// ===========================================================================

/**
 * How far outside the tinted garment mesh the decal shell floats, as a
 * fraction of radius. It has to clear the *vertex* radius of the mesh
 * underneath, not its average: the tinted meshes are coarse (10-16 radial
 * segments), so their faces sag inward between vertices while the vertices sit
 * at exactly the nominal radius. The decal shells are tessellated finer, so at
 * 2.8% their tightest point still sits ~2.3% clear of the tinted surface's
 * widest point — comfortably above z-fighting range, and far too small to read
 * as a second baggy layer.
 */
const DECAL_INFLATE = 0.028;

/** Below this combined alpha the fragment is discarded — this is what turns a cutout PNG's alpha channel into the garment's actual silhouette instead of a rectangular photo card. */
const DECAL_ALPHA_TEST = 0.5;

/** `dot(normal, projector)` at or below which the photo has faded out entirely, and at or above which it is fully opaque. The band between them is the soft wrap onto the sides. */
const DECAL_FACING_FADE_OUT = 0.1;
const DECAL_FACING_FADE_IN = 0.62;

/** Width, in UV units, of the fade at the border of the letterboxed image footprint. */
const DECAL_EDGE_FADE = 0.07;

/**
 * Decal shells are tessellated more finely than the meshes they sit on. The
 * two masks above are evaluated per *vertex* and interpolated, so segment
 * count is what sets how accurately the fade tracks the true silhouette and
 * the true image border. These are still trivial next to the scene budget
 * (a couple of hundred triangles per slot).
 */
const DECAL_RADIAL_SEGMENTS = 32;
const DECAL_HEIGHT_SEGMENTS = 12;

/**
 * The front-on projection basis, in character space. The character faces +Z
 * (its eyes sit at positive z — see buildEyes), so a photo of a garment laid
 * out flat projects along -Z onto the +Z-facing front. Its own left arm is at
 * +X, which appears on the *right* of the screen when you look at it head-on —
 * which is exactly where the right-hand side of a front-facing product photo
 * belongs, so no mirroring is needed.
 *
 * Never mutated; `projectDecalUVs` only reads them.
 */
const AXIS_FRONT = new THREE.Vector3(0, 0, 1);
const AXIS_RIGHT = new THREE.Vector3(1, 0, 0);
const AXIS_UP = new THREE.Vector3(0, 1, 0);

/**
 * Shoes get their own projection basis, tilted rather than front-on.
 *
 * Shoe photography is essentially always a side profile with the toe pointing
 * left, so a purely front-on projection would squash that profile onto the
 * narrow toe cap. A purely sideways projection is faithful to the photo but
 * lands on the outside of the foot, which is nearly edge-on in the try-on
 * screen's default framing — the user would have to rotate the character 90
 * degrees to see the shoe they just equipped.
 *
 * So: mostly outward, rolled about 35 degrees toward the camera. The photo's
 * profile stays roughly right, and enough of it faces front to read without
 * touching the turntable. `right` comes out of the cross product with world
 * up, which lands the toe on the photo's left for the character's left foot
 * and mirrors it for the right — the same way a real pair mirrors.
 *
 * If a device check says shoes read better dead-on, the fix is this vector.
 */
function shoeProjection(side: 1 | -1): {
  projector: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
} {
  const projector = new THREE.Vector3(side * 0.8, 0.2, 0.55).normalize();
  const forward = projector.clone().negate();
  const right = new THREE.Vector3().crossVectors(forward, AXIS_UP).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  return { projector, right, up };
}

type GarmentSlot = keyof EquippedGarments;

/** One decal mesh plus its transform into character-root space. */
interface DecalTarget {
  mesh: THREE.Mesh;
  /**
   * Snapshotted at build time, while the group is still detached, so
   * `matrixWorld` means "relative to the character" and not "relative to
   * whatever scene the avatar was later mounted into and animated inside".
   * The projection resolves asynchronously, long after mounting, and must not
   * depend on where the character happens to be standing at that moment.
   */
  matrix: THREE.Matrix4;
}

/**
 * A set of decal meshes that share one projection. Tops and bottoms have a
 * single group (one image spanning the whole slot, both trouser legs
 * included); shoes have one per foot, because a shoe product photo shows one
 * shoe and each foot needs it projected onto its own outward side.
 */
interface DecalGroup {
  targets: DecalTarget[];
  /** Character-space direction the surface must face to receive the image. */
  projector: THREE.Vector3;
  /** Character-space direction of the image's +u (its right-hand side as printed). */
  right: THREE.Vector3;
  /** Character-space direction of the image's +v (its top). Perpendicular to both of the above. */
  up: THREE.Vector3;
}

/** Everything needed to texture one equipped slot once its image arrives. */
interface SlotDecal {
  url: string;
  /** One material for the whole slot — shared across every decal mesh in it, matching how the tinted materials are shared. */
  material: THREE.MeshStandardMaterial;
  groups: Map<string, DecalGroup>;
}

type CharacterDecals = Partial<Record<GarmentSlot, SlotDecal>>;

/**
 * Build-time decal plans, keyed by the group `buildCharacterGroup` returned.
 * A WeakMap rather than a field on the group so `buildCharacterGroup`'s
 * signature stays `(c, equipped) => THREE.Group` for existing callers, and so
 * nothing has to be read back out of `Object3D.userData` (which is typed
 * `any`). Entries disappear with the group they describe.
 */
const decalRegistry = new WeakMap<THREE.Group, CharacterDecals>();

/**
 * The decal material. Same family as the tinted garment materials — a
 * MeshStandardMaterial in the same 0.6-0.85 "soft, not shiny-plastic"
 * roughness band, metalness 0 — so the textured area and the tint it sits on
 * catch the studio lighting identically and the boundary reads as fabric
 * rather than as a seam between two different surfaces.
 *
 * `color` is white on purpose: `map` is multiplied by it, so anything else
 * would tint the partner's photography.
 */
function createDecalMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: "#FFFFFF",
    roughness: 0.82,
    metalness: 0,
    transparent: true,
    alphaTest: DECAL_ALPHA_TEST,
    vertexColors: true,
    side: THREE.FrontSide,
    // Belt and braces with DECAL_INFLATE's geometric offset. Mobile depth
    // buffers are the least precise place this runs, and a decal that
    // z-fights with the garment under it is the single most obvious way this
    // feature could look broken.
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
}

/** Get (or lazily start) the decal plan for a slot. Returns null when the garment has no photo, which is what makes the whole feature opt-in per garment. */
function decalForSlot(
  decals: CharacterDecals,
  slot: GarmentSlot,
  garment: GarmentVisual | undefined
): SlotDecal | null {
  if (!garment?.textureUrl) return null;
  const existing = decals[slot];
  if (existing) return existing;
  const created: SlotDecal = {
    url: garment.textureUrl,
    material: createDecalMaterial(),
    groups: new Map<string, DecalGroup>(),
  };
  decals[slot] = created;
  return created;
}

/**
 * Register one decal mesh under a projection group, creating the group on
 * first use. `groupKey` is what lets meshes built in different functions (the
 * hip band in buildTorsoAndNeck, the trouser legs in two separate buildLeg
 * calls) share a single image footprint.
 *
 * The mesh starts hidden: until a texture actually arrives there is nothing to
 * show, and a visible untextured white shell would be far worse than the tint.
 */
function addDecalMesh(
  decal: SlotDecal,
  groupKey: string,
  mesh: THREE.Mesh,
  projector: THREE.Vector3,
  right: THREE.Vector3,
  up: THREE.Vector3
): void {
  mesh.visible = false;
  let group = decal.groups.get(groupKey);
  if (!group) {
    group = { targets: [], projector, right, up };
    decal.groups.set(groupKey, group);
  }
  group.targets.push({ mesh, matrix: new THREE.Matrix4() });
}

/** GLSL's smoothstep. Used for the facing fade so the wrap onto the sides eases instead of ramping linearly. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * 1 well inside the image, 0 at and beyond its border. Because
 * `Math.min(t, 1 - t)` goes negative outside [0,1], this also handles the
 * clamp-smear region without a separate test.
 */
function edgeMask(t: number): number {
  return Math.min(1, Math.max(0, Math.min(t, 1 - t) / DECAL_EDGE_FADE));
}

/**
 * Rewrite one decal mesh's `uv` and `color` attributes for a planar projection
 * of an image with the given aspect ratio across `box`.
 *
 * The fit is **contain, not cover**: the image is scaled until it fits inside
 * the slot's bounding box with its aspect ratio intact, leaving margins on
 * whichever axis is proportionally longer. Stretching a garment to fill the
 * box reads instantly as a bug — a shirt that has been squashed taller is
 * worse than a shirt that doesn't reach all the way down the mesh — and the
 * margins are handled by fading into the colour tint rather than being left
 * as visible bands.
 */
function projectDecalUVs(
  target: DecalTarget,
  box: THREE.Box3,
  imageAspect: number,
  projector: THREE.Vector3,
  right: THREE.Vector3,
  up: THREE.Vector3
): void {
  const geometry = target.mesh.geometry;
  const position = geometry.getAttribute("position");
  const normals = geometry.getAttribute("normal");
  if (!position) return;

  // Extent of the slot's box measured along the projection's own right/up
  // axes. Computed by projecting the eight corners rather than reading
  // `box.getSize()` because neither axis is guaranteed to be world-aligned —
  // the shoe projection is tilted on two axes at once.
  let minRight = Infinity;
  let maxRight = -Infinity;
  let minUp = Infinity;
  let maxUp = -Infinity;
  const corner = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    corner.set(
      i & 1 ? box.max.x : box.min.x,
      i & 2 ? box.max.y : box.min.y,
      i & 4 ? box.max.z : box.min.z
    );
    const alongRight = corner.dot(right);
    minRight = Math.min(minRight, alongRight);
    maxRight = Math.max(maxRight, alongRight);
    const alongUp = corner.dot(up);
    minUp = Math.min(minUp, alongUp);
    maxUp = Math.max(maxUp, alongUp);
  }

  const boxWidth = Math.max(maxRight - minRight, 1e-6);
  const boxHeight = Math.max(maxUp - minUp, 1e-6);
  const boxAspect = boxWidth / boxHeight;
  const imageWide = imageAspect >= boxAspect;
  const fitWidth = imageWide ? boxWidth : boxHeight * imageAspect;
  const fitHeight = imageWide ? boxWidth / imageAspect : boxHeight;
  const centerRight = (minRight + maxRight) / 2;
  const centerUp = (minUp + maxUp) / 2;

  const count = position.count;
  const uv = new Float32Array(count * 2);
  const color = new Float32Array(count * 4);
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(target.matrix);
  const vertex = new THREE.Vector3();
  const normal = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    vertex.fromBufferAttribute(position, i).applyMatrix4(target.matrix);
    const u = (vertex.dot(right) - centerRight) / fitWidth + 0.5;
    const v = (vertex.dot(up) - centerUp) / fitHeight + 0.5;
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;

    let facing = 1;
    if (normals) {
      normal.fromBufferAttribute(normals, i).applyMatrix3(normalMatrix).normalize();
      facing = smoothstep(
        DECAL_FACING_FADE_OUT,
        DECAL_FACING_FADE_IN,
        normal.dot(projector)
      );
    }

    // RGB stays white so the photo's own colours survive; only alpha carries
    // the masks. An itemSize of 4 is what makes three define USE_COLOR_ALPHA
    // and multiply the fragment's alpha by this — with 3 components the fades
    // would silently do nothing.
    color[i * 4] = 1;
    color[i * 4 + 1] = 1;
    color[i * 4 + 2] = 1;
    color[i * 4 + 3] = facing * edgeMask(u) * edgeMask(v);
  }

  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute("color", new THREE.BufferAttribute(color, 4));
}

/** Union of a decal group's geometry bounds, in character-root space — the box the image is fitted into. */
function decalGroupBox(group: DecalGroup): THREE.Box3 {
  const box = new THREE.Box3();
  for (const target of group.targets) {
    const geometry = target.mesh.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    if (bounds) box.union(bounds.clone().applyMatrix4(target.matrix));
  }
  return box;
}

/** Project a freshly-loaded image across every group of one slot and reveal the decal. */
function applySlotTexture(decal: SlotDecal, loaded: LoadedGarmentTexture): void {
  for (const group of decal.groups.values()) {
    const box = decalGroupBox(group);
    if (box.isEmpty()) continue;
    for (const target of group.targets) {
      projectDecalUVs(
        target,
        box,
        loaded.aspect,
        group.projector,
        group.right,
        group.up
      );
    }
  }

  decal.material.map = loaded.texture;
  decal.material.needsUpdate = true;

  // Revealed only now, and only after the UVs and vertex masks are in place,
  // so the first frame the decal appears in is already correct — no flash of
  // an unprojected or white shell.
  for (const group of decal.groups.values()) {
    for (const target of group.targets) {
      target.mesh.visible = true;
    }
  }
}

/**
 * Snapshot every decal mesh's transform into character space and register the
 * plan against its group.
 *
 * Runs once, at the very end of `buildCharacterGroup`, while the group is
 * still detached and therefore its own root — see `DecalTarget.matrix` for why
 * capturing it at this exact moment (rather than at projection time, when the
 * avatar is mounted, scaled by the viewer and bobbing on the idle animation)
 * is what keeps the projection stable.
 */
function finalizeDecals(root: THREE.Group, decals: CharacterDecals): void {
  const slots = Object.keys(decals) as GarmentSlot[];
  if (slots.length === 0) return;

  root.updateMatrixWorld(true);
  for (const slot of slots) {
    const decal = decals[slot];
    if (!decal) continue;
    for (const group of decal.groups.values()) {
      for (const target of group.targets) {
        target.matrix.copy(target.mesh.matrixWorld);
      }
    }
  }

  decalRegistry.set(root, decals);
}

/**
 * Kick off texture loading for every equipped slot of a built character, and
 * return the teardown for it.
 *
 * This is the async half of a synchronous builder: `buildCharacterGroup`
 * returns a fully-formed, fully-tinted character immediately, and this swaps
 * real photography in underneath it as each image lands. There is deliberately
 * no loading state and no "undressed" intermediate — the character is always
 * dressed, first in the garment's colour and then in its photo.
 *
 * The returned function must be called when the group is torn down. It stops
 * any in-flight application and releases the texture references, which is what
 * lets garmentTexture.ts eventually dispose them.
 */
export function applyGarmentTextures(group: THREE.Group): () => void {
  const decals = decalRegistry.get(group);
  if (!decals) return () => {};

  let cancelled = false;
  const acquired: string[] = [];

  for (const slot of Object.keys(decals) as GarmentSlot[]) {
    const decal = decals[slot];
    if (!decal) continue;

    // Acquire synchronously, before any await, so the reference is held even
    // if this group is torn down on the very next tick.
    acquired.push(decal.url);
    void acquireGarmentTexture(decal.url).then((loaded) => {
      if (cancelled || !loaded) return;
      applySlotTexture(decal, loaded);
    });
  }

  return () => {
    if (cancelled) return;
    cancelled = true;
    for (const url of acquired) releaseGarmentTexture(url);
  };
}

/** All materials used by one built character, created once per rebuild and reused across many meshes to keep draw calls / GC pressure down. */
type CharacterMaterials = ReturnType<typeof createMaterials>;

/**
 * Builds every MeshStandardMaterial the character needs. Roughness sits in
 * the 0.6-0.85 "soft, not shiny-plastic" band the app's existing studio
 * lighting (AvatarSpikeScreen) is tuned for; metalness is 0 everywhere
 * except a couple of tiny accent parts (eye sparkle / earrings) that read
 * better a bit glossier — still non-metallic, just lower roughness.
 *
 * `equipped` (optional) supplies per-slot garment colors — when a slot is
 * equipped, its material is tinted by that garment's `color` instead of the
 * fixed neutral-clothing color, and that ONE material instance is reused
 * across every mesh for that slot (torso cloth + sleeves for `top`, hip
 * band + pants for `bottom`, both shoes for `shoes`) so equipping a
 * garment never adds extra materials/draw calls.
 */
function createMaterials(c: Customization, equipped?: EquippedGarments) {
  const topColor = equipped?.top?.color ?? NEUTRAL_TOP_COLOR;
  const bottomColor = equipped?.bottom?.color ?? NEUTRAL_BOTTOM_COLOR;
  const shoeColor = equipped?.shoes?.color ?? NEUTRAL_SHOE_COLOR;
  const accessoryColor = equipped?.accessory?.color ?? NEUTRAL_ACCESSORY_COLOR;

  return {
    skin: new THREE.MeshStandardMaterial({ color: c.skinTone, roughness: 0.78, metalness: 0 }),
    hair: new THREE.MeshStandardMaterial({ color: c.hairColor, roughness: 0.62, metalness: 0 }),
    eyebrow: new THREE.MeshStandardMaterial({ color: c.eyebrowColor, roughness: 0.68, metalness: 0 }),
    facialHair: new THREE.MeshStandardMaterial({
      color: c.facialHairColor,
      roughness: 0.7,
      metalness: 0,
    }),
    eyeWhite: new THREE.MeshStandardMaterial({ color: "#FFFFFF", roughness: 0.45, metalness: 0 }),
    iris: new THREE.MeshStandardMaterial({ color: c.eyeColor, roughness: 0.35, metalness: 0 }),
    pupil: new THREE.MeshStandardMaterial({ color: PUPIL_COLOR, roughness: 0.4, metalness: 0 }),
    highlight: new THREE.MeshStandardMaterial({ color: "#FFFFFF", roughness: 0.25, metalness: 0 }),
    mouth: new THREE.MeshStandardMaterial({ color: MOUTH_COLOR, roughness: 0.6, metalness: 0 }),
    top: new THREE.MeshStandardMaterial({ color: topColor, roughness: 0.82, metalness: 0 }),
    bottom: new THREE.MeshStandardMaterial({
      color: bottomColor,
      roughness: 0.82,
      metalness: 0,
    }),
    shoe: new THREE.MeshStandardMaterial({ color: shoeColor, roughness: 0.75, metalness: 0 }),
    glasses: new THREE.MeshStandardMaterial({ color: GLASSES_COLOR, roughness: 0.35, metalness: 0 }),
    earring: new THREE.MeshStandardMaterial({ color: EARRING_COLOR, roughness: 0.3, metalness: 0 }),
    // Slightly softer/less shiny than the metal accents above: the accessory
    // slot is most often a scarf or a knit, and a fabric-range roughness reads
    // better than jewellery for the average case.
    accessory: new THREE.MeshStandardMaterial({
      color: accessoryColor,
      roughness: 0.78,
      metalness: 0,
    }),
  };
}

// ---------------------------------------------------------------------------
// Torso / neck / clothing — `bodyType` drives this section (shoulder/waist/
// hip radii). The torso is two tapered CylinderGeometry sections (radiusTop
// != radiusBottom gives a smooth trapezoid, not a blocky cylinder) stacked
// hip->waist->shoulder; a thin cylinder as a neck; then two slightly-larger
// clone cylinders as a soft top + bottom garment layer so the body never
// reads as nude.
//
// `topGarment` is the equipped `top` slot (see EquippedGarments) — when
// present the torso cloth is cut "fitted" and longer, reaching down past
// the waist to the hip (a real shirt hem) instead of stopping mid-torso,
// and — when `topGarment.long` (a dress) — an extra a-line skirt panel
// hangs from the hip down over the upper legs.
//
// When either equipped garment carries a `textureUrl`, a matching decal shell
// is registered alongside each cloth mesh (see GARMENT DECALS above). The top
// slot's shells are the torso cloth plus, for a dress, the skirt panel — one
// shared projection across both, so a dress photo runs the full length of the
// silhouette instead of being cut in half at the hip. The hip band belongs to
// the *bottom* slot's projection, which buildLeg completes with the two
// trouser legs.
// ---------------------------------------------------------------------------
function buildTorsoAndNeck(
  root: THREE.Group,
  materials: CharacterMaterials,
  metrics: BodyMetrics,
  decals: CharacterDecals,
  topGarment?: GarmentVisual,
  bottomGarment?: GarmentVisual
): void {
  const lowerTorso = new THREE.Mesh(
    new THREE.CylinderGeometry(metrics.waistR, metrics.hipR, LOWER_TORSO_HEIGHT, 16),
    materials.skin
  );
  lowerTorso.position.y = HIP_Y + LOWER_TORSO_HEIGHT / 2;
  root.add(lowerTorso);

  const upperTorso = new THREE.Mesh(
    new THREE.CylinderGeometry(metrics.shoulderR, metrics.waistR, UPPER_TORSO_HEIGHT, 16),
    materials.skin
  );
  upperTorso.position.y = WAIST_Y + UPPER_TORSO_HEIGHT / 2;
  root.add(upperTorso);

  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(metrics.shoulderR * 0.34, metrics.shoulderR * 0.37, NECK_HEIGHT, 12),
    materials.skin
  );
  neck.position.y = SHOULDER_Y + NECK_HEIGHT / 2;
  root.add(neck);

  const hasTop = !!topGarment;
  const topDecal = decalForSlot(decals, "top", topGarment);
  const bottomDecal = decalForSlot(decals, "bottom", bottomGarment);

  // Clothing top: with nothing equipped, a slightly larger clone of the
  // upper torso (a loose tee). Fitted/equipped: taller, reaching from the
  // hip up to the shoulder, so an equipped garment actually reads as worn
  // rather than identical to the neutral fallback.
  const clothTopHeight = hasTop
    ? SHOULDER_Y - HIP_Y + LOWER_TORSO_HEIGHT * 0.1
    : UPPER_TORSO_HEIGHT * 1.05;
  const clothTopRadiusTop = metrics.shoulderR * (hasTop ? 1.1 : 1.06);
  const clothTopRadiusBottom = hasTop ? metrics.hipR * 1.08 : metrics.waistR * 1.1;
  const clothTopY = hasTop
    ? HIP_Y - LOWER_TORSO_HEIGHT * 0.05 + clothTopHeight / 2
    : WAIST_Y + UPPER_TORSO_HEIGHT * 0.52;

  const clothTop = new THREE.Mesh(
    new THREE.CylinderGeometry(
      clothTopRadiusTop,
      clothTopRadiusBottom,
      clothTopHeight,
      16
    ),
    materials.top
  );
  clothTop.position.y = clothTopY;
  root.add(clothTop);

  if (topDecal) {
    // Open-ended: the flat caps at the collar and hem face straight up/down,
    // so the facing fade would discard every fragment on them anyway.
    const shell = new THREE.Mesh(
      new THREE.CylinderGeometry(
        clothTopRadiusTop * (1 + DECAL_INFLATE),
        clothTopRadiusBottom * (1 + DECAL_INFLATE),
        clothTopHeight,
        DECAL_RADIAL_SEGMENTS,
        DECAL_HEIGHT_SEGMENTS,
        true
      ),
      topDecal.material
    );
    shell.position.y = clothTopY;
    root.add(shell);
    addDecalMesh(topDecal, "torso", shell, AXIS_FRONT, AXIS_RIGHT, AXIS_UP);
  }

  // Dress: an a-line skirt panel hanging from the hip over the upper legs,
  // tinted the same color/material as the top (a dress is one garment).
  if (topGarment?.long) {
    const skirtHeight = LEG_LENGTH * 0.55;
    const skirtRadiusTop = metrics.hipR * 1.08;
    const skirtRadiusBottom = metrics.hipR * 1.32;
    const skirtY = HIP_Y - skirtHeight / 2;

    const skirt = new THREE.Mesh(
      new THREE.CylinderGeometry(skirtRadiusTop, skirtRadiusBottom, skirtHeight, 16),
      materials.top
    );
    skirt.position.y = skirtY;
    root.add(skirt);

    if (topDecal) {
      // Registered under the same "torso" group key as the bodice above, so
      // the two share one bounding box and the dress photo is fitted across
      // the whole garment rather than once per panel.
      const skirtShell = new THREE.Mesh(
        new THREE.CylinderGeometry(
          skirtRadiusTop * (1 + DECAL_INFLATE),
          skirtRadiusBottom * (1 + DECAL_INFLATE),
          skirtHeight,
          DECAL_RADIAL_SEGMENTS,
          DECAL_HEIGHT_SEGMENTS,
          true
        ),
        topDecal.material
      );
      skirtShell.position.y = skirtY;
      root.add(skirtShell);
      addDecalMesh(topDecal, "torso", skirtShell, AXIS_FRONT, AXIS_RIGHT, AXIS_UP);
    }
  }

  // Clothing bottom: wraps the hip + a touch of upper-leg, like
  // shorts/trousers waist. Skipped when a dress is equipped — the skirt
  // panel above already covers this area in the top's color, and layering
  // a second, differently-colored band here would peek out at the seam.
  if (!topGarment?.long) {
    const bandHeight = LOWER_TORSO_HEIGHT * 1.35;
    const bandRadiusTop = metrics.waistR * 1.05;
    const bandRadiusBottom = metrics.hipR * 1.12;
    const bandY = HIP_Y + LOWER_TORSO_HEIGHT * 0.55;

    const clothBottom = new THREE.Mesh(
      new THREE.CylinderGeometry(bandRadiusTop, bandRadiusBottom, bandHeight, 16),
      materials.bottom
    );
    clothBottom.position.y = bandY;
    root.add(clothBottom);

    if (bottomDecal) {
      const bandShell = new THREE.Mesh(
        new THREE.CylinderGeometry(
          bandRadiusTop * (1 + DECAL_INFLATE),
          bandRadiusBottom * (1 + DECAL_INFLATE),
          bandHeight,
          DECAL_RADIAL_SEGMENTS,
          Math.round(DECAL_HEIGHT_SEGMENTS / 2),
          true
        ),
        bottomDecal.material
      );
      bandShell.position.y = bandY;
      root.add(bandShell);
      addDecalMesh(bottomDecal, "legs", bandShell, AXIS_FRONT, AXIS_RIGHT, AXIS_UP);
    }
  }
}

/**
 * One arm: a pivot group at the shoulder (so rotation tilts around the
 * shoulder join, not the arm's own center), a capsule for the limb, a small
 * sphere for the hand, and a sleeve-cap capsule (clothing) over the top of
 * the arm. `side` is +1 (character's left, +X) or -1 (right, -X).
 *
 * `topGarment` is the equipped `top` slot — when present, the sleeve is cut
 * longer (past the elbow, like an actual short/mid sleeve) instead of the
 * short shoulder-cap the neutral fallback uses.
 */
function buildArm(
  side: 1 | -1,
  metrics: BodyMetrics,
  materials: CharacterMaterials,
  topGarment?: GarmentVisual
): THREE.Group {
  const shoulderX = side * (metrics.shoulderR + metrics.armR * 0.8);
  const armTopY = SHOULDER_Y - metrics.armR * 0.2;
  const armBottomY = HIP_Y + 0.04;
  const armLength = Math.max(0.2, armTopY - armBottomY);

  const pivot = new THREE.Group();
  pivot.position.set(shoulderX, armTopY, 0);
  // Slight outward tilt so arms clear the torso and read as a relaxed
  // stance rather than a stiff T-pose.
  pivot.rotation.z = side * -0.11;

  const armMesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(metrics.armR, armLength * 0.7, 4, 10),
    materials.skin
  );
  armMesh.position.y = -armLength / 2;
  pivot.add(armMesh);

  const hand = new THREE.Mesh(new THREE.SphereGeometry(metrics.armR * 1.05, 12, 10), materials.skin);
  hand.position.y = -armLength + metrics.armR * 0.3;
  pivot.add(hand);

  const hasTop = !!topGarment;
  const sleeveLength = hasTop ? armLength * 0.52 : armLength * 0.2;
  const sleeveRadius = metrics.armR * (hasTop ? 1.3 : 1.2);
  const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(sleeveRadius, sleeveLength, 3, 10), materials.top);
  sleeve.position.y = -sleeveLength / 2 - metrics.armR * 0.1;
  pivot.add(sleeve);

  return pivot;
}

/**
 * One leg: capsule limb + a squashed-sphere "shoe" + a shorts/pants cap over
 * the top of the thigh.
 *
 * `bottomGarment` (equipped `bottom` slot) stretches the shorts-cap into a
 * full pants leg reaching almost to the ankle instead of just covering the
 * upper thigh. `shoesGarment` (equipped `shoes` slot) enlarges the shoe and
 * adds a small ankle-cuff band so an equipped shoe reads as more than the
 * bare neutral silhouette.
 *
 * Decals (see GARMENT DECALS above) attach here for two slots:
 *   * **bottom** — this leg's trouser shell joins the `"legs"` group that
 *     buildTorsoAndNeck started with the hip band. Both legs and the band
 *     share one front-on projection, so a flat-lay trouser photo lands with
 *     its left leg on the character's screen-left leg, as printed.
 *   * **shoes** — one group per foot, projected along that foot's **outward**
 *     axis rather than front-on. Shoe photography is overwhelmingly a side
 *     profile, and the shoe primitive is elongated front-to-back, so a
 *     front-on projection would compress the whole shoe into its narrow toe
 *     face. Projecting sideways also means the toe lands toward the front of
 *     the foot on both sides, which is why `right` flips with `side`.
 */
function buildLeg(
  side: 1 | -1,
  metrics: BodyMetrics,
  materials: CharacterMaterials,
  decals: CharacterDecals,
  bottomGarment?: GarmentVisual,
  shoesGarment?: GarmentVisual
): THREE.Group {
  const hipX = side * metrics.hipR * 0.55;
  const legLength = HIP_Y;

  const leg = new THREE.Group();
  leg.position.set(hipX, HIP_Y, 0);

  const legMesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(metrics.legR, legLength * 0.62, 4, 10),
    materials.skin
  );
  legMesh.position.y = -legLength / 2;
  leg.add(legMesh);

  const hasShoes = !!shoesGarment;
  const shoeRadius = metrics.legR * (hasShoes ? 1.28 : 1.2);
  const shoeScaleZ = hasShoes ? 1.45 : 1.3;
  const shoeY = -legLength + metrics.legR * 0.25;
  const shoeZ = metrics.legR * (hasShoes ? 0.38 : 0.3);

  const shoe = new THREE.Mesh(
    new THREE.SphereGeometry(shoeRadius, 12, 8),
    materials.shoe
  );
  shoe.scale.set(1, 0.55, shoeScaleZ);
  shoe.position.set(0, shoeY, shoeZ);
  leg.add(shoe);

  if (hasShoes) {
    const cuff = new THREE.Mesh(
      new THREE.CylinderGeometry(metrics.legR * 1.05, metrics.legR * 1.18, metrics.legR * 0.55, 10),
      materials.shoe
    );
    cuff.position.set(0, -legLength + metrics.legR * 0.6, metrics.legR * 0.15);
    leg.add(cuff);
  }

  const shoesDecal = decalForSlot(decals, "shoes", shoesGarment);
  if (shoesDecal) {
    const shoeShell = new THREE.Mesh(
      new THREE.SphereGeometry(shoeRadius * (1 + DECAL_INFLATE), 24, 16),
      shoesDecal.material
    );
    shoeShell.scale.set(1, 0.55, shoeScaleZ);
    shoeShell.position.set(0, shoeY, shoeZ);
    leg.add(shoeShell);
    // The ankle cuff is deliberately left as flat tint: it reads as the
    // garment's own trim, and wrapping it into the projection would drag the
    // shoe's bounding box upward and shrink the photo.
    //
    // One group per foot, not one shared across both: a shoe photo shows a
    // single shoe, so each foot needs the whole image fitted to its own box.
    const shoeAxes = shoeProjection(side);
    addDecalMesh(
      shoesDecal,
      `shoe:${side}`,
      shoeShell,
      shoeAxes.projector,
      shoeAxes.right,
      shoeAxes.up
    );
  }

  const hasBottom = !!bottomGarment;
  const pantsLength = hasBottom ? legLength * 0.72 : legLength * 0.2;
  const pantsRadius = metrics.legR * (hasBottom ? 1.16 : 1.22);
  const pantsY = -pantsLength / 2 - metrics.legR * 0.08;
  const pants = new THREE.Mesh(new THREE.CapsuleGeometry(pantsRadius, pantsLength, 3, 10), materials.bottom);
  pants.position.y = pantsY;
  leg.add(pants);

  const bottomDecal = decalForSlot(decals, "bottom", bottomGarment);
  if (bottomDecal) {
    const pantsShell = new THREE.Mesh(
      new THREE.CapsuleGeometry(
        pantsRadius * (1 + DECAL_INFLATE),
        pantsLength,
        4,
        DECAL_RADIAL_SEGMENTS
      ),
      bottomDecal.material
    );
    pantsShell.position.y = pantsY;
    leg.add(pantsShell);
    addDecalMesh(bottomDecal, "legs", pantsShell, AXIS_FRONT, AXIS_RIGHT, AXIS_UP);
  }

  return leg;
}

/**
 * Square/heart get a small extra skin-tone mesh blended over the jaw/chin —
 * square widens the jaw (a short wide cylinder), heart adds a pointed chin
 * bump. Round/oval/long rely purely on FACE_SHAPE_SCALE's non-uniform head
 * scale, so they need nothing extra here.
 */
function buildJawAccent(headGroup: THREE.Group, materials: CharacterMaterials, faceShape: FaceShape): void {
  if (faceShape === "square") {
    const jaw = new THREE.Mesh(
      new THREE.CylinderGeometry(HEAD_RADIUS * 0.62, HEAD_RADIUS * 0.68, HEAD_RADIUS * 0.4, 16),
      materials.skin
    );
    jaw.position.set(0, -HEAD_RADIUS * 0.62, HEAD_RADIUS * 0.05);
    headGroup.add(jaw);
  } else if (faceShape === "heart") {
    const chin = new THREE.Mesh(new THREE.SphereGeometry(HEAD_RADIUS * 0.32, 14, 12), materials.skin);
    chin.scale.set(0.85, 0.8, 0.9);
    chin.position.set(0, -HEAD_RADIUS * 0.85, HEAD_RADIUS * 0.35);
    headGroup.add(chin);
  }
}

/** Both eyes: white + iris + pupil + a tiny sparkle highlight, shaped/tilted per `eyeShape`. */
function buildEyes(headGroup: THREE.Group, materials: CharacterMaterials, eyeShape: EyeShape): void {
  const p = EYE_SHAPE_PARAMS[eyeShape] ?? EYE_SHAPE_PARAMS.almond;
  const R = HEAD_RADIUS;

  ([1, -1] as const).forEach((side) => {
    const eyeGroup = new THREE.Group();
    eyeGroup.position.set(side * R * 0.4, R * 0.06, R * 0.86);
    eyeGroup.rotation.z = side * p.tilt;

    const white = new THREE.Mesh(new THREE.SphereGeometry(R * 0.155, 14, 12), materials.eyeWhite);
    white.scale.set(p.rx, p.ry, 0.55);
    eyeGroup.add(white);

    const iris = new THREE.Mesh(new THREE.SphereGeometry(R * 0.095, 12, 10), materials.iris);
    iris.scale.set(1, 1, 0.6);
    iris.position.z = R * 0.06;
    eyeGroup.add(iris);

    const pupil = new THREE.Mesh(new THREE.SphereGeometry(R * 0.045, 10, 8), materials.pupil);
    pupil.scale.set(1, 1, 0.6);
    pupil.position.z = R * 0.095;
    eyeGroup.add(pupil);

    const highlight = new THREE.Mesh(new THREE.SphereGeometry(R * 0.02, 8, 6), materials.highlight);
    highlight.position.set(-R * 0.03, R * 0.035, R * 0.11);
    eyeGroup.add(highlight);

    if (eyeShape === "hooded") {
      const lid = new THREE.Mesh(new THREE.SphereGeometry(R * 0.13, 12, 10), materials.skin);
      lid.scale.set(1.1, 0.7, 0.9);
      lid.position.set(0, R * 0.11, R * 0.02);
      eyeGroup.add(lid);
    }

    headGroup.add(eyeGroup);
  });
}

/** Both eyebrows: a thin box bar, arched per `eyebrows` style, colored `eyebrowColor`. */
function buildEyebrows(headGroup: THREE.Group, materials: CharacterMaterials, style: string): void {
  const p = EYEBROW_STYLE_PARAMS[style] ?? EYEBROW_STYLE_PARAMS.natural;
  const R = HEAD_RADIUS;

  ([1, -1] as const).forEach((side) => {
    const brow = new THREE.Mesh(
      new THREE.BoxGeometry(R * 0.5, R * p.thickness, R * 0.12),
      materials.eyebrow
    );
    brow.position.set(side * R * 0.4, R * 0.36, R * 0.88);
    brow.rotation.z = side * -p.arch;
    headGroup.add(brow);
  });
}

/** A tiny skin-tone nose bump, centered under the eyes. Not customization-driven — every face gets one. */
function buildNose(headGroup: THREE.Group, materials: CharacterMaterials): void {
  const R = HEAD_RADIUS;
  const nose = new THREE.Mesh(new THREE.SphereGeometry(R * 0.085, 12, 10), materials.skin);
  nose.scale.set(0.85, 0.9, 1.15);
  nose.position.set(0, -R * 0.24, R * 0.95);
  headGroup.add(nose);
}

/** A simple smiling mouth line: half a torus (a "cup" shape reads as a smile), rotated 180 deg to sit on the lower semicircle. */
function buildMouth(headGroup: THREE.Group, materials: CharacterMaterials): void {
  const R = HEAD_RADIUS;
  const mouth = new THREE.Mesh(
    new THREE.TorusGeometry(R * 0.16, R * 0.022, 8, 20, Math.PI),
    materials.mouth
  );
  mouth.rotation.z = Math.PI;
  mouth.position.set(0, -R * 0.58, R * 0.85);
  headGroup.add(mouth);
}

/** Facial hair: stubble (instanced dots), mustache, goatee (mustache + chin blob), or a full beard (a jaw-height band cut from a sphere). Colored `facialHairColor`. */
function buildFacialHair(headGroup: THREE.Group, materials: CharacterMaterials, style: string): void {
  const R = HEAD_RADIUS;
  if (style === "none") return;

  const makeMustache = () => {
    const m = new THREE.Mesh(
      new THREE.TorusGeometry(R * 0.15, R * 0.028, 8, 16, Math.PI),
      materials.facialHair
    );
    m.position.set(0, -R * 0.46, R * 0.9);
    return m;
  };

  const makeChinBlob = () => {
    const c = new THREE.Mesh(new THREE.SphereGeometry(R * 0.16, 12, 10), materials.facialHair);
    c.scale.set(0.9, 0.85, 0.7);
    c.position.set(0, -R * 0.68, R * 0.78);
    return c;
  };

  const makeFullBeard = () => {
    // A band cut from a sphere (phi restricted to the front-facing half via
    // 0..PI so z stays positive — see three's sphere parametrization —
    // theta restricted to a jaw-height belt) sitting just outside the head.
    return new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.03, 20, 16, 0, Math.PI, Math.PI * 0.42, Math.PI * 0.5),
      materials.facialHair
    );
  };

  const makeStubble = () => {
    const geo = new THREE.SphereGeometry(R * 0.018, 6, 5);
    const count = 22;
    const inst = new THREE.InstancedMesh(geo, materials.facialHair, count);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const t = i / count;
      const angle = -Math.PI * 0.55 + t * Math.PI * 1.1;
      const y = -R * 0.42 - Math.abs(Math.sin(t * Math.PI)) * R * 0.18;
      const x = Math.sin(angle) * R * 0.42;
      const z = R * 0.78 + Math.cos(angle) * R * 0.12;
      dummy.position.set(x, y, z);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    return inst;
  };

  switch (style) {
    case "stubble":
      headGroup.add(makeStubble());
      break;
    case "mustache":
      headGroup.add(makeMustache());
      break;
    case "goatee":
      headGroup.add(makeMustache());
      headGroup.add(makeChinBlob());
      break;
    case "full":
      headGroup.add(makeFullBeard());
      break;
    default:
      break;
  }
}

/**
 * Hair — one recognizable shape per `hairStyle` id, colored `hairColor`.
 * Built from partial-sphere "caps" (SphereGeometry's thetaStart/thetaLength
 * lets us take just the top portion of a sphere, which sits on the scalp
 * like a cap of hair), capsules for ponytails/braids/side panels, and
 * InstancedMesh clusters of small spheres for the bumpy wavy/curly looks.
 */
function buildHair(headGroup: THREE.Group, materials: CharacterMaterials, hairStyle: string): void {
  const R = HEAD_RADIUS;
  const hairMat = materials.hair;

  const addCap = (thetaLength: number, radiusScale = 1.05): THREE.Mesh => {
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(R * radiusScale, 24, 16, 0, Math.PI * 2, 0, thetaLength),
      hairMat
    );
    headGroup.add(cap);
    return cap;
  };

  const addSidePanel = (side: 1 | -1, length: number, zOffset = 0, radiusScale = 0.22): void => {
    const panel = new THREE.Mesh(
      new THREE.CapsuleGeometry(R * radiusScale, length * 0.8, 3, 8),
      hairMat
    );
    panel.position.set(side * R * 0.92, -length / 2, zOffset);
    headGroup.add(panel);
  };

  /** A ring of small spheres around a latitude band — the "bumpy" wavy/curly hair texture. Deterministic (index-based) offsets, not Math.random, so a rebuild never pops between runs. */
  const addBumps = (count: number, bandTheta: number, radiusScale: number, bumpScale: number): void => {
    const geo = new THREE.SphereGeometry(R * bumpScale, 8, 6);
    const inst = new THREE.InstancedMesh(geo, hairMat, count);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const wobble = 1 + 0.08 * Math.sin(i * 2.4);
      const y = Math.cos(bandTheta) * R * radiusScale * wobble;
      const ringR = Math.sin(bandTheta) * R * radiusScale * wobble;
      const x = Math.cos(a) * ringR;
      const z = Math.sin(a) * ringR;
      dummy.position.set(x, y, z);
      dummy.scale.setScalar(0.85 + 0.3 * ((i % 3) / 2));
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    headGroup.add(inst);
  };

  switch (hairStyle) {
    case "bald":
      break;

    case "buzz":
      addCap(Math.PI * 0.42, 1.015);
      break;

    case "sidePart": {
      const cap = addCap(Math.PI * 0.56, 1.05);
      cap.rotation.z = 0.1;
      cap.position.x = R * 0.03;
      break;
    }

    case "bob":
      addCap(Math.PI * 0.55, 1.05);
      addSidePanel(1, R * 1.7);
      addSidePanel(-1, R * 1.7);
      break;

    case "longStraight":
      addCap(Math.PI * 0.55, 1.05);
      addSidePanel(1, R * 3.4);
      addSidePanel(-1, R * 3.4);
      break;

    case "wavy":
      addCap(Math.PI * 0.5, 1.05);
      addBumps(16, Math.PI * 0.52, 1.06, 0.24);
      break;

    case "curly":
      addCap(Math.PI * 0.42, 1.02);
      addBumps(22, Math.PI * 0.48, 1.08, 0.22);
      break;

    case "afro": {
      // A big sphere offset up/back so the head still pokes out the front —
      // see the file-level notes on this trick.
      const afro = new THREE.Mesh(new THREE.SphereGeometry(R * 1.42, 22, 18), hairMat);
      afro.position.set(0, R * 0.18, -R * 0.12);
      headGroup.add(afro);
      break;
    }

    case "ponytail": {
      addCap(Math.PI * 0.56, 1.05);
      const tailPivot = new THREE.Group();
      tailPivot.position.set(0, R * 0.35, -R * 0.85);
      tailPivot.rotation.x = 0.55;
      const tail = new THREE.Mesh(new THREE.CapsuleGeometry(R * 0.26, R * 2.0, 3, 10), hairMat);
      tail.position.y = -R * 1.1;
      tailPivot.add(tail);
      const tie = new THREE.Mesh(new THREE.SphereGeometry(R * 0.22, 10, 8), hairMat);
      tailPivot.add(tie);
      headGroup.add(tailPivot);
      break;
    }

    case "bun": {
      addCap(Math.PI * 0.56, 1.05);
      const bun = new THREE.Mesh(new THREE.SphereGeometry(R * 0.4, 14, 12), hairMat);
      bun.position.set(0, R * 0.55, -R * 0.55);
      headGroup.add(bun);
      break;
    }

    case "braids":
      addCap(Math.PI * 0.54, 1.05);
      addSidePanel(1, R * 2.1, -R * 0.25, 0.16);
      addSidePanel(-1, R * 2.1, -R * 0.25, 0.16);
      break;

    case "short":
    default:
      addCap(Math.PI * 0.56, 1.05);
      break;
  }
}

/** Glasses: two torus "lenses" sized to roughly match the eye shape, a bridge, and two thin temple arms. */
function buildGlasses(headGroup: THREE.Group, materials: CharacterMaterials, eyeShape: EyeShape): void {
  const R = HEAD_RADIUS;
  const p = EYE_SHAPE_PARAMS[eyeShape] ?? EYE_SHAPE_PARAMS.almond;
  const lensR = R * 0.155 * Math.max(p.rx, p.ry) * 1.15;

  ([1, -1] as const).forEach((side) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(lensR, R * 0.014, 8, 20), materials.glasses);
    ring.position.set(side * R * 0.4, R * 0.06, R * 0.92);
    headGroup.add(ring);

    const temple = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.012, R * 0.012, R * 0.5, 6), materials.glasses);
    temple.rotation.x = Math.PI / 2;
    temple.rotation.z = side * 0.15;
    temple.position.set(side * (R * 0.4 + lensR * 0.9), R * 0.07, R * 0.55);
    headGroup.add(temple);
  });

  const bridge = new THREE.Mesh(new THREE.BoxGeometry(R * 0.18, R * 0.02, R * 0.02), materials.glasses);
  bridge.position.set(0, R * 0.06, R * 0.94);
  headGroup.add(bridge);
}

/** Earrings: two tiny gold sphere studs at roughly ear height. */
function buildEarrings(headGroup: THREE.Group, materials: CharacterMaterials): void {
  const R = HEAD_RADIUS;
  ([1, -1] as const).forEach((side) => {
    const stud = new THREE.Mesh(new THREE.SphereGeometry(R * 0.045, 10, 8), materials.earring);
    stud.position.set(side * R * 0.97, -R * 0.05, R * 0.05);
    headGroup.add(stud);
  });
}

// ---------------------------------------------------------------------------
// THE ACCESSORY SLOT — an equipped wardrobe/shop item, worn at the neckline.
//
// WHY THE NECKLINE, FOR A CATCH-ALL CATEGORY
// `accessory` is the app's only unstructured category: the seeded catalog
// alone holds a scarf, a beanie, a cap, a leather belt and a wallet, with no
// sub-type to tell them apart. No single procedural shape is all of those, so
// the honest goal is not "model the item" but "show, in the item's own colour,
// that it is on" — which is exactly the frame PRODUCT_SPEC §5b already sets
// for 3D try-on ("a preview, not an exact replica").
//
// Given that, the neckline is the best available anchor:
//   * it is dead-centre in the try-on screen's default framing, so the user
//     sees the equip land without rotating the character;
//   * it is the one region that collides with nothing — not the top/bottom/
//     shoes garment meshes, not the hair (the afro style's sphere reaches
//     R*1.42 around the head, so anything worn ON the head would be swallowed
//     by it), and not the face;
//   * a ring at the collar plus a knot at the front reads plausibly as the
//     most common accessory shapes (scarf, necklace, collar, tie) and reads as
//     "an accessory" rather than as a glitch for the rest.
//
// RECONCILIATION WITH THE CREATOR'S OWN ACCESSORIES — THEY COEXIST.
// `Customization.accessories` ("glasses" | "earrings", see
// features/creator/customization.ts) describes the character's *face*: it is
// saved on the avatar row and is part of who they are, the same way their eye
// colour is. An equipped accessory is part of *what they are wearing today*
// and is saved on the outfit. Those are different layers of identity, so
// neither may silently overwrite the other: equipping a scarf must not take a
// user's glasses off their face, and unequipping it must not have to put them
// back.
//
// That is only safe because the two are disjoint BY CONSTRUCTION — creator
// accessories are built into `headGroup` (lenses on the eyes, studs on the
// ears) and this one is built at the neck on the root. The failure mode a
// "coexist" rule usually invites — two pairs of glasses intersecting on one
// face — is therefore not reachable here, rather than being suppressed at
// runtime. If the accessory slot ever grows head-worn geometry (a hat), THAT
// is the point at which a precedence rule has to be written, and the right one
// is almost certainly "the equipped item wins the geometry it needs, and only
// that geometry" — a hat should hide hair, not earrings.
//
// WHY THIS SLOT IS TINT-ONLY, WITH NO PHOTO DECAL
// Every other slot planar-projects the item's real photo (see GARMENT DECALS).
// This one deliberately does not, and it is not an omission:
//   * the decal fits the image to the slot's whole bounding box, contain-style.
//     A scarf ring's visible surface is a band a couple of centimetres thick,
//     so ~95% of the photo would land on nothing and the user would see a
//     narrow horizontal crop of a packshot smeared around a torus — that reads
//     as a texture bug, not as clothing.
//   * the facing fade (DECAL_FACING_FADE_IN) keeps only fragments pointing at
//     the projector, and a torus presents very few of those, so most of what
//     survived the crop would then be discarded anyway.
//   * accessory packshots are overwhelmingly small objects centred on white,
//     so the contain-fit's margins dominate — the honest result is mostly
//     background.
//   * the colour path is strong here precisely where the photo path is weak:
//     these items name their colour ("Rust" scarf, "Chestnut" belt, "Navy"
//     beanie) and `resolveGarmentColor` reads it. At this size, colour is the
//     signal a user can actually perceive.
// Consequently `decalForSlot` is never called for "accessory", the slot costs
// no texture download, and `GarmentVisual.textureUrl` is simply ignored for it.
// ---------------------------------------------------------------------------

/**
 * The equipped `accessory` slot: a soft ring around the base of the neck plus
 * a small knot/pendant at the front, both tinted with the item's colour.
 *
 * Sized off the neck (itself a fraction of `shoulderR`) so it tracks body
 * type, and seated low enough to overlap the top garment's collar slightly —
 * which is what makes it read as resting on the shoulders rather than
 * floating. It stays well inside the shoulder silhouette at every body type,
 * so it never pokes through an equipped jacket.
 */
function buildNeckAccessory(
  root: THREE.Group,
  materials: CharacterMaterials,
  metrics: BodyMetrics
): void {
  // Matches buildTorsoAndNeck's own neck cylinder (shoulderR * 0.34..0.37).
  const neckR = metrics.shoulderR * 0.355;
  const ringRadius = neckR * 1.22;
  const tubeRadius = neckR * 0.32;
  const ringY = SHOULDER_Y + NECK_HEIGHT * 0.55;

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(ringRadius, tubeRadius, 10, 24),
    materials.accessory
  );
  // Lying flat around the neck rather than standing up like a wheel.
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, ringY, 0);
  root.add(ring);

  // The knot sits on the character's front (+Z, the side the camera starts
  // on), just under the ring — where a scarf ties, a pendant hangs and a tie
  // knot sits. Squashed on Z so it hugs the ring instead of jutting forward.
  const knot = new THREE.Mesh(
    new THREE.SphereGeometry(tubeRadius * 1.55, 12, 10),
    materials.accessory
  );
  knot.scale.set(1, 1.35, 0.72);
  knot.position.set(0, ringY - tubeRadius * 1.15, ringRadius * 0.92);
  root.add(knot);
}

/**
 * Builds the full character as a single THREE.Group, ready to be mounted via
 * `<primitive object={...} />`. Synchronous and pure function of
 * `Customization` (+ the optional `equipped` garments) — call it again any
 * time either changes, and dispose the previous result via `disposeObject3D`
 * (the React component below does exactly this).
 *
 * Garment photos are the one thing that cannot be resolved synchronously. When
 * an equipped garment carries a `textureUrl`, this leaves a hidden decal shell
 * in place for it and records how to project onto it; pass the returned group
 * to `applyGarmentTextures` to start the download and reveal the photo when it
 * lands. Skip that call and you get today's behaviour — a correctly cut,
 * colour-tinted garment — with no download, no error path and no visual
 * placeholder.
 */
export function buildCharacterGroup(c: Customization, equipped?: EquippedGarments): THREE.Group {
  const root = new THREE.Group();
  root.name = "CharacterAvatar";

  const materials = createMaterials(c, equipped);
  const metrics = BODY_METRICS[c.bodyType] ?? BODY_METRICS.average;

  // Accumulates the (initially hidden) photo-decal shells the builders below
  // register for any equipped garment that has a `textureUrl`. Stays empty —
  // and therefore costs nothing at all — when no garment has one.
  const decals: CharacterDecals = {};

  // --- Body -----------------------------------------------------------
  buildTorsoAndNeck(root, materials, metrics, decals, equipped?.top, equipped?.bottom);
  root.add(buildArm(1, metrics, materials, equipped?.top));
  root.add(buildArm(-1, metrics, materials, equipped?.top));
  root.add(buildLeg(1, metrics, materials, decals, equipped?.bottom, equipped?.shoes));
  root.add(buildLeg(-1, metrics, materials, decals, equipped?.bottom, equipped?.shoes));

  // Built after the torso so it seats over the top garment's collar, and on
  // the root rather than on `headGroup` — see THE ACCESSORY SLOT above for why
  // keeping it off the head is what lets it coexist with the creator's own
  // glasses/earrings without any precedence check.
  if (equipped?.accessory) {
    buildNeckAccessory(root, materials, metrics);
  }

  // --- Head + face ------------------------------------------------------
  const headGroup = new THREE.Group();
  headGroup.name = "Head";
  headGroup.position.y = HEAD_CENTER_Y;
  root.add(headGroup);

  const faceScale = FACE_SHAPE_SCALE[c.faceShape] ?? FACE_SHAPE_SCALE.oval;
  const headMesh = new THREE.Mesh(new THREE.SphereGeometry(HEAD_RADIUS, 28, 20), materials.skin);
  headMesh.scale.set(faceScale.x, faceScale.y, faceScale.z);
  headGroup.add(headMesh);

  buildJawAccent(headGroup, materials, c.faceShape);
  buildEyes(headGroup, materials, c.eyeShape);
  buildEyebrows(headGroup, materials, c.eyebrows);
  buildNose(headGroup, materials);
  buildMouth(headGroup, materials);
  buildFacialHair(headGroup, materials, c.facialHair);
  buildHair(headGroup, materials, c.hairStyle);

  if (c.accessories.includes("glasses")) {
    buildGlasses(headGroup, materials, c.eyeShape);
  }
  if (c.accessories.includes("earrings")) {
    buildEarrings(headGroup, materials);
  }

  // Must be last: it needs every mesh in place before it can resolve each
  // decal's transform relative to the finished character.
  finalizeDecals(root, decals);

  return root;
}

export interface CharacterAvatarProps {
  customization: Customization;
  /**
   * Garments currently "worn" on each renderable slot (top/bottom/shoes/
   * accessory), from the user's wardrobe or straight off a Shop product. Omit
   * entirely (or omit individual slots) to fall back to the neutral
   * non-customizable clothing — see EquippedGarments/GarmentVisual above and
   * CharacterTryOnScreen, which is what actually populates this. An omitted
   * `accessory` simply means nothing is worn at the neckline; there is no
   * neutral fallback for it.
   *
   * A garment slot whose item carries a `textureUrl` has that photo downloaded
   * and projected onto it automatically; nothing extra is required of the
   * caller, and there is no loading state to render, because the slot is
   * already dressed in the garment's colour while the image is on its way.
   * `accessory` is the exception and renders as colour alone — see THE
   * ACCESSORY SLOT for why.
   */
  equipped?: EquippedGarments;
  /**
   * Subtle idle bob/sway so the character doesn't feel frozen. Cheap (a
   * couple of scalar writes per frame, no allocations) — disable for a
   * static thumbnail/capture context. Default true.
   */
  animate?: boolean;
}

/**
 * The public component: `<CharacterAvatar customization={...} />`. Rebuilds
 * the procedural mesh group only when a customization field OR an equipped
 * garment that affects geometry/material actually changes (see the useMemo
 * dependency list), and disposes the previous build's GPU resources on
 * every rebuild/unmount.
 */
export function CharacterAvatar({ customization, equipped, animate = true }: CharacterAvatarProps) {
  const groupRef = useRef<THREE.Group>(null);

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

  // Array identity isn't stable across loads (getMyAvatar/mergeCustomization
  // can return a new array each call), so key off its joined contents
  // instead of the reference.
  const accessoriesKey = accessories.join(",");

  // Same reasoning as accessoriesKey: `equipped` is frequently a freshly
  // built object every render (CharacterTryOnScreen recomputes it from
  // equip-state via useMemo, but callers aren't required to memoize it), so
  // key off its actual per-slot color/long/texture values rather than
  // reference identity. `textureUrl` has to be in here: two different products
  // can easily resolve to the same fallback tint, and without the url in the
  // key, swapping between them would leave the first one's photo on screen.
  const equippedKey = JSON.stringify({
    top: equipped?.top
      ? { c: equipped.top.color, l: !!equipped.top.long, t: equipped.top.textureUrl ?? null }
      : null,
    bottom: equipped?.bottom
      ? { c: equipped.bottom.color, t: equipped.bottom.textureUrl ?? null }
      : null,
    shoes: equipped?.shoes
      ? { c: equipped.shoes.color, t: equipped.shoes.textureUrl ?? null }
      : null,
    // Colour only, deliberately: the accessory slot renders no decal (see THE
    // ACCESSORY SLOT), so keying on its textureUrl would rebuild the whole
    // character for a change that cannot alter a single pixel.
    accessory: equipped?.accessory ? { c: equipped.accessory.color } : null,
  });

  const character = useMemo(
    () =>
      buildCharacterGroup(
        {
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
        },
        equipped
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- accessoriesKey/equippedKey stand in for `accessories`/`equipped`
    [
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
      accessoriesKey,
      equippedKey,
    ]
  );

  // Two jobs, in the same effect because they share a lifetime.
  //
  // Going in: start downloading any equipped garment's photo and project it
  // onto the decal shells the build left hidden. The character is already
  // on screen, dressed in the garment's colour, so this is a refinement rather
  // than a load — nothing pops in from empty, and if a download fails the
  // colour is simply what stays.
  //
  // Coming out: release those texture references and dispose the PREVIOUS
  // group's geometries/materials, whenever `character` changes (a new one was
  // just built above) or this component unmounts. Effect cleanups run before
  // the next effect body, so this frees the old group at exactly the right
  // moment without ever disposing the one currently mounted. Textures are
  // released rather than disposed here — garmentTexture.ts keeps recently-used
  // ones warm so re-equipping is instant, and disposes them on its own terms.
  useEffect(() => {
    const releaseTextures = applyGarmentTextures(character);
    return () => {
      releaseTextures();
      disposeObject3D(character);
    };
  }, [character]);

  // Idle life: a gentle sinusoidal bob + sway. Mutates the SAME persistent
  // outer group every frame (no allocations, no state) — the inner
  // `character` group is only ever rebuilt by the useMemo above.
  useFrame((state) => {
    if (!animate || !groupRef.current) return;
    const t = state.clock.elapsedTime;
    groupRef.current.position.y = Math.sin(t * 1.4) * 0.006;
    groupRef.current.rotation.y = Math.sin(t * 0.6) * 0.015;
  });

  return (
    <group ref={groupRef}>
      <primitive object={character} />
    </group>
  );
}

export default CharacterAvatar;
