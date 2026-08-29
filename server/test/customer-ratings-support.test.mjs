import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, stopTestServer, getBaseUrl, apiPost, apiGet, signupUser } from "./harness.mjs";

process.env.ADMIN_USER_EMAILS = "admin.support@test.goocart.local";

let mongoose;

before(async () => {
  ({ mongoose } = await startTestServer());
});

after(async () => {
  await stopTestServer();
});

async function seedCustomerOrder(status = "DELIVERED") {
  const { Restaurant, Order } = await import("../dist/models.js");
  const customer = await signupUser("Ratings Customer");
  const otherCustomer = await signupUser("Other Customer");

  const restaurant = await Restaurant.create({
    slug: `rating-kitchen-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: "Rating Kitchen",
    area: "Test Area",
    isOpen: true,
    latitude: 17.4362,
    longitude: 81.2661,
    rating: 0,
    ratingCount: 0,
    categories: [{ key: "mains", name: "Mains", sortOrder: 1 }],
  });

  const order = await Order.create({
    orderNumber: `GOO-FD-RATING-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    customerId: new mongoose.Types.ObjectId(customer.user.id),
    customerName: customer.user.name,
    restaurantId: restaurant._id,
    restaurantName: restaurant.name,
    status,
    paymentMethod: "COD",
    paymentStatus: "NOT_APPLICABLE",
    bill: { itemTotal: 250, total: 280 },
    deliveryAddress: { latitude: 17.4, longitude: 81.2 },
    deliveryOtp: "2468",
    pickupOtp: "1357",
    statusHistory: [{ status, at: new Date() }],
    events: [],
  });

  return { customer, otherCustomer, restaurant, order };
}

test("customer can rate only their delivered food order and restaurant rating updates", async () => {
  const { customer, restaurant, order } = await seedCustomerOrder("DELIVERED");

  const submit = await apiPost(
    "/api/v1/customer/ratings",
    { orderId: String(order._id), foodStars: 4, restaurantStars: 5, deliveryPartnerStars: 3, comment: "Good food" },
    customer.token,
  );

  assert.equal(submit.status, 200, JSON.stringify(submit.body));
  assert.equal(submit.body.data.rating.orderId, String(order._id));
  assert.equal(submit.body.data.rating.restaurantStars, 5);

  const list = await apiGet("/api/v1/customer/ratings", customer.token);
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.data.ratings.length, 1);
  assert.equal(list.body.data.ratings[0].comment, "Good food");

  const { Restaurant } = await import("../dist/models.js");
  const freshRestaurant = await Restaurant.findById(restaurant._id).lean();
  assert.equal(freshRestaurant.rating, 5);
  assert.equal(freshRestaurant.ratingCount, 1);
});

test("customer cannot rate an order before delivery or another customer's order", async () => {
  const { customer, otherCustomer, order } = await seedCustomerOrder("PICKED_UP");

  const tooEarly = await apiPost(
    "/api/v1/customer/ratings",
    { orderId: String(order._id), foodStars: 5, restaurantStars: 5, deliveryPartnerStars: 5 },
    customer.token,
  );
  assert.equal(tooEarly.status, 409);
  assert.equal(tooEarly.body.error.code, "ORDER_NOT_DELIVERED");

  const outsider = await apiPost(
    "/api/v1/customer/ratings",
    { orderId: String(order._id), foodStars: 5, restaurantStars: 5, deliveryPartnerStars: 5 },
    otherCustomer.token,
  );
  assert.equal(outsider.status, 404);
  assert.equal(outsider.body.error.code, "ORDER_NOT_FOUND");
});

test("support ticket creation is persisted and respects customer ownership", async () => {
  const { customer, otherCustomer, order } = await seedCustomerOrder("DELIVERED");

  const blocked = await apiPost(
    "/api/v1/customer/support-tickets",
    { orderId: String(order._id), reason: "Missing item", details: "Not my order" },
    otherCustomer.token,
  );
  assert.equal(blocked.status, 404);
  assert.equal(blocked.body.error.code, "ORDER_NOT_FOUND");

  const created = await apiPost(
    "/api/v1/customer/support-tickets",
    { orderId: String(order._id), reason: "Missing item", details: "The drink was missing." },
    customer.token,
  );
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.match(created.body.data.ticket.id, /^SUP-\d{4}-\d{6}$/);
  assert.equal(created.body.data.ticket.status, "OPEN");
  assert.equal(created.body.data.ticket.orderId, String(order._id));

  const { SupportTicket } = await import("../dist/models.js");
  const stored = await SupportTicket.findOne({ ticketNumber: created.body.data.ticket.id }).lean();
  assert.ok(stored);
  assert.equal(String(stored.customerId), customer.user.id);
  assert.equal(stored.category, "Missing item");
  assert.equal(stored.message, "The drink was missing.");
});

test("admin can list and update customer support tickets", async () => {
  const { customer, order } = await seedCustomerOrder("DELIVERED");
  const adminSignup = await apiPost("/api/v1/auth/signup", { email: "admin.support@test.goocart.local", name: "Support Admin", password: "SupportPass#2026" });
  assert.equal(adminSignup.status, 200, JSON.stringify(adminSignup.body));
  assert.equal(adminSignup.body.data.user.role, "SUPER_ADMIN");

  const created = await apiPost(
    "/api/v1/customer/support-tickets",
    { orderId: String(order._id), reason: "Delivery partner issue", details: "Partner could not find my address." },
    customer.token,
  );
  assert.equal(created.status, 200, JSON.stringify(created.body));

  const list = await apiGet("/api/v1/admin/support-tickets", adminSignup.body.data.token);
  assert.equal(list.status, 200, JSON.stringify(list.body));
  const ticket = list.body.data.tickets.find((item) => item.ticketNumber === created.body.data.ticket.id);
  assert.ok(ticket, "admin support queue should include the new customer ticket");
  assert.equal(ticket.customerName, customer.user.name);
  assert.equal(ticket.orderNumber, order.orderNumber);
  assert.equal(ticket.status, "OPEN");

  const response = await fetch(`${getBaseUrl()}/api/v1/admin/support-tickets/${ticket.id}/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${adminSignup.body.data.token}` },
    body: JSON.stringify({ status: "RESOLVED" }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.ticket.status, "RESOLVED");
});
