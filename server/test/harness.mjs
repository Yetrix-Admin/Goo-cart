// Shared setup for integration tests: a real in-memory MongoDB replica set
// (so multi-document transactions work exactly like they do against Atlas),
// the real compiled Express app on an ephemeral port, and a couple of thin
// helpers so each test file stays focused on the behaviour it's proving
// rather than plumbing. No mocks — every request in these tests goes through
// the actual HTTP layer and the actual database driver.

import http from "node:http";
import { MongoMemoryReplSet } from "mongodb-memory-server";

let replSet;
let server;
let baseUrl;

export async function startTestServer() {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await replSet.waitUntilRunning();

  process.env.MONGODB_URI = replSet.getUri();
  process.env.MONGODB_DB = "goocart_test";
  // Prevents server/src/index.ts from also calling httpServer.listen() on the
  // configured PORT — we bind our own ephemeral port below instead.
  process.env.VERCEL = "1";
  process.env.RESEND_API_KEY = ""; // force the console-fallback email path, never a real send

  const [{ default: app }, { connectDb }] = await Promise.all([import("../dist/index.js"), import("../dist/lib/db.js")]);
  // VERCEL=1 makes index.ts treat this as serverless, which skips its own
  // eager connectDb() call (and its httpServer.listen()) — the Express
  // middleware would still connect lazily on the first request, but that
  // would race the first test request rather than guaranteeing readiness.
  await connectDb();

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;

  const mongoose = (await import("mongoose")).default;
  return { baseUrl, mongoose };
}

export async function stopTestServer() {
  await new Promise((resolve) => server?.close(resolve));
  const mongoose = (await import("mongoose")).default;
  await mongoose.disconnect();
  await replSet?.stop();
}

export function getBaseUrl() {
  return baseUrl;
}

async function json(res) {
  const body = await res.json();
  return { status: res.status, body };
}

export async function apiPost(path, body, token) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  return json(res);
}

export async function apiGet(path, token) {
  const res = await fetch(`${baseUrl}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  return json(res);
}

let signupCounter = 0;

/** Real signup through the real auth route — returns { user, token }. */
export async function signupUser(namePrefix = "Test User") {
  signupCounter += 1;
  const email = `${namePrefix.toLowerCase().replace(/\s+/g, ".")}.${Date.now()}.${signupCounter}@test.goocart.local`;
  const { status, body } = await apiPost("/api/v1/auth/signup", { email, password: "TestPass123!", name: namePrefix });
  if (status !== 200) throw new Error(`signup failed: ${JSON.stringify(body)}`);
  return { user: body.data.user, token: body.data.token, email };
}
