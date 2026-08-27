import assert from "node:assert/strict";
import test from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";

test("customer -> vendor -> delivery partner flow is role-scoped and complete", async (t) => {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = "goocart-flow-test";
  process.env.AWS_LAMBDA_FUNCTION_NAME = "test";
  process.env.ADMIN_USER_EMAILS = "admin@flow.test";
  process.env.VENDOR_USER_EMAILS = "vendor@flow.test";
  process.env.PARTNER_USER_EMAILS = "partner@flow.test";

  const [{ default: app }, { connectDb, disconnectDb }, { Restaurant }] = await Promise.all([
    import(`../dist/index.js?test=${Date.now()}`),
    import("../dist/lib/db.js"),
    import("../dist/models.js"),
  ]);
  await connectDb();

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

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
    const result = await request("/api/v1/auth/token", {
      method: "POST",
      body: { mode: "signup", email, name, password: "FlowPass#2026" },
    });
    assert.equal(result.status, 200, JSON.stringify(result.json));
    return result.json.data;
  }

  const admin = await signup("admin@flow.test", "Flow Admin");
  const vendor = await signup("vendor@flow.test", "Flow Vendor");
  const partner = await signup("partner@flow.test", "Flow Partner");
  const customer = await signup("customer@flow.test", "Flow Customer");
  assert.equal(admin.user.role, "SUPER_ADMIN");
  assert.equal(vendor.user.role, "VENDOR_OWNER");
  assert.equal(partner.user.role, "DELIVERY_PARTNER");
  assert.equal(customer.user.role, "CUSTOMER");

  const restaurant = await Restaurant.create({
    slug: "flow-kitchen",
    name: "Flow Kitchen",
    area: "Test Area",
    isOpen: true,
    categories: [{ key: "mains", name: "Mains", sortOrder: 1 }],
  });

  const assignment = await request(`/api/v1/admin/restaurants/${restaurant._id}/owner`, {
    token: admin.token,
    method: "PATCH",
    body: { userId: vendor.user.id },
  });
  assert.equal(assignment.status, 200, JSON.stringify(assignment.json));

  const createdItem = await request("/api/v1/vendor/menu", {
    token: vendor.token,
    method: "POST",
    body: { name: "Flow Meal", description: "Integration test meal", price: 180, categoryKey: "mains", veg: true },
  });
  assert.equal(createdItem.status, 200, JSON.stringify(createdItem.json));

  const forbiddenVendor = await request("/api/v1/vendor/menu", { token: customer.token });
  assert.equal(forbiddenVendor.status, 403);
  const forbiddenPartner = await request("/api/v1/partner/status", { token: vendor.token });
  assert.equal(forbiddenPartner.status, 403);
  const forbiddenAdmin = await request("/api/v1/admin/vendors", { token: partner.token });
  assert.equal(forbiddenAdmin.status, 403);

  const placed = await request("/api/v1/orders", {
    token: customer.token,
    method: "POST",
    body: {
      restaurantId: String(restaurant._id),
      paymentMethod: "COD",
      deliveryAddress: { label: "Home", line1: "1 Test Street", city: "Test City", pincode: "500001" },
      items: [{ foodItemId: createdItem.json.data.item.id, quantity: 1, addonIds: [] }],
    },
  });
  assert.equal(placed.status, 200, JSON.stringify(placed.json));
  const orderId = placed.json.data.order.id;
  const deliveryOtp = placed.json.data.order.deliveryOtp;
  assert.match(deliveryOtp, /^\d{4}$/);

  for (const to of ["VENDOR_ACCEPTED", "PREPARING", "READY_FOR_PICKUP"]) {
    const moved = await request(`/api/v1/orders/${orderId}/transition`, {
      token: vendor.token,
      method: "POST",
      body: { to },
    });
    assert.equal(moved.status, 200, `${to}: ${JSON.stringify(moved.json)}`);
  }

  const offlineClaim = await request(`/api/v1/orders/${orderId}/transition`, {
    token: partner.token,
    method: "POST",
    body: { to: "DELIVERY_PARTNER_ASSIGNED" },
  });
  assert.equal(offlineClaim.status, 409);
  assert.equal(offlineClaim.json.error.code, "PARTNER_OFFLINE");

  const online = await request("/api/v1/partner/online", { token: partner.token, method: "POST", body: { value: true } });
  assert.equal(online.status, 200);
  assert.equal(online.json.data.online, true);

  for (const to of ["DELIVERY_PARTNER_ASSIGNED", "PICKED_UP", "ON_THE_WAY", "ARRIVED"]) {
    const moved = await request(`/api/v1/orders/${orderId}/transition`, {
      token: partner.token,
      method: "POST",
      body: { to },
    });
    assert.equal(moved.status, 200, `${to}: ${JSON.stringify(moved.json)}`);
  }

  const wrongCode = await request(`/api/v1/orders/${orderId}/transition`, {
    token: partner.token,
    method: "POST",
    body: { to: "DELIVERED", code: "0000" },
  });
  assert.equal(wrongCode.status, 401);
  assert.equal(wrongCode.json.error.code, "INVALID_CODE");

  const delivered = await request(`/api/v1/orders/${orderId}/transition`, {
    token: partner.token,
    method: "POST",
    body: { to: "DELIVERED", code: deliveryOtp },
  });
  assert.equal(delivered.status, 200, JSON.stringify(delivered.json));
  assert.equal(delivered.json.data.order.status, "DELIVERED");

  const closed = await request("/api/v1/vendor/restaurant", {
    token: vendor.token,
    method: "PATCH",
    body: { isOpen: false },
  });
  assert.equal(closed.status, 200);

  const blockedOrder = await request("/api/v1/orders", {
    token: customer.token,
    method: "POST",
    body: {
      restaurantId: String(restaurant._id),
      paymentMethod: "COD",
      deliveryAddress: { line1: "1 Test Street", city: "Test City" },
      items: [{ foodItemId: createdItem.json.data.item.id, quantity: 1, addonIds: [] }],
    },
  });
  assert.equal(blockedOrder.status, 409);
  assert.equal(blockedOrder.json.error.code, "RESTAURANT_CLOSED");
});
