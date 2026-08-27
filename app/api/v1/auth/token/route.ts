import { env } from "cloudflare:workers";
import { createSession, defaultRoleForEmail, hashPassword, verifyPassword } from "../../../../../db/auth";
import { api, EMAIL_RE } from "../../../../../db/http";
import { runMigrations } from "../../../../../db/migrations";

type UserRow = { id: string; email: string; name: string; role: string; status: string; password_hash: string | null };

// Token endpoint for native clients, which cannot hold an HttpOnly cookie.
// Issues the same session row the web cookie flow uses, returned as a bearer
// token for the app to store in secure device storage.
export async function POST(request: Request) {
  try {
    await runMigrations(env.DB);
    const body = (await request.json()) as Record<string, unknown>;
    const mode = String(body.mode ?? "login");
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");

    if (!EMAIL_RE.test(email)) return api({ code: "INVALID_EMAIL", message: "Enter a valid email address" }, 400);
    if (password.length < 8) return api({ code: "WEAK_PASSWORD", message: "Password must be at least 8 characters" }, 400);

    let user = await env.DB
      .prepare("SELECT id,email,name,role,status,password_hash FROM users WHERE email = ?")
      .bind(email)
      .first<UserRow>();

    if (mode === "signup") {
      if (user) return api({ code: "EMAIL_TAKEN", message: "An account with this email already exists" }, 409);
      const name = String(body.name ?? "").trim();
      if (name.length < 2) return api({ code: "INVALID_NAME", message: "Enter your full name" }, 400);
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const role = defaultRoleForEmail(email);
      await env.DB
        .prepare("INSERT INTO users(id,email,name,password_hash,role,status,created_at,updated_at) VALUES (?,?,?,?,?,'ACTIVE',?,?)")
        .bind(id, email, name, await hashPassword(password), role, now, now)
        .run();
      user = { id, email, name, role, status: "ACTIVE", password_hash: null };
    } else {
      if (!user || !user.password_hash) return api({ code: "INVALID_CREDENTIALS", message: "Incorrect email or password" }, 401);
      if (user.status !== "ACTIVE") return api({ code: "ACCOUNT_DISABLED", message: "This account is not active" }, 403);
      if (!(await verifyPassword(password, user.password_hash))) {
        return api({ code: "INVALID_CREDENTIALS", message: "Incorrect email or password" }, 401);
      }
      await env.DB.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(new Date().toISOString(), user.id).run();
    }

    const token = await createSession(env.DB, user.id, {
      ip: request.headers.get("cf-connecting-ip"),
      userAgent: request.headers.get("user-agent"),
    });

    return api({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, status: user.status },
    });
  } catch (error) {
    return api({ code: "AUTH_FAILED", message: error instanceof Error ? error.message : "Sign in failed" }, 500);
  }
}
