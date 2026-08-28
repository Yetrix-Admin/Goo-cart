// Proves the new pickup-verification guard actually works end-to-end
// through the real HTTP transition route: a delivery partner cannot move an
// order to PICKED_UP without the vendor-held code, and the right code works.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, stopTestServer, apiPost } from "./harness.mjs";

let mongoose;

before(async () => {
  ({ mongoose } = await startTestServer());
});

after(async () => {
  await stopTestServer();
});

async function seedAssignedOrder(pickupOtp) {
  const { User, Order } = await import("../dist/models.js");
  const { hashPassword, createSession } = await import("../dist/lib/auth.js");

  const partner = await User.create({
    email: `partner.${Date.now()}@test.goocart.local`,
    name: "Test Partner",
    passwordHash: await hashPassword("TestPass123!"),
    role: "DELIVERY_PARTNER",
    status: "ACTIVE",
    partnerApprovalStatus: "APPROVED",
  });
  const token = await createSession(partner._id, { ip: "127.0.0.1", userAgent: "test" });

  const order = await Order.create({
    orderNumber: `GOO-FD-TEST-${Date.now()}`,
    customerId: new mongoose.Types.ObjectId(),
    customerName: "Test Customer",
    restaurantId: new mongoose.Types.ObjectId(),
    restaurantName: "Test Restaurant",
    status: "ARRIVED_AT_VENDOR",
    paymentMethod: "COD",
    paymentStatus: "NOT_APPLICABLE",
    bill: { itemTotal: 200, total: 220 },
    deliveryAddress: { latitude: 17.4, longitude: 81.2 },
    deliveryOtp: "9999",
    pickupOtp,
    partnerId: partner._id,
    partnerName: partner.name,
    statusHistory: [{ status: "ARRIVED_AT_VENDOR", actorId: partner._id, actorRole: "DELIVERY_PARTNER", at: new Date() }],
    events: [],
  });

  return { partnerToken: token, order };
}

test("wrong pickup code is rejected and does not change order status", async () => {
  const { partnerToken, order } = await seedAssignedOrder("4821");

  const { status, body } = await apiPost(`/api/v1/orders/${order._id}/transition`, { to: "PICKED_UP", code: "0000" }, partnerToken);

  assert.equal(status, 401);
  assert.equal(body.error.code, "INVALID_CODE");

  const { Order } = await import("../dist/models.js");
  const fresh = await Order.findById(order._id).lean();
  assert.equal(fresh.status, "ARRIVED_AT_VENDOR", "an incorrect code must never move the order forward");
});

test("correct pickup code moves the order to PICKED_UP", async () => {
  const { partnerToken, order } = await seedAssignedOrder("4821");

  const { status, body } = await apiPost(`/api/v1/orders/${order._id}/transition`, { to: "PICKED_UP", code: "4821" }, partnerToken);

  assert.equal(status, 200);
  assert.equal(body.data.order.status, "PICKED_UP");
});

test("an unrelated delivery partner cannot act on this order at all", async () => {
  const { order } = await seedAssignedOrder("4821");
  const { User } = await import("../dist/models.js");
  const { hashPassword, createSession } = await import("../dist/lib/auth.js");
  const outsider = await User.create({
    email: `outsider.${Date.now()}@test.goocart.local`,
    name: "Outsider Partner",
    passwordHash: await hashPassword("TestPass123!"),
    role: "DELIVERY_PARTNER",
    status: "ACTIVE",
    partnerApprovalStatus: "APPROVED",
  });
  const outsiderToken = await createSession(outsider._id, { ip: "127.0.0.1", userAgent: "test" });

  const { status, body } = await apiPost(`/api/v1/orders/${order._id}/transition`, { to: "PICKED_UP", code: "4821" }, outsiderToken);

  assert.equal(status, 403);
  assert.equal(body.error.code, "FORBIDDEN");
});
