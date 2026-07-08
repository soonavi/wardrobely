import type { GarmentCategory } from "../../lib/database.types";

export interface CategoryOption {
  label: string;
  value: GarmentCategory;
}

export const CATEGORY_OPTIONS: CategoryOption[] = [
  { label: "Top", value: "top" },
  { label: "Bottom", value: "bottom" },
  { label: "Dress", value: "dress" },
  { label: "Outerwear", value: "outerwear" },
  { label: "Shoes", value: "shoes" },
  { label: "Accessory", value: "accessory" },
];
