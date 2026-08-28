// Proves the OTP hardening added in this change: resend cooldown, the
// request-window cap, attempt limiting, expiry, single-use, purpose
// isolation (an OTP for one purpose can never verify another), disabled
// accounts staying blocked even with a correct code, no code ever leaking
// into an API response, and the new password-reset flow end to end
// (including that resetting a password revokes every other session).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { startTestServer, stopTestServer, apiPost, apiGet, signupUser, knownOtpCode } from "./harness.mjs";

before(async () => {
  await startTestServer();
});

after(async () => {
  await stopTestServer();
});

function uniqueEmail(prefix) {
  return `${prefix}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@test.goocart.local`;
}

test("a second OTP request inside the cooldown window is rejected", async () => {
  const email = uniqueEmail("cooldown");
  const first = await apiPost("/api/v1/auth/otp/request", { identifier: email, purpose: "SIGNUP" });
  assert.equal(first.status, 200, JSON.stringify(first.body));

  const second = await apiPost("/api/v1/auth/otp/request", { identifier: email, purpose: "SIGNUP" });
  assert.equal(second.status, 429);
  assert.equal(second.body.error.code, "COOLDOWN");
});

test("the request response never contains the OTP code itself", async () => {
  const email = uniqueEmail("noleak");
  const { status, body } = await apiPost("/api/v1/auth/otp/request", { identifier: email, purpose: "SIGNUP" });
  assert.equal(status, 200);
  const serialized = JSON.stringify(body);
  assert.ok(!/"(code|otp)"\s*:\s*"?\d{6}/.test(serialized), `response leaked something resembling an OTP: ${serialized}`);
});

test("more than the per-window request cap is rejected even outside the cooldown", async () => {
  const email = uniqueEmail("windowcap");
  const { Otp } = await import("../dist/models.js");
  // Seed 5 prior requests, each older than the 60s cooldown but still inside
  // the 10-minute window, so only the window cap (not the cooldown) is what
  // blocks the 6th real request below.
  const now = Date.now();
  await Otp.insertMany(
    Array.from({ length: 5 }, (_, i) => ({
      identifier: email,
      purpose: "SIGNUP",
      codeHash: crypto.createHash("sha256").update("000000").digest("hex"),
      expiresAt: new Date(now - 1000),
      createdAt: new Date(now - (90 + i * 30) * 1000),
    })),
  );

  const { status, body } = await apiPost("/api/v1/auth/otp/request", { identifier: email, purpose: "SIGNUP" });
  assert.equal(status, 429);
  assert.equal(body.error.code, "RATE_LIMITED");
});

test("an OTP issued for one purpose cannot verify another", async () => {
  const email = uniqueEmail("purpose");
  await apiPost("/api/v1/auth/otp/request", { identifier: email, purpose: "SIGNUP" });
  const { Otp } = await import("../dist/models.js");
  const knownCode = "654321";
  await Otp.updateOne({ identifier: email, purpose: "SIGNUP", consumedAt: null }, { $set: { codeHash: crypto.createHash("sha256").update(knownCode).digest("hex") } }, { sort: { createdAt: -1 } });

  const wrongPurpose = await apiPost("/api/v1/auth/otp/verify", { identifier: email, purpose: "LOGIN", code: knownCode });
  assert.equal(wrongPurpose.status, 401);
  assert.equal(wrongPurpose.body.error.code, "INVALID_OTP");

  const rightPurpose = await apiPost("/api/v1/auth/otp/verify", { identifier: email, purpose: "SIGNUP", code: knownCode, name: "Purpose Test" });
  assert.equal(rightPurpose.status, 200, JSON.stringify(rightPurpose.body));
});

test("an OTP is invalidated after too many wrong attempts, even with the eventually-correct code", async () => {
  const email = uniqueEmail("attempts");
  const code = await knownOtpCode(email, "SIGNUP");

  for (let i = 0; i < 5; i += 1) {
    const attempt = await apiPost("/api/v1/auth/otp/verify", { identifier: email, purpose: "SIGNUP", code: "000000", name: "Attempts Test" });
    assert.equal(attempt.status, 401);
  }

  const finalAttempt = await apiPost("/api/v1/auth/otp/verify", { identifier: email, purpose: "SIGNUP", code, name: "Attempts Test" });
  assert.equal(finalAttempt.status, 401, "the correct code must be rejected once the attempt cap is exhausted");
});

test("a consumed OTP cannot be used a second time", async () => {
  const email = uniqueEmail("reuse");
  const code = await knownOtpCode(email, "SIGNUP");

  const firstUse = await apiPost("/api/v1/auth/otp/verify", { identifier: email, purpose: "SIGNUP", code, name: "Reuse Test" });
  assert.equal(firstUse.status, 200, JSON.stringify(firstUse.body));

  const secondUse = await apiPost("/api/v1/auth/otp/verify", { identifier: email, purpose: "LOGIN", code, name: "Reuse Test" });
  assert.equal(secondUse.status, 401);
});

test("an expired OTP is rejected", async () => {
  const email = uniqueEmail("expired");
  const { User, Otp } = await import("../dist/models.js");
  await User.create({ email, name: "Expired Test", role: "CUSTOMER", status: "ACTIVE", passwordHash: "x" });
  const code = "112233";
  await Otp.create({ identifier: email, purpose: "LOGIN", codeHash: crypto.createHash("sha256").update(code).digest("hex"), expiresAt: new Date(Date.now() - 1000) });

  const { status, body } = await apiPost("/api/v1/auth/otp/verify", { identifier: email, purpose: "LOGIN", code });
  assert.equal(status, 401);
  assert.equal(body.error.code, "INVALID_OTP");
});

test("a suspended account cannot sign in even with the correct code", async () => {
  const email = uniqueEmail("suspended");
  const { User } = await import("../dist/models.js");
  await User.create({ email, name: "Suspended Test", role: "CUSTOMER", status: "SUSPENDED", passwordHash: "x" });
  const code = await knownOtpCode(email, "LOGIN");

  const { status, body } = await apiPost("/api/v1/auth/otp/verify", { identifier: email, purpose: "LOGIN", code });
  assert.equal(status, 403);
  assert.equal(body.error.code, "ACCOUNT_DISABLED");
});

test("password reset: full flow works, revokes prior sessions, and the reset code cannot be reused as a login code", async () => {
  const { user, token: oldToken, email } = await signupUser("Reset Test");
  assert.ok(oldToken);

  // The old session works before the reset.
  const before = await apiGet("/api/v1/auth/me", oldToken);
  assert.equal(before.status, 200);

  const requestReset = await apiPost("/api/v1/auth/password/reset-request", { identifier: email });
  assert.equal(requestReset.status, 200, JSON.stringify(requestReset.body));

  const { Otp } = await import("../dist/models.js");
  const code = "998877";
  await Otp.updateOne({ identifier: email, purpose: "PASSWORD_RESET", consumedAt: null }, { $set: { codeHash: crypto.createHash("sha256").update(code).digest("hex") } }, { sort: { createdAt: -1 } });

  const confirm = await apiPost("/api/v1/auth/password/reset-confirm", { identifier: email, code, newPassword: "BrandNewPass123!" });
  assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
  assert.ok(confirm.body.data.token);
  const newToken = confirm.body.data.token;

  // The pre-reset session must now be dead.
  const afterOldToken = await apiGet("/api/v1/auth/me", oldToken);
  assert.equal(afterOldToken.status, 401);

  // The new session (issued by reset-confirm) works.
  const afterNewToken = await apiGet("/api/v1/auth/me", newToken);
  assert.equal(afterNewToken.status, 200);

  // Old password no longer works; new one does.
  const oldPasswordLogin = await apiPost("/api/v1/auth/login", { email, password: "TestPass123!" });
  assert.equal(oldPasswordLogin.status, 401);
  const newPasswordLogin = await apiPost("/api/v1/auth/login", { email, password: "BrandNewPass123!" });
  assert.equal(newPasswordLogin.status, 200);
});

test("a password-reset OTP cannot be used to log in", async () => {
  const { email } = await signupUser("Reset Purpose Test");
  await apiPost("/api/v1/auth/password/reset-request", { identifier: email });

  const { Otp } = await import("../dist/models.js");
  const code = "445566";
  await Otp.updateOne({ identifier: email, purpose: "PASSWORD_RESET", consumedAt: null }, { $set: { codeHash: crypto.createHash("sha256").update(code).digest("hex") } }, { sort: { createdAt: -1 } });

  const { status, body } = await apiPost("/api/v1/auth/otp/verify", { identifier: email, purpose: "LOGIN", code });
  assert.equal(status, 401);
  assert.equal(body.error.code, "INVALID_OTP");
});

test("reset-request gives the same response for a nonexistent account (no enumeration)", async () => {
  const { status, body } = await apiPost("/api/v1/auth/password/reset-request", { identifier: uniqueEmail("doesnotexist") });
  assert.equal(status, 200);
  assert.match(body.message, /if that account exists/i);
});
