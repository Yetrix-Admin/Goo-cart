import assert from "node:assert/strict";
import test from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";

test("admin audit logs redact sensitive account, bank, token and key fields", async (t) => {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = "goocart-audit-redaction-test";
  process.env.AWS_LAMBDA_FUNCTION_NAME = "test";
  process.env.ADMIN_USER_EMAILS = "admin@audit.test";

  const [{ default: app }, { connectDb, disconnectDb }, { AuditLog }] = await Promise.all([
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

  async function request(path, { token, method = "GET", body, requestId } = {}) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(requestId ? { "x-request-id": requestId } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, json: await response.json() };
  }

  const adminSignup = await request("/api/v1/auth/token", {
    method: "POST",
    body: { mode: "signup", email: "admin@audit.test", name: "Audit Admin", password: "AuditPass#2026" },
  });
  assert.equal(adminSignup.status, 200, JSON.stringify(adminSignup.json));
  const token = adminSignup.json.data.token;

  const create = await request("/api/v1/admin/restaurants", {
    token,
    method: "POST",
    requestId: "audit-redaction-create",
    body: {
      name: "Sensitive Audit Kitchen",
      ownerName: "Sensitive Owner",
      ownerEmail: "owner@audit.test",
      initialPassword: "OwnerSecret123!",
      area: "Audit Area",
      latitude: 17.4368,
      longitude: 81.2668,
      bankDetails: {
        accountNumber: "1234567890",
        ifsc: "TEST0001234",
        apiKey: "should-not-appear",
      },
    },
  });
  assert.equal(create.status, 200, JSON.stringify(create.json));

  const restaurantId = create.json.data.restaurant.id;
  const edit = await request(`/api/v1/admin/restaurants/${restaurantId}`, {
    token,
    method: "PATCH",
    requestId: "audit-redaction-edit",
    body: {
      bankDetails: {
        accountNumber: "9999999999",
        ifsc: "TEST0009999",
        card: { last4: "4242", cvv: "123" },
      },
    },
  });
  assert.equal(edit.status, 200, JSON.stringify(edit.json));

  const logs = await AuditLog.find().sort({ createdAt: 1 }).lean();
  assert.ok(logs.length >= 2);
  const serialized = JSON.stringify(logs);

  for (const sensitive of ["OwnerSecret123!", "1234567890", "9999999999", "TEST0001234", "TEST0009999", "should-not-appear", "4242", "123"]) {
    assert.equal(serialized.includes(sensitive), false, `${sensitive} leaked into audit logs`);
  }
  assert.equal(serialized.includes("[REDACTED]"), true);
  assert.ok(logs.some((log) => log.requestId === "audit-redaction-create"));
  assert.ok(logs.some((log) => log.changedFields?.includes("bankDetails.accountNumber")));
});
