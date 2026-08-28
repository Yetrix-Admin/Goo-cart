import assert from "node:assert/strict";
import test from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";

// Nothing about fees, discounts, or coupon codes should be hardcoded in a
// way only a redeploy could change — admin edits must take effect on the
// very next order priced.
test("admin controls platform pricing, restaurant offers, and coupons end to end", async (t) => {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = "goocart-pricing-test";
  process.env.AWS_LAMBDA_FUNCTION_NAME = "test";
  process.env.ADMIN_USER_EMAILS = "admin@pricing.test";

  const [{ default: app }, { connectDb, disconnectDb }, { Restaurant, FoodItem }] = await Promise.all([
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

  const adminSignup = await request("/api/v1/auth/token", { method: "POST", body: { mode: "signup", email: "admin@pricing.test", name: "Pricing Admin", password: "PricingPass#2026" } });
  const admin = adminSignup.json.data;
  const customerSignup = await request("/api/v1/auth/token", { method: "POST", body: { mode: "signup", email: "customer@pricing.test", name: "Pricing Customer", password: "PricingPass#2026" } });
  const customer = customerSignup.json.data;

  const restaurant = await Restaurant.create({
    slug: "pricing-kitchen",
    name: "Pricing Kitchen",
    area: "Test Area",
    isOpen: true,
    latitude: 17.4362,
    longitude: 81.2661,
    manualOrderAcceptance: false,
    categories: [{ key: "mains", name: "Mains", sortOrder: 1 }],
  });
  const item = await FoodItem.create({ slug: "pricing-meal", restaurantId: restaurant._id, categoryKey: "mains", name: "Pricing Meal", price: 100, veg: true, available: true });
  const otherItem = await FoodItem.create({ slug: "pricing-side", restaurantId: restaurant._id, categoryKey: "mains", name: "Pricing Side", price: 100, veg: true, available: true });

  async function placeOrder(couponCode, selectedItems = [{ foodItemId: String(item._id), quantity: 1, addonIds: [] }], selectedRestaurant = restaurant) {
    return request("/api/v1/orders", {
      token: customer.token,
      method: "POST",
      body: {
        restaurantId: String(selectedRestaurant._id),
        paymentMethod: "COD",
        deliveryAddress: { label: "Home", line1: "1 Pricing Street", city: "Pricing City", pincode: "500001" },
        items: selectedItems,
        couponCode,
      },
    });
  }

  // --- Default pricing applies before any admin change -------------------
  const defaultOrder = await placeOrder();
  assert.equal(defaultOrder.status, 200, JSON.stringify(defaultOrder.json));
  assert.equal(defaultOrder.json.data.order.bill.deliveryFee, 30);
  assert.equal(defaultOrder.json.data.order.bill.platformFee, 8);
  assert.equal(defaultOrder.json.data.order.bill.taxes, Math.round(100 * 0.05));

  // --- Admin changes platform pricing --------------------------------------
  const updated = await request("/api/v1/admin/pricing-settings", {
    token: admin.token,
    method: "PATCH",
    body: { deliveryFee: 45, platformFee: 12, taxRatePercent: 10 },
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.json));
  assert.equal(updated.json.data.pricing.deliveryFee, 45);

  const nonAdminAttempt = await request("/api/v1/admin/pricing-settings", { token: customer.token, method: "PATCH", body: { deliveryFee: 1 } });
  assert.equal(nonAdminAttempt.status, 403);

  const afterChange = await placeOrder();
  assert.equal(afterChange.status, 200, JSON.stringify(afterChange.json));
  assert.equal(afterChange.json.data.order.bill.deliveryFee, 45, "new delivery fee should apply immediately, no redeploy");
  assert.equal(afterChange.json.data.order.bill.platformFee, 12);
  assert.equal(afterChange.json.data.order.bill.taxes, Math.round(100 * 0.1));

  // --- Admin creates and applies a coupon ----------------------------------
  const couponCreate = await request("/api/v1/admin/coupons", {
    token: admin.token,
    method: "POST",
    body: { code: "ADMIN20", type: "PERCENT", value: 20, minOrder: 0 },
  });
  assert.equal(couponCreate.status, 200, JSON.stringify(couponCreate.json));

  const withCoupon = await placeOrder("ADMIN20");
  assert.equal(withCoupon.status, 200, JSON.stringify(withCoupon.json));
  assert.equal(withCoupon.json.data.order.bill.couponDiscount, 20, "20% off a ₹100 item is ₹20");

  // A targeted home offer discounts only the selected food subtotal and is
  // rejected at every other restaurant by the authoritative order API.
  const targetedCreate = await request("/api/v1/admin/coupons", {
    token: admin.token,
    method: "POST",
    body: {
      code: "MEAL50",
      title: "Half price meal",
      type: "PERCENT",
      value: 50,
      targetRestaurantIds: [String(restaurant._id)],
      targetFoodItemIds: [String(item._id)],
      showOnHome: true,
    },
  });
  assert.equal(targetedCreate.status, 200, JSON.stringify(targetedCreate.json));
  const targetedOrder = await placeOrder("MEAL50", [
    { foodItemId: String(item._id), quantity: 1, addonIds: [] },
    { foodItemId: String(otherItem._id), quantity: 1, addonIds: [] },
  ]);
  assert.equal(targetedOrder.status, 200, JSON.stringify(targetedOrder.json));
  assert.equal(targetedOrder.json.data.order.bill.couponDiscount, 50, "only the selected ₹100 meal should receive 50% off");

  const publicOffers = await request("/api/v1/catalog/coupons");
  const mealOffer = publicOffers.json.data.coupons.find((coupon) => coupon.code === "MEAL50");
  assert.deepEqual(mealOffer.targetRestaurantNames, ["Pricing Kitchen"]);
  assert.deepEqual(mealOffer.targetFoodItemNames, ["Pricing Meal"]);
  assert.equal(mealOffer.showOnHome, true);

  const otherRestaurant = await Restaurant.create({
    slug: "other-kitchen", name: "Other Kitchen", area: "Test Area", isOpen: true,
    latitude: 17.4363, longitude: 81.2662, manualOrderAcceptance: false,
    categories: [{ key: "mains", name: "Mains", sortOrder: 1 }],
  });
  const otherRestaurantItem = await FoodItem.create({ slug: "other-meal", restaurantId: otherRestaurant._id, categoryKey: "mains", name: "Other Meal", price: 100, veg: true, available: true });
  const wrongRestaurant = await placeOrder("MEAL50", [{ foodItemId: String(otherRestaurantItem._id), quantity: 1, addonIds: [] }], otherRestaurant);
  assert.equal(wrongRestaurant.status, 409);
  assert.equal(wrongRestaurant.json.error.code, "COUPON_NOT_APPLICABLE");

  // Deactivating the coupon must take effect immediately too.
  const couponId = couponCreate.json.data.coupon.id;
  await request(`/api/v1/admin/coupons/${couponId}`, { token: admin.token, method: "PATCH", body: { active: false } });
  const afterDeactivate = await placeOrder("ADMIN20");
  assert.equal(afterDeactivate.status, 409, "a deactivated coupon should be rejected");
  assert.equal(afterDeactivate.json.error.code, "INVALID_COUPON");

  // --- Admin manages a per-restaurant offer --------------------------------
  const offerAdd = await request(`/api/v1/admin/restaurants/${restaurant._id}/offers`, {
    token: admin.token,
    method: "POST",
    body: { title: "FREE DELIVERY", description: "On all orders today" },
  });
  assert.equal(offerAdd.status, 200, JSON.stringify(offerAdd.json));
  assert.equal(offerAdd.json.data.restaurant.offers.length, 1);
  const offerId = offerAdd.json.data.restaurant.offers[0].id;

  const publicView = await request(`/api/v1/catalog/restaurants/${restaurant._id}`);
  assert.equal(publicView.json.data.restaurant.offers[0].title, "FREE DELIVERY", "customers should see the admin-added offer");

  const offerRemove = await request(`/api/v1/admin/restaurants/${restaurant._id}/offers/${offerId}`, { token: admin.token, method: "DELETE" });
  assert.equal(offerRemove.status, 200, JSON.stringify(offerRemove.json));
  assert.equal(offerRemove.json.data.restaurant.offers.length, 0);

  // --- Public pricing endpoint reflects the same admin-set values ---------
  const publicPricing = await request("/api/v1/catalog/pricing-settings");
  assert.equal(publicPricing.json.data.pricing.deliveryFee, 45);
});
