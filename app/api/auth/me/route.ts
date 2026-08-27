import { env } from "cloudflare:workers";
import { getSessionUser } from "../../../../db/auth";
import { api } from "../../../../db/http";
import { runMigrations } from "../../../../db/migrations";

export async function GET() {
  await runMigrations(env.DB);
  const user = await getSessionUser(env.DB);
  return api(user);
}
