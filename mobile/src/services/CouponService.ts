import { apiGet } from "@/services/apiClient";
import { Coupon } from "@/types";

export type CouponValidationResult =
  | { ok: true; coupon: Coupon }
  | { ok: false; reason: "NOT_FOUND" | "MIN_NOT_REACHED" | "ALREADY_APPLIED"; message: string };

// Coupons are defined in the database and fetched at runtime. Validation still
// runs client-side for instant feedback, but the authoritative check belongs on
// the server once order creation moves to the backend.
export async function fetchCoupons(): Promise<Coupon[]> {
  const data = await apiGet<{ coupons: Coupon[] }>("/api/v1/catalog/coupons");
  return data.coupons;
}

export function validateCoupon(coupons: Coupon[], code: string, subtotal: number, currentlyApplied?: string): CouponValidationResult {
  const coupon = coupons.find((c) => c.code.toLowerCase() === code.trim().toLowerCase());
  if (!coupon) return { ok: false, reason: "NOT_FOUND", message: "This coupon code doesn't exist." };
  if (currentlyApplied && currentlyApplied.toLowerCase() === coupon.code.toLowerCase()) {
    return { ok: false, reason: "ALREADY_APPLIED", message: "This coupon is already applied." };
  }
  if (subtotal < coupon.minOrder) {
    return { ok: false, reason: "MIN_NOT_REACHED", message: `Add items worth ₹${Math.ceil(coupon.minOrder - subtotal)} more to use this coupon.` };
  }
  return { ok: true, coupon };
}
