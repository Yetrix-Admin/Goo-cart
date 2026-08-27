import { env } from "cloudflare:workers";
import { getSessionUser } from "../../../../../../db/auth";
import { api } from "../../../../../../db/http";
import { runMigrations } from "../../../../../../db/migrations";
import { canTransition, OrderStatus } from "../../../../../../db/orders";
import { canViewOrder, loadOrderBundle, ownedRestaurantIds, toOrderDTO, transitionGroupFor, type OrderRow } from "../../../../../../db/orderQueries";

// Statuses where the acting partner claims the job.
const ASSIGNING_STATUSES = new Set<OrderStatus>(["DELIVERY_PARTNER_ASSIGNED"]);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await runMigrations(env.DB);
    const viewer = await getSessionUser(env.DB);
    if (!viewer) return api({ code: "AUTH_REQUIRED", message: "Sign in to continue" }, 401);
    if (viewer.status !== "ACTIVE") return api({ code: "ACCOUNT_DISABLED", message: "This account is not active" }, 403);

    const { id } = await context.params;
    const body = (await request.json()) as { to?: string; otp?: string };
    const to = String(body.to ?? "") as OrderStatus;

    const row = await env.DB.prepare("SELECT * FROM food_orders WHERE id = ?").bind(id).first<OrderRow>();
    if (!row) return api({ code: "ORDER_NOT_FOUND", message: "Order not found" }, 404);
    const ownedIds = await ownedRestaurantIds(env.DB, viewer);
    if (!canViewOrder(viewer, row, ownedIds)) return api({ code: "FORBIDDEN", message: "This order is outside your scope" }, 403);

    const group = transitionGroupFor(viewer, row, ownedIds);
    if (!group) return api({ code: "FORBIDDEN", message: "This order is outside your scope" }, 403);

    const from = row.status as OrderStatus;
    if (!canTransition(group, from, to)) {
      return api({ code: "INVALID_TRANSITION", message: `An order cannot move from ${from} to ${to}.` }, 409);
    }

    // Delivery is only confirmed by the OTP the customer holds.
    if (to === "DELIVERED" && group === "partner") {
      if (String(body.otp ?? "").trim() !== row.delivery_otp) {
        return api({ code: "INVALID_OTP", message: "That delivery OTP is incorrect." }, 401);
      }
    }

    const now = new Date().toISOString();
    const claims = group === "partner" && ASSIGNING_STATUSES.has(to);

    await env.DB.batch([
      claims
        ? env.DB
            .prepare("UPDATE food_orders SET status = ?, partner_id = ?, partner_name = ?, updated_at = ? WHERE id = ? AND status = ?")
            .bind(to, viewer.id, viewer.name, now, id, from)
        : env.DB.prepare("UPDATE food_orders SET status = ?, updated_at = ? WHERE id = ? AND status = ?").bind(to, now, id, from),
      env.DB
        .prepare("INSERT INTO food_order_status_history (id, order_id, status, actor_id, actor_role, created_at) VALUES (?,?,?,?,?,?)")
        .bind(crypto.randomUUID(), id, to, viewer.id, viewer.role, now),
      env.DB
        .prepare(
          "INSERT INTO audit_logs (id, actor_id, actor_role, action, entity_type, entity_id, before_json, after_json, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        )
        .bind(crypto.randomUUID(), viewer.id, viewer.role, "order.transition", "food_order", id, JSON.stringify({ status: from }), JSON.stringify({ status: to }), now),
    ]);

    const updated = await env.DB.prepare("SELECT * FROM food_orders WHERE id = ?").bind(id).first<OrderRow>();
    const { items, history } = await loadOrderBundle(env.DB, id);
    return api({ order: toOrderDTO(updated!, items, history, viewer) }, 200, "Status updated");
  } catch (error) {
    return api({ code: "TRANSITION_FAILED", message: error instanceof Error ? error.message : "Could not update this order" }, 500);
  }
}
