import { BillBreakdown, CartLineItem, Coupon } from "@/types";
import { PricingSettings } from "@/store/usePricingStore";

export function lineItemTotal(unitPrice: number, quantity: number): number {
  return Math.round(unitPrice * quantity);
}

export function itemTotal(items: CartLineItem[]): number {
  return items.reduce((sum, i) => sum + i.lineTotal, 0);
}

export function couponDiscount(coupon: Coupon | null, subtotalAfterRestaurantDiscount: number, settings: PricingSettings): number {
  if (!coupon) return 0;
  if (subtotalAfterRestaurantDiscount < coupon.minOrder) return 0;
  if (coupon.type === "FREE_DELIVERY") return settings.deliveryFee;
  if (coupon.type === "FLAT") return Math.min(coupon.value, subtotalAfterRestaurantDiscount);
  const pct = (subtotalAfterRestaurantDiscount * coupon.value) / 100;
  return Math.round(coupon.maxDiscount ? Math.min(pct, coupon.maxDiscount) : pct);
}

/**
 * A display-only estimate — the server (see server/src/lib/pricing.ts)
 * recalculates the real bill from these same admin-controlled settings when
 * the order is actually placed, and only that result is ever charged.
 */
export function calculateBill(items: CartLineItem[], coupon: Coupon | null, tip: number, settings: PricingSettings): BillBreakdown {
  const subtotal = itemTotal(items);
  const restaurantDiscount = subtotal >= settings.restaurantDiscountThreshold ? settings.restaurantDiscountAmount : 0;
  const afterRestaurantDiscount = subtotal - restaurantDiscount;
  const coup = couponDiscount(coupon, afterRestaurantDiscount, settings);
  const isFreeDelivery = coupon?.type === "FREE_DELIVERY" && afterRestaurantDiscount >= coupon.minOrder;
  const deliveryFee = isFreeDelivery ? 0 : settings.deliveryFee;
  const taxableBase = afterRestaurantDiscount - (coupon?.type !== "FREE_DELIVERY" ? coup : 0);
  const taxes = Math.round(Math.max(0, taxableBase) * (settings.taxRatePercent / 100));
  const total = Math.max(0, afterRestaurantDiscount - (coupon?.type !== "FREE_DELIVERY" ? coup : 0)) + deliveryFee + settings.platformFee + taxes + tip;

  return {
    itemTotal: subtotal,
    restaurantDiscount,
    couponDiscount: coupon?.type === "FREE_DELIVERY" ? 0 : coup,
    deliveryFee,
    platformFee: settings.platformFee,
    taxes,
    tip,
    total: Math.round(total),
  };
}
