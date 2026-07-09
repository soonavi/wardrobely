import { supabase } from "../supabase";
import type { GarmentRow, OutfitItemRow, OutfitRow } from "../database.types";

export interface ApiResult<T> {
  data: T | null;
  error: string | null;
}

export interface CreateOutfitItemInput {
  garment_id: string;
  layer_order: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

/** An outfit_items row joined with its garment row, as returned by listOutfits/getOutfit. */
export interface OutfitItemWithGarment extends OutfitItemRow {
  garment: GarmentRow;
}

/** An outfit row with its items (each joined to the garment) attached. */
export interface OutfitWithItems extends OutfitRow {
  items: OutfitItemWithGarment[];
}

/**
 * Create an outfit and its outfit_items rows in one call. The outfit row
 * is inserted first, then all items are inserted with that outfit_id.
 * If the items insert fails, the outfit row is rolled back.
 */
export async function createOutfit(
  userId: string,
  name: string,
  items: CreateOutfitItemInput[]
): Promise<ApiResult<OutfitWithItems>> {
  const { data: outfit, error: outfitError } = await supabase
    .from("outfits")
    .insert({ user_id: userId, name })
    .select()
    .single();

  if (outfitError) {
    return { data: null, error: outfitError.message };
  }

  // outfit_items is keyed on (outfit_id, garment_id) — dedupe by garment,
  // keeping the top-most layer, so the insert can't hit a PK conflict.
  const dedupedItems = Array.from(
    items
      .slice()
      .sort((a, b) => a.layer_order - b.layer_order)
      .reduce(
        (map, item) => map.set(item.garment_id, item),
        new Map<string, CreateOutfitItemInput>()
      )
      .values()
  );

  if (dedupedItems.length > 0) {
    const { error: itemsError } = await supabase.from("outfit_items").insert(
      dedupedItems.map((item) => ({
        outfit_id: outfit.id,
        garment_id: item.garment_id,
        layer_order: item.layer_order,
        x: item.x,
        y: item.y,
        scale: item.scale,
        rotation: item.rotation,
      }))
    );

    if (itemsError) {
      // Roll back the outfit row so we don't leave an empty orphan outfit.
      await supabase.from("outfits").delete().eq("id", outfit.id);
      return { data: null, error: itemsError.message };
    }
  }

  return getOutfit(outfit.id);
}

/** List a user's outfits, each with its items joined to the garment rows. */
export async function listOutfits(
  userId: string
): Promise<ApiResult<OutfitWithItems[]>> {
  const { data, error } = await supabase
    .from("outfits")
    .select("*, outfit_items(*, garment:garments(*))")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    return { data: null, error: error.message };
  }

  const outfits: OutfitWithItems[] = (data ?? []).map((row: any) => ({
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    created_at: row.created_at,
    items: (row.outfit_items ?? []).map((item: any) => ({
      outfit_id: item.outfit_id,
      garment_id: item.garment_id,
      layer_order: item.layer_order,
      x: item.x,
      y: item.y,
      scale: item.scale,
      rotation: item.rotation,
      garment: item.garment as GarmentRow,
    })),
  }));

  return { data: outfits, error: null };
}

/** Fetch a single outfit with its items joined to the garment rows. */
export async function getOutfit(
  outfitId: string
): Promise<ApiResult<OutfitWithItems>> {
  const { data, error } = await supabase
    .from("outfits")
    .select("*, outfit_items(*, garment:garments(*))")
    .eq("id", outfitId)
    .maybeSingle();

  if (error) {
    return { data: null, error: error.message };
  }

  if (!data) {
    return { data: null, error: "Outfit not found" };
  }

  const row: any = data;
  const outfit: OutfitWithItems = {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    created_at: row.created_at,
    items: (row.outfit_items ?? []).map((item: any) => ({
      outfit_id: item.outfit_id,
      garment_id: item.garment_id,
      layer_order: item.layer_order,
      x: item.x,
      y: item.y,
      scale: item.scale,
      rotation: item.rotation,
      garment: item.garment as GarmentRow,
    })),
  };

  return { data: outfit, error: null };
}

/** Delete an outfit (outfit_items cascade via FK). */
export async function deleteOutfit(
  outfitId: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("outfits").delete().eq("id", outfitId);
  return { error: error ? error.message : null };
}

/**
 * Update an existing outfit's name and replace its items wholesale.
 *
 * Used to save changes back onto an outfit that was loaded into the
 * try-on studio, instead of creating a duplicate outfit. Not currently
 * called anywhere — the try-on studio always calls `createOutfit`, even
 * when editing a loaded outfit (see PLAN.md "Known MVP limitation").
 * Wiring this in requires the studio to pass `useTryOnStore`'s
 * `outfitId` here when it's non-null; that's outside this file's scope.
 */
export async function updateOutfit(
  outfitId: string,
  name: string,
  items: CreateOutfitItemInput[]
): Promise<ApiResult<OutfitWithItems>> {
  const { error: renameError } = await supabase
    .from("outfits")
    .update({ name })
    .eq("id", outfitId);

  if (renameError) {
    return { data: null, error: renameError.message };
  }

  const { error: deleteError } = await supabase
    .from("outfit_items")
    .delete()
    .eq("outfit_id", outfitId);

  if (deleteError) {
    return { data: null, error: deleteError.message };
  }

  // outfit_items is keyed on (outfit_id, garment_id) — dedupe by garment,
  // keeping the top-most layer, so the insert can't hit a PK conflict.
  const dedupedItems = Array.from(
    items
      .slice()
      .sort((a, b) => a.layer_order - b.layer_order)
      .reduce(
        (map, item) => map.set(item.garment_id, item),
        new Map<string, CreateOutfitItemInput>()
      )
      .values()
  );

  if (dedupedItems.length > 0) {
    const { error: itemsError } = await supabase.from("outfit_items").insert(
      dedupedItems.map((item) => ({
        outfit_id: outfitId,
        garment_id: item.garment_id,
        layer_order: item.layer_order,
        x: item.x,
        y: item.y,
        scale: item.scale,
        rotation: item.rotation,
      }))
    );

    if (itemsError) {
      return { data: null, error: itemsError.message };
    }
  }

  return getOutfit(outfitId);
}

/** Rename an outfit. */
export async function renameOutfit(
  outfitId: string,
  name: string
): Promise<ApiResult<OutfitRow>> {
  const { data, error } = await supabase
    .from("outfits")
    .update({ name })
    .eq("id", outfitId)
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as OutfitRow, error: null };
}
