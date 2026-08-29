import { create } from "zustand";
import { apiGet, apiPost } from "@/services/apiClient";
import { FoodOrder, FoodOrderStatus } from "@/types";

type OrdersState = {
  orders: FoodOrder[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  transition: (id: string, to: FoodOrderStatus) => Promise<FoodOrder>;
  clear: () => void;
};

// GET /api/v1/orders is already scoped server-side to this vendor's owned
// restaurant(s) — this store is just a cache of that response.
export const useOrdersStore = create<OrdersState>((set, get) => ({
  orders: [],
  loading: false,
  error: null,

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const data = await apiGet<{ orders: FoodOrder[] }>("/api/v1/orders");
      set({ orders: data.orders, loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : "Couldn't load orders" });
    }
  },

  transition: async (id, to) => {
    const data = await apiPost<{ order: FoodOrder }>(`/api/v1/orders/${id}/transition`, { to });
    set({ orders: get().orders.map((o) => (o.id === id ? data.order : o)) });
    return data.order;
  },

  clear: () => set({ orders: [], loading: false, error: null }),
}));
