import { apiGet } from "@/services/apiClient";
import { CartLineItem, Coupon } from "@/types";

export type CouponValidationResult =
  | { ok: true; coupon: Coupon }
  | { ok: false; reason: "NOT_FOUND" | "MIN_NOT_REACHED" | "ALREADY_APPLIED" | "NOT_APPLICABLE"; message: string };

// Coupons are defined in the database and fetched at runtime. Validation still
// runs client-side for instant feedback, but the authoritative check belongs on
// the server once order creation moves to the backend.
export async function fetchCoupons(): Promise<Coupon[]> {
  const data = await apiGet<{ coupons: Coupon[] }>("/api/v1/catalog/coupons");
  return data.coupons;
}

export function eligibleCouponSubtotal(coupon: Coupon, restaurantId: string | null, items: CartLineItem[]): number {
  const restaurantTargets = coupon.targetRestaurantIds ?? [];
  if (restaurantTargets.length && (!restaurantId || !restaurantTargets.includes(restaurantId))) return 0;
  const foodTargets = new Set(coupon.targetFoodItemIds ?? []);
  const eligibleItems = foodTargets.size ? items.filter((item) => foodTargets.has(item.foodItemId)) : items;
  return eligibleItems.reduce((sum, item) => sum + item.lineTotal, 0);
}

export function validateCoupon(coupons: Coupon[], code: string, restaurantId: string | null, items: CartLineItem[], currentlyApplied?: string): CouponValidationResult {
  const coupon = coupons.find((c) => c.code.toLowerCase() === code.trim().toLowerCase());
  if (!coupon) return { ok: false, reason: "NOT_FOUND", message: "This coupon code doesn't exist." };
  if (currentlyApplied && currentlyApplied.toLowerCase() === coupon.code.toLowerCase()) {
    return { ok: false, reason: "ALREADY_APPLIED", message: "This coupon is already applied." };
  }
  const eligibleSubtotal = eligibleCouponSubtotal(coupon, restaurantId, items);
  if (eligibleSubtotal <= 0) {
    const scope = (coupon.targetFoodItemNames ?? []).length ? coupon.targetFoodItemNames.join(", ") : (coupon.targetRestaurantNames ?? []).join(", ");
    return { ok: false, reason: "NOT_APPLICABLE", message: scope ? `This offer is only for ${scope}.` : "This offer does not apply to this cart." };
  }
  if (eligibleSubtotal < coupon.minOrder) {
    return { ok: false, reason: "MIN_NOT_REACHED", message: `Add eligible items worth ₹${Math.ceil(coupon.minOrder - eligibleSubtotal)} more to use this coupon.` };
  }
  return { ok: true, coupon };
}
