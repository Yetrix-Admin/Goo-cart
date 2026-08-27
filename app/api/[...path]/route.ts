// Every API call is served by the Node + MongoDB service in server/.
//
// MongoDB cannot run on the Cloudflare Workers runtime this app previously
// deployed to (the Atlas Data API was retired in September 2025, and the
// driver requires net.Socket). Rather than maintain two implementations,
// this app forwards the whole /api surface to the Node service — this app
// is now plain Next.js, so a standard process.env read is all that's needed.
//
// Set GOOCART_API_URL to the deployed API origin in production.

const DEFAULT_API = "http://localhost:3001";

function apiBase(): string {
  const configured = process.env.GOOCART_API_URL;
  return (configured || DEFAULT_API).replace(/\/$/, "");
}

async function forward(request: Request): Promise<Response> {
  const incoming = new URL(request.url);
  const target = `${apiBase()}${incoming.pathname}${incoming.search}`;

  // Pass through only what the API needs to identify the caller. Hop-by-hop
  // and host headers are deliberately dropped.
  const headers = new Headers();
  for (const name of ["cookie", "authorization", "content-type", "accept"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? await request.text() : undefined,
    });

    const responseHeaders = new Headers({ "content-type": upstream.headers.get("content-type") ?? "application/json" });
    const setCookie = upstream.headers.get("set-cookie");
    if (setCookie) responseHeaders.append("set-cookie", setCookie);

    return new Response(await upstream.text(), { status: upstream.status, headers: responseHeaders });
  } catch {
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

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
