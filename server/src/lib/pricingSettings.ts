import { PricingSettings as PricingSettingsModel } from "../models.js";
import { DEFAULT_PRICING_SETTINGS, type PricingSettings } from "./pricing.js";

const SETTINGS_ID = "food";

export async function getPricingSettings(): Promise<PricingSettings> {
  const doc: any = await PricingSettingsModel.findById(SETTINGS_ID).lean();
  if (!doc) return DEFAULT_PRICING_SETTINGS;
  return {
    deliveryFee: doc.deliveryFee,
    platformFee: doc.platformFee,
    taxRatePercent: doc.taxRatePercent,
    restaurantDiscountThreshold: doc.restaurantDiscountThreshold,
    restaurantDiscountAmount: doc.restaurantDiscountAmount,
  };
}

export async function updatePricingSettings(patch: Partial<PricingSettings>): Promise<PricingSettings> {
  const current = await getPricingSettings();
  const next = { ...current, ...patch };
  await PricingSettingsModel.findByIdAndUpdate(SETTINGS_ID, { $set: next }, { upsert: true });
  return next;
}
