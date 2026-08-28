// Authoritative pricing. The client computes the same numbers for display, but
// only this module's output is ever persisted or charged — a client-supplied
// total is never trusted. The actual fee/discount VALUES are admin-controlled
// (see PricingSettings in models.ts and admin.ts's /pricing-settings route);
// these are only the fallback defaults used before an admin ever sets one.

export const DEFAULT_PRICING_SETTINGS: PricingSettings = {
  deliveryFee: 30,
  platformFee: 8,
  taxRatePercent: 5,
  restaurantDiscountThreshold: 300,
  restaurantDiscountAmount: 50,
  vendorCommissionPercent: 18,
  deliveryPartnerPayout: 35,
};

export type PricingSettings = {
  deliveryFee: number;
  platformFee: number;
  taxRatePercent: number;
  restaurantDiscountThreshold: number;
  restaurantDiscountAmount: number;
  vendorCommissionPercent: number;
  deliveryPartnerPayout: number;
};

export type CouponRule = {
  code: string;
  type: "PERCENT" | "FLAT" | "FREE_DELIVERY";
  value: number;
  minOrder: number;
  maxDiscount: number | null;
  eligibleSubtotal?: number;
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
  vendorCommission: number;
  vendorPayable: number;
  deliveryPartnerPayout: number;
  platformNetRevenue: number;
  total: number;
};

export function calculateBill(lines: PricedLine[], coupon: CouponRule | null, tip: number, settings: PricingSettings = DEFAULT_PRICING_SETTINGS): Bill {
  const itemTotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const restaurantDiscount = itemTotal >= settings.restaurantDiscountThreshold ? settings.restaurantDiscountAmount : 0;
  const afterRestaurantDiscount = itemTotal - restaurantDiscount;

  const discountBase = coupon ? Math.min(afterRestaurantDiscount, coupon.eligibleSubtotal ?? afterRestaurantDiscount) : 0;
  const couponApplies = coupon !== null && discountBase >= coupon.minOrder;
  const freeDelivery = couponApplies && coupon!.type === "FREE_DELIVERY";

  let couponDiscount = 0;
  if (couponApplies && coupon!.type === "FLAT") {
    couponDiscount = Math.min(coupon!.value, discountBase);
  } else if (couponApplies && coupon!.type === "PERCENT") {
    const raw = (discountBase * coupon!.value) / 100;
    couponDiscount = Math.round(coupon!.maxDiscount ? Math.min(raw, coupon!.maxDiscount) : raw);
  }

  const deliveryFee = freeDelivery ? 0 : settings.deliveryFee;
  const taxableBase = Math.max(0, afterRestaurantDiscount - couponDiscount);
  const taxes = Math.round(taxableBase * (settings.taxRatePercent / 100));
  const safeTip = Number.isFinite(tip) && tip > 0 ? Math.round(tip) : 0;
  // Commission and payouts are snapshotted on the order so changing admin
  // pricing later never rewrites historical settlements.
  const vendorCommission = Math.round(taxableBase * (settings.vendorCommissionPercent / 100));
  const vendorPayable = Math.max(0, taxableBase - vendorCommission);
  const deliveryPartnerPayout = Math.round(settings.deliveryPartnerPayout);
  const platformNetRevenue = Math.round(settings.platformFee + deliveryFee + vendorCommission - deliveryPartnerPayout);

  return {
    itemTotal,
    restaurantDiscount,
    couponDiscount,
    deliveryFee,
    platformFee: settings.platformFee,
    taxes,
    tip: safeTip,
    vendorCommission,
    vendorPayable,
    deliveryPartnerPayout,
    platformNetRevenue,
    total: Math.round(taxableBase + deliveryFee + settings.platformFee + taxes + safeTip),
  };
}
