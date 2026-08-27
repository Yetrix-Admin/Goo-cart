import { env } from "cloudflare:workers";
import { api } from "../../../../../db/http";
import { runMigrations } from "../../../../../db/migrations";
import { listRestaurants } from "../../../../../db/catalog";

// Public catalog: browsing restaurants requires no session. Ordering does.
export async function GET(request: Request) {
  try {
    await runMigrations(env.DB);
    const url = new URL(request.url);
    const restaurants = await listRestaurants(env.DB, {
      search: url.searchParams.get("q") ?? undefined,
      minRating: url.searchParams.get("minRating") ? Number(url.searchParams.get("minRating")) : undefined,
      maxDeliveryMinutes: url.searchParams.get("maxDeliveryMinutes") ? Number(url.searchParams.get("maxDeliveryMinutes")) : undefined,
      vegOnly: url.searchParams.get("vegOnly") === "true",
      withOffers: url.searchParams.get("withOffers") === "true",
      cuisine: url.searchParams.get("cuisine") ?? undefined,
    });
    return api({ restaurants });
  } catch (error) {
    return api({ code: "CATALOG_UNAVAILABLE", message: error instanceof Error ? error.message : "Unable to load restaurants" }, 500);
  }
}
