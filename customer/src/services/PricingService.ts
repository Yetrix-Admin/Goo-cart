import { BillBreakdown, CartLineItem, Coupon } from "@/types";

const DELIVERY_FEE = 30;
const PLATFORM_FEE = 8;
const TAX_RATE = 0.05;
const RESTAURANT_DISCOUNT_THRESHOLD = 300;
const RESTAURANT_DISCOUNT = 50;

export function lineItemTotal(unitPrice: number, quantity: number): number {
  return Math.round(unitPrice * quantity);
}

export function itemTotal(items: CartLineItem[]): number {
  return items.reduce((sum, i) => sum + i.lineTotal, 0);
}

export function couponDiscount(coupon: Coupon | null, subtotalAfterRestaurantDiscount: number): number {
  if (!coupon) return 0;
  if (subtotalAfterRestaurantDiscount < coupon.minOrder) return 0;
  if (coupon.type === "FREE_DELIVERY") return DELIVERY_FEE;
  if (coupon.type === "FLAT") return Math.min(coupon.value, subtotalAfterRestaurantDiscount);
  const pct = (subtotalAfterRestaurantDiscount * coupon.value) / 100;
  return Math.round(coupon.maxDiscount ? Math.min(pct, coupon.maxDiscount) : pct);
}

export function calculateBill(items: CartLineItem[], coupon: Coupon | null, tip: number): BillBreakdown {
  const subtotal = itemTotal(items);
  const restaurantDiscount = subtotal >= RESTAURANT_DISCOUNT_THRESHOLD ? RESTAURANT_DISCOUNT : 0;
  const afterRestaurantDiscount = subtotal - restaurantDiscount;
  const coup = couponDiscount(coupon, afterRestaurantDiscount);
  const isFreeDelivery = coupon?.type === "FREE_DELIVERY" && afterRestaurantDiscount >= coupon.minOrder;
  const deliveryFee = isFreeDelivery ? 0 : DELIVERY_FEE;
  const taxableBase = afterRestaurantDiscount - (coupon?.type !== "FREE_DELIVERY" ? coup : 0);
  const taxes = Math.round(Math.max(0, taxableBase) * TAX_RATE);
  const total = Math.max(0, afterRestaurantDiscount - (coupon?.type !== "FREE_DELIVERY" ? coup : 0)) + deliveryFee + PLATFORM_FEE + taxes + tip;

  return {
    itemTotal: subtotal,
    restaurantDiscount,
    couponDiscount: coupon?.type === "FREE_DELIVERY" ? 0 : coup,
    deliveryFee,
    platformFee: PLATFORM_FEE,
    taxes,
    tip,
    total: Math.round(total),
  };
}
