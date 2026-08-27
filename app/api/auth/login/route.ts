import { env } from "cloudflare:workers";
import { createSession, sessionCookieHeader, verifyPassword } from "../../../../db/auth";
import { api, EMAIL_RE } from "../../../../db/http";
import { runMigrations } from "../../../../db/migrations";

type UserRow = { id: string; email: string; name: string; role: string; status: string; password_hash: string | null };

export async function POST(request: Request) {
  try {
    await runMigrations(env.DB);
    const body = (await request.json()) as Record<string, unknown>;
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!EMAIL_RE.test(email) || !password) return api({ code: "INVALID_CREDENTIALS", message: "Enter your email and password" }, 400);

    const user = await env.DB
      .prepare("SELECT id,email,name,role,status,password_hash FROM users WHERE email=?")
      .bind(email)
      .first<UserRow>();
    if (!user || !user.password_hash) return api({ code: "INVALID_CREDENTIALS", message: "Incorrect email or password" }, 401);
    if (user.status !== "ACTIVE") return api({ code: "ACCOUNT_DISABLED", message: "This account is not active" }, 403);
    if (!(await verifyPassword(password, user.password_hash)))
      return api({ code: "INVALID_CREDENTIALS", message: "Incorrect email or password" }, 401);

    await env.DB.prepare("UPDATE users SET last_login_at=? WHERE id=?").bind(new Date().toISOString(), user.id).run();
    const token = await createSession(env.DB, user.id, {
      ip: request.headers.get("cf-connecting-ip"),
      userAgent: request.headers.get("user-agent"),
    });
    return new Response(
      JSON.stringify({
        success: true,
        data: { id: user.id, email: user.email, name: user.name, role: user.role, status: user.status },
        message: "Signed in",
      }),
      { status: 200, headers: { "content-type": "application/json", "set-cookie": sessionCookieHeader(token, request.url) } },
    );
  } catch (error) {
    return api({ code: "LOGIN_FAILED", message: error instanceof Error ? error.message : "Sign in failed" }, 500);
  }
}
