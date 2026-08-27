import { env } from "cloudflare:workers";
import { getSessionUser } from "../../../../db/auth";
import { api } from "../../../../db/http";
import { runMigrations } from "../../../../db/migrations";
import {
  generateOrderNumber,
  generateOtp,
  OrderValidationError,
  priceOrder,
  resolveCoupon,
  validateAndPriceLines,
} from "../../../../db/orders";
import { loadOrderBundle, ownedRestaurantIds, scopedOrderQuery, toOrderDTO, type OrderRow } from "../../../../db/orderQueries";

export async function GET(request: Request) {
  try {
    await runMigrations(env.DB);
    const viewer = await getSessionUser(env.DB);
    if (!viewer) return api({ code: "AUTH_REQUIRED", message: "Sign in to view orders" }, 401);
    if (viewer.status !== "ACTIVE") return api({ code: "ACCOUNT_DISABLED", message: "This account is not active" }, 403);

    const limit = Math.min(100, Math.max(1, Number(new URL(request.url).searchParams.get("limit") ?? 50)));
    const ownedIds = await ownedRestaurantIds(env.DB, viewer);
    const rows = (await scopedOrderQuery(env.DB, viewer, limit, ownedIds).all<OrderRow>()).results;

    const orders = await Promise.all(
      rows.map(async (row) => {
        const { items, history } = await loadOrderBundle(env.DB, row.id);
        return toOrderDTO(row, items, history, viewer);
      }),
    );
    return api({ orders });
  } catch (error) {
    return api({ code: "ORDERS_UNAVAILABLE", message: error instanceof Error ? error.message : "Unable to load orders" }, 500);
  }
}

export async function POST(request: Request) {
  try {
    await runMigrations(env.DB);
    const viewer = await getSessionUser(env.DB);
    if (!viewer) return api({ code: "AUTH_REQUIRED", message: "Sign in to place an order" }, 401);
    if (viewer.status !== "ACTIVE") return api({ code: "ACCOUNT_DISABLED", message: "This account is not active" }, 403);
    if (viewer.role !== "CUSTOMER") return api({ code: "FORBIDDEN", message: "Only customers can place orders" }, 403);

    const body = (await request.json()) as Record<string, unknown>;
    const restaurantId = String(body.restaurantId ?? "");
    const paymentMethod = String(body.paymentMethod ?? "");
    const validMethods = ["UPI", "GPAY", "PHONEPE", "PAYTM", "CARD", "NETBANKING", "WALLET", "COD"];
    if (!validMethods.includes(paymentMethod)) return api({ code: "INVALID_PAYMENT_METHOD", message: "Choose a valid payment method" }, 400);

    const restaurant = await env.DB
      .prepare("SELECT id, name, area, latitude, longitude, is_open, delivery_time_max FROM restaurants WHERE id = ?")
      .bind(restaurantId)
      .first<{ id: string; name: string; area: string; latitude: number; longitude: number; is_open: number; delivery_time_max: number }>();
    if (!restaurant) return api({ code: "RESTAURANT_NOT_FOUND", message: "Restaurant not found" }, 404);
    if (!restaurant.is_open) return api({ code: "STORE_CLOSED", message: `${restaurant.name} is not accepting orders right now.` }, 409);

    const address = body.deliveryAddress as Record<string, unknown> | undefined;
    if (!address || typeof address !== "object" || !address.line1 || !address.city) {
      return api({ code: "INVALID_ADDRESS", message: "A delivery address is required" }, 400);
    }

    // Re-price from the database; the client's totals are never trusted.
    const lines = await validateAndPriceLines(env.DB, restaurantId, (body.items ?? []) as never);
    const coupon = await resolveCoupon(env.DB, body.couponCode as string | undefined);
    const bill = priceOrder(lines, coupon, Number(body.tip ?? 0));

    const countRow = await env.DB.prepare("SELECT COUNT(*) AS count FROM food_orders").first<{ count: number }>();
    const orderId = crypto.randomUUID();
    const now = new Date().toISOString();
    const instructions = Array.isArray(body.instructions) ? (body.instructions as string[]).slice(0, 10) : [];

    const statements = [
      env.DB
        .prepare(
          `INSERT INTO food_orders (
            id, order_number, customer_id, customer_name, restaurant_id, restaurant_name, restaurant_area,
            restaurant_latitude, restaurant_longitude, status, payment_method, payment_status, coupon_code,
            instructions, item_total, restaurant_discount, coupon_discount, delivery_fee, platform_fee, taxes,
            tip, total, delivery_address, delivery_otp, estimated_delivery_minutes, created_at, updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,'PLACED',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          orderId,
          generateOrderNumber((countRow?.count ?? 0) + 1),
          viewer.id,
          viewer.name,
          restaurant.id,
          restaurant.name,
          restaurant.area,
          restaurant.latitude,
          restaurant.longitude,
          paymentMethod,
          paymentMethod === "COD" ? "NOT_APPLICABLE" : "PAID",
          coupon?.code ?? null,
          JSON.stringify(instructions),
          bill.itemTotal,
          bill.restaurantDiscount,
          bill.couponDiscount,
          bill.deliveryFee,
          bill.platformFee,
          bill.taxes,
          bill.tip,
          bill.total,
          JSON.stringify(address),
          generateOtp(),
          restaurant.delivery_time_max,
          now,
          now,
        ),
      ...lines.map((line) =>
        env.DB
          .prepare(
            `INSERT INTO food_order_items (id, order_id, food_item_id, name, image_url, veg, quantity, unit_price, line_total, variant_id, variant_name, addons)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            crypto.randomUUID(),
            orderId,
            line.foodItemId,
            line.name,
            line.imageUrl,
            line.veg ? 1 : 0,
            line.quantity,
            line.unitPrice,
            line.lineTotal,
            line.variantId,
            line.variantName,
            JSON.stringify(line.addons),
          ),
      ),
      env.DB
        .prepare("INSERT INTO food_order_status_history (id, order_id, status, actor_id, actor_role, created_at) VALUES (?,?,?,?,?,?)")
        .bind(crypto.randomUUID(), orderId, "PLACED", viewer.id, viewer.role, now),
    ];

    await env.DB.batch(statements);

    const row = await env.DB.prepare("SELECT * FROM food_orders WHERE id = ?").bind(orderId).first<OrderRow>();
    const { items, history } = await loadOrderBundle(env.DB, orderId);
    return api({ order: toOrderDTO(row!, items, history, viewer) }, 200, "Order placed");
  } catch (error) {
    if (error instanceof OrderValidationError) return api({ code: error.code, message: error.message }, 409);
    return api({ code: "ORDER_CREATE_FAILED", message: error instanceof Error ? error.message : "Could not place order" }, 500);
  }
}
