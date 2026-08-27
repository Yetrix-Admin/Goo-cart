import { env } from "cloudflare:workers";

// The vendor / delivery-partner / admin portal now reads and writes MongoDB,
// which cannot run on the Cloudflare Workers runtime this app is served from
// (the Atlas Data API was retired in September 2025, and the MongoDB driver
// needs net.Socket). The portal logic therefore lives in the Node service in
// server/, and this route forwards to it.
//
// Keeping the path identical means the existing UI needed no changes, and no
// D1 query remains anywhere in the portal path.

const DEFAULT_API = "http://localhost:3000";

function apiBase(): string {
  const configured = (env as unknown as Record<string, unknown>).GOOCART_API_URL;
  return (typeof configured === "string" && configured ? configured : DEFAULT_API).replace(/\/$/, "");
}

async function forward(request: Request, method: "GET" | "POST"): Promise<Response> {
  const target = `${apiBase()}/api/goocart`;

  // Auth travels as a cookie from the browser; pass it through untouched so
  // the Node service resolves the same session.
  const headers = new Headers();
  const cookie = request.headers.get("cookie");
  const authorization = request.headers.get("authorization");
  if (cookie) headers.set("cookie", cookie);
  if (authorization) headers.set("authorization", authorization);
  if (method === "POST") headers.set("content-type", "application/json");

  try {
    const upstream = await fetch(target, {
      method,
      headers,
      body: method === "POST" ? await request.text() : undefined,
    });

    const body = await upstream.text();
    const responseHeaders = new Headers({ "content-type": "application/json" });
    const setCookie = upstream.headers.get("set-cookie");
    if (setCookie) responseHeaders.append("set-cookie", setCookie);

    return new Response(body, { status: upstream.status, headers: responseHeaders });
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: {
          code: "API_UNREACHABLE",
          message: `Could not reach the Goocart API at ${apiBase()}. Start it with: cd server && npm run dev`,
        },
      },
      { status: 503 },
    );
  }
}

export async function GET(request: Request) {
  return forward(request, "GET");
}

export async function POST(request: Request) {
  return forward(request, "POST");
}
