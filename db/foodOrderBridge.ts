import { Actor, canAdmin, canPartner, canVendor } from "./auth";
import { canTransition, OrderStatus } from "./orders";
import { ownedRestaurantIds, type OrderRow as FoodOrderRow } from "./orderQueries";

// The mobile app writes food orders to `food_orders` (server-priced, with a
// delivery OTP and a status-history trail). The web vendor/partner/admin
// portals render the older flat `orders` shape. This module projects
// `food_orders` into that shape so one queue shows both, without forking the
// state machine — transitions still go through db/orders.ts.

export type LegacyShapedOrder = {
  id: string;
  reference: string;
  service: string;
  vendor: string;
  vendor_id: string;
  customer: string;
  customer_id: string;
  partner: string | null;
  partner_id: string | null;
  status: string;
  total: number;
  details: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  source: "food_orders";
};

type ItemRow = { name: string; quantity: number; variant_name: string | null };

function projectRow(row: FoodOrderRow, items: ItemRow[], viewer: Actor): LegacyShapedOrder {
  const address = safeParse<Record<string, unknown>>(row.delivery_address, {});
  // Only the customer and the assigned partner may see the delivery OTP; the
  // UI reads it from details.verificationCode.
  const maySeeOtp = viewer.id === row.customer_id || (row.partner_id !== null && viewer.id === row.partner_id);

  return {
    id: row.id,
    reference: row.order_number,
    service: "Food",
    vendor: row.restaurant_name,
    vendor_id: row.restaurant_id,
    customer: row.customer_name,
    customer_id: row.customer_id,
    partner: row.partner_name,
    partner_id: row.partner_id,
    status: row.status,
    total: row.total,
    details: {
      items: items.map((i) => ({ name: i.variant_name ? `${i.name} (${i.variant_name})` : i.name, qty: i.quantity })),
      address: [address.line1, address.city].filter(Boolean).join(", ") || "Customer address",
      ...(maySeeOtp ? { verificationCode: row.delivery_otp } : {}),
    },
    created_at: row.created_at,
    updated_at: row.updated_at,
    source: "food_orders",
  };
}

function safeParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function listFoodOrdersForActor(db: D1Database, viewer: Actor): Promise<LegacyShapedOrder[]> {
  let rows: FoodOrderRow[];

  if (canAdmin(viewer)) {
    rows = (await db.prepare("SELECT * FROM food_orders ORDER BY created_at DESC LIMIT 200").all<FoodOrderRow>()).results;
  } else if (canVendor(viewer)) {
    const owned = await ownedRestaurantIds(db, viewer);
    if (owned.length === 0) return [];
    const placeholders = owned.map(() => "?").join(",");
    rows = (
      await db
        .prepare(`SELECT * FROM food_orders WHERE restaurant_id IN (${placeholders}) ORDER BY created_at DESC LIMIT 200`)
        .bind(...owned)
        .all<FoodOrderRow>()
    ).results;
  } else if (canPartner(viewer)) {
    rows = (
      await db
        .prepare(
          `SELECT * FROM food_orders
           WHERE partner_id = ? OR (partner_id IS NULL AND status = 'READY_FOR_PICKUP')
           ORDER BY created_at DESC LIMIT 200`,
        )
        .bind(viewer.id)
        .all<FoodOrderRow>()
    ).results;
  } else {
    rows = (
      await db.prepare("SELECT * FROM food_orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 200").bind(viewer.id).all<FoodOrderRow>()
    ).results;
  }

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");
  const items = (
    await db
      .prepare(`SELECT order_id, name, quantity, variant_name FROM food_order_items WHERE order_id IN (${placeholders})`)
      .bind(...ids)
      .all<ItemRow & { order_id: string }>()
  ).results;

  const byOrder = new Map<string, ItemRow[]>();
  for (const item of items) {
    const list = byOrder.get(item.order_id) ?? [];
    list.push(item);
    byOrder.set(item.order_id, list);
  }

  return rows.map((row) => projectRow(row, byOrder.get(row.id) ?? [], viewer));
}

export type BridgeTransitionResult =
  | { ok: true }
  | { ok: false; status: number; code: string; message: string };

/** Returns null when the id is not a food order, so the caller falls through. */
export async function transitionFoodOrder(
  db: D1Database,
  viewer: Actor,
  orderId: string,
  to: string,
  code: string,
): Promise<BridgeTransitionResult | null> {
  const row = await db.prepare("SELECT * FROM food_orders WHERE id = ?").bind(orderId).first<FoodOrderRow>();
  if (!row) return null;

  const owned = canVendor(viewer) ? await ownedRestaurantIds(db, viewer) : [];
  const group =
    viewer.id === row.customer_id
      ? "customer"
      : canVendor(viewer) && owned.includes(row.restaurant_id)
        ? "vendor"
        : canPartner(viewer) && (row.partner_id === viewer.id || row.partner_id === null)
          ? "partner"
          : canAdmin(viewer)
            ? "admin"
            : null;

  if (!group) return { ok: false, status: 403, code: "FORBIDDEN", message: "This order is outside your scope" };

  const from = row.status as OrderStatus;
  if (!canTransition(group, from, to as OrderStatus)) {
    return { ok: false, status: 409, code: "INVALID_TRANSITION", message: `${from} cannot move to ${to}` };
  }

  const claiming = group === "partner" && to === "DELIVERY_PARTNER_ASSIGNED";
  if (claiming) {
    const online = await db.prepare("SELECT value FROM app_settings WHERE key = ?").bind(`partner_online:${viewer.id}`).first<{ value: string }>();
    if (online?.value !== "true") return { ok: false, status: 409, code: "PARTNER_OFFLINE", message: "Go online before accepting a request" };

    const active = await db
      .prepare("SELECT id FROM food_orders WHERE partner_id = ? AND status NOT IN ('DELIVERED','CANCELLED_BY_ADMIN','CANCELLED_BY_CUSTOMER','VENDOR_REJECTED') LIMIT 1")
      .bind(viewer.id)
      .first();
    if (active) return { ok: false, status: 409, code: "ACTIVE_TASK_EXISTS", message: "Complete your current task before accepting another" };
  }

  // Delivery is only confirmed by the OTP the customer holds.
  if (to === "DELIVERED" && group === "partner" && code.trim() !== row.delivery_otp) {
    return { ok: false, status: 401, code: "INVALID_CODE", message: "That verification PIN is incorrect" };
  }

  const now = new Date().toISOString();
  await db.batch([
    claiming
      ? db
          .prepare("UPDATE food_orders SET status = ?, partner_id = ?, partner_name = ?, updated_at = ? WHERE id = ? AND status = ?")
          .bind(to, viewer.id, viewer.name, now, orderId, from)
      : db.prepare("UPDATE food_orders SET status = ?, updated_at = ? WHERE id = ? AND status = ?").bind(to, now, orderId, from),
    db
      .prepare("INSERT INTO food_order_status_history (id, order_id, status, actor_id, actor_role, created_at) VALUES (?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), orderId, to, viewer.id, viewer.role, now),
    db
      .prepare("INSERT INTO audit_logs (id, actor_id, actor_role, action, entity_type, entity_id, before_json, after_json, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), viewer.id, viewer.role, "order.transition", "food_order", orderId, JSON.stringify({ status: from }), JSON.stringify({ status: to }), now),
  ]);

  return { ok: true };
}
