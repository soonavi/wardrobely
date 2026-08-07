import { supabase } from "../supabase";
import type { GarmentCategory, GarmentRow } from "../database.types";
import { canAddGarment, getCurrentPlan, wardrobeLimitMessage } from "../pricing";

export interface ApiResult<T> {
  data: T | null;
  error: string | null;
}

const GARMENTS_BUCKET = "garments";

export interface CreateGarmentInput {
  userId: string;
  /** Local file URI from expo-image-picker (e.g. file://...). */
  imageUri: string;
  category: GarmentCategory;
  name?: string;
  color?: string;
  brand?: string;
  tags?: string[];
}

export interface UpdateGarmentInput {
  category?: GarmentCategory;
  name?: string | null;
  color?: string | null;
  brand?: string | null;
  tags?: string[];
}

export interface ListGarmentsFilter {
  category?: GarmentCategory;
  tag?: string;
}

/**
 * Reads a local file URI into an ArrayBuffer suitable for Supabase Storage
 * upload. Uses fetch + arrayBuffer, which works for local file:// and
 * content:// URIs in Expo Go / React Native runtime.
 */
async function uriToArrayBuffer(uri: string): Promise<ArrayBuffer> {
  const response = await fetch(uri);
  return await response.arrayBuffer();
}

/**
 * How many garments the user owns, in total — never filtered.
 *
 * This exists as its own call because the wardrobe cap must be judged against
 * the whole wardrobe, while `listGarments` deliberately returns only what the
 * active category/tag filter matches. Deriving the cap from a filtered list is
 * the bug this replaces: a user at the limit could filter to a category
 * holding three items, be told "3/25", and be waved into the add-garment flow
 * only to be rejected at save time after picking a photo and typing metadata.
 *
 * `head: true` fetches no rows — Postgres returns the count in a header — so
 * this stays cheap enough to run alongside every list refresh.
 */
export async function countGarments(userId: string): Promise<ApiResult<number>> {
  const { count, error } = await supabase
    .from("garments")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: count ?? 0, error: null };
}

/**
 * Upload a garment image to storage at {user_id}/{garment_id}.jpg and
 * insert the corresponding garments row. The garment id is generated
 * client-side so the storage path can be known before the row exists.
 */
export async function createGarment(
  input: CreateGarmentInput
): Promise<ApiResult<GarmentRow>> {
  // Defensive guard: re-check the free-tier wardrobe cap right before
  // inserting, independent of any check the caller already did. The
  // wardrobe screen blocks navigation to the add-garment flow once the
  // cap is hit, but that's a UI convenience only — someone could still
  // deep-link straight into add-garment, so the cap has to be enforced
  // here too, right against the current server-side count.
  const { data: count, error: countError } = await countGarments(input.userId);

  if (countError) {
    return { data: null, error: countError };
  }

  if (!canAddGarment(count ?? 0, getCurrentPlan())) {
    return { data: null, error: wardrobeLimitMessage() };
  }

  const garmentId = generateUuid();
  const imagePath = `${input.userId}/${garmentId}.jpg`;

  try {
    const fileData = await uriToArrayBuffer(input.imageUri);

    const { error: uploadError } = await supabase.storage
      .from(GARMENTS_BUCKET)
      .upload(imagePath, fileData, {
        contentType: "image/jpeg",
        upsert: true,
      });

    if (uploadError) {
      return { data: null, error: uploadError.message };
    }

    const { data, error: insertError } = await supabase
      .from("garments")
      .insert({
        id: garmentId,
        user_id: input.userId,
        image_path: imagePath,
        category: input.category,
        name: input.name ?? null,
        color: input.color ?? null,
        brand: input.brand ?? null,
        tags: input.tags ?? [],
      })
      .select()
      .single();

    if (insertError) {
      // Roll back the uploaded file if the row insert failed.
      await supabase.storage.from(GARMENTS_BUCKET).remove([imagePath]);
      return { data: null, error: insertError.message };
    }

    return { data: data as GarmentRow, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "Failed to upload image",
    };
  }
}

/** List garments for a user, optionally filtered by category and/or tag. */
export async function listGarments(
  userId: string,
  filter?: ListGarmentsFilter
): Promise<ApiResult<GarmentRow[]>> {
  let query = supabase
    .from("garments")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (filter?.category) {
    query = query.eq("category", filter.category);
  }

  if (filter?.tag) {
    query = query.contains("tags", [filter.tag]);
  }

  const { data, error } = await query;

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: (data ?? []) as GarmentRow[], error: null };
}

/** Fetch a single garment by id. */
export async function getGarment(
  garmentId: string
): Promise<ApiResult<GarmentRow>> {
  const { data, error } = await supabase
    .from("garments")
    .select("*")
    .eq("id", garmentId)
    .maybeSingle();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as GarmentRow | null, error: null };
}

/** Update garment metadata (does not change the image). */
export async function updateGarment(
  garmentId: string,
  updates: UpdateGarmentInput
): Promise<ApiResult<GarmentRow>> {
  const { data, error } = await supabase
    .from("garments")
    .update(updates)
    .eq("id", garmentId)
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as GarmentRow, error: null };
}

/**
 * Delete a garment row and, when it owns one, its storage object.
 *
 * `imagePath` is nullable because a garment no longer always comes from a
 * user photo upload. A catalog-sourced garment (`source === 'catalog'`, saved
 * from the Shop tab) keeps its imagery on the partner's CDN in `image_url`
 * and has `image_path === null` — there is no object in our bucket to remove,
 * and asking Storage to delete one would either fail the delete outright or
 * ask it to remove something that was never ours. So the storage call is
 * skipped entirely rather than being handed a synthesized or empty path.
 */
export async function deleteGarment(
  garmentId: string,
  imagePath: string | null
): Promise<{ error: string | null }> {
  if (imagePath) {
    const { error: storageError } = await supabase.storage
      .from(GARMENTS_BUCKET)
      .remove([imagePath]);

    if (storageError) {
      return { error: storageError.message };
    }
  }

  const { error: deleteError } = await supabase
    .from("garments")
    .delete()
    .eq("id", garmentId);

  if (deleteError) {
    return { error: deleteError.message };
  }

  return { error: null };
}

/** Seconds a signed garment image URL stays valid for. */
const SIGNED_URL_EXPIRY_SECONDS = 60 * 60; // 1 hour

/**
 * Get a signed URL for an image path. The "garments" storage bucket is
 * private, so callers must request a freshly signed URL rather than a
 * public one.
 */
export async function getGarmentImageUrl(
  imagePath: string
): Promise<ApiResult<string>> {
  const { data, error } = await supabase.storage
    .from(GARMENTS_BUCKET)
    .createSignedUrl(imagePath, SIGNED_URL_EXPIRY_SECONDS);

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data.signedUrl, error: null };
}

/** RFC4122-ish v4 UUID generator (no native crypto module required). */
function generateUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
