import { env } from "cloudflare:workers";
import { getSessionUser } from "../../../../../db/auth";
import { api } from "../../../../../db/http";
import { runMigrations } from "../../../../../db/migrations";
import { allowedTransitions } from "../../../../../db/orders";
import { canViewOrder, loadOrderBundle, ownedRestaurantIds, toOrderDTO, transitionGroupFor, type OrderRow } from "../../../../../db/orderQueries";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await runMigrations(env.DB);
    const viewer = await getSessionUser(env.DB);
    if (!viewer) return api({ code: "AUTH_REQUIRED", message: "Sign in to view this order" }, 401);

    const { id } = await context.params;
    const row = await env.DB.prepare("SELECT * FROM food_orders WHERE id = ?").bind(id).first<OrderRow>();
    if (!row) return api({ code: "ORDER_NOT_FOUND", message: "Order not found" }, 404);
    const ownedIds = await ownedRestaurantIds(env.DB, viewer);
    if (!canViewOrder(viewer, row, ownedIds)) return api({ code: "FORBIDDEN", message: "This order is outside your scope" }, 403);

    const { items, history } = await loadOrderBundle(env.DB, id);
    const group = transitionGroupFor(viewer, row, ownedIds);
    return api({
      order: toOrderDTO(row, items, history, viewer),
      availableTransitions: group ? allowedTransitions(group, row.status as never) : [],
    });
  } catch (error) {
    return api({ code: "ORDER_UNAVAILABLE", message: error instanceof Error ? error.message : "Unable to load order" }, 500);
  }
}
