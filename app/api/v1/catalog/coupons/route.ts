import { env } from "cloudflare:workers";
import { api } from "../../../../../db/http";
import { runMigrations } from "../../../../../db/migrations";

type CouponRow = { code: string; title: string; description: string; type: string; value: number; min_order: number; max_discount: number | null };

export async function GET() {
  try {
    await runMigrations(env.DB);
    const rows = (await env.DB.prepare("SELECT code, title, description, type, value, min_order, max_discount FROM coupons WHERE active = 1").all<CouponRow>()).results;
    return api({
      coupons: rows.map((c) => ({
        code: c.code,
        title: c.title,
        description: c.description,
        type: c.type,
        value: c.value,
        minOrder: c.min_order,
        maxDiscount: c.max_discount,
      })),
    });
  } catch (error) {
    return api({ code: "COUPONS_UNAVAILABLE", message: error instanceof Error ? error.message : "Unable to load coupons" }, 500);
  }
}
