export const ok = (data: unknown, message: string | null = null) => ({ success: true as const, data, message });
export const fail = (code: string, message: string) => ({ success: false as const, error: { code, message } });

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE_RE = /^\+?[0-9]{7,15}$/;
