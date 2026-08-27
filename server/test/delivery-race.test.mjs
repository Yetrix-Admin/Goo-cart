import assert from "node:assert/strict";
import test from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";

// Spec section 27-29 / 49: N delivery partners race to accept the same
// delivery. Exactly one must win; everyone else must get a clear
// ORDER_ALREADY_ASSIGNED response, never a generic error — and the database
// must end up with exactly one partnerId, never zero, never more than one.
test("concurrent delivery acceptance is atomic: exactly one partner wins", async (t) => {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = "goocart-race-test";
  process.env.AWS_LAMBDA_FUNCTION_NAME = "test";
  process.env.ADMIN_USER_EMAILS = "admin@race.test";
  process.env.VENDOR_USER_EMAILS = "vendor@race.test";
  process.env.DELIVERY_OFFER_TIMEOUT_SECONDS = "60";

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

  async function signup(email, name) {
    const result = await request("/api/v1/auth/token", { method: "POST", body: { mode: "signup", email, name, password: "RacePass#2026" } });
    assert.equal(result.status, 200, JSON.stringify(result.json));
    return result.json.data;
  }

  const admin = await signup("admin@race.test", "Race Admin");
  const vendor = await signup("vendor@race.test", "Race Vendor");
  const customer = await signup("customer@race.test", "Race Customer");

  const restaurant = await Restaurant.create({
    slug: "race-kitchen",
    name: "Race Kitchen",
    area: "Test Area",
    isOpen: true,
    latitude: 17.4362,
    longitude: 81.2661,
    categories: [{ key: "mains", name: "Mains", sortOrder: 1 }],
  });
  await request(`/api/v1/admin/restaurants/${restaurant._id}/owner`, { token: admin.token, method: "PATCH", body: { userId: vendor.user.id } });

  const item = await request("/api/v1/vendor/menu", {
    token: vendor.token,
    method: "POST",
    body: { name: "Race Meal", description: "Race test meal", price: 200, categoryKey: "mains", veg: true },
  });
  assert.equal(item.status, 200, JSON.stringify(item.json));

  // Three delivery partners, all online, all within range of the restaurant.
  const partners = [];
  for (let i = 0; i < 3; i += 1) {
    const partner = await signup(`partner${i}@race.test`, `Race Partner ${i}`);
    // Signup alone does not grant DELIVERY_PARTNER (no PARTNER_USER_EMAILS
    // match) — set the role directly the way an admin-created account would.
    const { User } = await import("../dist/models.js");
    await User.updateOne({ _id: partner.user.id }, { $set: { role: "DELIVERY_PARTNER" } });
    const relog = await request("/api/v1/auth/token", { method: "POST", body: { mode: "login", email: `partner${i}@race.test`, password: "RacePass#2026" } });
    assert.equal(relog.status, 200);
    const token = relog.json.data.token;

    const online = await request("/api/v1/partner/online", { token, method: "POST", body: { value: true } });
    assert.equal(online.status, 200, JSON.stringify(online.json));
    const located = await request("/api/v1/partner/location", { token, method: "POST", body: { latitude: 17.437 + i * 0.001, longitude: 81.2665, accuracy: 5 } });
    assert.equal(located.status, 200, JSON.stringify(located.json));

    partners.push({ ...partner, token });
  }

  const placed = await request("/api/v1/orders", {
    token: customer.token,
    method: "POST",
    body: {
      restaurantId: String(restaurant._id),
      paymentMethod: "COD",
      deliveryAddress: { label: "Home", line1: "1 Race Street", city: "Race City", pincode: "500001" },
      items: [{ foodItemId: item.json.data.item.id, quantity: 1, addonIds: [] }],
    },
  });
  assert.equal(placed.status, 200, JSON.stringify(placed.json));
  const orderId = placed.json.data.order.id;

  for (const to of ["VENDOR_ACCEPTED", "PREPARING", "READY_FOR_PICKUP"]) {
    const moved = await request(`/api/v1/orders/${orderId}/transition`, { token: vendor.token, method: "POST", body: { to } });
    assert.equal(moved.status, 200, `${to}: ${JSON.stringify(moved.json)}`);
  }

  // Wait for the broadcast to actually reach OFFERING with all 3 offered.
  let order;
  for (let i = 0; i < 40; i += 1) {
    const res = await request(`/api/v1/orders/${orderId}`, { token: partners[0].token });
    order = res.json.data.order;
    if (order.deliveryOfferStatus === "OFFERING") break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(order.deliveryOfferStatus, "OFFERING");

  // Fire all three "Accept" requests genuinely concurrently.
  const results = await Promise.all(
    partners.map((p) => request(`/api/v1/orders/${orderId}/transition`, { token: p.token, method: "POST", body: { to: "DELIVERY_PARTNER_ASSIGNED" } })),
  );

  const successes = results.filter((r) => r.status === 200);
  const conflicts = results.filter((r) => r.status === 409);

  assert.equal(successes.length, 1, `expected exactly 1 success, got ${successes.length}: ${JSON.stringify(results.map((r) => r.status))}`);
  assert.equal(conflicts.length, 2, `expected exactly 2 conflicts, got ${conflicts.length}`);
  for (const c of conflicts) {
    assert.equal(c.json.error.code, "ORDER_ALREADY_ASSIGNED");
    assert.match(c.json.error.message, /already been accepted by another delivery partner/i);
  }

  // The database itself must agree: exactly one partnerId, matching the
  // request that actually succeeded.
  const finalOrder = await Order.findById(orderId).lean();
  assert.ok(finalOrder.partnerId, "order should have a partnerId assigned");
  const winnerIndex = results.findIndex((r) => r.status === 200);
  assert.equal(String(finalOrder.partnerId), partners[winnerIndex].user.id);
  assert.equal(finalOrder.status, "DELIVERY_PARTNER_ASSIGNED");
  assert.equal(finalOrder.deliveryOfferStatus, "ASSIGNED");

  // The two losing partners must not have been left "busy".
  const { User } = await import("../dist/models.js");
  for (let i = 0; i < 3; i += 1) {
    if (i === winnerIndex) continue;
    const loser = await User.findById(partners[i].user.id).lean();
    assert.equal(loser.partnerBusy, false, `losing partner ${i} should not be marked busy`);
  }
  const winner = await User.findById(partners[winnerIndex].user.id).lean();
  assert.equal(winner.partnerBusy, true, "winning partner should be marked busy");
});
