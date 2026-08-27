import { calculateBill, CouponRule, PricedLine } from "./pricing";

export const ORDER_STATUSES = [
  "PLACED",
  "VENDOR_ACCEPTED",
  "PREPARING",
  "READY_FOR_PICKUP",
  "DELIVERY_PARTNER_ASSIGNED",
  "PICKED_UP",
  "ON_THE_WAY",
  "ARRIVED",
  "DELIVERED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number] | "VENDOR_REJECTED" | "CANCELLED_BY_CUSTOMER" | "CANCELLED_BY_ADMIN";

// Who may move an order from which status to which. Anything absent here is
// rejected — there is no path from PLACED straight to DELIVERED.
const TRANSITIONS: Record<string, Partial<Record<OrderStatus, OrderStatus[]>>> = {
  vendor: {
    PLACED: ["VENDOR_ACCEPTED", "VENDOR_REJECTED"],
    VENDOR_ACCEPTED: ["PREPARING"],
    PREPARING: ["READY_FOR_PICKUP"],
  },
  partner: {
    READY_FOR_PICKUP: ["DELIVERY_PARTNER_ASSIGNED"],
    DELIVERY_PARTNER_ASSIGNED: ["PICKED_UP"],
    PICKED_UP: ["ON_THE_WAY"],
    ON_THE_WAY: ["ARRIVED"],
    ARRIVED: ["DELIVERED"],
  },
  customer: {
    PLACED: ["CANCELLED_BY_CUSTOMER"],
    VENDOR_ACCEPTED: ["CANCELLED_BY_CUSTOMER"],
  },
  admin: {
    PLACED: ["CANCELLED_BY_ADMIN", "VENDOR_ACCEPTED"],
    VENDOR_ACCEPTED: ["CANCELLED_BY_ADMIN", "PREPARING"],
    PREPARING: ["CANCELLED_BY_ADMIN", "READY_FOR_PICKUP"],
    READY_FOR_PICKUP: ["CANCELLED_BY_ADMIN"],
    DELIVERY_PARTNER_ASSIGNED: ["CANCELLED_BY_ADMIN"],
    PICKED_UP: ["CANCELLED_BY_ADMIN"],
    ON_THE_WAY: ["CANCELLED_BY_ADMIN"],
    ARRIVED: ["CANCELLED_BY_ADMIN", "DELIVERED"],
  },
};

export function canTransition(group: string, from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[group]?.[from]?.includes(to) ?? false;
}

export function allowedTransitions(group: string, from: OrderStatus): OrderStatus[] {
  return TRANSITIONS[group]?.[from] ?? [];
}

export type RequestedLine = {
  foodItemId: string;
  quantity: number;
  variantId?: string | null;
  addonIds?: string[];
};

export type OrderItemRow = {
  id: string;
  order_id: string;
  food_item_id: string;
  name: string;
  image_url: string | null;
  veg: number;
  quantity: number;
  unit_price: number;
  line_total: number;
  variant_id: string | null;
  variant_name: string | null;
  addons: string;
};

export type ValidatedLine = PricedLine & {
  foodItemId: string;
  name: string;
  imageUrl: string | null;
  veg: boolean;
  variantId: string | null;
  variantName: string | null;
  addons: { id: string; name: string; price: number }[];
};

export class OrderValidationError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// Re-prices every line from the database. The client's prices are ignored
// entirely, so a tampered request cannot buy a ₹340 biryani for ₹1.
export async function validateAndPriceLines(db: D1Database, restaurantId: string, requested: RequestedLine[]): Promise<ValidatedLine[]> {
  if (!Array.isArray(requested) || requested.length === 0) {
    throw new OrderValidationError("EMPTY_CART", "Your cart is empty.");
  }

  const lines: ValidatedLine[] = [];

  for (const line of requested) {
    const quantity = Math.floor(Number(line.quantity));
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
      throw new OrderValidationError("INVALID_QUANTITY", "Item quantity must be between 1 and 50.");
    }

    const item = await db
      .prepare("SELECT id, restaurant_id, name, image_url, price, veg, available FROM food_items WHERE id = ?")
      .bind(line.foodItemId)
      .first<{ id: string; restaurant_id: string; name: string; image_url: string | null; price: number; veg: number; available: number }>();

    if (!item) throw new OrderValidationError("ITEM_NOT_FOUND", "An item in your cart no longer exists.");
    if (item.restaurant_id !== restaurantId) {
      throw new OrderValidationError("MULTI_VENDOR_CART", "All items must come from the same restaurant.");
    }
    if (!item.available) throw new OrderValidationError("ITEM_UNAVAILABLE", `${item.name} is currently unavailable.`);

    let basePrice = item.price;
    let variantId: string | null = null;
    let variantName: string | null = null;

    if (line.variantId) {
      const variant = await db
        .prepare("SELECT id, name, price FROM food_item_variants WHERE id = ? AND food_item_id = ?")
        .bind(line.variantId, item.id)
        .first<{ id: string; name: string; price: number }>();
      if (!variant) throw new OrderValidationError("VARIANT_NOT_FOUND", `That option for ${item.name} is no longer available.`);
      basePrice = variant.price;
      variantId = variant.id;
      variantName = variant.name;
    }

    const addons: { id: string; name: string; price: number }[] = [];
    for (const addonId of line.addonIds ?? []) {
      const addon = await db
        .prepare(
          `SELECT a.id, a.name, a.price FROM food_item_addons a
           JOIN food_item_addon_groups g ON g.id = a.group_id
           WHERE a.id = ? AND g.food_item_id = ?`,
        )
        .bind(addonId, item.id)
        .first<{ id: string; name: string; price: number }>();
      if (!addon) throw new OrderValidationError("ADDON_NOT_FOUND", `An extra on ${item.name} is no longer available.`);
      addons.push(addon);
    }

    // Required add-on groups must have a selection.
    const requiredGroups = (
      await db.prepare("SELECT id, name FROM food_item_addon_groups WHERE food_item_id = ? AND required = 1").bind(item.id).all<{ id: string; name: string }>()
    ).results;
    for (const group of requiredGroups) {
      const groupOptions = (
        await db.prepare("SELECT id FROM food_item_addons WHERE group_id = ?").bind(group.id).all<{ id: string }>()
      ).results.map((o) => o.id);
      if (!addons.some((a) => groupOptions.includes(a.id))) {
        throw new OrderValidationError("MISSING_REQUIRED_OPTION", `Please choose ${group.name} for ${item.name}.`);
      }
    }

    const unitPrice = basePrice + addons.reduce((sum, a) => sum + a.price, 0);
    lines.push({
      foodItemId: item.id,
      name: item.name,
      imageUrl: item.image_url,
      veg: Boolean(item.veg),
      quantity,
      unitPrice,
      lineTotal: Math.round(unitPrice * quantity),
      variantId,
      variantName,
      addons,
    });
  }

  return lines;
}

export async function resolveCoupon(db: D1Database, code: string | null | undefined): Promise<CouponRule | null> {
  if (!code) return null;
  const row = await db
    .prepare("SELECT code, type, value, min_order, max_discount FROM coupons WHERE code = ? AND active = 1")
    .bind(code.toUpperCase())
    .first<{ code: string; type: string; value: number; min_order: number; max_discount: number | null }>();
  if (!row) throw new OrderValidationError("INVALID_COUPON", "That coupon is not valid.");
  return { code: row.code, type: row.type as CouponRule["type"], value: row.value, minOrder: row.min_order, maxDiscount: row.max_discount };
}

export function priceOrder(lines: ValidatedLine[], coupon: CouponRule | null, tip: number) {
  return calculateBill(lines, coupon, tip);
}

export function generateOrderNumber(sequence: number): string {
  return `GOO-FD-${new Date().getFullYear()}-${String(sequence).padStart(6, "0")}`;
}

export function generateOtp(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}
