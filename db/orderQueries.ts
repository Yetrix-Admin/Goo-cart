import { Actor, canAdmin, canPartner, canVendor } from "./auth";
import { OrderItemRow, OrderStatus } from "./orders";

export type OrderRow = {
  id: string;
  order_number: string;
  customer_id: string;
  customer_name: string;
  restaurant_id: string;
  restaurant_name: string;
  restaurant_area: string;
  restaurant_latitude: number;
  restaurant_longitude: number;
  status: string;
  payment_method: string;
  payment_status: string;
  coupon_code: string | null;
  instructions: string;
  item_total: number;
  restaurant_discount: number;
  coupon_discount: number;
  delivery_fee: number;
  platform_fee: number;
  taxes: number;
  tip: number;
  total: number;
  delivery_address: string;
  delivery_otp: string;
  estimated_delivery_minutes: number;
  partner_id: string | null;
  partner_name: string | null;
  created_at: string;
  updated_at: string;
};

export type OrderDTO = ReturnType<typeof toOrderDTO>;

export function toOrderDTO(row: OrderRow, items: OrderItemRow[], history: { status: string; created_at: string }[], viewer: Actor) {
  // The delivery OTP is the customer's proof of receipt — only they and the
  // assigned partner ever see it.
  const canSeeOtp = viewer.id === row.customer_id || (row.partner_id !== null && viewer.id === row.partner_id);

  return {
    id: row.id,
    orderNumber: row.order_number,
    serviceType: "FOOD" as const,
    customerId: row.customer_id,
    customerName: row.customer_name,
    restaurantId: row.restaurant_id,
    restaurantName: row.restaurant_name,
    restaurantArea: row.restaurant_area,
    restaurantLatitude: row.restaurant_latitude,
    restaurantLongitude: row.restaurant_longitude,
    status: row.status as OrderStatus,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    couponCode: row.coupon_code,
    instructions: safeParse<string[]>(row.instructions, []),
    bill: {
      itemTotal: row.item_total,
      restaurantDiscount: row.restaurant_discount,
      couponDiscount: row.coupon_discount,
      deliveryFee: row.delivery_fee,
      platformFee: row.platform_fee,
      taxes: row.taxes,
      tip: row.tip,
      total: row.total,
    },
    deliveryAddress: safeParse<Record<string, unknown>>(row.delivery_address, {}),
    deliveryOtp: canSeeOtp ? row.delivery_otp : null,
    estimatedDeliveryMinutes: row.estimated_delivery_minutes,
    deliveryPartner: row.partner_id ? { id: row.partner_id, name: row.partner_name } : null,
    items: items.map((i) => ({
      lineId: i.id,
      foodItemId: i.food_item_id,
      name: i.name,
      imageUrl: i.image_url,
      veg: Boolean(i.veg),
      quantity: i.quantity,
      unitPrice: i.unit_price,
      lineTotal: i.line_total,
      selectedVariant: i.variant_id ? { id: i.variant_id, name: i.variant_name } : null,
      selectedAddons: safeParse<{ id: string; name: string; price: number }[]>(i.addons, []),
    })),
    statusHistory: history.map((h) => ({ status: h.status as OrderStatus, at: h.created_at })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safeParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// Scopes the order list to what this role is allowed to see. Customers see
// only their own; vendors only their restaurant's; partners their assigned
// jobs plus the unassigned pool; admins everything.
export function scopedOrderQuery(db: D1Database, viewer: Actor, limit: number, ownedIds: string[] = []) {
  if (canAdmin(viewer)) {
    return db.prepare("SELECT * FROM food_orders ORDER BY created_at DESC LIMIT ?").bind(limit);
  }
  if (canVendor(viewer)) {
    if (ownedIds.length === 0) {
      return db.prepare("SELECT * FROM food_orders WHERE 1 = 0").bind();
    }
    const placeholders = ownedIds.map(() => "?").join(",");
    return db
      .prepare(`SELECT * FROM food_orders WHERE restaurant_id IN (${placeholders}) ORDER BY created_at DESC LIMIT ?`)
      .bind(...ownedIds, limit);
  }
  if (canPartner(viewer)) {
    return db
      .prepare(
        `SELECT * FROM food_orders
         WHERE partner_id = ? OR (partner_id IS NULL AND status = 'READY_FOR_PICKUP')
         ORDER BY created_at DESC LIMIT ?`,
      )
      .bind(viewer.id, limit);
  }
  return db.prepare("SELECT * FROM food_orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT ?").bind(viewer.id, limit);
}

// A vendor's reach is defined by the restaurants they own, resolved from
// restaurants.owner_user_id — never by comparing a user id to a restaurant id.
export async function ownedRestaurantIds(db: D1Database, viewer: Actor): Promise<string[]> {
  if (!canVendor(viewer)) return [];
  const rows = (await db.prepare("SELECT id FROM restaurants WHERE owner_user_id = ?").bind(viewer.id).all<{ id: string }>()).results;
  return rows.map((r) => r.id);
}

export function canViewOrder(viewer: Actor, row: OrderRow, ownedIds: string[] = []): boolean {
  if (canAdmin(viewer)) return true;
  if (viewer.id === row.customer_id) return true;
  if (canVendor(viewer) && ownedIds.includes(row.restaurant_id)) return true;
  if (canPartner(viewer)) return row.partner_id === viewer.id || (row.partner_id === null && row.status === "READY_FOR_PICKUP");
  return false;
}

export function transitionGroupFor(viewer: Actor, row: OrderRow, ownedIds: string[] = []): string | null {
  if (viewer.id === row.customer_id) return "customer";
  if (canVendor(viewer) && ownedIds.includes(row.restaurant_id)) return "vendor";
  if (canPartner(viewer) && (row.partner_id === viewer.id || row.partner_id === null)) return "partner";
  if (canAdmin(viewer)) return "admin";
  return null;
}

export async function loadOrderBundle(db: D1Database, orderId: string) {
  const [items, history] = await Promise.all([
    db.prepare("SELECT * FROM food_order_items WHERE order_id = ? ORDER BY rowid").bind(orderId).all<OrderItemRow>(),
    db.prepare("SELECT status, created_at FROM food_order_status_history WHERE order_id = ? ORDER BY created_at").bind(orderId).all<{ status: string; created_at: string }>(),
  ]);
  return { items: items.results, history: history.results };
}
