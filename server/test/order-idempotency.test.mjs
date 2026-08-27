import assert from "node:assert/strict";
import test from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";

// Spec section 48: tapping "Place Order" twice (or a client retry after a
// dropped response) must create exactly ONE order, not two.
test("placing an order twice with the same idempotency key creates only one order", async (t) => {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = "goocart-idempotency-test";
  process.env.AWS_LAMBDA_FUNCTION_NAME = "test";

  const [{ default: app }, { connectDb, disconnectDb }, { Restaurant, Order }] = await Promise.all([
    import(`../dist/index.js?test=${Date.now()}`),
    import("../dist/lib/db.js"),
    import("../dist/models.js"),
  ]);
  await connectDb();

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await disconnectDb();
    await mongo.stop();
  });

  async function request(path, { token, method = "GET", body } = {}) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, json: await response.json() };
  }

  const signup = await request("/api/v1/auth/token", { method: "POST", body: { mode: "signup", email: "idem@flow.test", name: "Idem Customer", password: "IdemPass#2026" } });
  const customer = signup.json.data;

  const restaurant = await Restaurant.create({
    slug: "idem-kitchen",
    name: "Idem Kitchen",
    area: "Test Area",
    isOpen: true,
    latitude: 17.4362,
    longitude: 81.2661,
    categories: [{ key: "mains", name: "Mains", sortOrder: 1 }],
  });

  // No vendor account needed to create a food item directly for this test.
  const { FoodItem } = await import("../dist/models.js");
  const item = await FoodItem.create({ slug: "idem-meal", restaurantId: restaurant._id, categoryKey: "mains", name: "Idem Meal", price: 150, veg: true, available: true });

  const orderBody = {
    restaurantId: String(restaurant._id),
    paymentMethod: "COD",
    deliveryAddress: { label: "Home", line1: "1 Idem Street", city: "Idem City", pincode: "500001" },
    items: [{ foodItemId: String(item._id), quantity: 1, addonIds: [] }],
    idempotencyKey: "checkout-attempt-1",
  };

  // Fire it twice concurrently, simulating a double-tap.
  const [first, second] = await Promise.all([
    request("/api/v1/orders", { token: customer.token, method: "POST", body: orderBody }),
    request("/api/v1/orders", { token: customer.token, method: "POST", body: orderBody }),
  ]);

  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(second.status, 200, JSON.stringify(second.json));
  assert.equal(first.json.data.order.id, second.json.data.order.id, "both responses should reference the same order");

  const count = await Order.countDocuments({ customerId: customer.user.id });
  assert.equal(count, 1, "exactly one order should exist in the database");

  // A genuinely new checkout (different key) must still create a new order.
  const third = await request("/api/v1/orders", { token: customer.token, method: "POST", body: { ...orderBody, idempotencyKey: "checkout-attempt-2" } });
  assert.equal(third.status, 200, JSON.stringify(third.json));
  assert.notEqual(third.json.data.order.id, first.json.data.order.id);
  assert.equal(await Order.countDocuments({ customerId: customer.user.id }), 2);
});
