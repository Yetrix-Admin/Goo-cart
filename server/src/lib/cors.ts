const allowedOrigins = () => (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export function isOriginAllowed(origin: string | undefined): boolean {
  // Native mobile apps and server-to-server calls do not send a browser
  // Origin header.
  if (!origin) return true;

  const allowed = allowedOrigins();
  if (allowed.length) return allowed.includes(origin);

  // Local development stays convenient, but production must never silently
  // reflect arbitrary browser origins while credentials are enabled.
  return process.env.NODE_ENV !== "production";
}

export function corsOrigin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
  callback(null, isOriginAllowed(origin));
}
