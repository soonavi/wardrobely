import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Modal,
  PixelRatio,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Canvas, useFrame, useThree } from "@react-three/fiber/native";
import { ContactShadows } from "@react-three/drei/native";
import * as THREE from "three";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { CharacterAvatar, type EquippedGarments } from "./CharacterAvatar";
import { getMyAvatar } from "../../lib/api/avatars";
import { mergeCustomization, type Customization } from "../creator/customization";
import { listGarments } from "../../lib/api/garments";
import {
  createOutfit,
  getOutfit,
  updateOutfit,
  type CreateOutfitItemInput,
  type OutfitItemWithGarment,
  type OutfitWithItems,
} from "../../lib/api/outfits";
import {
  getProduct,
  recordProductTryOn,
  saveProductToWardrobe,
  searchProducts,
  type ProductWithBrand,
} from "../../lib/api/shop";
import { ProductImage } from "../shop/productImagery";
import { createCheckoutLink } from "../../lib/api/affiliate";
import { effectivePriceCents, formatPrice } from "../../lib/commerce/commission";
import { useAuthStore } from "../../lib/stores/useAuthStore";
import type { GarmentCategory, GarmentRow } from "../../lib/database.types";
import { ANCHOR_ZONES } from "../avatar/avatars";
import { resolveGarmentImageUrls } from "../../lib/garmentImage";
import {
  garmentToVisual,
  mapCategoryToSlot,
  productToVisual,
  resolveGarmentColor,
  resolveOutfitSlots,
  type EquipSlot,
  type ResolvedGarmentVisual,
} from "./garmentVisual";
import { ShareCard } from "../share/ShareCard";
import { useShareCard } from "../share/useShareCard";
import { colors, fonts, radius, spacing, type } from "../../lib/theme";

/**
 * ============================================================================
 * CharacterTryOnScreen — "try on your wardrobe on your 3D character".
 *
 * The lit, rotate/pinch 3D scene (backdrop, ground, studio 3-point lighting,
 * ContactShadows, capped device pixel ratio, gesture handling) is the SAME
 * proven setup CharacterViewerScreen.tsx uses, replicated here rather than
 * imported — this file follows that screen's own stated convention (see its
 * file-level comment) of duplicating the small, proven rendering block per
 * screen instead of sharing it, so each screen can tune framing/pacing
 * independently. See CharacterViewerScreen.tsx for the full rationale behind
 * each lighting/gesture choice; it isn't repeated here.
 *
 * What THIS screen adds on top of that base: it loads the user's wardrobe
 * (src/lib/api/garments.ts) alongside their customization, renders a bottom
 * drawer of garments grouped by category, and lets the user tap a garment to
 * "equip" it onto the matching CharacterAvatar slot (top/bottom/shoes/
 * accessory — see garmentVisual.ts's mapCategoryToSlot). Equipping projects
 * the item's actual photo onto the character where one is available —
 * `productToVisual` / `garmentToVisual` carry a `textureUrl`, and
 * CharacterAvatar planar-projects it onto a decal shell over the tinted mesh,
 * falling back to the flat colour tint whenever there's no usable image or the
 * download fails. A shopper trying on a catalog item therefore sees that item,
 * not a coloured stand-in. (The accessory slot is colour-only by design — see
 * CharacterAvatar's THE ACCESSORY SLOT.) "Save outfit" writes through
 * src/lib/api/outfits.ts's createOutfit, so an outfit saved here shows up in
 * the Outfits tab. `outfit_items` still carries x/y/scale/rotation columns
 * from the retired 2D collage studio; this 3D flow has no 2D placement of its
 * own, so it fills them with the ANCHOR_ZONES per-category defaults.
 *
 * THE ONLY TRY-ON SURFACE. This screen is what the Try On tab renders
 * (app/(tabs)/tryon.tsx). The 2D collage studio that used to sit behind it at
 * `/tryon-2d` has been deleted: it survived only because accessories had no 3D
 * body slot, and they now have one. Consequently this screen also owns the
 * whole Shop -> try it on -> buy loop:
 *
 *   * a `?productId=` deep link pushed by ProductDetailScreen, consumed
 *     exactly once (see `consumedProductIdRef` below),
 *   * a `?outfitId=` deep link pushed by the Outfits tab to reopen a saved
 *     look, consumed exactly once by the same mechanism
 *     (`consumedOutfitIdRef`) — which also puts the screen into "editing that
 *     outfit" mode, so saving updates it rather than duplicating it,
 *   * a "Shop" source in the garment drawer so catalog items can be tried
 *     without a wardrobe round-trip,
 *   * a Buy bar that mints a tracked affiliate click for whichever slot
 *     holds a product,
 *   * an outfit save that copies worn products into the wardrobe first,
 *     because `outfit_items.garment_id` cannot reference a catalog row.
 *
 * A slot therefore holds an `EquippedItem` — a discriminated union of a
 * wardrobe garment or a shop product — rather than a bare `GarmentRow`.
 * ============================================================================
 */

// ---------------------------------------------------------------------------
// Scene scale — same technique/units as CharacterViewerScreen, but pulled
// back a bit further (a larger distance multiplier) since this screen's
// Canvas gets a shorter vertical slice of the display (the bottom drawer
// takes the rest), so the full character still fits without cropping the
// head or feet.
// ---------------------------------------------------------------------------
const TARGET_HEIGHT_UNITS = 1.7;
const CAMERA_BASE_DISTANCE = TARGET_HEIGHT_UNITS * 2.3;
const CAMERA_START_Y = TARGET_HEIGHT_UNITS * 0.6;
const CAMERA_TARGET_Y = TARGET_HEIGHT_UNITS * 0.48;
const GROUND_RADIUS = TARGET_HEIGHT_UNITS * 0.62;

const BACKDROP_BOTTOM_COLOR = colors.bg;
const BACKDROP_TOP_COLOR = colors.accentSoft;
const BACKDROP_WIDTH = 5.0;
const BACKDROP_HEIGHT = 4.4;
const BACKDROP_CENTER_Y = TARGET_HEIGHT_UNITS * 0.6;
const BACKDROP_Z = -(TARGET_HEIGHT_UNITS * 1.6);
const GROUND_COLOR = colors.silhouette;

const HEMI_SKY_COLOR = colors.accentSoft;
const HEMI_GROUND_COLOR = "#FFF3E2";
const HEMI_INTENSITY = 0.6;
const KEY_LIGHT_COLOR = "#FFE8CC";
const KEY_LIGHT_INTENSITY = 1.3;
const KEY_LIGHT_POSITION: [number, number, number] = [2.2, 3.8, 2.8];
const FILL_LIGHT_COLOR = "#D8E0FF";
const FILL_LIGHT_INTENSITY = 0.34;
const FILL_LIGHT_POSITION: [number, number, number] = [-2.6, 1.5, -1.3];
const RIM_LIGHT_COLOR = "#FFFFFF";
const RIM_LIGHT_INTENSITY = 0.55;
const RIM_LIGHT_POSITION: [number, number, number] = [0, 3.2, -3.0];

const CONTACT_SHADOW_OPACITY = 0.5;
const CONTACT_SHADOW_BLUR = 2.6;
const CONTACT_SHADOW_RESOLUTION = 256;
const CONTACT_SHADOW_SCALE = GROUND_RADIUS * 2.3;
const CONTACT_SHADOW_FAR = TARGET_HEIGHT_UNITS * 0.9;

const IDLE_ROTATE_SPEED = 0.15;
const MAX_DEVICE_PIXEL_RATIO = 2;
const TONE_MAPPING_EXPOSURE = 1.1;

const ROTATE_SPEED = 0.012;
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2.4;

const MAX_OUTFIT_NAME_LENGTH = 60;

/** Display order + labels for the drawer's category sections. */
const CATEGORY_ORDER: GarmentCategory[] = ["top", "outerwear", "dress", "bottom", "shoes", "accessory"];
const CATEGORY_LABELS: Record<GarmentCategory, string> = {
  top: "Tops",
  outerwear: "Outerwear",
  dress: "Dresses",
  bottom: "Bottoms",
  shoes: "Shoes",
  accessory: "Accessories",
};

/** Human labels for the renderable body slots. */
const SLOT_LABELS: Record<EquipSlot, string> = {
  top: "Top",
  bottom: "Bottom",
  shoes: "Shoes",
  accessory: "Accessory",
};

/** How many shoppable products the drawer's Shop source pulls in one go. */
const SHOP_DRAWER_LIMIT = 30;

/** Which source the bottom drawer is listing. */
type DrawerSource = "wardrobe" | "shop";

/**
 * What is currently worn in one body slot: either something the user owns or
 * something from the catalog they haven't bought (yet).
 *
 * A discriminated union rather than parallel `equippedTopGarment` /
 * `equippedTopProduct` state, because every slot rule in this screen — the
 * dress<->bottom mutual exclusion, tap-to-toggle-off, the summary chips — has
 * to hold regardless of where the item came from, and two parallel states
 * would let a slot hold both at once. The origin only matters at three
 * points: rendering (`equippedVisual`), the Buy bar, and saving an outfit.
 */
type EquippedItem =
  | { origin: "garment"; garment: GarmentRow }
  | { origin: "product"; product: ProductWithBrand };

