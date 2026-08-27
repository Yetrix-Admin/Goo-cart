import { useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { calculateBill } from "@/services/PricingService";
import { useCatalogStore } from "@/store/useCatalogStore";
import { BillBreakdown, CartLineItem, DeliveryInstruction } from "@/types";

const STORAGE_KEY = "goocart.cart.v1";

// A cart line is identified by what it actually is, not when it was added, so
// adding the same configuration twice increments quantity instead of creating
// a duplicate row. It also keeps ids pure (no Date.now() during a render pass).
export function cartLineId(foodItemId: string, variantId?: string | null, addonIds: string[] = []): string {
  return [foodItemId, variantId ?? "-", [...addonIds].sort().join("+") || "-"].join("|");
}

type AddItemResult = { conflict: boolean };

type CartState = {
  restaurantId: string | null;
  restaurantName: string | null;
  items: CartLineItem[];
  couponCode: string | null;
  instructions: DeliveryInstruction[];
  tip: number;

  addItem: (restaurantId: string, restaurantName: string, item: CartLineItem) => AddItemResult;
  replaceCartWithItem: (restaurantId: string, restaurantName: string, item: CartLineItem) => void;
  updateQty: (lineId: string, delta: number) => void;
  removeLine: (lineId: string) => void;
  applyCoupon: (code: string) => void;
  removeCoupon: () => void;
  toggleInstruction: (instruction: DeliveryInstruction) => void;
  setTip: (amount: number) => void;
  clear: () => void;
  hydrate: () => Promise<void>;
};

type PersistedCart = Pick<CartState, "restaurantId" | "restaurantName" | "items" | "couponCode" | "instructions" | "tip">;

function persist(state: CartState) {
  const snapshot: PersistedCart = {
    restaurantId: state.restaurantId,
    restaurantName: state.restaurantName,
    items: state.items,
    couponCode: state.couponCode,
    instructions: state.instructions,
    tip: state.tip,
  };
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

export const useCartStore = create<CartState>((set, get) => ({
  restaurantId: null,
  restaurantName: null,
  items: [],
  couponCode: null,
  instructions: [],
  tip: 0,

  addItem: (restaurantId, restaurantName, item) => {
    const state = get();
    if (state.restaurantId && state.restaurantId !== restaurantId) {
      return { conflict: true };
    }
    const existing = state.items.find((i) => i.lineId === item.lineId);
    const items = existing
      ? state.items.map((i) =>
          i.lineId === item.lineId
            ? { ...i, quantity: i.quantity + item.quantity, lineTotal: Math.round(i.unitPrice * (i.quantity + item.quantity)) }
            : i,
        )
      : [...state.items, item];
    set({ restaurantId, restaurantName, items });
    persist(get());
    return { conflict: false };
  },

  replaceCartWithItem: (restaurantId, restaurantName, item) => {
    set({ restaurantId, restaurantName, items: [item], couponCode: null, instructions: [], tip: 0 });
    persist(get());
  },

  updateQty: (lineId, delta) => {
    const items = get()
      .items.map((i) => (i.lineId === lineId ? { ...i, quantity: i.quantity + delta, lineTotal: Math.round(i.unitPrice * (i.quantity + delta)) } : i))
      .filter((i) => i.quantity > 0);
    set({
      items,
      restaurantId: items.length ? get().restaurantId : null,
      restaurantName: items.length ? get().restaurantName : null,
      couponCode: items.length ? get().couponCode : null,
    });
    persist(get());
  },

  removeLine: (lineId) => {
    const items = get().items.filter((i) => i.lineId !== lineId);
    set({ items, restaurantId: items.length ? get().restaurantId : null, restaurantName: items.length ? get().restaurantName : null });
    persist(get());
  },

  applyCoupon: (code) => {
    set({ couponCode: code.toUpperCase() });
    persist(get());
  },
  removeCoupon: () => {
    set({ couponCode: null });
    persist(get());
  },

  toggleInstruction: (instruction) => {
    const has = get().instructions.includes(instruction);
    set({ instructions: has ? get().instructions.filter((i) => i !== instruction) : [...get().instructions, instruction] });
    persist(get());
  },

  setTip: (amount) => {
    set({ tip: Math.max(0, amount) });
    persist(get());
  },

  clear: () => {
    set({ restaurantId: null, restaurantName: null, items: [], couponCode: null, instructions: [], tip: 0 });
    void AsyncStorage.removeItem(STORAGE_KEY);
  },

  // A cart must survive the app being backgrounded or restarted; losing it on
  // reload is the fastest way to lose an order.
  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as PersistedCart;
      set({
        restaurantId: saved.restaurantId ?? null,
        restaurantName: saved.restaurantName ?? null,
        items: saved.items ?? [],
        couponCode: saved.couponCode ?? null,
        instructions: saved.instructions ?? [],
        tip: saved.tip ?? 0,
      });
    } catch {
      // A corrupt cart is discarded rather than blocking app start.
    }
  },
}));

// Derived values live in hooks rather than as store methods: a selector like
// `useCartStore((s) => s.bill())` would build a fresh object on every render,
// so zustand's reference check never settles and the component loops forever.
export function useCartItemCount(): number {
  const items = useCartStore((s) => s.items);
  return useMemo(() => items.reduce((sum, i) => sum + i.quantity, 0), [items]);
}

export function useCartBill(): BillBreakdown {
  const items = useCartStore((s) => s.items);
  const couponCode = useCartStore((s) => s.couponCode);
  const tip = useCartStore((s) => s.tip);
  const coupons = useCatalogStore((s) => s.coupons);
  return useMemo(() => {
    const coupon = couponCode ? coupons.find((c) => c.code.toLowerCase() === couponCode.toLowerCase()) ?? null : null;
    return calculateBill(items, coupon, tip);
  }, [items, couponCode, tip, coupons]);
}
