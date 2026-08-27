import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { Request, Response, NextFunction } from "express";
import { Otp, Session, User, type UserDoc } from "../models.js";
import { otpEmail, sendEmail } from "./email.js";

const SESSION_TTL_DAYS = 30;
const OTP_TTL_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;

const ADMIN_ROLES = ["SUPER_ADMIN", "OPERATIONS_ADMIN", "FINANCE_ADMIN", "SUPPORT_ADMIN", "MARKETING_ADMIN", "CITY_ADMIN"];

export function canAdmin(u: { role: string }) {
  return ADMIN_ROLES.includes(u.role);
}
export function canVendor(u: { role: string }) {
  return u.role === "VENDOR_OWNER" || u.role === "VENDOR_MANAGER";
}
export function canPartner(u: { role: string }) {
  return u.role === "DELIVERY_PARTNER";
}

export function defaultRoleForEmail(email: string): string {
  const e = email.toLowerCase();
  const list = (k: string) => (process.env[k] ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (list("ADMIN_USER_EMAILS").includes(e)) return "SUPER_ADMIN";
  if (list("VENDOR_USER_EMAILS").includes(e)) return "VENDOR_OWNER";
  if (list("PARTNER_USER_EMAILS").includes(e)) return "DELIVERY_PARTNER";
  return "CUSTOMER";
}

// New passwords use bcrypt. Imported D1 accounts keep their PBKDF2 hash until
// the first successful login, so existing customers are not locked out during
// the database migration.
export const hashPassword = (plain: string) => bcrypt.hash(plain, 12);
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (!hash.startsWith("pbkdf2$")) return bcrypt.compare(plain, hash);

  const [algorithm, iterationsText, saltHex, expectedHex] = hash.split("$");
  const iterations = Number(iterationsText);
  if (
    algorithm !== "pbkdf2" ||
    !Number.isSafeInteger(iterations) ||
    iterations < 1 ||
    !/^[0-9a-f]+$/i.test(saltHex ?? "") ||
    !/^[0-9a-f]+$/i.test(expectedHex ?? "")
  ) {
    return false;
  }

  const expected = Buffer.from(expectedHex, "hex");
  const actual = await new Promise<Buffer>((resolve, reject) => {
    crypto.pbkdf2(plain, Buffer.from(saltHex, "hex"), iterations, expected.length, "sha256", (error, value) => {
      if (error) reject(error);
      else resolve(value);
    });
  });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

export async function createSession(userId: unknown, meta: { ip?: string; userAgent?: string }): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  await Session.create({
    userId,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + SESSION_TTL_DAYS * 86400_000),
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return token;
}

export async function revokeSession(token: string): Promise<void> {
  await Session.updateOne({ tokenHash: sha256(token), revokedAt: null }, { $set: { revokedAt: new Date() } });
}

export function setSessionCookie(res: Response, token: string): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.append(
    "set-cookie",
    `goocart_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_DAYS * 86400}${secure}`,
  );
}

export function clearSessionCookie(res: Response): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.append("set-cookie", `goocart_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}

export async function userFromToken(token: string): Promise<UserDoc | null> {
  const session = await Session.findOne({ tokenHash: sha256(token), revokedAt: null, expiresAt: { $gt: new Date() } }).lean();
  if (!session) return null;
  const user = await User.findById(session.userId).lean<UserDoc>();
  return user && user.status === "ACTIVE" ? user : null;
}

// --- OTP ------------------------------------------------------------------

export type OtpIssueResult = { delivered: boolean; reason?: string };

export async function issueOtp(identifier: string, purpose: string): Promise<OtpIssueResult> {
  const recent = await Otp.countDocuments({ identifier, purpose, createdAt: { $gt: new Date(Date.now() - 10 * 60_000) } });
  if (recent >= 5) throw new Error("Too many codes requested. Try again later.");

  const code = String(Math.floor(100000 + Math.random() * 900000));
  await Otp.create({
    identifier,
    purpose,
    codeHash: sha256(code),
    expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60_000),
  });
  // Phone delivery has no provider yet; only email codes actually go out.
  const isEmail = identifier.includes("@");
  if (!isEmail) {
    console.log(`[DEV OTP — no SMS provider] ${identifier} -> ${code}`);
    return { delivered: false, reason: "SMS delivery is not configured yet" };
  }

  const { subject, html, text } = otpEmail(code);
  const result = await sendEmail(identifier, subject, html, text);
  if (!result.delivered) console.log(`[DEV OTP — email not delivered] ${identifier} -> ${code}`);
  return result;
}

export async function consumeOtp(identifier: string, purpose: string, code: string): Promise<boolean> {
  const doc = await Otp.findOne({ identifier, purpose, consumedAt: null }).sort({ createdAt: -1 });
  if (!doc) return false;
  if (doc.attempts >= OTP_MAX_ATTEMPTS || doc.expiresAt.getTime() < Date.now()) return false;
  if (doc.codeHash !== sha256(code)) {
    doc.attempts += 1;
    await doc.save();
    return false;
  }
  doc.consumedAt = new Date();
  await doc.save();
  return true;
}

// --- Express plumbing ------------------------------------------------------

export type AuthedRequest = Request & { user?: UserDoc };

export function sessionTokenFromRequest(req: Request): string | null {
  const auth = req.header("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim() || null;
  const cookie = req.header("cookie");
  if (cookie) {
    for (const part of cookie.split(";")) {
      const [k, ...rest] = part.trim().split("=");
      if (k === "goocart_session") return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

/** Populates req.user when a valid session is present; never rejects. */
export async function attachUser(req: AuthedRequest, _res: Response, next: NextFunction) {
  try {
    const token = sessionTokenFromRequest(req);
    if (token) req.user = (await userFromToken(token)) ?? undefined;
  } catch {
    /* fall through unauthenticated */
  }
  next();
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ success: false, error: { code: "AUTH_REQUIRED", message: "Sign in to continue" } });
  next();
}

export function requireRole(check: (u: { role: string }) => boolean, message: string) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ success: false, error: { code: "AUTH_REQUIRED", message: "Sign in to continue" } });
    if (!check(req.user)) return res.status(403).json({ success: false, error: { code: "FORBIDDEN", message } });
    next();
  };
}
