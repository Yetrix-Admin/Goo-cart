// Authoritative pricing. The client computes the same numbers for display, but
// only this module's output is ever persisted or charged — a client-supplied
// total is never trusted.

export const DELIVERY_FEE = 30;
export const PLATFORM_FEE = 8;
export const TAX_RATE = 0.05;
const RESTAURANT_DISCOUNT_THRESHOLD = 300;
const RESTAURANT_DISCOUNT = 50;

export type CouponRule = {
  code: string;
  type: "PERCENT" | "FLAT" | "FREE_DELIVERY";
  value: number;
  minOrder: number;
  maxDiscount: number | null;
};

export type PricedLine = { unitPrice: number; quantity: number; lineTotal: number };

export type Bill = {
  itemTotal: number;
  restaurantDiscount: number;
  couponDiscount: number;
  deliveryFee: number;
  platformFee: number;
  taxes: number;
  tip: number;
  total: number;
};

export function calculateBill(lines: PricedLine[], coupon: CouponRule | null, tip: number): Bill {
  const itemTotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const restaurantDiscount = itemTotal >= RESTAURANT_DISCOUNT_THRESHOLD ? RESTAURANT_DISCOUNT : 0;
  const afterRestaurantDiscount = itemTotal - restaurantDiscount;

  const couponApplies = coupon !== null && afterRestaurantDiscount >= coupon.minOrder;
  const freeDelivery = couponApplies && coupon!.type === "FREE_DELIVERY";

  let couponDiscount = 0;
  if (couponApplies && coupon!.type === "FLAT") {
    couponDiscount = Math.min(coupon!.value, afterRestaurantDiscount);
  } else if (couponApplies && coupon!.type === "PERCENT") {
    const raw = (afterRestaurantDiscount * coupon!.value) / 100;
    couponDiscount = Math.round(coupon!.maxDiscount ? Math.min(raw, coupon!.maxDiscount) : raw);
  }

  const deliveryFee = freeDelivery ? 0 : DELIVERY_FEE;
  const taxableBase = Math.max(0, afterRestaurantDiscount - couponDiscount);
  const taxes = Math.round(taxableBase * TAX_RATE);
  const safeTip = Number.isFinite(tip) && tip > 0 ? Math.round(tip) : 0;

  return {
    itemTotal,
    restaurantDiscount,
    couponDiscount,
    deliveryFee,
    platformFee: PLATFORM_FEE,
    taxes,
    tip: safeTip,
    total: Math.round(taxableBase + deliveryFee + PLATFORM_FEE + taxes + safeTip),
  };
}
