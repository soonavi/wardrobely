/**
 * Hand-written types mirroring supabase/schema.sql.
 * If you regenerate types with the Supabase CLI
 * (`supabase gen types typescript`), you can replace this file with the
 * generated output — the shape is designed to match it closely.
 */

/** Legacy enum — column still exists in the DB but the app no longer uses it. */
export type BodyType =
  | "rectangle"
  | "hourglass"
  | "pear"
  | "apple"
  | "inverted_triangle"
  | "athletic";

/** General build selected during onboarding (profiles.build). */
export type Build = "slim" | "average" | "athletic" | "curvy" | "broad";

export type GarmentCategory =
  | "top"
  | "bottom"
  | "dress"
  | "outerwear"
  | "shoes"
  | "accessory";

export interface ProfileRow {
  id: string;
  display_name: string | null;
  body_type: BodyType | null;
  height_cm: number | null;
  weight_kg: number | null;
  build: Build | null;
  created_at: string;
}

export interface GarmentRow {
  id: string;
  user_id: string;
  image_path: string;
  category: GarmentCategory;
  name: string | null;
  color: string | null;
  brand: string | null;
  tags: string[];
  created_at: string;
}

export interface OutfitRow {
  id: string;
  user_id: string;
  name: string | null;
  created_at: string;
}

export interface OutfitItemRow {
  outfit_id: string;
  garment_id: string;
  layer_order: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: Partial<ProfileRow> & { id: string };
        Update: Partial<ProfileRow>;
      };
      garments: {
        Row: GarmentRow;
        Insert: Partial<GarmentRow> & {
          user_id: string;
          image_path: string;
          category: GarmentCategory;
        };
        Update: Partial<GarmentRow>;
      };
      outfits: {
        Row: OutfitRow;
        Insert: Partial<OutfitRow> & { user_id: string };
        Update: Partial<OutfitRow>;
      };
      outfit_items: {
        Row: OutfitItemRow;
        Insert: Partial<OutfitItemRow> & {
          outfit_id: string;
          garment_id: string;
        };
        Update: Partial<OutfitItemRow>;
      };
    };
  };
}
