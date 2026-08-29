import assert from "node:assert/strict";
import test from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";

test("legacy portal cannot let a partner claim a food order they were not offered", async (t) => {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = "goocart-portal-claim-test";
  process.env.AWS_LAMBDA_FUNCTION_NAME = "test";

  const [{ default: app }, { connectDb, disconnectDb }, { Order, Restaurant, User }, { hashPassword }] = await Promise.all([
    import(`../dist/index.js?test=${Date.now()}`),
    import("../dist/lib/db.js"),
    import("../dist/models.js"),
    import("../dist/lib/auth.js"),
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

  const [customer, partner] = await Promise.all([
    User.create({
      email: "customer@portal-claim.test",
      name: "Portal Customer",
      role: "CUSTOMER",
      status: "ACTIVE",
      passwordHash: await hashPassword("PortalPass123!"),
    }),
    User.create({
      email: "partner@portal-claim.test",
      name: "Portal Partner",
      role: "DELIVERY_PARTNER",
      status: "ACTIVE",
      partnerApprovalStatus: "APPROVED",
      partnerOnline: true,
      partnerBusy: false,
      passwordHash: await hashPassword("PortalPass123!"),
    }),
  ]);
  const restaurant = await Restaurant.create({
    slug: "portal-claim-kitchen",
    name: "Portal Claim Kitchen",
    area: "Test Area",
    isOpen: true,
    latitude: 17.4368,
    longitude: 81.2668,
  });
  const order = await Order.create({
    orderNumber: "GOO-FD-2099-900001",
    customerId: customer._id,
    customerName: customer.name,
    restaurantId: restaurant._id,
    restaurantName: restaurant.name,
    restaurantArea: restaurant.area,
    status: "READY_FOR_PICKUP",
    deliveryOfferStatus: "NONE",
    deliveryOfferedPartnerIds: [],
    paymentMethod: "COD",
    paymentStatus: "NOT_APPLICABLE",
    bill: { itemTotal: 100, restaurantDiscount: 0, deliveryFee: 30, platformFee: 0, taxes: 5, tip: 0, total: 135 },
    deliveryAddress: { label: "Home", line1: "1 Test Street", city: "Test City" },
    deliveryOtp: "1111",
    pickupOtp: "2222",
    estimatedDeliveryMinutes: 30,
    items: [{ foodItemId: restaurant._id, name: "Test Item", veg: true, quantity: 1, unitPrice: 100, lineTotal: 100 }],
  });

  const login = await request("/api/v1/auth/token", {
    method: "POST",
    body: { mode: "login", email: partner.email, password: "PortalPass123!" },
  });
  assert.equal(login.status, 200, JSON.stringify(login.json));

  const claim = await request("/api/goocart", {
    token: login.json.data.token,
    method: "POST",
    body: { action: "order.transition", id: String(order._id), to: "DELIVERY_PARTNER_ASSIGNED" },
  });
  assert.equal(claim.status, 409, JSON.stringify(claim.json));
  assert.match(claim.json.error.code, /OFFER_EXPIRED|ORDER_ALREADY_ASSIGNED|PARTNER_NOT_ELIGIBLE/);

  const unchanged = await Order.findById(order._id).lean();
  assert.equal(unchanged.status, "READY_FOR_PICKUP");
  assert.equal(unchanged.partnerId, null);
});
