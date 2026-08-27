import { env } from "cloudflare:workers";
import { createSession, defaultRoleForEmail, hashPassword, sessionCookieHeader } from "../../../../db/auth";
import { api, EMAIL_RE } from "../../../../db/http";
import { runMigrations } from "../../../../db/migrations";

export async function POST(request: Request) {
  try {
    await runMigrations(env.DB);
    const body = (await request.json()) as Record<string, unknown>;
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const name = String(body.name || "").trim();
    if (!EMAIL_RE.test(email)) return api({ code: "INVALID_EMAIL", message: "Enter a valid email address" }, 400);
    if (password.length < 8) return api({ code: "WEAK_PASSWORD", message: "Password must be at least 8 characters" }, 400);
    if (name.length < 2) return api({ code: "INVALID_NAME", message: "Enter your full name" }, 400);

    const existing = await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first();
    if (existing) return api({ code: "EMAIL_TAKEN", message: "An account with this email already exists" }, 409);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const passwordHash = await hashPassword(password);
    const role = defaultRoleForEmail(email);
    await env.DB
      .prepare(
        "INSERT INTO users(id,email,name,password_hash,role,status,created_at,updated_at) VALUES (?,?,?,?,?,'ACTIVE',?,?)",
      )
      .bind(id, email, name, passwordHash, role, now, now)
      .run();

    const token = await createSession(env.DB, id, {
      ip: request.headers.get("cf-connecting-ip"),
      userAgent: request.headers.get("user-agent"),
    });
    return new Response(
      JSON.stringify({ success: true, data: { id, email, name, role, status: "ACTIVE" }, message: "Account created" }),
      { status: 200, headers: { "content-type": "application/json", "set-cookie": sessionCookieHeader(token, request.url) } },
    );
  } catch (error) {
    return api({ code: "SIGNUP_FAILED", message: error instanceof Error ? error.message : "Signup failed" }, 500);
  }
}
