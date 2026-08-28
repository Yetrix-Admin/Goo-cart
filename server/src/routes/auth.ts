import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { User } from "../models.js";
import {
  consumeOtp,
  createSession,
  defaultRoleForEmail,
  clearSessionCookie,
  hashPassword,
  issueOtp,
  revokeAllSessions,
  revokeSession,
  sessionTokenFromRequest,
  setSessionCookie,
  verifyPassword,
  requireAuth,
  type AuthedRequest,
} from "../lib/auth.js";
import { ok, fail, EMAIL_RE, PHONE_RE } from "../lib/http.js";

export const authRouter = Router();

const USERNAME_RE = /^[a-z0-9_.]{3,30}$/;

// Real IP-based limits, on top of issueOtp()'s own per-identifier cooldown/
// window — this stops one IP from hammering the endpoint across many
// different email addresses to burn through Gmail's sending quota.
const otpRequestLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });
const otpVerifyLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 40, standardHeaders: true, legacyHeaders: false });
const passwordResetLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });
const authAttemptLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });

const publicUser = (u: any) => ({
  id: String(u._id),
  email: u.email,
  username: u.username ?? null,
  phone: u.phone ?? null,
  name: u.name,
  role: u.role,
  status: u.status,
  // Only meaningful for Vendor App / Delivery Partner App logins; harmless
  // (and ignored) for a Customer App session.
  vendorId: u.vendorId ? String(u.vendorId) : null,
  vendorPermissions: u.vendorPermissions ?? [],
  staffTitle: u.staffTitle ?? null,
  partnerApprovalStatus: u.partnerApprovalStatus ?? null,
});

async function handleSignup(req: Request, res: Response) {
  try {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const username = String(req.body?.username ?? "").trim().toLowerCase();
    const password = String(req.body?.password ?? "");
    const name = String(req.body?.name ?? "").trim();
    // Optional here — the Customer app's own signup form requires it and
    // validates before ever calling this route, but the admin web portal's
    // signup (app/page.tsx, same route) has never collected a phone number,
    // and must keep working unchanged.
    const phone = req.body?.phone !== undefined ? String(req.body.phone).trim() : undefined;

    if (!EMAIL_RE.test(email)) return res.status(400).json(fail("INVALID_EMAIL", "Enter a valid email address"));
    if (username && !USERNAME_RE.test(username)) return res.status(400).json(fail("INVALID_USERNAME", "Use 3–30 lowercase letters, numbers, dots or underscores for username"));
    if (phone && !PHONE_RE.test(phone)) return res.status(400).json(fail("INVALID_PHONE", "Enter a valid mobile number"));
    if (password.length < 8) return res.status(400).json(fail("WEAK_PASSWORD", "Password must be at least 8 characters"));
    if (name.length < 2) return res.status(400).json(fail("INVALID_NAME", "Enter your full name"));
    if (await User.exists({ email })) return res.status(409).json(fail("EMAIL_TAKEN", "An account with this email already exists"));
    if (username && (await User.exists({ username }))) return res.status(409).json(fail("USERNAME_TAKEN", "This username is already taken"));
    if (phone && (await User.exists({ phone }))) return res.status(409).json(fail("PHONE_TAKEN", "An account with this mobile number already exists"));

    const user = await User.create({ email, ...(username ? { username } : {}), ...(phone ? { phone } : {}), name, passwordHash: await hashPassword(password), role: defaultRoleForEmail(email), status: "ACTIVE" });
    const token = await createSession(user._id, { ip: req.ip, userAgent: req.header("user-agent") });
    setSessionCookie(res, token);
    res.json(ok({ user: publicUser(user), token }, "Account created"));
  } catch (e) {
    res.status(500).json(fail("SIGNUP_FAILED", e instanceof Error ? e.message : "Signup failed"));
  }
}

