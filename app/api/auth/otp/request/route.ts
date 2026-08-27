import { env } from "cloudflare:workers";
import { requestOtp } from "../../../../../db/auth";
import { api, EMAIL_RE, PHONE_RE } from "../../../../../db/http";
import { runMigrations } from "../../../../../db/migrations";

export async function POST(request: Request) {
  try {
    await runMigrations(env.DB);
    const body = (await request.json()) as Record<string, unknown>;
    const identifier = String(body.identifier || "").trim().toLowerCase();
    const purpose = String(body.purpose || "");
    if (purpose !== "SIGNUP" && purpose !== "LOGIN") return api({ code: "INVALID_PURPOSE", message: "Invalid OTP purpose" }, 400);
    if (!EMAIL_RE.test(identifier) && !PHONE_RE.test(identifier))
      return api({ code: "INVALID_IDENTIFIER", message: "Enter a valid email or phone number" }, 400);

    const column = EMAIL_RE.test(identifier) ? "email" : "phone";
    const existing = await env.DB.prepare(`SELECT id,status FROM users WHERE ${column}=?`).bind(identifier).first<{ id: string; status: string }>();
    if (purpose === "SIGNUP" && existing) return api({ code: "ACCOUNT_EXISTS", message: "An account already exists — sign in instead" }, 409);
    if (purpose === "LOGIN" && !existing) return api({ code: "ACCOUNT_NOT_FOUND", message: "No account found — sign up instead" }, 404);
    if (purpose === "LOGIN" && existing && existing.status !== "ACTIVE")
      return api({ code: "ACCOUNT_DISABLED", message: "This account is not active" }, 403);

    await requestOtp(env.DB, identifier, purpose);
    return api({ identifier }, 200, "Verification code sent");
  } catch (error) {
    return api({ code: "OTP_REQUEST_FAILED", message: error instanceof Error ? error.message : "Could not send code" }, 500);
  }
}
