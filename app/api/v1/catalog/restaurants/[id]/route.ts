import { env } from "cloudflare:workers";
import { api } from "../../../../../../db/http";
import { runMigrations } from "../../../../../../db/migrations";
import { getMenu, getRestaurant } from "../../../../../../db/catalog";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await runMigrations(env.DB);
    const { id } = await context.params;
    const restaurant = await getRestaurant(env.DB, id);
    if (!restaurant) return api({ code: "RESTAURANT_NOT_FOUND", message: "Restaurant not found" }, 404);
    const menu = await getMenu(env.DB, id);
    return api({ restaurant, categories: menu.categories, items: menu.items });
  } catch (error) {
    return api({ code: "CATALOG_UNAVAILABLE", message: error instanceof Error ? error.message : "Unable to load restaurant" }, 500);
  }
}