/**
 * Stable identity for an equipped item, used for the toggle-off comparison
 * and the drawer's "Worn" badge.
 *
 * Namespaced by origin on purpose: garment ids and product ids come from
 * different tables, so an unprefixed comparison would be relying on uuid
 * collisions never happening across two id spaces to stay correct.
 */
function equippedKey(item: EquippedItem): string {
  return item.origin === "garment"
    ? `garment:${item.garment.id}`
    : `product:${item.product.id}`;
}

function garmentKey(garment: GarmentRow): string {
  return `garment:${garment.id}`;
}

function productKey(product: ProductWithBrand): string {
  return `product:${product.id}`;
}

function equippedCategory(item: EquippedItem): GarmentCategory {
  return item.origin === "garment" ? item.garment.category : item.product.category;
}

function equippedName(item: EquippedItem): string | null {
  return item.origin === "garment" ? item.garment.name : item.product.name;
}

/**
 * The {color, name, long, textureUrl} CharacterAvatar renders. Delegated to
 * garmentVisual.ts rather than hand-built here so texture support (a product
 * image wrapped onto the mesh instead of a flat colour tint) flows through
 * automatically as that module gains it.
 */
function equippedVisual(item: EquippedItem): ResolvedGarmentVisual {
  return item.origin === "garment"
    ? garmentToVisual(item.garment)
    : productToVisual(item.product);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// --- Reopening a saved outfit ----------------------------------------------

/**
 * What a saved outfit becomes on a 3D character: one garment per body slot,
 * plus everything that can't be shown.
 *
 * The slot rules themselves live in garmentVisual.ts's `resolveOutfitSlots`,
 * shared with OutfitsScreen so the Outfits grid preview and what this screen
 * actually equips can never disagree. This wrapper only unwraps the chosen
 * items down to their `GarmentRow`s, which is what `equipOutfit` wears.
 *
 * `hidden` is not a discard pile — it is the losers of a slot collision (an
 * outfit that layers a shirt under a jacket has two `top` items; only the
 * top-most can dress the torso) plus a dress's displaced bottoms. They are
 * still genuinely part of the user's outfit, and the caller carries them
 * through the next save untouched (see `carriedItems`), because `updateOutfit`
 * replaces an outfit's items wholesale — dropping them here would mean opening
 * an outfit in 3D and re-saving it quietly deleted pieces of it.
 */
function splitOutfitForSlots(outfit: OutfitWithItems): {
  bySlot: Partial<Record<EquipSlot, GarmentRow>>;
  hidden: OutfitItemWithGarment[];
} {
  const { bySlot: chosen, hidden } = resolveOutfitSlots(outfit.items);

  const bySlot: Partial<Record<EquipSlot, GarmentRow>> = {};
  (Object.keys(chosen) as EquipSlot[]).forEach((slot) => {
    const item = chosen[slot];
    if (item) bySlot[slot] = item.garment;
  });

  return { bySlot, hidden };
}

/**
 * A hidden outfit item back into the input shape a save takes, preserving the
 * x/y/scale/rotation it was stored with. Those columns are a leftover of the
 * retired 2D collage studio, and this screen has no opinion about them — but
 * it must not invent one either: overwriting them with ANCHOR_ZONES defaults
 * (what `toOutfitItem` does for newly equipped garments, which have no prior
 * placement) would rewrite stored values on every save for no reason.
 */
function carriedOutfitItem(item: OutfitItemWithGarment): CreateOutfitItemInput {
  return {
    garment_id: item.garment_id,
    layer_order: item.layer_order,
    x: item.x,
    y: item.y,
    scale: item.scale,
    rotation: item.rotation,
  };
}

/** Comma-joined names for the "not shown in 3D" alert, falling back to the category when a garment is unnamed. */
function describeItems(items: OutfitItemWithGarment[]): string {
  return items
    .map((item) => item.garment.name?.trim() || item.garment.category)
    .join(", ");
}

/**
 * Alert-based yes/no, awaited. The save flow has to ask a question mid-way
 * through an async operation and branch on the answer, which `Alert.alert`'s
 * callback API can't do on its own.
 */
function confirmAsync(
  title: string,
  message: string,
  confirmLabel: string,
  cancelLabel = "Cancel"
): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancelLabel, style: "cancel", onPress: () => resolve(false) },
      { text: confirmLabel, onPress: () => resolve(true) },
    ]);
  });
}

/**
 * A soft vertical gradient plane built from per-vertex colors (no canvas
 * texture — there's no `document` on React Native). Same technique as
 * CharacterViewerScreen/AvatarSpikeScreen's own copies.
 */
function useVerticalGradientPlaneGeometry(
  width: number,
  height: number,
  topColor: string,
  bottomColor: string
): THREE.PlaneGeometry {
  return useMemo(() => {
    const heightSegments = 24;
    const geometry = new THREE.PlaneGeometry(width, height, 1, heightSegments);
    const top = new THREE.Color(topColor);
    const bottom = new THREE.Color(bottomColor);
    const tmp = new THREE.Color();
    const position = geometry.attributes.position;
    const colorArray = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      const t = (position.getY(i) + height / 2) / height;
      tmp.copy(bottom).lerp(top, t);
      colorArray[i * 3] = tmp.r;
      colorArray[i * 3 + 1] = tmp.g;
      colorArray[i * 3 + 2] = tmp.b;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colorArray, 3));
    return geometry;
  }, [width, height, topColor, bottomColor]);
}

function StudioBackdrop() {
  const geometry = useVerticalGradientPlaneGeometry(
    BACKDROP_WIDTH,
    BACKDROP_HEIGHT,
    BACKDROP_TOP_COLOR,
    BACKDROP_BOTTOM_COLOR
  );
  return (
    <mesh position={[0, BACKDROP_CENTER_Y, BACKDROP_Z]} geometry={geometry}>
      <meshBasicMaterial vertexColors toneMapped={false} />
    </mesh>
  );
}

function Ground() {
  return (
    <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <circleGeometry args={[GROUND_RADIUS, 64]} />
      <meshStandardMaterial color={GROUND_COLOR} roughness={0.92} metalness={0} />
    </mesh>
  );
}

function RotatingGroup({
  rotationRef,
  isDraggingRef,
  children,
}: {
  rotationRef: React.RefObject<number>;
  isDraggingRef: React.RefObject<boolean>;
  children: React.ReactNode;
}) {
  const ref = useRef<THREE.Group>(null);

  useFrame((_state, delta) => {
    if (!isDraggingRef.current) {
      rotationRef.current += IDLE_ROTATE_SPEED * delta;
    }
    if (ref.current) {
      ref.current.rotation.y = rotationRef.current;
    }
  });

  return <group ref={ref}>{children}</group>;
}

function CameraRig({ zoomRef }: { zoomRef: React.RefObject<number> }) {
  const { camera } = useThree();
  const directionRef = useRef(new THREE.Vector3(0, 0, 1));

  useEffect(() => {
    directionRef.current.copy(camera.position).normalize();
  }, [camera]);

  useFrame(() => {
    const distance = CAMERA_BASE_DISTANCE / zoomRef.current;
    camera.position.copy(directionRef.current).multiplyScalar(distance);
    camera.lookAt(0, CAMERA_TARGET_Y, 0);
  });

  return null;
}

/** Loads the signed-in user's saved customization — same shape/behavior as CharacterViewerScreen's own copy. */
function useMyCustomization() {
  const [customization, setCustomization] = useState<Customization | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasCustomization, setHasCustomization] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error: fetchError } = await getMyAvatar();

    setLoading(false);

    if (fetchError) {
      setError(fetchError);
      return;
    }

    const raw = data?.customization;
    const populated = !!raw && Object.keys(raw).length > 0;
    setHasCustomization(populated);
    setCustomization(populated ? mergeCustomization(raw as Partial<Customization>) : null);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { customization, hasCustomization, loading, error, reload: load };
}

/** One equipped-slot summary chip: shows the worn item's swatch + name, or "Empty"; tapping a filled chip clears that slot. */
function SlotChip({
  label,
  item,
  onClear,
}: {
  label: string;
  item: EquippedItem | null;
  onClear: () => void;
}) {
  if (!item) {
    return (
      <View style={styles.slotChip}>
        <View style={[styles.slotChipSwatch, styles.slotChipSwatchEmpty]} />
        <Text style={styles.slotChipText} numberOfLines={1}>
          {label}: empty
        </Text>
      </View>
    );
  }

  const swatch = equippedVisual(item).color;
  const name = equippedName(item) || label;
  return (
    <Pressable
      style={[styles.slotChip, styles.slotChipFilled]}
      onPress={onClear}
      accessibilityRole="button"
      accessibilityLabel={`Remove ${name} from ${label}`}
    >
      <View style={[styles.slotChipSwatch, { backgroundColor: swatch }]} />
      <Text style={styles.slotChipText} numberOfLines={1}>
        {name}
      </Text>
      {/* Marks a slot the user doesn't own yet, so "Save outfit" asking to
          copy it into the wardrobe isn't a surprise. */}
      {item.origin === "product" && <Text style={styles.slotChipShopTag}>shop</Text>}
      <Text style={styles.slotChipClear}>✕</Text>
    </Pressable>
  );
}

