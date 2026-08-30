import { useMemo } from "react";
import { create } from "zustand";
import { fetchCoupons } from "@/services/CouponService";
import { fetchBanners } from "@/services/BannerService";
import { Banner, Coupon } from "@/types";

type CatalogState = {
  coupons: Coupon[];
  banners: Banner[];
  loaded: boolean;
  load: (force?: boolean) => Promise<void>;
};

// Coupons and banners are small and change rarely, so they're fetched once
// and cached for the session. Restaurants and menus are fetched per-screen so
// vendor edits (price, availability) are always current.
export const useCatalogStore = create<CatalogState>((set, get) => ({
  coupons: [],
  banners: [],
  loaded: false,
  load: async (force = false) => {
    if (get().loaded && !force) return;
    try {
      const [coupons, banners] = await Promise.all([fetchCoupons(), fetchBanners()]);
      set({ coupons, banners, loaded: true });
    } catch {
      set({ coupons: [], banners: [], loaded: true });
    }
  },
}));

export function useCoupon(code: string | null): Coupon | null {
  const coupons = useCatalogStore((s) => s.coupons);
  return useMemo(() => (code ? coupons.find((c) => c.code.toLowerCase() === code.toLowerCase()) ?? null : null), [coupons, code]);
}