async function handleLogin(req: Request, res: Response) {
  try {
    const identifier = String(req.body?.identifier ?? req.body?.email ?? "").trim().toLowerCase();
    const password = String(req.body?.password ?? "");
    const isIdentifier = EMAIL_RE.test(identifier) || PHONE_RE.test(identifier) || USERNAME_RE.test(identifier);
    if (!isIdentifier || !password) return res.status(400).json(fail("INVALID_CREDENTIALS", "Enter your email, phone or username and password"));

    const user: any = await User.findOne({ $or: [{ email: identifier }, { phone: identifier }, { username: identifier }] });
    // Same generic message whether the account is missing or the password is
    // wrong, so the endpoint can't be used to enumerate registered emails.
    if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      return res.status(401).json(fail("INVALID_CREDENTIALS", "Incorrect email, phone, username or password"));
    }
    if (user.status !== "ACTIVE") return res.status(403).json(fail("ACCOUNT_DISABLED", "This account is not active"));

    // Transparently upgrade a migrated D1 PBKDF2 password after it has been
    // proven correct. No reset is required and future logins use bcrypt.
    if (user.passwordHash.startsWith("pbkdf2$")) user.passwordHash = await hashPassword(password);
    user.lastLoginAt = new Date();
    await user.save();
    const token = await createSession(user._id, { ip: req.ip, userAgent: req.header("user-agent") });
    setSessionCookie(res, token);
    res.json(ok({ user: publicUser(user), token }, "Signed in"));
  } catch (e) {
    res.status(500).json(fail("LOGIN_FAILED", e instanceof Error ? e.message : "Sign in failed"));
  }
}

authRouter.post("/signup", authAttemptLimiter, handleSignup);
authRouter.post("/login", authAttemptLimiter, handleLogin);

authRouter.post("/otp/request", otpRequestLimiter, async (req, res) => {
  try {
    const identifier = String(req.body?.identifier ?? "").trim().toLowerCase();
    const purpose = String(req.body?.purpose ?? "");
    if (purpose !== "SIGNUP" && purpose !== "LOGIN") return res.status(400).json(fail("INVALID_PURPOSE", "Invalid OTP purpose"));
    if (!EMAIL_RE.test(identifier) && !PHONE_RE.test(identifier)) {
      return res.status(400).json(fail("INVALID_IDENTIFIER", "Enter a valid email or phone number"));
    }

    const field = EMAIL_RE.test(identifier) ? "email" : "phone";
    const existing = await User.findOne({ [field]: identifier }).lean();
    if (purpose === "SIGNUP" && existing) return res.status(409).json(fail("ACCOUNT_EXISTS", "An account already exists — sign in instead"));
    if (purpose === "LOGIN" && !existing) return res.status(404).json(fail("ACCOUNT_NOT_FOUND", "No account found — sign up instead"));

    const result = await issueOtp(identifier, purpose);
    if (!result.ok) return res.status(429).json(fail(result.code, result.message));

    // Never claim delivery that did not happen. In development the code is in
    // the server log; the client shows that instead of a false success.
    res.json(
      ok(
        { identifier, delivered: result.delivered },
        result.delivered ? "Verification code sent" : `${result.reason ?? "Code not delivered"} — check the server log for the code`,
      ),
    );
  } catch (e) {
    res.status(500).json(fail("OTP_REQUEST_FAILED", e instanceof Error ? e.message : "Could not send code"));
  }
});

authRouter.post("/otp/verify", otpVerifyLimiter, async (req, res) => {
  try {
    const identifier = String(req.body?.identifier ?? "").trim().toLowerCase();
    const purpose = String(req.body?.purpose ?? "");
    const code = String(req.body?.code ?? "").trim();
    const name = String(req.body?.name ?? "").trim();

    if (!/^[0-9]{6}$/.test(code)) return res.status(400).json(fail("INVALID_CODE", "Enter the 6-digit code"));
    if (!(await consumeOtp(identifier, purpose, code))) return res.status(401).json(fail("INVALID_OTP", "That code is incorrect or has expired"));

    const isEmail = EMAIL_RE.test(identifier);
    const field = isEmail ? "email" : "phone";
    let user: any = await User.findOne({ [field]: identifier });

    if (purpose === "SIGNUP") {
      if (user) return res.status(409).json(fail("ACCOUNT_EXISTS", "An account already exists — sign in instead"));
      if (name.length < 2) return res.status(400).json(fail("INVALID_NAME", "Enter your full name"));
      user = await User.create({
        email: isEmail ? identifier : `pending-${Date.now()}@goocart.local`,
        ...(!isEmail ? { phone: identifier } : {}),
        name,
        role: isEmail ? defaultRoleForEmail(identifier) : "CUSTOMER",
        status: "ACTIVE",
        [isEmail ? "emailVerifiedAt" : "phoneVerifiedAt"]: new Date(),
      });
    } else {
      if (!user) return res.status(404).json(fail("ACCOUNT_NOT_FOUND", "No account found — sign up instead"));
      if (user.status !== "ACTIVE") return res.status(403).json(fail("ACCOUNT_DISABLED", "This account is not active"));
      user.lastLoginAt = new Date();
      await user.save();
    }

    const token = await createSession(user._id, { ip: req.ip, userAgent: req.header("user-agent") });
    setSessionCookie(res, token);
    res.json(ok({ user: publicUser(user), token }, "Signed in"));
  } catch (e) {
    res.status(500).json(fail("OTP_VERIFY_FAILED", e instanceof Error ? e.message : "Could not verify code"));
  }
});

