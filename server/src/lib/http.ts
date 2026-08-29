export const ok = (data: unknown, message: string | null = null) => ({ success: true as const, data, message });
export const fail = (code: string, message: string) => ({ success: false as const, error: { code, message } });

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE_RE = /^\+?[0-9]{7,15}$/;

// Escapes regex metacharacters in user-supplied search text before it goes
// into a Mongo $regex filter, so a crafted query string (e.g. many nested
// quantifiers) can't cause catastrophic backtracking (ReDoS) or match more
// than the literal text the user typed.
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
