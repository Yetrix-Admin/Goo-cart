import { create } from "zustand";
import { apiGet } from "@/services/apiClient";

export type PricingSettings = {
  deliveryFee: number;
  platformFee: number;
  taxRatePercent: number;
  restaurantDiscountThreshold: number;
  restaurantDiscountAmount: number;
};

// Matches server/src/lib/pricing.ts's DEFAULT_PRICING_SETTINGS — used only
// until the real, admin-controlled values load, so a slow network never
// blocks rendering a bill estimate.
const FALLBACK_SETTINGS: PricingSettings = {
  deliveryFee: 30,
  platformFee: 8,
  taxRatePercent: 5,
  restaurantDiscountThreshold: 300,
  restaurantDiscountAmount: 50,
};

type PricingState = {
  settings: PricingSettings;
  loaded: boolean;
  load: () => Promise<void>;
};

// The server always re-derives the real bill from these same admin-set
// values at order time — this store only makes the on-screen estimate match
// what will actually be charged, so a customer never sees stale fees.
export const usePricingStore = create<PricingState>((set) => ({
  settings: FALLBACK_SETTINGS,
  loaded: false,

  load: async () => {
    try {
      const data = await apiGet<{ pricing: PricingSettings }>("/api/v1/catalog/pricing-settings");
      set({ settings: data.pricing, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
}));
