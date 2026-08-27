import { API_TIMEOUT_MS, API_URL, apiConfigError } from "@/config/environment";

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

type ApiEnvelope<T> = { success: true; data: T; message: string | null } | { success: false; error: { code: string; message: string } };

// The bearer token is held in memory and mirrored into device storage by the
// auth store; keeping a module-level copy avoids a circular import between the
// store and this client.
let authToken: string | null = null;

// Auth hydrates from storage asynchronously at app start. Without this gate a
// screen mounting first would fire its request before the token is restored
// and get a spurious 401.
let resolveAuthReady: () => void;
const authReady = new Promise<void>((resolve) => {
  resolveAuthReady = resolve;
});

export function setAuthToken(token: string | null) {
  authToken = token;
}

/** Called once by the auth store when hydration finishes, token or not. */
export function markAuthReady() {
  resolveAuthReady();
}

async function request<T>(path: string, init: RequestInit & { params?: Record<string, string | number | boolean | undefined> } = {}): Promise<T> {
  // A build with no backend URL fails here with an explanation rather than
  // producing a confusing network error on every screen.
  if (apiConfigError) throw new ApiError("API_NOT_CONFIGURED", apiConfigError);

  const url = new URL(`${API_URL}${path}`);
  if (init.params) {
    for (const [key, value] of Object.entries(init.params)) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }
  }

  await authReady;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      ...init,
      signal: controller.signal,
      headers: {
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
        ...init.headers,
      },
    });
    const json = (await response.json()) as ApiEnvelope<T>;
    if (!json.success) throw new ApiError(json.error.code, json.error.message, response.status);
    return json.data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError("TIMEOUT", "The server took too long to respond. Check your connection and try again.");
    }
    throw new ApiError("NETWORK_ERROR", `Couldn't reach Goocart at ${API_URL}. Make sure the backend is running and your phone is on the same Wi-Fi.`);
  } finally {
    clearTimeout(timeout);
  }
}

export function apiGet<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
  return request<T>(path, { method: "GET", params });
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
}
