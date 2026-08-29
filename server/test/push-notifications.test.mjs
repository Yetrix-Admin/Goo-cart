import assert from "node:assert/strict";
import test from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";

test("push device registration is scoped to the authenticated user and validates appType", async (t) => {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = "goocart-push-registration-test";
  process.env.AWS_LAMBDA_FUNCTION_NAME = "test";

  const [{ default: app }, { connectDb, disconnectDb }, { User, DeviceToken }, { hashPassword }] = await Promise.all([
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

  const [customerA, customerB] = await Promise.all([
    User.create({
      email: "device-a@push.test",
      name: "Device Owner A",
      role: "CUSTOMER",
      status: "ACTIVE",
      passwordHash: await hashPassword("PushPass123!"),
    }),
    User.create({
      email: "device-b@push.test",
      name: "Device Owner B",
      role: "CUSTOMER",
      status: "ACTIVE",
      passwordHash: await hashPassword("PushPass123!"),
    }),
  ]);

  const [loginA, loginB] = await Promise.all([
    request("/api/v1/auth/token", { method: "POST", body: { mode: "login", identifier: customerA.email, password: "PushPass123!" } }),
    request("/api/v1/auth/token", { method: "POST", body: { mode: "login", identifier: customerB.email, password: "PushPass123!" } }),
  ]);
  assert.equal(loginA.status, 200, JSON.stringify(loginA.json));
  assert.equal(loginB.status, 200, JSON.stringify(loginB.json));
  const tokenA = loginA.json.data.token;
  const tokenB = loginB.json.data.token;

  // Unauthenticated requests are rejected outright.
  const anon = await request("/api/v1/notifications/register-device", {
    method: "POST",
    body: { token: "ExponentPushToken[anon]", platform: "android", appType: "customer" },
  });
  assert.equal(anon.status, 401);

  // A bogus appType is rejected — the endpoint does not silently accept
  // arbitrary strings for an app association field.
  const badAppType = await request("/api/v1/notifications/register-device", {
    token: tokenA,
    method: "POST",
    body: { token: "ExponentPushToken[bad-app-type]", platform: "android", appType: "not-a-real-app" },
  });
  assert.equal(badAppType.status, 400);
  assert.equal(badAppType.json.error.code, "INVALID_APP_TYPE");

  // Registering a device always attaches it to the authenticated caller —
  // there is no way to pass someone else's userId through the body.
  const deviceToken = "ExponentPushToken[shared-device]";
  const registerA = await request("/api/v1/notifications/register-device", {
    token: tokenA,
    method: "POST",
    body: { token: deviceToken, platform: "android", appType: "customer", userId: String(customerB._id) },
  });
  assert.equal(registerA.status, 200, JSON.stringify(registerA.json));

  let row = await DeviceToken.findOne({ token: deviceToken }).lean();
  assert.equal(String(row.userId), String(customerA._id));
  assert.equal(row.appType, "customer");
  assert.equal(row.active, true);

  // The same physical token re-registering under a different account (e.g.
  // customer B signs into the same phone) reassigns ownership — B's app no
  // longer receives A's pushes.
  const registerB = await request("/api/v1/notifications/register-device", {
    token: tokenB,
    method: "POST",
    body: { token: deviceToken, platform: "android", appType: "customer" },
  });
  assert.equal(registerB.status, 200, JSON.stringify(registerB.json));
  row = await DeviceToken.findOne({ token: deviceToken }).lean();
  assert.equal(String(row.userId), String(customerB._id));

  // Customer A can no longer unregister a token that now belongs to B.
  const unregisterWrongOwner = await request("/api/v1/notifications/unregister-device", {
    token: tokenA,
    method: "POST",
    body: { token: deviceToken },
  });
  assert.equal(unregisterWrongOwner.status, 200);
  row = await DeviceToken.findOne({ token: deviceToken }).lean();
  assert.ok(row, "token must still exist — A's unregister call must not delete B's row");
  assert.equal(String(row.userId), String(customerB._id));

  // The rightful owner can unregister it.
  const unregisterRightOwner = await request("/api/v1/notifications/unregister-device", {
    token: tokenB,
    method: "POST",
    body: { token: deviceToken },
  });
  assert.equal(unregisterRightOwner.status, 200);
  row = await DeviceToken.findOne({ token: deviceToken }).lean();
  assert.equal(row, null);

  // A user only ever sees their own in-app notification history.
  const notificationsAnon = await request("/api/v1/notifications");
  assert.equal(notificationsAnon.status, 401);
});
