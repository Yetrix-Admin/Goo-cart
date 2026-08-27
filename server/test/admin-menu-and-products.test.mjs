import assert from "node:assert/strict";
import test from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";

// Admin must be able to manage a vendor's menu directly, without waiting on
// a Vendor App login — this is the fix for "vendors adding is live but
// can't add menu items and products".
test("admin can create, edit, and delete menu items and legacy products directly", async (t) => {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = "goocart-admin-menu-test";
  process.env.AWS_LAMBDA_FUNCTION_NAME = "test";
  process.env.ADMIN_USER_EMAILS = "admin@menu.test";

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

  const adminSignup = await request("/api/v1/auth/token", { method: "POST", body: { mode: "signup", email: "admin@menu.test", name: "Menu Admin", password: "MenuPass#2026" } });
  const admin = adminSignup.json.data;

  const restaurant = await Restaurant.create({
    slug: "menu-kitchen",
    name: "Menu Kitchen",
    area: "Test Area",
    isOpen: true,
    latitude: 17.4362,
    longitude: 81.2661,
  });

  // --- Menu items (FoodItem), no vendor login needed ----------------------
  const created = await request(`/api/v1/admin/restaurants/${restaurant._id}/menu`, {
    token: admin.token,
    method: "POST",
    body: { name: "Admin Added Meal", description: "Added directly by admin", price: 199, categoryKey: "mains", veg: true },
  });
  assert.equal(created.status, 200, JSON.stringify(created.json));
  assert.equal(created.json.data.item.name, "Admin Added Meal");
  const itemId = created.json.data.item.id;

  const listed = await request(`/api/v1/admin/restaurants/${restaurant._id}/menu`, { token: admin.token });
  assert.equal(listed.status, 200);
  assert.equal(listed.json.data.items.length, 1);

  const edited = await request(`/api/v1/admin/restaurants/${restaurant._id}/menu/${itemId}`, {
    token: admin.token,
    method: "PATCH",
    body: { price: 249, available: false },
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.json));
  assert.equal(edited.json.data.item.price, 249);
  assert.equal(edited.json.data.item.available, false);

  // A publicly-visible restaurant page should reflect the admin-added item.
  const publicView = await request(`/api/v1/catalog/restaurants/${restaurant._id}`);
  assert.equal(publicView.json.data.items.length, 1);
  assert.equal(publicView.json.data.items[0].price, 249);

  const removed = await request(`/api/v1/admin/restaurants/${restaurant._id}/menu/${itemId}`, { token: admin.token, method: "DELETE" });
  assert.equal(removed.status, 200, JSON.stringify(removed.json));

  const afterDelete = await request(`/api/v1/admin/restaurants/${restaurant._id}/menu`, { token: admin.token });
  assert.equal(afterDelete.json.data.items.length, 0);

  // A non-admin must not be able to touch menu items via this path.
  const customerSignup = await request("/api/v1/auth/token", { method: "POST", body: { mode: "signup", email: "customer@menu.test", name: "Menu Customer", password: "MenuPass#2026" } });
  const forbidden = await request(`/api/v1/admin/restaurants/${restaurant._id}/menu`, {
    token: customerSignup.json.data.token,
    method: "POST",
    body: { name: "Should Not Work", price: 100, categoryKey: "mains" },
  });
  assert.equal(forbidden.status, 403);

  // --- Legacy multi-service products (Grocery/Mart/Vegetables) ------------
  const productCreated = await request("/api/v1/admin/products", {
    token: admin.token,
    method: "POST",
    body: { service: "Grocery", name: "Rice 5kg", price: 350, stock: 40 },
  });
  assert.equal(productCreated.status, 200, JSON.stringify(productCreated.json));
  const productId = productCreated.json.data.product.id;

  const productList = await request("/api/v1/admin/products?service=Grocery", { token: admin.token });
  assert.equal(productList.status, 200);
  assert.equal(productList.json.data.products.length, 1);

  const productEdited = await request(`/api/v1/admin/products/${productId}`, { token: admin.token, method: "PATCH", body: { stock: 15 } });
  assert.equal(productEdited.status, 200, JSON.stringify(productEdited.json));
  assert.equal(productEdited.json.data.product.stock, 15);

  const productDeleted = await request(`/api/v1/admin/products/${productId}`, { token: admin.token, method: "DELETE" });
  assert.equal(productDeleted.status, 200, JSON.stringify(productDeleted.json));

  const productListAfter = await request("/api/v1/admin/products?service=Grocery", { token: admin.token });
  assert.equal(productListAfter.json.data.products.length, 0);
});
