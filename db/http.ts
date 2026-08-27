export function api(data: unknown, status = 200, message: string | null = null): Response {
  return Response.json(status < 400 ? { success: true, data, message } : { success: false, error: data }, { status });
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE_RE = /^\+?[0-9]{7,15}$/;
