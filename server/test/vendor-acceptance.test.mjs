import assert from "node:assert/strict";
import test from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";

// Spec sections 15-18, 50-52: the vendor-level manualOrderAcceptance toggle
// controls whether an order needs a human Accept, or is auto-accepted by the
// backend; and a vendor-user's own CAN_ACCEPT_ORDER permission separately
// controls WHO on that vendor's team may press Accept.
test("manual vs auto vendor acceptance, and per-user accept permission", async (t) => {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = "goocart-acceptance-test";
  process.env.AWS_LAMBDA_FUNCTION_NAME = "test";
  process.env.ADMIN_USER_EMAILS = "admin@accept.test";

  const [{ default: app }, { connectDb, disconnectDb }, { Restaurant }] = await Promise.all([
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
    const result = await request("/api/v1/auth/token", { method: "POST", body: { mode: "signup", email, name, password: "AcceptPass#2026" } });
    assert.equal(result.status, 200, JSON.stringify(result.json));
    return result.json.data;
  }

  async function loginViaOtp(identifier) {
    // Vendor-app users admin creates have no password — they sign in with an
    // OTP, exactly like a customer. The dev fallback logs the code to the
    // server console; here we read it straight out of the Otp collection.
    const { Otp } = await import("../dist/models.js");
    const req = await request("/api/v1/auth/otp/request", { method: "POST", body: { identifier, purpose: "LOGIN" } });
    assert.equal(req.status, 200, JSON.stringify(req.json));
    // We don't have the plaintext code (only its hash is stored), so drive
    // the flow through the same doc the server itself would check against by
    // temporarily overriding it with a known code's hash.
    const crypto = await import("node:crypto");
    const knownCode = "123456";
    const codeHash = crypto.createHash("sha256").update(knownCode).digest("hex");
    await Otp.updateOne({ identifier, purpose: "LOGIN", consumedAt: null }, { $set: { codeHash } }, { sort: { createdAt: -1 } });
    const verify = await request("/api/v1/auth/otp/verify", { method: "POST", body: { identifier, purpose: "LOGIN", code: knownCode } });
    assert.equal(verify.status, 200, JSON.stringify(verify.json));
    return verify.json.data.token;
  }

  const admin = await signup("admin@accept.test", "Accept Admin");

  const restaurantManual = await Restaurant.create({
    slug: "manual-kitchen",
    name: "Manual Kitchen",
    area: "Test Area",
    isOpen: true,
    latitude: 17.4362,
    longitude: 81.2661,
    manualOrderAcceptance: true,
    categories: [{ key: "mains", name: "Mains", sortOrder: 1 }],
  });
  const restaurantAuto = await Restaurant.create({
    slug: "auto-kitchen",
    name: "Auto Kitchen",
    area: "Test Area",
    isOpen: true,
    latitude: 17.44,
    longitude: 81.27,
    manualOrderAcceptance: false,
    categories: [{ key: "mains", name: "Mains", sortOrder: 1 }],
  });

  // Admin creates two vendor users on the manual-acceptance restaurant: an
  // Owner (implicitly full access) and a Kitchen Staff member explicitly
  // denied CAN_ACCEPT_ORDER.
  const ownerCreate = await request(`/api/v1/admin/restaurants/${restaurantManual._id}/users`, {
    token: admin.token,
    method: "POST",
    body: { email: "owner@accept.test", name: "Owner", role: "VENDOR_OWNER", permissions: [] },
  });
  assert.equal(ownerCreate.status, 200, JSON.stringify(ownerCreate.json));

  const kitchenCreate = await request(`/api/v1/admin/restaurants/${restaurantManual._id}/users`, {
    token: admin.token,
    method: "POST",
    body: { email: "kitchen@accept.test", name: "Kitchen", role: "VENDOR_STAFF", permissions: ["CAN_VIEW_ORDERS", "CAN_UPDATE_ORDER_STATUS"] },
  });
  assert.equal(kitchenCreate.status, 200, JSON.stringify(kitchenCreate.json));

  const ownerToken = await loginViaOtp("owner@accept.test");
  const kitchenToken = await loginViaOtp("kitchen@accept.test");

  // Give the auto-accept restaurant an owner too, and a customer to order as.
  const autoOwner = await request(`/api/v1/admin/restaurants/${restaurantAuto._id}/users`, {
    token: admin.token,
    method: "POST",
    body: { email: "autoowner@accept.test", name: "Auto Owner", role: "VENDOR_OWNER", permissions: [] },
  });
  assert.equal(autoOwner.status, 200, JSON.stringify(autoOwner.json));

  const customer = await signup("customer@accept.test", "Accept Customer");

  const manualItem = await request("/api/v1/vendor/menu", {
    token: ownerToken,
    method: "POST",
    body: { name: "Manual Meal", description: "x", price: 150, categoryKey: "mains", veg: true },
  });
  assert.equal(manualItem.status, 200, JSON.stringify(manualItem.json));

  const autoOwnerToken = await loginViaOtp("autoowner@accept.test");
  const autoItem = await request("/api/v1/vendor/menu", {
    token: autoOwnerToken,
    method: "POST",
    body: { name: "Auto Meal", description: "x", price: 150, categoryKey: "mains", veg: true },
  });
  assert.equal(autoItem.status, 200, JSON.stringify(autoItem.json));

  async function placeOrder(restaurant, foodItemId) {
    const res = await request("/api/v1/orders", {
      token: customer.token,
      method: "POST",
      body: {
        restaurantId: String(restaurant._id),
        paymentMethod: "COD",
        deliveryAddress: { label: "Home", line1: "1 Test Street", city: "Test City", pincode: "500001" },
        items: [{ foodItemId, quantity: 1, addonIds: [] }],
      },
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    return res.json.data.order;
  }

  // --- Test 50: manual acceptance ---------------------------------------
  const manualOrder = await placeOrder(restaurantManual, manualItem.json.data.item.id);
  assert.equal(manualOrder.status, "PLACED");
  assert.equal(manualOrder.manualAcceptanceRequired, true);
  assert.equal(manualOrder.deliveryOfferStatus, "NONE", "no delivery broadcast should happen before vendor accepts");

  // Kitchen (no CAN_ACCEPT_ORDER) may not accept — the backend rejects it
  // even though the request is otherwise well-formed (spec section 52).
  const kitchenTriesAccept = await request(`/api/v1/orders/${manualOrder.id}/transition`, {
    token: kitchenToken,
    method: "POST",
    body: { to: "VENDOR_ACCEPTED" },
  });
  assert.equal(kitchenTriesAccept.status, 403, JSON.stringify(kitchenTriesAccept.json));
  assert.equal(kitchenTriesAccept.json.error.code, "FORBIDDEN");

  // The owner can, because VENDOR_OWNER always has every permission.
  const ownerAccepts = await request(`/api/v1/orders/${manualOrder.id}/transition`, {
    token: ownerToken,
    method: "POST",
    body: { to: "VENDOR_ACCEPTED" },
  });
  assert.equal(ownerAccepts.status, 200, JSON.stringify(ownerAccepts.json));
  assert.equal(ownerAccepts.json.data.order.status, "VENDOR_ACCEPTED");

  // Kitchen DOES have CAN_UPDATE_ORDER_STATUS, so it can move it along.
  const kitchenPrepares = await request(`/api/v1/orders/${manualOrder.id}/transition`, {
    token: kitchenToken,
    method: "POST",
    body: { to: "PREPARING" },
  });
  assert.equal(kitchenPrepares.status, 200, JSON.stringify(kitchenPrepares.json));

  // ...but not CAN_MARK_READY.
  const kitchenTriesReady = await request(`/api/v1/orders/${manualOrder.id}/transition`, {
    token: kitchenToken,
    method: "POST",
    body: { to: "READY_FOR_PICKUP" },
  });
  assert.equal(kitchenTriesReady.status, 403, JSON.stringify(kitchenTriesReady.json));

  // --- Test 51: auto acceptance -------------------------------------------
  const autoOrder = await placeOrder(restaurantAuto, autoItem.json.data.item.id);
  assert.equal(autoOrder.status, "VENDOR_ACCEPTED", "auto-accept restaurants should skip straight past PLACED");
  assert.equal(autoOrder.manualAcceptanceRequired, false);
  assert.equal(autoOrder.autoAccepted, true);

  // Trying to "accept" an already-auto-accepted order is not a valid
  // transition (PLACED -> VENDOR_ACCEPTED is the only accept edge).
  const cannotReaccept = await request(`/api/v1/orders/${autoOrder.id}/transition`, {
    token: autoOwnerToken,
    method: "POST",
    body: { to: "VENDOR_ACCEPTED" },
  });
  assert.equal(cannotReaccept.status, 409);
  assert.equal(cannotReaccept.json.error.code, "INVALID_TRANSITION");
});
