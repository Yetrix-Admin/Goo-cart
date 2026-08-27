import { env } from "cloudflare:workers";
import { headers } from "next/headers";

export type Actor = { id: string; email: string; name: string; role: string; status: string };

const ADMIN_ROLES = ["SUPER_ADMIN", "OPERATIONS_ADMIN", "FINANCE_ADMIN", "SUPPORT_ADMIN", "MARKETING_ADMIN", "CITY_ADMIN"];

export function canAdmin(user: Actor): boolean {
  return ADMIN_ROLES.includes(user.role);
}
export function canVendor(user: Actor): boolean {
  return ["VENDOR_OWNER", "VENDOR_MANAGER"].includes(user.role);
}
export function canPartner(user: Actor): boolean {
  return user.role === "DELIVERY_PARTNER";
}

// New signups always start as CUSTOMER unless their email matches one of these
// operator-configured allowlists. Real vendor/delivery-partner accounts should
// go through the onboarding + admin approval flows (a later phase); this is a
// bootstrap mechanism for standing up the first admins/vendors/partners.
export function defaultRoleForEmail(email: string): string {
  const normalized = email.toLowerCase();
  if (envList("ADMIN_USER_EMAILS").includes(normalized)) return "SUPER_ADMIN";
  if (envList("VENDOR_USER_EMAILS").includes(normalized)) return "VENDOR_OWNER";
  if (envList("PARTNER_USER_EMAILS").includes(normalized)) return "DELIVERY_PARTNER";
  return "CUSTOMER";
}

function envList(key: string): string[] {
  const value = (env as unknown as Record<string, unknown>)[key];
  return typeof value === "string" ? value.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean) : [];
}

const SESSION_COOKIE = "goocart_session";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const OTP_TTL_SECONDS = 5 * 60;
const OTP_MAX_ATTEMPTS = 5;
const PBKDF2_ITERATIONS = 100_000;

// --- password hashing (PBKDF2 via Web Crypto; available in the Workers runtime,
// unlike bcrypt/argon2 native bindings) ---------------------------------------

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await deriveBits(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(salt)}$${toHex(bits)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  const salt = fromHex(parts[2]);
  if (!Number.isFinite(iterations) || !salt) return false;
  const bits = await deriveBits(password, salt, iterations);
  return timingSafeEqual(toHex(bits), parts[3]);
}

async function deriveBits(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256);
  return new Uint8Array(bits);
}

// --- sessions ------------------------------------------------------------

export async function createSession(
  db: D1Database,
  userId: string,
  meta: { ip: string | null; userAgent: string | null },
): Promise<string> {
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
  await db
    .prepare(
      "INSERT INTO sessions(id,user_id,token_hash,created_at,expires_at,ip,user_agent) VALUES (?,?,?,?,?,?,?)",
    )
    .bind(crypto.randomUUID(), userId, await sha256Hex(token), now.toISOString(), expiresAt.toISOString(), meta.ip, meta.userAgent)
    .run();
  return token;
}

export async function revokeCurrentSession(db: D1Database): Promise<void> {
  const token = await readSessionCookie();
  if (!token) return;
  await db
    .prepare("UPDATE sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL")
    .bind(new Date().toISOString(), await sha256Hex(token))
    .run();
}

export async function getSessionUser(db: D1Database): Promise<Actor | null> {
  const token = (await readBearerToken()) ?? (await readSessionCookie());
  if (!token) return null;
  return resolveSessionToken(db, token);
}

// Native clients can't hold an HttpOnly cookie, so they present the same
// opaque session token as `Authorization: Bearer <token>`. Both paths hit the
// identical sessions row — revoking a session kills web and mobile alike.
async function readBearerToken(): Promise<string | null> {
  const requestHeaders = await headers();
  const authorization = requestHeaders.get("authorization");
  if (!authorization) return null;
  const [scheme, ...rest] = authorization.split(" ");
  if (scheme.toLowerCase() !== "bearer") return null;
  const token = rest.join(" ").trim();
  return token || null;
}

