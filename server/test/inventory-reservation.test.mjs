// Proves the reservation-backed grocery/mart checkout: two customers racing
// for the last unit of stock can never both succeed, a multi-item cart that
// fails partway never leaves earlier items silently decremented, and the
// expiry sweep gives abandoned holds back to stock.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, stopTestServer, apiPost, signupUser } from "./harness.mjs";

before(async () => {
  await startTestServer();
});

after(async () => {
  await stopTestServer();
});

async function seedProduct(overrides = {}) {
  const mongoose = (await import("mongoose")).default;
  const { Product } = await import("../dist/models.js");
  return Product.create({
    service: "Grocery",
    vendorId: new mongoose.Types.ObjectId(),
    vendorName: "Test Grocer",
    name: "Test Milk 1L",
    price: 60,
    stock: 1,
    ...overrides,
  });
}

test("two customers racing for the last unit: exactly one order succeeds", async () => {
  const product = await seedProduct({ stock: 1 });
  const [buyerA, buyerB] = await Promise.all([signupUser("Buyer A"), signupUser("Buyer B")]);

  const address = { latitude: 17.4, longitude: 81.2, area: "Test Area" };
  const placeOrder = (token) =>
    apiPost("/api/v1/customer/service-orders", { service: "GROCERY", items: [{ productId: String(product._id), quantity: 1 }], address }, token);

  const [resultA, resultB] = await Promise.all([placeOrder(buyerA.token), placeOrder(buyerB.token)]);

  const outcomes = [resultA, resultB];
  const succeeded = outcomes.filter((r) => r.status === 200);
  const failed = outcomes.filter((r) => r.status === 409);

  assert.equal(succeeded.length, 1, "exactly one of the two concurrent buyers must win the last unit");
  assert.equal(failed.length, 1);
  assert.equal(failed[0].body.error.code, "OUT_OF_STOCK");

  const { Product, Reservation } = await import("../dist/models.js");
  const freshProduct = await Product.findById(product._id).lean();
  assert.equal(freshProduct.stock, 0, "stock must land at exactly 0, never negative");

  const reservations = await Reservation.find({ productId: product._id }).lean();
  assert.equal(reservations.length, 1, "only the winning attempt should have created a reservation");
  assert.equal(reservations[0].status, "CONSUMED");
});

test("a multi-item cart that fails on one line leaves every line's stock untouched", async () => {
  const inStock = await seedProduct({ name: "In-stock item", stock: 5 });
  const outOfStock = await seedProduct({ name: "Out-of-stock item", stock: 0 });
  const { token } = await signupUser("Cart Buyer");

  const { status, body } = await apiPost(
    "/api/v1/customer/service-orders",
    { service: "GROCERY", items: [{ productId: String(inStock._id), quantity: 2 }, { productId: String(outOfStock._id), quantity: 1 }], address: { latitude: 17.4, longitude: 81.2 } },
    token,
  );

  assert.equal(status, 409);
  assert.equal(body.error.code, "OUT_OF_STOCK");

  const { Product, Reservation } = await import("../dist/models.js");
  const freshInStock = await Product.findById(inStock._id).lean();
  assert.equal(freshInStock.stock, 5, "the in-stock line must not have been decremented when a later line in the same cart failed");

  const reservations = await Reservation.find({ productId: inStock._id }).lean();
  assert.equal(reservations.length, 0, "no reservation should exist for a cart that never completed");
});

test("expiry sweep releases an abandoned hold back to stock", async () => {
  const { sweepExpiredReservations } = await import("../dist/lib/inventory.js");
  const mongoose = (await import("mongoose")).default;
  const { Product, Reservation } = await import("../dist/models.js");

  const product = await seedProduct({ stock: 3 });
  await Product.updateOne({ _id: product._id }, { $inc: { stock: -1 } }); // simulate the hold's decrement
  const stale = await Reservation.create({
    productId: product._id,
    vendorId: product.vendorId,
    quantity: 1,
    customerId: new mongoose.Types.ObjectId(),
    status: "RESERVED",
    expiresAt: new Date(Date.now() - 60_000), // already expired
  });

  const releasedCount = await sweepExpiredReservations();
  assert.ok(releasedCount >= 1);

  const freshProduct = await Product.findById(product._id).lean();
  assert.equal(freshProduct.stock, 3, "stock must be restored to its pre-hold value");

  const freshReservation = await Reservation.findById(stale._id).lean();
  assert.equal(freshReservation.status, "EXPIRED");
});
