import { supabase } from "../supabase";
import type { Build, ProfileRow } from "../database.types";

export interface ApiResult<T> {
  data: T | null;
  error: string | null;
}

/** Fetch the profile row for a given user id (defaults to current user). */
export async function getProfile(
  userId: string
): Promise<ApiResult<ProfileRow>> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as ProfileRow | null, error: null };
}

export interface BodyMetricsInput {
  height_cm: number;
  weight_kg: number;
  build: Build;
}

/** Update the current user's height, weight, and general build. */
export async function updateBodyMetrics(
  userId: string,
  metrics: BodyMetricsInput
): Promise<ApiResult<ProfileRow>> {
  const { data, error } = await supabase
    .from("profiles")
    .update(metrics)
    .eq("id", userId)
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as ProfileRow, error: null };
}

/** Update the current user's display name. */
export async function updateDisplayName(
  userId: string,
  displayName: string
): Promise<ApiResult<ProfileRow>> {
  const { data, error } = await supabase
    .from("profiles")
    .update({ display_name: displayName })
    .eq("id", userId)
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as ProfileRow, error: null };
}

/** Generic profile update. */
export async function updateProfile(
  userId: string,
  updates: Partial<
    Pick<ProfileRow, "display_name" | "height_cm" | "weight_kg" | "build">
  >
): Promise<ApiResult<ProfileRow>> {
  const { data, error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", userId)
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as ProfileRow, error: null };
}
