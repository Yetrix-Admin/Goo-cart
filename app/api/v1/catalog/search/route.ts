import { env } from "cloudflare:workers";
import { api } from "../../../../../db/http";
import { runMigrations } from "../../../../../db/migrations";
import { searchCatalog } from "../../../../../db/catalog";

export async function GET(request: Request) {
  try {
    await runMigrations(env.DB);
    const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (!query) return api({ restaurants: [], items: [] });
    return api(await searchCatalog(env.DB, query));
  } catch (error) {
    return api({ code: "SEARCH_UNAVAILABLE", message: error instanceof Error ? error.message : "Search failed" }, 500);
  }
}