export function CharacterTryOnScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    productId?: string | string[];
    outfitId?: string | string[];
  }>();
  const session = useAuthStore((s) => s.session);
  const userId = session?.user.id;
  const profile = useAuthStore((s) => s.profile);

  /*
   * This screen is a tab root, so `router.back()` has nothing to pop in the
   * common case — but it is still reachable as a pushed route (Shop ->
   * "Try it on" navigates here from a stack screen above the tabs), where a
   * Back button is exactly right. Rendering it conditionally is why the
   * router is read for this rather than hard-coding either answer.
   */
  const canGoBack = router.canGoBack();

  const { customization, hasCustomization, loading, error, reload } = useMyCustomization();
  const { cardRef: shareCardRef, share: shareCard, busy: shareBusy } = useShareCard();

  const rotationRef = useRef(0);
  const zoomRef = useRef(1);
  const pinchStartZoomRef = useRef(1);
  const isDraggingRef = useRef(false);

  const [garments, setGarments] = useState<GarmentRow[]>([]);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [loadingGarments, setLoadingGarments] = useState(true);
  const [garmentsError, setGarmentsError] = useState<string | null>(null);
  const hasLoadedGarmentsOnceRef = useRef(false);

  const [drawerSource, setDrawerSource] = useState<DrawerSource>("wardrobe");
  const [products, setProducts] = useState<ProductWithBrand[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [productsError, setProductsError] = useState<string | null>(null);
  const hasLoadedProductsRef = useRef(false);

  const [equippedTop, setEquippedTop] = useState<EquippedItem | null>(null);
  const [equippedBottom, setEquippedBottom] = useState<EquippedItem | null>(null);
  const [equippedShoes, setEquippedShoes] = useState<EquippedItem | null>(null);
  const [equippedAccessory, setEquippedAccessory] = useState<EquippedItem | null>(null);

  /**
   * Which slot the Buy bar is currently pointed at.
   *
   * A full outfit can hold up to three shoppable products, and three stacked
   * Buy buttons would bury the 3D view the screen exists for. So the bar
   * shows ONE product — the most recently equipped by default — and when
   * more than one slot holds a product it grows a compact row of slot pills
   * to switch between them. `null` means "follow the most recent", which is
   * also what the bar falls back to when the focused slot is cleared.
   */
  const [buyFocusSlot, setBuyFocusSlot] = useState<EquipSlot | null>(null);
  const [buying, setBuying] = useState(false);

  const [saveModalVisible, setSaveModalVisible] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  /**
   * The saved outfit this screen is currently editing, or null for a fresh
   * look. Non-null is what makes saving call `updateOutfit` instead of
   * `createOutfit`. Kept as local state because the id arrives as a route
   * param and nothing outside this screen needs to read it.
   *
   * Set when a `?outfitId=` link is consumed, and again after any successful
   * save: once a look exists as a row, the screen represents THAT row, so the
   * next save edits it rather than minting a near-identical copy. The name
   * rides along to prefill the save modal (and to make "Update" visibly refer
   * to something).
   */
  const [editingOutfitId, setEditingOutfitId] = useState<string | null>(null);
  const [editingOutfitName, setEditingOutfitName] = useState<string | null>(null);

  /**
   * Items of the outfit being edited that this screen can't put on the
   * character — see `splitOutfitForSlots`. Held so the next save can pass them
   * straight back through: `updateOutfit` replaces an outfit's items
   * wholesale, so anything not sent is deleted.
   *
   * STILL LOAD-BEARING after accessories got a slot. That closed one of the
   * two reasons an item ends up here (no slot at all), but not the bigger one:
   * a slot collision. An outfit that layers a shirt under a jacket, or pairs a
   * dress with bottoms, has more items than the body has places to put them —
   * and those losers are exactly the pieces a user would be most surprised to
   * find deleted by opening their outfit and tapping Update.
   */
  const [carriedItems, setCarriedItems] = useState<CreateOutfitItemInput[]>([]);

  const loadGarments = useCallback(async () => {
    if (!userId) return;
    if (!hasLoadedGarmentsOnceRef.current) {
      setLoadingGarments(true);
    }
    setGarmentsError(null);
    const { data, error: fetchError } = await listGarments(userId);
    if (fetchError) {
      setGarmentsError(fetchError);
    } else {
      hasLoadedGarmentsOnceRef.current = true;
      const rows = data ?? [];
      setGarments(rows);
      // Keyed by garment id — catalog-sourced garments have no image_path.
      const urls = await resolveGarmentImageUrls(rows);
      setThumbUrls(urls);
    }
    setLoadingGarments(false);
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      loadGarments();
    }, [loadGarments])
  );

  /*
   * `userId` mirrored into a ref so the deep-link effect below can record a
   * try-on without taking `userId` as a dependency. That effect must only
   * ever re-run on a param change: re-running it for any other reason
   * cancels the in-flight getProduct and skips the `router.setParams` clear,
   * which strands the param and blocks the next try-on of the same product.
   */
  const userIdRef = useRef<string | undefined>(userId);
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  const loadProducts = useCallback(async () => {
    setLoadingProducts(true);
    setProductsError(null);
    const { data, error: fetchError } = await searchProducts({
      limit: SHOP_DRAWER_LIMIT,
    });
    if (fetchError) {
      setProductsError(fetchError);
    } else {
      hasLoadedProductsRef.current = true;
      setProducts(data ?? []);
    }
    setLoadingProducts(false);
  }, []);

  // The catalog is fetched only once the user asks for it — this screen's
  // primary job is still styling what they own, and paying for a shop query
  // on every visit would slow that down for no one's benefit.
  useEffect(() => {
    if (drawerSource !== "shop") return;
    if (hasLoadedProductsRef.current) return;
    loadProducts();
  }, [drawerSource, loadProducts]);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .onBegin(() => {
          isDraggingRef.current = true;
        })
        .onChange((event) => {
          rotationRef.current += event.changeX * ROTATE_SPEED;
        })
        .onFinalize(() => {
          isDraggingRef.current = false;
        })
        .runOnJS(true),
    []
  );

  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .onStart(() => {
          pinchStartZoomRef.current = zoomRef.current;
        })
        .onChange((event) => {
          zoomRef.current = clamp(pinchStartZoomRef.current * event.scale, MIN_ZOOM, MAX_ZOOM);
        })
        .runOnJS(true),
    []
  );

  const composedGesture = useMemo(
    () => Gesture.Simultaneous(panGesture, pinchGesture),
    [panGesture, pinchGesture]
  );

  const handleCanvasCreated = useCallback((state: { gl: THREE.WebGLRenderer }) => {
    const { gl } = state;
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = TONE_MAPPING_EXPOSURE;
    gl.setPixelRatio(Math.min(PixelRatio.get(), MAX_DEVICE_PIXEL_RATIO));
  }, []);

  // --- Equip / unequip ---------------------------------------------------

  const equippedKeys = useMemo(() => {
    const keys = new Set<string>();
    if (equippedTop) keys.add(equippedKey(equippedTop));
    if (equippedBottom) keys.add(equippedKey(equippedBottom));
    if (equippedShoes) keys.add(equippedKey(equippedShoes));
    if (equippedAccessory) keys.add(equippedKey(equippedAccessory));
    return keys;
  }, [equippedTop, equippedBottom, equippedShoes, equippedAccessory]);

  /*
   * `equippedKeys` mirrored into a ref purely so `equipProduct` below can ask
   * "was this already on?" without depending on the equipped state — see
   * `equipItem`'s note on why the deep-link path needs a stable callback.
   */
  const equippedKeysRef = useRef(equippedKeys);
  useEffect(() => {
    equippedKeysRef.current = equippedKeys;
  }, [equippedKeys]);

  /** Write one slot directly. Used by equip, by the chips' clear action, and by the outfit save's product -> wardrobe promotion. */
  const setSlot = useCallback((slot: EquipSlot, item: EquippedItem | null) => {
    if (slot === "top") setEquippedTop(item);
    else if (slot === "bottom") setEquippedBottom(item);
    else if (slot === "shoes") setEquippedShoes(item);
    else setEquippedAccessory(item);
  }, []);

  /**
   * Put `item` on the character, applying the slot rules.
   *
   * `mode` decides what happens when the same item is already in its slot:
   * `"toggle"` (a drawer tap) takes it off again, `"force"` (arriving from
   * the Shop with an explicit "try this on") leaves it on. Returns the slot
   * it landed in, or `null` when the category has no 3D slot at all — which
   * no current `GarmentCategory` does (see `mapCategoryToSlot`), so in
   * practice that branch only fires for a category added to the DB enum ahead
   * of the character model.
   *
   * Declared with no reactive dependencies (only `useState` setters, all
   * stable) so the deep-link effect can depend on it without re-running.
   */
  const equipItem = useCallback(
    (item: EquippedItem, mode: "toggle" | "force"): EquipSlot | null => {
      const category = equippedCategory(item);
      const slot = mapCategoryToSlot(category);
      if (!slot) return null;

      const key = equippedKey(item);
      const next = (prev: EquippedItem | null): EquippedItem | null =>
        mode === "toggle" && prev && equippedKey(prev) === key ? null : item;

      if (slot === "top") {
        setEquippedTop(next);
        // A dress covers the same area separate bottoms would — replacing it
        // avoids pants/skirt showing through the dress's hem.
        if (category === "dress") {
          setEquippedBottom(null);
        }
      } else if (slot === "bottom") {
        setEquippedBottom(next);
        // Equipping separate bottoms while a dress is worn would double up on
        // the same coverage — clear the dress so the bottom actually shows.
        setEquippedTop((prev) =>
          prev && equippedCategory(prev) === "dress" ? null : prev
        );
      } else if (slot === "shoes") {
        setEquippedShoes(next);
      } else {
        // The neckline slot has no exclusion rules to enforce: it doesn't
        // overlap any garment mesh, and it is deliberately independent of the
        // character's own creator-chosen glasses/earrings (see
        // CharacterAvatar's THE ACCESSORY SLOT for why those coexist).
        setEquippedAccessory(next);
      }

      return slot;
    },
    []
  );

  /**
   * Equip a catalog product and log the try-on.
   *
   * Returns false only when the product has no 3D slot. The analytics write
   * is fire-and-forget by contract (see api/shop.ts); the extra `.catch`
   * stops a transport-level rejection from surfacing as an unhandled promise.
   *
   * Dependency-free for the same reason as `equipItem` — `userId` is read
   * through `userIdRef` rather than captured.
   */
  const equipProduct = useCallback(
    (product: ProductWithBrand, mode: "toggle" | "force"): boolean => {
      const wasEquipped = equippedKeysRef.current.has(productKey(product));
      const slot = equipItem({ origin: "product", product }, mode);
      if (!slot) return false;

      // Don't log taking an item back off as a try-on.
      const nowEquipped = mode === "force" || !wasEquipped;
      const id = userIdRef.current;
      if (nowEquipped && id) {
        recordProductTryOn(id, product.id).catch(() => {});
      }

      if (nowEquipped) {
        setBuyFocusSlot(slot);
      }
      return true;
    },
    [equipItem]
  );

  /**
   * Explain an item the character can't wear.
   *
   * Unreachable for every category that exists today — accessories were the
   * last hold-out and now have a neckline slot of their own. It stays as the
   * honest answer for a `garment_category` added to the DB enum before it is
   * modelled on the character: saying so is strictly better than a tap that
   * appears to do nothing. Stable (no reactive deps), so the deep-link effect
   * can depend on it without re-running.
   */
  const promptSlotUnsupported = useCallback(() => {
    Alert.alert(
      "Can't wear this yet",
      "This kind of item can't be worn on your character in this version of Selv."
    );
  }, []);

  function handleEquipGarment(garment: GarmentRow) {
    const slot = equipItem({ origin: "garment", garment }, "toggle");
    if (!slot) {
      promptSlotUnsupported();
      return;
    }
    // A wardrobe garment landing in a slot that was showing a product retires
    // that product's Buy bar; clearing the focus lets the bar fall back to
    // whichever other slot (if any) still holds one.
    setBuyFocusSlot((prev) => (prev === slot ? null : prev));
  }

  function handleEquipProduct(product: ProductWithBrand) {
    if (!equipProduct(product, "toggle")) {
      promptSlotUnsupported();
    }
  }

  function handleClearSlot(slot: EquipSlot) {
    setSlot(slot, null);
    setBuyFocusSlot((prev) => (prev === slot ? null : prev));
  }

  /**
   * Consume a `?productId=` deep link from the Shop **exactly once**.
   *
   * Three things stack up to guarantee that, because double-equipping (and
   * double-counting the try-on it records) is the obvious failure here and
   * each mechanism alone has a hole:
   *   1. `consumedProductIdRef` is set synchronously, before the first await,
   *      so a re-render during the fetch can't start a second equip.
   *   2. `router.setParams` clears the param, so re-focusing the tab later
   *      doesn't replay the same navigation. The guard is re-armed when the
   *      param comes back empty, so tapping "try it on" on the *same* product
   *      a second time still works.
   *   3. Equipping is idempotent: `"force"` mode writes the product into its
   *      slot rather than toggling, so a repeat lands on the same state.
   *
   * Every dependency here is stable by construction (`router`, and two
   * `useCallback`s with no reactive deps) — the effect must re-run ONLY when
   * the param changes. Anything else re-entering it cancels the in-flight
   * `getProduct` and skips the param clear below.
   */
  const consumedProductIdRef = useRef<string | null>(null);
  const rawProductIdParam = params.productId;

  useEffect(() => {
    const productId = Array.isArray(rawProductIdParam)
      ? rawProductIdParam[0]
      : rawProductIdParam;

    if (!productId) {
      consumedProductIdRef.current = null;
      return;
    }

    if (consumedProductIdRef.current === productId) return;
    consumedProductIdRef.current = productId;

    let cancelled = false;

    (async () => {
      const { data, error: productError } = await getProduct(productId);

      if (productError || !data) {
        if (!cancelled) {
          Alert.alert(
            "Item unavailable",
            productError ?? "This item can't be tried on right now."
          );
        }
      } else {
        // The equip itself is deliberately NOT gated on `cancelled`: it is
        // idempotent in "force" mode, and gating it would drop the product
        // entirely under a double-invoked effect (dev StrictMode), where the
        // first pass is cancelled and the second is stopped by the ref guard
        // above. Only the UI reactions below are gated.
        const equipped = equipProduct(data, "force");

        if (!cancelled) {
          if (equipped) {
            // Land the user in the source they arrived from, so the item
            // they just tried on is visible in the drawer next to it.
            setDrawerSource("shop");
          } else {
            promptSlotUnsupported();
          }
        }
      }

      if (cancelled) return;

      // Cleared only now, on every outcome. Clearing it *before* the fetch
      // settles would re-run this effect, and its cleanup would flip
      // `cancelled` on the very request it just started — the product would
      // never arrive. Clearing on the failure path too means a second tap on
      // the same product still re-triggers this effect.
      router.setParams({ productId: undefined });
    })();

    return () => {
      cancelled = true;
    };
  }, [rawProductIdParam, router, equipProduct, promptSlotUnsupported]);

  /**
   * Dress the character in a saved outfit and take ownership of editing it.
   *
   * Writes all three slots absolutely rather than merging into them: reopening
   * a saved outfit has to show that outfit and nothing else, or whatever was
   * left on the character from the last session would be folded into it by the
   * next save. That also makes this idempotent, which is what lets the effect
   * below re-apply it safely (same property `"force"` mode gives `equipItem`).
   *
   * Returns the items it couldn't wear, for the caller to explain.
   *
   * No reactive dependencies (only `useState` setters) so the effect below
   * depends on it without ever re-running for an unrelated render.
   */
  const equipOutfit = useCallback(
    (outfit: OutfitWithItems): OutfitItemWithGarment[] => {
      const { bySlot, hidden } = splitOutfitForSlots(outfit);
      const wear = (garment: GarmentRow | undefined): EquippedItem | null =>
        garment ? { origin: "garment", garment } : null;

      setEquippedTop(wear(bySlot.top));
      setEquippedBottom(wear(bySlot.bottom));
      setEquippedShoes(wear(bySlot.shoes));
      setEquippedAccessory(wear(bySlot.accessory));

      // Everything in a saved outfit is a wardrobe garment by construction
      // (`outfit_items.garment_id` is a NOT NULL FK), so no slot can still
      // hold a catalog product and the Buy bar has nothing left to point at.
      setBuyFocusSlot(null);

      setEditingOutfitId(outfit.id);
      setEditingOutfitName(outfit.name);
      setCarriedItems(hidden.map(carriedOutfitItem));

      return hidden;
    },
    []
  );

  /**
   * Consume an `?outfitId=` link from the Outfits tab **exactly once**.
   *
   * Same three-part guard as the `?productId=` effect above, for the same
   * reasons — and it is deliberately a second, separate effect rather than a
   * branch inside that one: the two params never arrive together, and merging
   * them would make either param's arrival re-run the other's fetch.
   * `router.setParams` merges, so clearing one leaves the other alone.
   *
   * The outfit is re-fetched by id even though the Outfits tab already had it
   * in hand, because a route param is all this screen is promised (it must
   * work from a cold deep link) and because equipping needs the full
   * `GarmentRow` behind each item — its category, colour and image — which is
   * exactly what the 2D store's layers do NOT carry.
   */
  const consumedOutfitIdRef = useRef<string | null>(null);
  const rawOutfitIdParam = params.outfitId;

  useEffect(() => {
    const outfitId = Array.isArray(rawOutfitIdParam)
      ? rawOutfitIdParam[0]
      : rawOutfitIdParam;

    if (!outfitId) {
      consumedOutfitIdRef.current = null;
      return;
    }

    if (consumedOutfitIdRef.current === outfitId) return;
    consumedOutfitIdRef.current = outfitId;

    let cancelled = false;

    (async () => {
      const { data, error: outfitError } = await getOutfit(outfitId);

      if (outfitError || !data) {
        if (!cancelled) {
          Alert.alert(
            "Couldn't open this outfit",
            outfitError ?? "This outfit can't be opened right now."
          );
        }
      } else {
        // Not gated on `cancelled`, for the same reason the product equip
        // isn't: it's idempotent, and gating it would drop the outfit entirely
        // under a double-invoked effect (dev StrictMode).
        const hidden = equipOutfit(data);

        if (!cancelled) {
          // The outfit is made of wardrobe garments, so leave the drawer on
          // the source they came from.
          setDrawerSource("wardrobe");

          if (hidden.length > 0) {
            /*
             * Equip what fits, then say plainly what didn't — the one thing
             * this must not do is what the old navigation did and discard part
             * of the user's outfit without a word. The reassurance is load
             * -bearing and true: `carriedItems` means these pieces survive a
             * re-save.
             *
             * Every remaining reason to be here is a slot collision (two tops
             * layered; bottoms under a dress), so the copy names that rather
             * than the old "accessories have no 3D slot" — they do now.
             */
            const plural = hidden.length === 1 ? "it" : "them";
            Alert.alert(
              "Some pieces aren't shown",
              `${describeItems(hidden)} can't be worn at the same time as the rest of this outfit — only the top layer of each part of the body shows on your character. ${
                hidden.length === 1 ? "It's" : "They're"
              } still part of this outfit, and saving keeps ${plural}.`
            );
          }
        }
      }

      if (cancelled) return;

      router.setParams({ outfitId: undefined });
    })();

    return () => {
      cancelled = true;
    };
  }, [rawOutfitIdParam, router, equipOutfit]);

  const equippedProp: EquippedGarments = useMemo(
    () => ({
      top: equippedTop ? equippedVisual(equippedTop) : undefined,
      bottom: equippedBottom ? equippedVisual(equippedBottom) : undefined,
      shoes: equippedShoes ? equippedVisual(equippedShoes) : undefined,
      accessory: equippedAccessory ? equippedVisual(equippedAccessory) : undefined,
    }),
    [equippedTop, equippedBottom, equippedShoes, equippedAccessory]
  );

  const hasAnyEquipped = !!(
    equippedTop ||
    equippedBottom ||
    equippedShoes ||
    equippedAccessory
  );

  const grouped = useMemo(() => {
    const map = new Map<GarmentCategory, GarmentRow[]>();
    for (const g of garments) {
      const list = map.get(g.category);
      if (list) {
        list.push(g);
      } else {
        map.set(g.category, [g]);
      }
    }
    return map;
  }, [garments]);

  /** Shop products grouped the same way, so the drawer reads identically across both sources. */
  const groupedProducts = useMemo(() => {
    const map = new Map<GarmentCategory, ProductWithBrand[]>();
    for (const p of products) {
      const list = map.get(p.category);
      if (list) {
        list.push(p);
      } else {
        map.set(p.category, [p]);
      }
    }
    return map;
  }, [products]);

  // --- Buy ----------------------------------------------------------------

  /** Every slot currently holding something the user doesn't own yet, in render order. */
  const productSlots = useMemo(() => {
    const entries: { slot: EquipSlot; product: ProductWithBrand }[] = [];
    const push = (slot: EquipSlot, item: EquippedItem | null) => {
      if (item && item.origin === "product") {
        entries.push({ slot, product: item.product });
      }
    };
    push("top", equippedTop);
    push("bottom", equippedBottom);
    push("shoes", equippedShoes);
    push("accessory", equippedAccessory);
    return entries;
  }, [equippedTop, equippedBottom, equippedShoes, equippedAccessory]);

  // Falls back to the first product slot when nothing is focused, or when the
  // focused slot no longer holds a product (cleared, or replaced by a
  // wardrobe garment) — so the bar never points at a stale item. Annotated
  // explicitly because `productSlots[0]` is `undefined` on an empty array
  // without `noUncheckedIndexedAccess`, and the `null` is what the JSX guard
  // below actually tests.
  const buyTarget: { slot: EquipSlot; product: ProductWithBrand } | null =
    productSlots.find((entry) => entry.slot === buyFocusSlot) ?? productSlots[0] ?? null;

  /**
   * Hand the user off to the brand's product page through a tracked link.
   * If the click can't be recorded we do NOT fall back to an untracked open
   * — see createCheckoutLink's doc comment for why that trade is deliberate.
   */
  async function handleBuy(product: ProductWithBrand) {
    if (!userId || buying) return;
    setBuying(true);

    const { data, error: linkError } = await createCheckoutLink({
      userId,
      product,
      source: "tryon",
    });

    if (linkError || !data) {
      setBuying(false);
      Alert.alert(
        "Couldn't open this item",
        linkError ?? "Please check your connection and try again."
      );
      return;
    }

    try {
      // The *system* browser, via react-native's Linking — not
      // expo-web-browser. An affiliate network's cookie set here persists
      // into the browser the user actually checks out in; an in-app web view
      // sandboxes it and can drop the attribution the click was minted for.
      await Linking.openURL(data.url);
    } catch {
      Alert.alert(
        "Couldn't open this item",
        "We couldn't open your browser. Please try again."
      );
    } finally {
      setBuying(false);
    }
  }

  // --- Save outfit ---------------------------------------------------------

  /**
   * The worn slots in save order (bottom under top under shoes under
   * accessory), paired with the `layer_order` an outfit item gets.
   *
   * Order still matters after the 2D collage's retirement: `layer_order` is
   * what `resolveOutfitSlots` reads to decide which item wins a slot when this
   * outfit is reopened. Accessories go last so that, in an outfit somehow
   * holding two of them, the one saved here is the one worn.
   */
  function wornSlotEntries(): { slot: EquipSlot; item: EquippedItem; order: number }[] {
    const entries: { slot: EquipSlot; item: EquippedItem; order: number }[] = [];
    if (equippedBottom) entries.push({ slot: "bottom", item: equippedBottom, order: 0 });
    if (equippedTop) entries.push({ slot: "top", item: equippedTop, order: 1 });
    if (equippedShoes) entries.push({ slot: "shoes", item: equippedShoes, order: 2 });
    if (equippedAccessory)
      entries.push({ slot: "accessory", item: equippedAccessory, order: 3 });
    return entries;
  }

  /**
   * A garment -> outfit item. `outfit_items` still requires x/y/scale/rotation
   * (NOT NULL columns left behind by the retired 2D collage studio), and this
   * 3D flow has no placement of its own, so the per-category ANCHOR_ZONES
   * defaults fill them. Nothing reads them back today; they are written so the
   * insert is valid and so the values stay stable/meaningful rather than
   * arbitrary.
   */
  function toOutfitItem(garment: GarmentRow, order: number): CreateOutfitItemInput {
    const anchor = ANCHOR_ZONES[garment.category];
    return {
      garment_id: garment.id,
      layer_order: order,
      x: anchor.x,
      y: anchor.y,
      scale: anchor.scale,
      rotation: 0,
    };
  }

  function openSaveModal() {
    if (!hasAnyEquipped) {
      Alert.alert("Equip a garment", "Equip at least one item before saving.");
      return;
    }
    setSaveError(null);
    // Prefilled when editing, so the name field shows what is about to be
    // overwritten instead of asking for it again.
    setNameInput(editingOutfitName ?? "");
    setSaveModalVisible(true);
  }

  function closeSaveModal() {
    if (saving) return;
    setSaveModalVisible(false);
  }

  /**
   * Persist the current look.
   *
   * `mode` decides which row it lands in: `"auto"` (the Save button, and the
   * keyboard's return key) updates the outfit being edited when there is one
   * and creates otherwise; `"new"` always creates, which is the "keep the
   * original, save this as its own outfit" escape hatch offered in the modal
   * while editing.
   */
  async function handleSaveOutfit(mode: "auto" | "new" = "auto") {
    if (!userId || saving) return;
    const trimmedName = nameInput.trim();
    if (!trimmedName) {
      setSaveError("Please enter a name for this outfit.");
      return;
    }
    if (trimmedName.length > MAX_OUTFIT_NAME_LENGTH) {
      setSaveError(`Name must be ${MAX_OUTFIT_NAME_LENGTH} characters or fewer.`);
      return;
    }

    setSaving(true);
    setSaveError(null);

    /*
     * TRADEOFF — products vs. the outfits schema.
     *
     * `outfit_items.garment_id` is a NOT NULL FK into `garments`, so a slot
     * holding only a catalog product has nothing to persist. Two ways out:
     * widen `outfit_items` to hold either a garment or a product, or copy the
     * product into the user's wardrobe and save it as a normal garment.
     *
     * We take the second. Widening the schema would force every outfit
     * reader — the Outfits grid, the share card, this screen — to handle two
     * kinds of item forever, in exchange for avoiding one tap the user can
     * make now. It would also leave saved outfits pointing at catalog rows a
     * partner can delist out from under them, whereas a wardrobe copy is
     * theirs and survives.
     *
     * The cost is that saving an outfit can consume wardrobe slots, which is
     * exactly why this always asks first and never copies silently.
     */
    const items: CreateOutfitItemInput[] = [];
    const productEntries: { slot: EquipSlot; product: ProductWithBrand; order: number }[] = [];

    // One pass rather than two `filter`s, so each branch narrows the union
    // naturally instead of needing a cast back out of it.
    for (const entry of wornSlotEntries()) {
      if (entry.item.origin === "garment") {
        items.push(toOutfitItem(entry.item.garment, entry.order));
      } else {
        productEntries.push({
          slot: entry.slot,
          product: entry.item.product,
          order: entry.order,
        });
      }
    }

    let promotedAny = false;

    if (productEntries.length > 0) {
      const noun = productEntries.length === 1 ? "item" : "items";
      const confirmed = await confirmAsync(
        "Add to your wardrobe?",
        `Outfits are built from your wardrobe, so ${productEntries.length} shop ${noun} will be saved there first. You can still buy ${
          productEntries.length === 1 ? "it" : "them"
        } any time.`,
        "Save to wardrobe"
      );

      if (!confirmed) {
        setSaving(false);
        return;
      }

      const blocked: string[] = [];

      for (const { slot, product, order } of productEntries) {
        const { data: garment, error: wardrobeError } = await saveProductToWardrobe(
          userId,
          product
        );

        if (wardrobeError || !garment) {
          // `saveProductToWardrobe` returns the free-tier cap copy verbatim in
          // this field, so it must be surfaced as-is rather than replaced
          // with a generic failure message.
          blocked.push(`${product.name} — ${wardrobeError ?? "couldn't be saved"}`);
          continue;
        }

        promotedAny = true;
        // The slot now holds something the user owns — swap it in place so
        // the chips, the Buy bar and the 3D visual all agree with what was
        // just persisted.
        setSlot(slot, { origin: "garment", garment });
        setBuyFocusSlot((prev) => (prev === slot ? null : prev));
        items.push(toOutfitItem(garment, order));
      }

      if (blocked.length > 0) {
        // Usually the free-tier wardrobe cap. Losing the whole outfit over it
        // would be the worst outcome, so the partial save is offered plainly.
        const proceed = await confirmAsync(
          "Some items couldn't be added",
          `${blocked.join("\n\n")}\n\nSave this outfit without ${
            blocked.length === 1 ? "it" : "them"
          }?`,
          "Save without"
        );

        if (!proceed) {
          setSaving(false);
          return;
        }
      }
    }

    if (items.length === 0) {
      setSaving(false);
      setSaveError("There's nothing left to save in this outfit.");
      return;
    }

    /*
     * Pieces of the edited outfit this screen can't wear ride along untouched
     * — `updateOutfit` replaces items wholesale, so omitting them would delete
     * them. Empty unless a saved outfit is open; see `carriedItems`.
     *
     * A carried piece stops being carried the moment the user equips it: the
     * drawer equips into a slot and has no reason to reach into this list, so
     * the same garment can sit in both. That is not a duplicate row —
     * `createOutfit`/`updateOutfit` dedupe on `garment_id` for the
     * `outfit_items` PK — but their tie-break keeps the highest `layer_order`,
     * which on a tie is the stale carried copy, so the slot the user just put
     * the garment in would lose. Drop the carried copy instead.
     */
    const wornGarmentIds = new Set(items.map((item) => item.garment_id));
    const allItems = [
      ...items,
      ...carriedItems.filter((item) => !wornGarmentIds.has(item.garment_id)),
    ];

    // Null on "save as new", which is the whole point of that path: it forces
    // the create branch while leaving the outfit being edited untouched.
    const targetOutfitId = mode === "new" ? null : editingOutfitId;

    const { data, error: saveErrorMsg } = targetOutfitId
      ? await updateOutfit(targetOutfitId, trimmedName, allItems)
      : await createOutfit(userId, trimmedName, allItems);

    setSaving(false);

    if (saveErrorMsg) {
      setSaveError(saveErrorMsg);
      return;
    }

    if (data) {
      setSaveModalVisible(false);
      // Newly-copied products are wardrobe garments now — refresh so the
      // drawer shows them under "My wardrobe" instead of only under "Shop".
      if (promotedAny) {
        loadGarments();
      }

      // Follow whatever was just written, including a brand-new row and a
      // "save as new" copy: from here on the character on screen IS that
      // outfit, so tapping Save again should refine it rather than pile up
      // another copy. `data` comes back from a re-read, so these are the
      // persisted values, not the ones we hoped we wrote.
      setEditingOutfitId(data.id);
      setEditingOutfitName(data.name);

      Alert.alert(
        "Saved",
        targetOutfitId
          ? `"${trimmedName}" was updated.`
          : `"${trimmedName}" was saved to your outfits.`
      );
    }
  }

  // --- Share the current look --------------------------------------------
  // Captures the off-screen <ShareCard> below (always kept mounted with the
  // live customization + equippedProp, so it's already showing the current
  // look by the time this fires) and hands the PNG to the OS share sheet.
  async function handleShareFit() {
    const result = await shareCard();
    if (!result.ok && result.error) {
      Alert.alert("Couldn't share", result.error);
    }
  }

  // --- Resolved-before-3D states --------------------------------------

  if (loading) {
    return (
      <View style={[styles.root, styles.centerFill]}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.overlayText}>Loading your character…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.root, styles.centerFill]}>
        <Text style={styles.errorTitle}>Couldn&apos;t load your character</Text>
        <Text style={styles.errorMessage} numberOfLines={4}>
          {error}
        </Text>
        <Pressable style={styles.primaryButton} onPress={reload} accessibilityRole="button">
          <Text style={styles.primaryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!hasCustomization || !customization) {
    return (
      <View style={[styles.root, styles.centerFill]}>
        <Text style={styles.title}>No character yet</Text>
        <Text style={[styles.overlayText, styles.promptBody]}>
          Design your Selv in the character creator first, then come back here to try on your
          wardrobe.
        </Text>
        <Pressable
          style={styles.primaryButton}
          onPress={() => router.push("/create-avatar")}
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>Open character creator</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <GestureDetector gesture={composedGesture}>
        <View style={styles.canvasArea}>
          <Canvas
            style={styles.canvas}
            camera={{
              position: [0, CAMERA_START_Y, CAMERA_BASE_DISTANCE],
              fov: 30,
              near: 0.05,
              far: 50,
            }}
            gl={{ antialias: true }}
            shadows="soft"
            onCreated={handleCanvasCreated}
          >
            <color attach="background" args={[BACKDROP_BOTTOM_COLOR]} />

            <hemisphereLight
              color={HEMI_SKY_COLOR}
              groundColor={HEMI_GROUND_COLOR}
              intensity={HEMI_INTENSITY}
            />
            <directionalLight
              position={KEY_LIGHT_POSITION}
              intensity={KEY_LIGHT_INTENSITY}
              color={KEY_LIGHT_COLOR}
              castShadow
              shadow-mapSize-width={1024}
              shadow-mapSize-height={1024}
              shadow-camera-near={0.1}
              shadow-camera-far={8}
              shadow-camera-left={-0.9}
              shadow-camera-right={0.9}
              shadow-camera-top={1.9}
              shadow-camera-bottom={-0.1}
              shadow-bias={-0.0015}
            />
            <directionalLight
              position={FILL_LIGHT_POSITION}
              intensity={FILL_LIGHT_INTENSITY}
              color={FILL_LIGHT_COLOR}
            />
            <directionalLight
              position={RIM_LIGHT_POSITION}
              intensity={RIM_LIGHT_INTENSITY}
              color={RIM_LIGHT_COLOR}
            />

            <StudioBackdrop />
            <Ground />

            <ContactShadows
              position={[0, 0.005, 0]}
              opacity={CONTACT_SHADOW_OPACITY}
              scale={CONTACT_SHADOW_SCALE}
              blur={CONTACT_SHADOW_BLUR}
              far={CONTACT_SHADOW_FAR}
              resolution={CONTACT_SHADOW_RESOLUTION}
              color={colors.ink}
            />

            <RotatingGroup rotationRef={rotationRef} isDraggingRef={isDraggingRef}>
              <CharacterAvatar customization={customization} equipped={equippedProp} />
            </RotatingGroup>

            <CameraRig zoomRef={zoomRef} />
          </Canvas>

          <View style={[styles.topOverlay, { top: insets.top + spacing.sm }]} pointerEvents="box-none">
            {canGoBack && (
              <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityRole="button">
                <Text style={styles.backButtonText}>← Back</Text>
              </Pressable>
            )}
            <View pointerEvents="none">
              <Text style={styles.legendTitle}>Try it on</Text>
              <Text style={styles.legendNote}>Tap an item below · drag to rotate</Text>
            </View>
          </View>

          <View style={styles.slotRow} pointerEvents="box-none">
            <SlotChip label="Top" item={equippedTop} onClear={() => handleClearSlot("top")} />
            <SlotChip label="Bottom" item={equippedBottom} onClear={() => handleClearSlot("bottom")} />
            <SlotChip label="Shoes" item={equippedShoes} onClear={() => handleClearSlot("shoes")} />
            <SlotChip
              label={SLOT_LABELS.accessory}
              item={equippedAccessory}
              onClear={() => handleClearSlot("accessory")}
            />
          </View>

          <Pressable
            style={[
              styles.saveButton,
              { top: insets.top + spacing.sm + 56 },
              !hasAnyEquipped && styles.saveButtonDisabled,
            ]}
            onPress={openSaveModal}
            accessibilityRole="button"
          >
            {/* Says what the button will actually do. Without this, a screen
                opened from the Outfits tab looks identical to a fresh one and
                "Save" silently overwriting a saved look would be a surprise. */}
            <Text style={styles.saveButtonText}>
              {editingOutfitId ? "Update outfit" : "Save outfit"}
            </Text>
          </Pressable>

          <Pressable
            style={[
              styles.shareButton,
              { top: insets.top + spacing.sm + 56 + 46 },
              shareBusy !== "idle" && styles.shareButtonDisabled,
            ]}
            onPress={handleShareFit}
            disabled={shareBusy !== "idle"}
            accessibilityRole="button"
          >
            {shareBusy === "sharing" ? (
              <ActivityIndicator color={colors.acid} />
            ) : (
              <Text style={styles.shareButtonText}>Share this fit</Text>
            )}
          </Pressable>
        </View>
      </GestureDetector>

      {/* Off-screen ShareCard — always mounted (moved well outside the
          viewport) so it's laid out and reflects the live customization +
          equipped fit by the time handleShareFit fires captureAndShare on
          it. See shareCard.ts's RELIABILITY DECISION doc comment for why
          this captures the flat 2D card instead of the 3D Canvas above. */}
      <View style={styles.offscreenCapture} pointerEvents="none">
        <ShareCard
          cardRef={shareCardRef}
          customization={customization}
          equipped={equippedProp}
          outfitName="My fit"
          handle={profile?.display_name ?? undefined}
        />
      </View>

      {/* Buy bar — pinned directly above the drawer so the price and the
          action sit next to the item the user is looking at. Only shown when
          a slot holds a catalog product; wardrobe items aren't for sale. */}
      {buyTarget && (
        <View style={styles.buyBar}>
          {productSlots.length > 1 && (
            <View style={styles.buySwitchRow}>
              {productSlots.map(({ slot }) => {
                const active = slot === buyTarget.slot;
                return (
                  <Pressable
                    key={slot}
                    style={[styles.buySwitch, active && styles.buySwitchActive]}
                    onPress={() => setBuyFocusSlot(slot)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Show the ${SLOT_LABELS[slot].toLowerCase()} you're wearing`}
                  >
                    <Text
                      style={[styles.buySwitchText, active && styles.buySwitchTextActive]}
                    >
                      {SLOT_LABELS[slot]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          <View style={styles.buyBarRow}>
            <View style={styles.buyBarText}>
              <Text style={styles.buyBarName} numberOfLines={1}>
                {buyTarget.product.name}
              </Text>
              <Text style={styles.buyBarBrand} numberOfLines={1}>
                {buyTarget.product.brand.name}
              </Text>
            </View>
            <View style={styles.buyBarAction}>
              <Pressable
                style={[styles.buyButton, buying && styles.buyButtonDisabled]}
                onPress={() => handleBuy(buyTarget.product)}
                disabled={buying}
                accessibilityRole="button"
                accessibilityLabel={`Buy ${buyTarget.product.name} at ${buyTarget.product.brand.name}, opens in your browser`}
              >
                {buying ? (
                  <ActivityIndicator color={colors.ink} />
                ) : (
                  <Text style={styles.buyButtonText}>
                    {`Buy — ${formatPrice(
                      effectivePriceCents(buyTarget.product),
                      buyTarget.product.currency
                    )}`}
                  </Text>
                )}
              </Pressable>
              {/* FTC 16 CFR Part 255: the material connection has to be
                  disclosed clearly and close to the affiliate link itself,
                  not buried in a settings screen. */}
              <Text style={styles.buyBarDisclosure}>Selv earns a commission</Text>
            </View>
          </View>
        </View>
      )}

      <View style={styles.drawer}>
        <View style={styles.drawerTabs}>
          {(
            [
              { value: "wardrobe", label: "My wardrobe" },
              { value: "shop", label: "Shop" },
            ] as const
          ).map((tab) => {
            const active = drawerSource === tab.value;
            return (
              <Pressable
                key={tab.value}
                style={[styles.drawerTab, active && styles.drawerTabActive]}
                onPress={() => setDrawerSource(tab.value)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.drawerTabText, active && styles.drawerTabTextActive]}>
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {drawerSource === "shop" ? (
          <ShopDrawer
            products={products}
            grouped={groupedProducts}
            loading={loadingProducts}
            error={productsError}
            equippedKeys={equippedKeys}
            onRetry={loadProducts}
            onEquip={handleEquipProduct}
            onBrowseShop={() => router.push("/(tabs)/shop" as const)}
          />
        ) : garmentsError && garments.length === 0 ? (
          <View style={styles.drawerMessageBlock}>
            <Text style={styles.errorText}>{garmentsError}</Text>
            <Pressable style={styles.retryButton} onPress={loadGarments} accessibilityRole="button">
              <Text style={styles.retryButtonText}>Retry</Text>
            </Pressable>
          </View>
        ) : loadingGarments ? (
          <ActivityIndicator style={styles.drawerLoading} color={colors.accent} />
        ) : garments.length === 0 ? (
          <View style={styles.drawerMessageBlock}>
            <Text style={styles.drawerEmptyTitle}>Your wardrobe is empty</Text>
            <Text style={styles.drawerEmptyBody}>
              Add a few garments and they&apos;ll show up here to try on.
            </Text>
            <Pressable
              style={styles.retryButton}
              onPress={() => router.push("/add-garment")}
              accessibilityRole="button"
            >
              <Text style={styles.retryButtonText}>Add a garment</Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.drawerScrollContent}>
            {garmentsError && (
              <View style={styles.drawerInlineError}>
                <Text style={styles.errorText} numberOfLines={1}>
                  {garmentsError}
                </Text>
                <Pressable style={styles.retryButton} onPress={loadGarments} accessibilityRole="button">
                  <Text style={styles.retryButtonText}>Retry</Text>
                </Pressable>
              </View>
            )}
            {CATEGORY_ORDER.map((category) => {
              const items = grouped.get(category);
              if (!items || items.length === 0) return null;
              return (
                <View key={category} style={styles.categorySection}>
                  <Text style={styles.categoryTitle}>{CATEGORY_LABELS[category]}</Text>
                  <FlatList
                    horizontal
                    data={items}
                    keyExtractor={(item) => item.id}
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.categoryList}
                    renderItem={({ item }) => {
                      const isEquipped = equippedKeys.has(garmentKey(item));
                      const swatch = resolveGarmentColor(item);
                      const uri = thumbUrls[item.id];
                      return (
                        <Pressable
                          style={[styles.card, isEquipped && styles.cardEquipped]}
                          onPress={() => handleEquipGarment(item)}
                          accessibilityRole="button"
                        >
                          {/* Same treatment as the Shop source above. A
                              garment saved from the catalog keeps the
                              partner's url — including a `selv-asset:` demo
                              uri — so it needs the tile underneath too; an
                              uploaded garment's signed url simply paints over
                              it. */}
                          <ProductImage
                            uri={uri}
                            category={item.category}
                            style={styles.cardImage}
                          />
                          <View style={[styles.cardSwatch, { backgroundColor: swatch }]} />
                          <Text style={styles.cardLabel} numberOfLines={1}>
                            {item.name || CATEGORY_LABELS[item.category]}
                          </Text>
                          {isEquipped && <Text style={styles.cardEquippedLabel}>Worn</Text>}
                        </Pressable>
                      );
                    }}
                  />
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>

      <Modal visible={saveModalVisible} transparent animationType="fade" onRequestClose={closeSaveModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {editingOutfitId ? "Update this outfit" : "Name this outfit"}
            </Text>
            <TextInput
              style={styles.modalInput}
              value={nameInput}
              onChangeText={(text) => {
                setNameInput(text);
                if (saveError) setSaveError(null);
              }}
              placeholder="e.g. Friday dinner"
              autoFocus
              maxLength={MAX_OUTFIT_NAME_LENGTH}
              editable={!saving}
              returnKeyType="done"
              // Wrapped: the handler's first argument is its save mode, and
              // onSubmitEditing would otherwise pass an event object there.
              onSubmitEditing={() => handleSaveOutfit()}
            />
            {saveError && <Text style={styles.errorText}>{saveError}</Text>}
            <View style={styles.modalButtonsRow}>
              <Pressable style={styles.modalCancelButton} onPress={closeSaveModal} disabled={saving}>
                <Text style={styles.modalCancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalSaveButton, saving && styles.modalSaveButtonDisabled]}
                onPress={() => handleSaveOutfit()}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color={colors.onInk} />
                ) : (
                  <Text style={styles.modalSaveButtonText}>
                    {editingOutfitId ? "Update" : "Save"}
                  </Text>
                )}
              </Pressable>
            </View>

            {/* The way out of overwriting. Offered only while editing, and as
                a link under the buttons rather than a third one in the row, so
                the primary choice stays a plain two-way Cancel/Update. */}
            {editingOutfitId && (
              <Pressable
                style={styles.modalSecondaryAction}
                onPress={() => handleSaveOutfit("new")}
                disabled={saving}
                accessibilityRole="button"
              >
                <Text style={styles.modalSecondaryActionText}>
                  Save as a new outfit instead
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

export default CharacterTryOnScreen;

/**
 * The drawer's "Shop" source: browse catalog items and put them straight on
 * the character without a wardrobe round-trip.
 *
 * Grouped by category with the same section headings the wardrobe source
 * uses, so switching sources doesn't rearrange how the drawer reads. Split
 * out as its own component purely so the screen's own drawer markup stays
 * readable — it holds no state.
 */
function ShopDrawer({
  products,
  grouped,
  loading,
  error,
  equippedKeys,
  onRetry,
  onEquip,
  onBrowseShop,
}: {
  products: ProductWithBrand[];
  grouped: Map<GarmentCategory, ProductWithBrand[]>;
  loading: boolean;
  error: string | null;
  /** Namespaced keys of everything currently worn — see `equippedKey`. */
  equippedKeys: Set<string>;
  onRetry: () => void;
  onEquip: (product: ProductWithBrand) => void;
  onBrowseShop: () => void;
}) {
  if (error && products.length === 0) {
    return (
      <View style={styles.drawerMessageBlock}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.retryButton} onPress={onRetry} accessibilityRole="button">
          <Text style={styles.retryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (loading && products.length === 0) {
    return <ActivityIndicator style={styles.drawerLoading} color={colors.accent} />;
  }

  if (products.length === 0) {
    return (
      <View style={styles.drawerMessageBlock}>
        <Text style={styles.drawerEmptyTitle}>Nothing to shop right now</Text>
        <Text style={styles.drawerEmptyBody}>
          New pieces land from our partner brands regularly — check back soon.
        </Text>
        <Pressable style={styles.retryButton} onPress={onRetry} accessibilityRole="button">
          <Text style={styles.retryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.drawerScrollContent}>
      {/* A refresh that failed while a previous list is still on screen —
          shown inline rather than replacing what the user is browsing. */}
      {error && (
        <View style={styles.drawerInlineError}>
          <Text style={styles.errorText} numberOfLines={1}>
            {error}
          </Text>
          <Pressable style={styles.retryButton} onPress={onRetry} accessibilityRole="button">
            <Text style={styles.retryButtonText}>Retry</Text>
          </Pressable>
        </View>
      )}

      {CATEGORY_ORDER.map((category) => {
        const items = grouped.get(category);
        if (!items || items.length === 0) return null;
        return (
          <View key={category} style={styles.categorySection}>
            <Text style={styles.categoryTitle}>{CATEGORY_LABELS[category]}</Text>
            <FlatList
              horizontal
              data={items}
              keyExtractor={(item) => item.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.categoryList}
              renderItem={({ item }) => {
                const isEquipped = equippedKeys.has(productKey(item));
                return (
                  <Pressable
                    style={[styles.card, isEquipped && styles.cardEquipped]}
                    onPress={() => onEquip(item)}
                    accessibilityRole="button"
                    accessibilityLabel={`Try on ${item.name} from ${item.brand.name}`}
                  >
                    {/* Via ProductImage, not a bare <Image>: catalog urls can
                        be a dead partner CDN or a `selv-asset:` demo uri, and
                        a drawer of blank squares is the one thing that would
                        make Shop -> try-on unusable. The bundled category tile
                        sits underneath either way. */}
                    <ProductImage
                      uri={item.tryon_image_url ?? item.image_url}
                      category={item.category}
                      style={styles.cardImage}
                    />
                    <Text style={styles.cardLabel} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.cardPrice} numberOfLines={1}>
                      {formatPrice(effectivePriceCents(item), item.currency)}
                    </Text>
                    {isEquipped && <Text style={styles.cardEquippedLabel}>Worn</Text>}
                  </Pressable>
                );
              }}
            />
          </View>
        );
      })}

      <Pressable style={styles.browseShopButton} onPress={onBrowseShop} accessibilityRole="button">
        <Text style={styles.browseShopButtonText}>Browse all of Shop</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centerFill: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  canvasArea: {
    flex: 0.56,
  },
  canvas: {
    flex: 1,
  },
  topOverlay: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    alignItems: "flex-start",
    gap: spacing.xs,
  },
  backButton: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  backButtonText: {
    color: colors.accent,
    fontFamily: fonts.medium,
    fontSize: 15,
  },
  legendTitle: {
    fontFamily: type.title.fontFamily,
    fontSize: 20,
    fontWeight: "700",
    color: colors.ink,
  },
  legendNote: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  slotRow: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    flexDirection: "row",
    // Wraps to two rows of two. Four chips squeezed onto one line left ~4
    // characters of room each, which is not a garment name — it's noise.
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  slotChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 10,
    gap: 6,
    // basis + grow rather than `flex: 1`, so two chips share a line and a
    // lone one still spans it.
    flexBasis: "46%",
    flexGrow: 1,
    flexShrink: 1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  slotChipFilled: {
    borderColor: colors.accent,
  },
  slotChipSwatch: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  slotChipSwatchEmpty: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  slotChipText: {
    fontSize: 11,
    color: colors.ink,
    fontWeight: "600",
    flexShrink: 1,
  },
  slotChipClear: {
    fontSize: 11,
    color: colors.muted,
  },
  slotChipShopTag: {
    fontSize: 9,
    fontWeight: "700",
    color: colors.accent,
    textTransform: "uppercase",
  },
  buyBar: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.ink,
    gap: spacing.xs,
  },
  buySwitchRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  buySwitch: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.muted,
  },
  buySwitchActive: {
    backgroundColor: colors.acid,
    borderColor: colors.acid,
  },
  buySwitchText: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.silhouette,
  },
  buySwitchTextActive: {
    color: colors.ink,
  },
  buyBarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  buyBarText: {
    flex: 1,
  },
  buyBarName: {
    color: colors.onInk,
    fontSize: 13,
    fontWeight: "700",
  },
  buyBarBrand: {
    color: colors.silhouette,
    fontSize: 11,
    marginTop: 1,
  },
  buyBarAction: {
    alignItems: "flex-end",
  },
  buyButton: {
    backgroundColor: colors.acid,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: radius.pill,
    minWidth: 120,
    alignItems: "center",
  },
  buyButtonDisabled: {
    opacity: 0.6,
  },
  buyButtonText: {
    color: colors.ink,
    fontWeight: "700",
    fontSize: 14,
  },
  buyBarDisclosure: {
    color: colors.silhouette,
    fontSize: 10,
    marginTop: 3,
  },
  drawerTabs: {
    flexDirection: "row",
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  drawerTab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
  },
  drawerTabActive: {
    backgroundColor: colors.ink,
  },
  drawerTabText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.muted,
  },
  drawerTabTextActive: {
    color: colors.onInk,
  },
  cardPrice: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.ink,
    marginTop: 1,
  },
  browseShopButton: {
    alignSelf: "center",
    marginTop: spacing.xs,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  browseShopButtonText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.ink,
  },
  saveButton: {
    position: "absolute",
    right: spacing.md,
    backgroundColor: colors.accent,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.pill,
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    color: colors.onInk,
    fontWeight: "700",
    fontSize: 13,
  },
  shareButton: {
    position: "absolute",
    right: spacing.md,
    backgroundColor: colors.ink,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.pill,
  },
  shareButtonDisabled: {
    opacity: 0.6,
  },
  shareButtonText: {
    color: colors.acid,
    fontWeight: "700",
    fontSize: 13,
  },
  offscreenCapture: {
    position: "absolute",
    top: -10000,
    left: 0,
  },
  drawer: {
    flex: 0.44,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  drawerScrollContent: {
    paddingVertical: spacing.sm,
    paddingBottom: spacing.lg,
  },
  drawerLoading: {
    marginTop: spacing.lg,
  },
  drawerMessageBlock: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  drawerInlineError: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  drawerEmptyTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.ink,
    textAlign: "center",
  },
  drawerEmptyBody: {
    fontSize: 13,
    color: colors.muted,
    textAlign: "center",
  },
  categorySection: {
    marginBottom: spacing.sm,
  },
  categoryTitle: {
    ...type.label,
    marginHorizontal: spacing.md,
    marginBottom: 6,
  },
  categoryList: {
    paddingHorizontal: spacing.md,
    gap: 10,
  },
  card: {
    width: 76,
    marginRight: 10,
    alignItems: "center",
  },
  cardEquipped: {
    opacity: 1,
  },
  cardImage: {
    width: 68,
    height: 68,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardSwatch: {
    width: 14,
    height: 14,
    borderRadius: 7,
    marginTop: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardLabel: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
    textAlign: "center",
  },
  cardEquippedLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.accent,
    marginTop: 1,
  },
  errorText: {
    color: colors.danger,
    flexShrink: 1,
  },
  retryButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
  },
  retryButtonText: {
    color: colors.onInk,
    fontWeight: "700",
    fontSize: 12,
  },
  title: {
    ...type.title,
    fontSize: 24,
    textAlign: "center",
    marginBottom: spacing.xs,
  },
  promptBody: {
    textAlign: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  overlayText: {
    marginTop: spacing.sm,
    fontSize: 13,
    color: colors.muted,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.danger,
    marginBottom: 4,
    textAlign: "center",
  },
  errorMessage: {
    fontSize: 12,
    color: colors.muted,
    textAlign: "center",
    marginBottom: spacing.md,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderRadius: radius.pill,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 20,
  },
  modalTitle: {
    fontFamily: type.title.fontFamily,
    fontSize: 18,
    fontWeight: "700",
    color: colors.ink,
    marginBottom: 12,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.ink,
  },
  modalButtonsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  modalCancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
  },
  modalCancelButtonText: {
    fontWeight: "600",
    color: colors.ink,
  },
  modalSaveButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
    alignItems: "center",
  },
  modalSaveButtonDisabled: {
    opacity: 0.6,
  },
  modalSaveButtonText: {
    fontWeight: "700",
    color: colors.onInk,
  },
  modalSecondaryAction: {
    marginTop: 12,
    alignItems: "center",
    paddingVertical: 4,
  },
  modalSecondaryActionText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.accent,
  },
});