// --- Password reset (email OTP) --------------------------------------------
// Deliberately its own purpose ("PASSWORD_RESET") and its own pair of
// routes, distinct from /otp/request+/otp/verify — a reset code must never
// be usable to sign in, and a login/signup code must never be usable to
// change a password. Kept as separate purpose values inside the same
// issueOtp()/consumeOtp() machinery rather than a parallel implementation.

authRouter.post("/password/reset-request", passwordResetLimiter, async (req, res) => {
  try {
    const identifier = String(req.body?.identifier ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(identifier) && !PHONE_RE.test(identifier)) {
      return res.status(400).json(fail("INVALID_IDENTIFIER", "Enter a valid email or phone number"));
    }

    const field = EMAIL_RE.test(identifier) ? "email" : "phone";
    const existing: any = await User.findOne({ [field]: identifier }).lean();
    // Same response whether or not the account exists (and whether it's
    // active) so this endpoint can't be used to enumerate registered
    // accounts or find out which ones are disabled.
    if (existing && existing.status === "ACTIVE") {
      const result = await issueOtp(identifier, "PASSWORD_RESET");
      if (!result.ok) return res.status(429).json(fail(result.code, result.message));
    }
    res.json(ok({ identifier }, "If that account exists, a reset code has been sent."));
  } catch (e) {
    res.status(500).json(fail("PASSWORD_RESET_REQUEST_FAILED", e instanceof Error ? e.message : "Could not process this request"));
  }
});

authRouter.post("/password/reset-confirm", passwordResetLimiter, async (req, res) => {
  try {
    const identifier = String(req.body?.identifier ?? "").trim().toLowerCase();
    const code = String(req.body?.code ?? "").trim();
    const newPassword = String(req.body?.newPassword ?? "");

    if (!/^[0-9]{6}$/.test(code)) return res.status(400).json(fail("INVALID_CODE", "Enter the 6-digit code"));
    if (newPassword.length < 8) return res.status(400).json(fail("WEAK_PASSWORD", "Password must be at least 8 characters"));
    if (!(await consumeOtp(identifier, "PASSWORD_RESET", code))) return res.status(401).json(fail("INVALID_OTP", "That code is incorrect or has expired"));

    const field = EMAIL_RE.test(identifier) ? "email" : "phone";
    const user: any = await User.findOne({ [field]: identifier });
    if (!user) return res.status(404).json(fail("ACCOUNT_NOT_FOUND", "No account found for this identifier"));
    if (user.status !== "ACTIVE") return res.status(403).json(fail("ACCOUNT_DISABLED", "This account is not active"));

    user.passwordHash = await hashPassword(newPassword);
    await user.save();
    // A stolen session should not survive its owner resetting the password.
    await revokeAllSessions(user._id);

    const token = await createSession(user._id, { ip: req.ip, userAgent: req.header("user-agent") });
    setSessionCookie(res, token);
    res.json(ok({ user: publicUser(user), token }, "Password updated"));
  } catch (e) {
    res.status(500).json(fail("PASSWORD_RESET_FAILED", e instanceof Error ? e.message : "Could not reset your password"));
  }
});

// The mobile client uses a single token endpoint with a `mode` discriminator
// rather than separate /signup and /login paths. Kept as a thin adapter so the
// app needs no changes when the backend moved from D1 to MongoDB.
authRouter.post("/token", async (req, res) => {
  const mode = String(req.body?.mode ?? "");
  if (mode === "signup") return handleSignup(req, res);
  if (mode === "login") return handleLogin(req, res);
  res.status(400).json(fail("INVALID_MODE", "mode must be 'signup' or 'login'"));
});

authRouter.get("/me", requireAuth, (req: AuthedRequest, res) => res.json(ok({ user: publicUser(req.user) })));

authRouter.post("/logout", async (req, res) => {
  const token = sessionTokenFromRequest(req);
  if (token) await revokeSession(token);
  clearSessionCookie(res);
  res.json(ok(null, "Signed out"));
});
