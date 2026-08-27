import { create } from "zustand";
import { apiGet, apiPost } from "@/services/apiClient";
import { FoodOrder, FoodOrderStatus } from "@/types";

type OrdersState = {
  online: boolean;
  statusLoaded: boolean;
  onlineBusy: boolean;
  orders: FoodOrder[];
  loading: boolean;
  error: string | null;
  loadStatus: () => Promise<void>;
  setOnline: (value: boolean) => Promise<void>;
  refresh: () => Promise<void>;
  getOrder: (id: string) => FoodOrder | undefined;
  fetchOrder: (id: string) => Promise<FoodOrder | null>;
  transition: (id: string, to: FoodOrderStatus, code?: string) => Promise<FoodOrder>;
  clear: () => void;
};

// The server already scopes GET /api/v1/orders to exactly what a partner may
// see: jobs assigned to them, plus unassigned READY_FOR_PICKUP jobs anyone
// can claim. This store is a cache of that response — the Home/Trips screens
// just filter it client-side by whether deliveryPartner matches the caller.
export const useOrdersStore = create<OrdersState>((set, get) => ({
  online: false,
  statusLoaded: false,
  onlineBusy: false,
  orders: [],
  loading: false,
  error: null,

  loadStatus: async () => {
    try {
      const data = await apiGet<{ online: boolean }>("/api/v1/partner/status");
      set({ online: data.online, statusLoaded: true });
    } catch {
      set({ statusLoaded: true });
    }
  },

  setOnline: async (value) => {
    set({ onlineBusy: true });
    try {
      const data = await apiPost<{ online: boolean }>("/api/v1/partner/online", { value });
      set({ online: data.online, onlineBusy: false });
    } catch (e) {
      set({ onlineBusy: false, error: e instanceof Error ? e.message : "Could not update your status" });
      throw e;
    }
  },

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const data = await apiGet<{ orders: FoodOrder[] }>("/api/v1/orders");
      set({ orders: data.orders, loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : "Couldn't load jobs" });
    }
  },

  getOrder: (id) => get().orders.find((o) => o.id === id),

  fetchOrder: async (id) => {
    try {
      const data = await apiGet<{ order: FoodOrder }>(`/api/v1/orders/${id}`);
      const existing = get().orders.filter((o) => o.id !== id);
      set({ orders: [data.order, ...existing] });
      return data.order;
    } catch {
      return null;
    }
  },

  transition: async (id, to, code) => {
    const data = await apiPost<{ order: FoodOrder }>(`/api/v1/orders/${id}/transition`, { to, code });
    const existing = get().orders.filter((o) => o.id !== id);
    set({ orders: [data.order, ...existing] });
    return data.order;
  },

  clear: () => set({ orders: [], error: null }),
}));