async function resolveSessionToken(db: D1Database, token: string): Promise<Actor | null> {
  const row = await db
    .prepare(
      `SELECT u.id,u.email,u.name,u.role,u.status FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at > ?`,
    )
    .bind(await sha256Hex(token), new Date().toISOString())
    .first<Actor>();
  return row ?? null;
}

async function readSessionCookie(): Promise<string | null> {
  const requestHeaders = await headers();
  const cookieHeader = requestHeaders.get("cookie");
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function sessionCookieHeader(token: string, requestUrl: string): string {
  const secure = requestUrl.startsWith("https://") ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}

export function clearSessionCookieHeader(requestUrl: string): string {
  const secure = requestUrl.startsWith("https://") ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

// --- OTP -------------------------------------------------------------------

export type OtpPurpose = "SIGNUP" | "LOGIN";

export async function requestOtp(db: D1Database, identifier: string, purpose: OtpPurpose): Promise<string> {
  const recent = await db
    .prepare(
      "SELECT COUNT(*) AS count FROM otp_codes WHERE identifier=? AND purpose=? AND created_at > ?",
    )
    .bind(identifier, purpose, new Date(Date.now() - 10 * 60 * 1000).toISOString())
    .first<{ count: number }>();
  if ((recent?.count ?? 0) >= 5) throw new Error("Too many codes requested. Try again later.");

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const now = new Date();
  await db
    .prepare(
      "INSERT INTO otp_codes(id,identifier,purpose,code_hash,attempts,expires_at,created_at) VALUES (?,?,?,?,0,?,?)",
    )
    .bind(
      crypto.randomUUID(),
      identifier,
      purpose,
      await sha256Hex(code),
      new Date(now.getTime() + OTP_TTL_SECONDS * 1000).toISOString(),
      now.toISOString(),
    )
    .run();
  await sendOtp(identifier, code);
  return code;
}

export async function verifyOtp(db: D1Database, identifier: string, purpose: OtpPurpose, code: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT id,code_hash,attempts,expires_at FROM otp_codes
       WHERE identifier=? AND purpose=? AND consumed_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(identifier, purpose)
    .first<{ id: string; code_hash: string; attempts: number; expires_at: string }>();
  if (!row) return false;
  if (row.attempts >= OTP_MAX_ATTEMPTS) return false;
  if (new Date(row.expires_at).getTime() < Date.now()) return false;

  const matches = timingSafeEqual(await sha256Hex(code), row.code_hash);
  if (!matches) {
    await db.prepare("UPDATE otp_codes SET attempts=attempts+1 WHERE id=?").bind(row.id).run();
    return false;
  }
  await db.prepare("UPDATE otp_codes SET consumed_at=? WHERE id=?").bind(new Date().toISOString(), row.id).run();
  return true;
}

// OTP delivery is a real one-time-code system (random, hashed, expiring, rate
// limited, single-use) but sending real SMS/email requires a paid provider
// (Twilio, SES, etc.) this environment has no credentials for. Until such a
// provider is configured, codes are written to the Worker log only — this is a
// clearly-labeled development fallback, never a faked "delivered" response.
async function sendOtp(identifier: string, code: string): Promise<void> {
  console.log(`[DEV OTP] ${identifier} -> ${code} (no SMS/email provider configured)`);
}

// --- permissions -------------------------------------------------------------

export async function hasPermission(db: D1Database, role: string, permissionId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 FROM role_permissions WHERE role_id=? AND permission_id=?")
    .bind(role, permissionId)
    .first();
  return Boolean(row);
}

// --- crypto helpers ------------------------------------------------------

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return toHex(new Uint8Array(digest));
}

function toHex(bytes: Uint8Array<ArrayBuffer>): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function toBase64Url(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
