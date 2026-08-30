import { create } from "zustand";
import { apiGet, apiPatch, apiPost } from "@/services/apiClient";
import { FoodItem, Restaurant } from "@/types";

export type CreateMenuItemInput = {
  name: string;
  description: string;
  price: number;
  categoryKey: string;
  veg: boolean;
  imageUrl?: string | null;
};

export type UpdateMenuItemInput = Partial<{
  name: string;
  description: string;
  price: number;
  veg: boolean;
  available: boolean;
  imageUrl: string | null;
}>;

type VendorState = {
  restaurant: Restaurant | null;
  restaurantLoaded: boolean;
  menu: FoodItem[];
  loading: boolean;
  error: string | null;
  loadRestaurant: () => Promise<void>;
  setOpen: (isOpen: boolean) => Promise<void>;
  loadMenu: () => Promise<void>;
  createMenuItem: (input: CreateMenuItemInput) => Promise<FoodItem>;
  updateMenuItem: (id: string, patch: UpdateMenuItemInput) => Promise<FoodItem>;
  clear: () => void;
};

// A brand-new vendor account has no restaurant until an admin links one via
// the web Admin app's Vendors page — GET /restaurant returning null is a
// real, expected state, not an error.
export const useVendorStore = create<VendorState>((set, get) => ({
  restaurant: null,
  restaurantLoaded: false,
  menu: [],
  loading: false,
  error: null,

  loadRestaurant: async () => {
    try {
      const data = await apiGet<{ restaurant: Restaurant | null }>("/api/v1/vendor/restaurant");
      set({ restaurant: data.restaurant, restaurantLoaded: true });
    } catch (e) {
      set({ restaurantLoaded: true, error: e instanceof Error ? e.message : "Could not load your restaurant" });
    }
  },

  setOpen: async (isOpen) => {
    const data = await apiPatch<{ restaurant: Restaurant }>("/api/v1/vendor/restaurant", { isOpen });
    set({ restaurant: data.restaurant });
  },

  loadMenu: async () => {
    set({ loading: true, error: null });
    try {
      const data = await apiGet<{ items: FoodItem[] }>("/api/v1/vendor/menu");
      set({ menu: data.items, loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : "Could not load your menu" });
    }
  },

  createMenuItem: async (input) => {
    const data = await apiPost<{ item: FoodItem }>("/api/v1/vendor/menu", input);
    set({ menu: [data.item, ...get().menu] });
    return data.item;
  },

  updateMenuItem: async (id, patch) => {
    const data = await apiPatch<{ item: FoodItem }>(`/api/v1/vendor/menu/${id}`, patch);
    set({ menu: get().menu.map((i) => (i.id === id ? data.item : i)) });
    return data.item;
  },

  clear: () => set({ restaurant: null, restaurantLoaded: false, menu: [], loading: false, error: null }),
}));
