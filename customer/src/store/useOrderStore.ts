import { create } from "zustand";
import { apiGet, apiPost } from "@/services/apiClient";
import { CartLineItem, DeliveryInstruction, FoodOrder, FoodOrderStatus, PaymentMethod } from "@/types";

export type CreateOrderInput = {
  restaurantId: string;
  items: CartLineItem[];
  deliveryAddress: Record<string, unknown>;
  instructions: DeliveryInstruction[];
  couponCode?: string;
  tip: number;
  paymentMethod: PaymentMethod;
};

type OrderState = {
  orders: FoodOrder[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createOrder: (input: CreateOrderInput) => Promise<FoodOrder>;
  getOrder: (id: string) => FoodOrder | undefined;
  fetchOrder: (id: string) => Promise<FoodOrder | null>;
  transition: (id: string, to: FoodOrderStatus, otp?: string) => Promise<FoodOrder>;
  clear: () => void;
};

// Orders live on the server. The store is a cache of what the API returned —
// it never invents state, so what the customer sees matches what the vendor
// and admin panels see.
export const useOrderStore = create<OrderState>((set, get) => ({
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

  createOrder: async (input) => {
    const data = await apiPost<{ order: FoodOrder }>("/api/v1/orders", {
      restaurantId: input.restaurantId,
      paymentMethod: input.paymentMethod,
      couponCode: input.couponCode,
      tip: input.tip,
      instructions: input.instructions,
      deliveryAddress: input.deliveryAddress,
      // Only identifiers and quantities are sent; the server re-prices everything.
      items: input.items.map((i) => ({
        foodItemId: i.foodItemId,
        quantity: i.quantity,
        variantId: i.selectedVariant?.id ?? null,
        addonIds: i.selectedAddons.map((a) => a.id),
      })),
    });
    set({ orders: [data.order, ...get().orders] });
    return data.order;
  },

  getOrder: (id) => get().orders.find((o) => o.id === id),

  fetchOrder: async (id) => {
    try {
      const data = await apiGet<{ order: FoodOrder }>(`/api/v1/orders/${id}`);
      const existing = get().orders.filter((o) => o.id !== id);
      set({ orders: [data.order, ...existing].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
      return data.order;
    } catch {
      return null;
    }
  },

  transition: async (id, to, otp) => {
    const data = await apiPost<{ order: FoodOrder }>(`/api/v1/orders/${id}/transition`, { to, otp });
    set({ orders: get().orders.map((o) => (o.id === id ? data.order : o)) });
    return data.order;
  },

  clear: () => set({ orders: [], error: null }),
}));
