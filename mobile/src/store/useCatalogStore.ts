import { useMemo } from "react";
import { create } from "zustand";
import { fetchCoupons } from "@/services/CouponService";
import { Coupon } from "@/types";

type CatalogState = {
  coupons: Coupon[];
  loaded: boolean;
  load: () => Promise<void>;
};

// Coupons are small and change rarely, so they're fetched once and cached for
// the session. Restaurants and menus are fetched per-screen so vendor edits
// (price, availability) are always current.
export const useCatalogStore = create<CatalogState>((set, get) => ({
  coupons: [],
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    try {
      set({ coupons: await fetchCoupons(), loaded: true });
    } catch {
      set({ coupons: [], loaded: true });
    }
  },
}));

export function useCoupon(code: string | null): Coupon | null {
  const coupons = useCatalogStore((s) => s.coupons);
  return useMemo(() => (code ? coupons.find((c) => c.code.toLowerCase() === code.toLowerCase()) ?? null : null), [coupons, code]);
}
