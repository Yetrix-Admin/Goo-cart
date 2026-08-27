import { env } from "cloudflare:workers";
import { createSession, defaultRoleForEmail, sessionCookieHeader, verifyOtp } from "../../../../../db/auth";
import { api, EMAIL_RE, PHONE_RE } from "../../../../../db/http";
import { runMigrations } from "../../../../../db/migrations";

type UserRow = { id: string; email: string; name: string; role: string; status: string };

export async function POST(request: Request) {
  try {
    await runMigrations(env.DB);
    const body = (await request.json()) as Record<string, unknown>;
    const identifier = String(body.identifier || "").trim().toLowerCase();
    const purpose = String(body.purpose || "");
    const code = String(body.code || "").trim();
    const name = String(body.name || "").trim();
    if (purpose !== "SIGNUP" && purpose !== "LOGIN") return api({ code: "INVALID_PURPOSE", message: "Invalid OTP purpose" }, 400);
    if (!EMAIL_RE.test(identifier) && !PHONE_RE.test(identifier))
      return api({ code: "INVALID_IDENTIFIER", message: "Enter a valid email or phone number" }, 400);
    if (!/^[0-9]{6}$/.test(code)) return api({ code: "INVALID_CODE", message: "Enter the 6-digit code" }, 400);

    const isEmail = EMAIL_RE.test(identifier);
    const column = isEmail ? "email" : "phone";

    if (!(await verifyOtp(env.DB, identifier, purpose as "SIGNUP" | "LOGIN", code)))
      return api({ code: "INVALID_OTP", message: "That code is incorrect or has expired" }, 401);

    let user = await env.DB.prepare(`SELECT id,email,name,role,status FROM users WHERE ${column}=?`).bind(identifier).first<UserRow>();

    if (purpose === "SIGNUP") {
      if (user) return api({ code: "ACCOUNT_EXISTS", message: "An account already exists — sign in instead" }, 409);
      if (name.length < 2) return api({ code: "INVALID_NAME", message: "Enter your full name" }, 400);
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const role = isEmail ? defaultRoleForEmail(identifier) : "CUSTOMER";
      await env.DB
        .prepare(
          `INSERT INTO users(id,email,phone,name,role,status,${isEmail ? "email_verified_at" : "phone_verified_at"},created_at,updated_at)
           VALUES (?,?,?,?,?,'ACTIVE',?,?,?)`,
        )
        .bind(id, isEmail ? identifier : `pending-${id}@goocart.local`, isEmail ? null : identifier, name, role, now, now, now)
        .run();
      user = { id, email: isEmail ? identifier : `pending-${id}@goocart.local`, name, role, status: "ACTIVE" };
    } else {
      if (!user) return api({ code: "ACCOUNT_NOT_FOUND", message: "No account found — sign up instead" }, 404);
      if (user.status !== "ACTIVE") return api({ code: "ACCOUNT_DISABLED", message: "This account is not active" }, 403);
      await env.DB
        .prepare(`UPDATE users SET last_login_at=?, ${isEmail ? "email_verified_at" : "phone_verified_at"}=COALESCE(${isEmail ? "email_verified_at" : "phone_verified_at"}, ?) WHERE id=?`)
        .bind(new Date().toISOString(), new Date().toISOString(), user.id)
        .run();
    }

    const token = await createSession(env.DB, user.id, {
      ip: request.headers.get("cf-connecting-ip"),
      userAgent: request.headers.get("user-agent"),
    });
    return new Response(JSON.stringify({ success: true, data: user, message: "Signed in" }), {
      status: 200,
      headers: { "content-type": "application/json", "set-cookie": sessionCookieHeader(token, request.url) },
    });
  } catch (error) {
    return api({ code: "OTP_VERIFY_FAILED", message: error instanceof Error ? error.message : "Could not verify code" }, 500);
  }
}
