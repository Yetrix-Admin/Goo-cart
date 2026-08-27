import { env } from "cloudflare:workers";
import { getSessionUser, hasPermission } from "../../../../../../../db/auth";
import { api } from "../../../../../../../db/http";
import { runMigrations } from "../../../../../../../db/migrations";

// Assigns a vendor user as the owner of a restaurant. This is what makes the
// vendor portal's order scoping work — without an owner link a vendor sees
// nothing, which is the safe default.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await runMigrations(env.DB);
    const viewer = await getSessionUser(env.DB);
    if (!viewer) return api({ code: "AUTH_REQUIRED", message: "Sign in to continue" }, 401);
    if (!(await hasPermission(env.DB, viewer.role, "vendor.manage"))) {
      return api({ code: "FORBIDDEN", message: "Vendor management permission required" }, 403);
    }

    const { id } = await context.params;
    const body = (await request.json()) as { ownerUserId?: string | null };
    const ownerUserId = body.ownerUserId ?? null;

    const restaurant = await env.DB.prepare("SELECT id, owner_user_id FROM restaurants WHERE id = ?").bind(id).first<{ id: string; owner_user_id: string | null }>();
    if (!restaurant) return api({ code: "RESTAURANT_NOT_FOUND", message: "Restaurant not found" }, 404);

    if (ownerUserId) {
      const owner = await env.DB.prepare("SELECT id, role FROM users WHERE id = ?").bind(ownerUserId).first<{ id: string; role: string }>();
      if (!owner) return api({ code: "USER_NOT_FOUND", message: "That user does not exist" }, 404);
      if (!["VENDOR_OWNER", "VENDOR_MANAGER"].includes(owner.role)) {
        return api({ code: "NOT_A_VENDOR", message: "Only vendor accounts can own a restaurant" }, 409);
      }
    }

    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("UPDATE restaurants SET owner_user_id = ? WHERE id = ?").bind(ownerUserId, id),
      env.DB
        .prepare("INSERT INTO audit_logs (id, actor_id, actor_role, action, entity_type, entity_id, before_json, after_json, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(
          crypto.randomUUID(),
          viewer.id,
          viewer.role,
          "restaurant.owner_changed",
          "restaurant",
          id,
          JSON.stringify({ ownerUserId: restaurant.owner_user_id }),
          JSON.stringify({ ownerUserId }),
          now,
        ),
    ]);

    return api({ restaurantId: id, ownerUserId }, 200, "Restaurant owner updated");
  } catch (error) {
    return api({ code: "OWNER_UPDATE_FAILED", message: error instanceof Error ? error.message : "Could not update owner" }, 500);
  }
}
