import { env } from "cloudflare:workers";
import { clearSessionCookieHeader, revokeCurrentSession } from "../../../../db/auth";

export async function POST(request: Request) {
  await revokeCurrentSession(env.DB);
  return new Response(JSON.stringify({ success: true, data: null, message: "Signed out" }), {
    status: 200,
    headers: { "content-type": "application/json", "set-cookie": clearSessionCookieHeader(request.url) },
  });
}
