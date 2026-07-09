import { create } from "zustand";
import type { OutfitWithItems } from "../api/outfits";

export interface TryOnLayer {
  /** Client-side unique id for this layer instance (not the outfit_item id). */
  id: string;
  garmentId: string;
  imageUrl: string;
  /** True when the last attempt to resolve imageUrl for this layer failed. */
  imageError?: boolean;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  layerOrder: number;
}

export type NewTryOnLayer = Omit<TryOnLayer, "id" | "layerOrder">;

interface TryOnState {
  /** The outfit currently loaded/being edited, if any (null = unsaved/new). */
  outfitId: string | null;
  outfitName: string | null;
  layers: TryOnLayer[];
  selectedLayerId: string | null;

  addLayer: (layer: NewTryOnLayer) => string;
  removeLayer: (id: string) => void;
  updateLayer: (id: string, updates: Partial<Omit<TryOnLayer, "id">>) => void;
  bringToFront: (id: string) => void;
  selectLayer: (id: string | null) => void;
  clear: () => void;
  loadFromOutfit: (outfit: OutfitWithItems) => void;
}

function generateLayerId(): string {
  return `layer-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Holds the working state of the try-on canvas: the ordered stack of
 * garment layers placed on the avatar, plus which one is currently
 * selected. Populated either by tapping garments in TryOnStudioScreen
 * or by loadFromOutfit when re-opening a saved outfit.
 */
export const useTryOnStore = create<TryOnState>((set, get) => ({
  outfitId: null,
  outfitName: null,
  layers: [],
  selectedLayerId: null,

  addLayer: (layer) => {
    const id = generateLayerId();
    const maxOrder = get().layers.reduce(
      (max, l) => Math.max(max, l.layerOrder),
      -1
    );
    set((state) => ({
      layers: [
        ...state.layers,
        { ...layer, id, layerOrder: maxOrder + 1 },
      ],
      selectedLayerId: id,
    }));
    return id;
  },

  removeLayer: (id) =>
    set((state) => ({
      layers: state.layers.filter((l) => l.id !== id),
      selectedLayerId:
        state.selectedLayerId === id ? null : state.selectedLayerId,
    })),

  updateLayer: (id, updates) =>
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === id ? { ...l, ...updates } : l
      ),
    })),

  bringToFront: (id) =>
    set((state) => {
      const maxOrder = state.layers.reduce(
        (max, l) => Math.max(max, l.layerOrder),
        -1
      );
      return {
        layers: state.layers.map((l) =>
          l.id === id ? { ...l, layerOrder: maxOrder + 1 } : l
        ),
      };
    }),

  selectLayer: (id) => set({ selectedLayerId: id }),

  clear: () =>
    set({
      outfitId: null,
      outfitName: null,
      layers: [],
      selectedLayerId: null,
    }),

  loadFromOutfit: (outfit) =>
    set({
      outfitId: outfit.id,
      outfitName: outfit.name,
      selectedLayerId: null,
      layers: outfit.items
        .slice()
        .sort((a, b) => a.layer_order - b.layer_order)
        .map((item) => ({
          id: generateLayerId(),
          garmentId: item.garment_id,
          imageUrl: "",
          imageError: false,
          x: item.x,
          y: item.y,
          scale: item.scale,
          rotation: item.rotation,
          layerOrder: item.layer_order,
        })),
    }),
}));
