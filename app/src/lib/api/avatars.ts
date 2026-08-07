import { supabase } from "../supabase";
import {
  measurementsToShapeParams,
  type Measurements,
  type ShapeParams,
} from "../../features/avatar3d/bodyModel";
import type { Customization } from "../../features/creator/customization";
import type { AvatarRow } from "../database.types";

export interface ApiResult<T> {
  data: T | null;
  error: string | null;
}

/**
 * Every function below operates on "my" avatar rather than taking a
 * userId parameter like garments.ts/profiles.ts do. There's exactly one
 * avatar per user (the `avatars_user_id_key` unique constraint + upsert-
 * on-user_id pattern below), avatars are never looked up for anyone but
 * the signed-in user, and RLS (`user_id = auth.uid()`) would reject a
 * mismatched id anyway — so there's no legitimate caller-supplied id to
 * thread through, and resolving it from the session here keeps call sites
 * simple.
 */
async function getCurrentUserId(): Promise<{
  userId: string | null;
  error: string | null;
}> {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    return { userId: null, error: error.message };
  }
  if (!data.user) {
    return { userId: null, error: "Not signed in." };
  }
  return { userId: data.user.id, error: null };
}

/**
 * Fetch the signed-in user's avatar row, or null if they haven't saved
 * one yet. `customization` (the character creator's appearance choices —
 * see features/creator/customization.ts) is the field screens should read
 * for the current avatar; pass it through `mergeCustomization` before use,
 * since the DB only guarantees it's an object (`{}` by default), not a
 * fully-populated Customization.
 */
export async function getMyAvatar(): Promise<ApiResult<AvatarRow>> {
  const { userId, error: userError } = await getCurrentUserId();
  if (!userId) {
    return { data: null, error: userError };
  }

  const { data, error } = await supabase
    .from("avatars")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as AvatarRow | null, error: null };
}

/**
 * Create or update the signed-in user's avatar row (upserts on `user_id`,
 * so there is always at most one row per user — matches the DB's unique
 * constraint). `shape_params` is always (re)computed from `measurements`
 * via bodyModel's calibrated mapping here, rather than accepted as an
 * input, so the stored shape vector can never drift out of sync with the
 * raw measurements it was derived from.
 */
export async function upsertMyAvatar(
  measurements: Measurements,
  skinTone: string | null
): Promise<ApiResult<AvatarRow>> {
  const { userId, error: userError } = await getCurrentUserId();
  if (!userId) {
    return { data: null, error: userError };
  }

  const shapeParams: ShapeParams = measurementsToShapeParams(measurements);

  const { data, error } = await supabase
    .from("avatars")
    .upsert(
      {
        user_id: userId,
        height_cm: measurements.heightCm,
        weight_kg: measurements.weightKg,
        chest_cm: measurements.chestCm ?? null,
        waist_cm: measurements.waistCm ?? null,
        hip_cm: measurements.hipCm ?? null,
        inseam_cm: measurements.inseamCm ?? null,
        skin_tone: skinTone,
        shape_params: shapeParams,
      },
      { onConflict: "user_id" }
    )
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as AvatarRow, error: null };
}

/**
 * Create or update the signed-in user's avatar row with a full set of
 * character-creator appearance choices (upserts on `user_id`, same
 * one-row-per-user pattern as upsertMyAvatar above). Only the
 * `customization` column is written — height/weight/measurement columns
 * on an existing row are left untouched, and on a brand-new row they're
 * simply left null (they're nullable; see database.types.ts's AvatarRow).
 */
export async function saveCustomization(
  customization: Customization
): Promise<ApiResult<AvatarRow>> {
  const { userId, error: userError } = await getCurrentUserId();
  if (!userId) {
    return { data: null, error: userError };
  }

  const { data, error } = await supabase
    .from("avatars")
    .upsert(
      {
        user_id: userId,
        customization,
      },
      { onConflict: "user_id" }
    )
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as AvatarRow, error: null };
}

/** Delete the signed-in user's avatar row (they'll be prompted to re-enter measurements next time). */
export async function deleteMyAvatar(): Promise<{ error: string | null }> {
  const { userId, error: userError } = await getCurrentUserId();
  if (!userId) {
    return { error: userError };
  }

  const { error } = await supabase.from("avatars").delete().eq("user_id", userId);
  return { error: error ? error.message : null };
}
