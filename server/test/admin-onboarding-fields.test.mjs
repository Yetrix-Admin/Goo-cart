import assert from "node:assert/strict";
import test from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";

// Covers the vendor/partner onboarding fields added for the admin console:
// vendor photo, address, per-vendor commission rate, owner username, menu
// item photo + discount, percentage offers via coupons scoped to a vendor,
// and delivery-partner KYC (Aadhaar/PAN/bank details).
test("admin can onboard a vendor and a delivery partner with the new fields, and stats/offers work end to end", async (t) => {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = "goocart-onboarding-test";
  process.env.AWS_LAMBDA_FUNCTION_NAME = "test";
  process.env.ADMIN_USER_EMAILS = "admin@onboarding.test";

  const [{ default: app }, { connectDb, disconnectDb }, { Order }] = await Promise.all([
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

  const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

  const adminSignup = await request("/api/v1/auth/token", { method: "POST", body: { mode: "signup", email: "admin@onboarding.test", name: "Onboarding Admin", password: "OnboardPass#2026" } });
  const admin = adminSignup.json.data;
  assert.ok(admin.token, "admin signup should return a token");

  // --- Vendor creation with photo, address, commission %, username --------
  const vendorCreate = await request("/api/v1/admin/restaurants", {
    token: admin.token,
    method: "POST",
    body: {
      name: "OG Grocery", imageUrl: TINY_PNG, area: "Jangareddigudem", address: "12 Market Street", latitude: 17.44, longitude: 81.26,
      businessType: "Grocery Store", commissionPercent: 12.5,
      ownerName: "OG Owner", ownerUsername: "og_owner", ownerEmail: "owner@oggrocery.test", ownerPhone: "+919000000099",
      initialPassword: "OgGrocery#2026", manualOrderAcceptance: true,
    },
  });
  assert.equal(vendorCreate.status, 200, JSON.stringify(vendorCreate.json));
  const restaurantId = vendorCreate.json.data.restaurant.id;
  assert.equal(vendorCreate.json.data.restaurant.address, "12 Market Street");
  assert.equal(vendorCreate.json.data.owner.username, "og_owner");
  assert.ok(!("passwordHash" in vendorCreate.json.data.owner), "created owner response must never include a password hash");

  // Vendor ID is auto-generated (the Mongo _id), never supplied by the admin.
  assert.match(restaurantId, /^[0-9a-f]{24}$/);

  // A duplicate username must be rejected.
  const dupUsername = await request("/api/v1/admin/restaurants", {
    token: admin.token,
    method: "POST",
    body: { name: "Dup", area: "A", latitude: 1, longitude: 1, ownerName: "Duplicate Owner", ownerUsername: "og_owner", ownerEmail: "dup@test.test", initialPassword: "DupPass#2026" },
  });
  assert.equal(dupUsername.status, 409);

  // --- GET /restaurants exposes admin-only stats + commission -------------
  const listed = await request("/api/v1/admin/restaurants", { token: admin.token });
  const listedRestaurant = listed.json.data.restaurants.find((r) => r.id === restaurantId);
  assert.ok(listedRestaurant, "created restaurant must appear in the admin list");
  assert.equal(listedRestaurant.commissionPercent, 12.5);
  assert.equal(listedRestaurant.totalOrders, 0);
  assert.equal(listedRestaurant.commissionPayout, 0);
  assert.equal(listedRestaurant.owner.username, "og_owner");

  // The public catalog DTO must NOT leak the vendor's commission rate.
  const publicView = await request(`/api/v1/catalog/restaurants/${restaurantId}`);
  assert.equal(publicView.json.data.restaurant.commissionPercent, undefined, "commissionPercent must never appear in the public catalog response");
  assert.equal(publicView.json.data.restaurant.address, "12 Market Street", "address is fine to expose publicly");

  // --- Edit vendor (PATCH) -------------------------------------------------
  const edited = await request(`/api/v1/admin/restaurants/${restaurantId}`, {
    token: admin.token,
    method: "PATCH",
    body: { commissionPercent: 15, address: "45 New Address Road" },
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.json));
  assert.equal(edited.json.data.restaurant.address, "45 New Address Road");

  const badCommission = await request(`/api/v1/admin/restaurants/${restaurantId}`, { token: admin.token, method: "PATCH", body: { commissionPercent: 150 } });
  assert.equal(badCommission.status, 400);

  // --- Menu item with photo + discount -------------------------------------
  const menuCreated = await request(`/api/v1/admin/restaurants/${restaurantId}/menu`, {
    token: admin.token,
    method: "POST",
    body: { name: "Rice 5kg", description: "Premium rice", imageUrl: TINY_PNG, price: 350, discountPercent: 10, categoryKey: "staples", veg: true },
  });
  assert.equal(menuCreated.status, 200, JSON.stringify(menuCreated.json));
  assert.equal(menuCreated.json.data.item.discountPercent, 10);
  assert.equal(menuCreated.json.data.item.imageUrl, TINY_PNG);
  const itemId = menuCreated.json.data.item.id;

  const badDiscount = await request(`/api/v1/admin/restaurants/${restaurantId}/menu`, {
    token: admin.token,
    method: "POST",
    body: { name: "Bad", price: 10, discountPercent: 250, categoryKey: "staples" },
  });
  assert.equal(badDiscount.status, 400, "discount over 100% must be rejected");

  const menuEdited = await request(`/api/v1/admin/restaurants/${restaurantId}/menu/${itemId}`, {
    token: admin.token,
    method: "PATCH",
    body: { discountPercent: 20 },
  });
  assert.equal(menuEdited.status, 200, JSON.stringify(menuEdited.json));
  assert.equal(menuEdited.json.data.item.discountPercent, 20);

  const publicItem = await request(`/api/v1/catalog/restaurants/${restaurantId}`);
  assert.equal(publicItem.json.data.items[0].discountPercent, 20, "discount must be customer-visible");

  // --- Percentage offer via a restaurant-scoped coupon ---------------------
  const couponCreated = await request("/api/v1/admin/coupons", {
    token: admin.token,
    method: "POST",
    body: { code: "OGWEEKEND20", title: "Weekend 20% off", type: "PERCENT", value: 20, minOrder: 100, targetRestaurantIds: [restaurantId] },
  });
  assert.equal(couponCreated.status, 200, JSON.stringify(couponCreated.json));
  const couponId = couponCreated.json.data.coupon.id;

  const couponsList = await request("/api/v1/admin/coupons", { token: admin.token });
  const scoped = couponsList.json.data.coupons.filter((c) => c.targetRestaurantIds.includes(restaurantId));
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0].value, 20);

  const couponPaused = await request(`/api/v1/admin/coupons/${couponId}`, { token: admin.token, method: "PATCH", body: { active: false } });
  assert.equal(couponPaused.status, 200, JSON.stringify(couponPaused.json));
  assert.equal(couponPaused.json.data.coupon.active, false);

  const couponRemoved = await request(`/api/v1/admin/coupons/${couponId}`, { token: admin.token, method: "DELETE" });
  assert.equal(couponRemoved.status, 200, JSON.stringify(couponRemoved.json));

  // --- Vendor delete (no order history -> hard delete) ---------------------
  const vendorDeleted = await request(`/api/v1/admin/restaurants/${restaurantId}`, { token: admin.token, method: "DELETE" });
  assert.equal(vendorDeleted.status, 200, JSON.stringify(vendorDeleted.json));
  assert.equal(vendorDeleted.json.data.deleted, true);

  // --- Delivery partner with Aadhaar / PAN / bank details / photo ----------
  const badPartner = await request("/api/v1/admin/partners", {
    token: admin.token,
    method: "POST",
    body: { name: "No Aadhaar", email: "noaadhaar@test.test", initialPassword: "NoAadhaar#2026" },
  });
  assert.equal(badPartner.status, 400, "Aadhaar must be required");

  const partnerCreated = await request("/api/v1/admin/partners", {
    token: admin.token,
    method: "POST",
    body: {
      name: "Delivery Kumar", email: "kumar@partner.test", phone: "+919000000098", photoUrl: TINY_PNG,
      aadhaarNumber: "123456789012", panNumber: "abcde1234f", licenceNumber: "DL-99887766",
      bankDetails: { accountNumber: "1234567890", ifsc: "HDFC0001234", accountHolderName: "Delivery Kumar" },
      initialPassword: "DeliveryKumar#2026", approveNow: true,
    },
  });
  assert.equal(partnerCreated.status, 200, JSON.stringify(partnerCreated.json));
  assert.equal(partnerCreated.json.data.partner.aadhaarNumber, "123456789012");
  assert.equal(partnerCreated.json.data.partner.panNumber, "ABCDE1234F", "PAN should be normalized to uppercase");
  const partnerId = partnerCreated.json.data.partner.id;

  const badAadhaar = await request("/api/v1/admin/partners", {
    token: admin.token,
    method: "POST",
    body: { name: "Bad Aadhaar", email: "badaadhaar@test.test", aadhaarNumber: "123", initialPassword: "BadAadhaar#2026" },
  });
  assert.equal(badAadhaar.status, 400);

  const partnersList = await request("/api/v1/admin/partners", { token: admin.token });
  const listedPartner = partnersList.json.data.partners.find((p) => p.id === partnerId);
  assert.ok(listedPartner);
  assert.equal(listedPartner.bankDetails.ifsc, "HDFC0001234");
  assert.equal(listedPartner.photoUrl, TINY_PNG);

  // Editing KYC fields writes a before/after audit snapshot of the full
  // document — this is where Aadhaar/PAN/bank details/photo must be
  // redacted, since they're real PII, not just decoration.
  const partnerEdited = await request(`/api/v1/admin/partners/${partnerId}`, {
    token: admin.token,
    method: "PATCH",
    body: { aadhaarNumber: "987654321098" },
  });
  assert.equal(partnerEdited.status, 200, JSON.stringify(partnerEdited.json));

  const AuditLogModule = await import("../dist/models.js");
  const partnerEditLog = await AuditLogModule.AuditLog.findOne({ action: "partner.edit", entityId: partnerId }).sort({ createdAt: -1 }).lean();
  assert.ok(partnerEditLog, "partner edit should be audited");
  const auditSnapshot = JSON.stringify([partnerEditLog.before, partnerEditLog.after]);
  assert.ok(!auditSnapshot.includes("123456789012"), "old Aadhaar must not appear raw in the audit log");
  assert.ok(!auditSnapshot.includes("987654321098"), "new Aadhaar must not appear raw in the audit log");
  assert.ok(!auditSnapshot.includes("HDFC0001234"), "bank IFSC must not appear raw in the audit log");
  assert.ok(!auditSnapshot.includes(TINY_PNG), "the base64 photo must not be duplicated into the audit log");

  const partnerDeleted = await request(`/api/v1/admin/partners/${partnerId}`, { token: admin.token, method: "DELETE" });
  assert.equal(partnerDeleted.status, 200, JSON.stringify(partnerDeleted.json));
  assert.equal(partnerDeleted.json.data.deleted, true);

  // Sanity: Order model import didn't break anything used by the new stats aggregation.
  assert.equal(await Order.countDocuments(), 0);
});
