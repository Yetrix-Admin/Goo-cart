import { AuditLog } from "../models.js";

const REDACTED = "[REDACTED]";

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /passwordHash/i,
  /\botp\b/i,
  /codeHash/i,
  /token/i,
  /secret/i,
  /apiKey/i,
  /authorization/i,
  /cookie/i,
  /bank/i,
  /accountNumber/i,
  /\bifsc\b/i,
  /card/i,
  /cvv/i,
  /paymentCredential/i,
  /refresh/i,
  /access/i,
];

type AuditActor = { _id?: unknown; role?: string | null } | null | undefined;

function isSensitiveKey(key: string) {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}

export function sanitizeAuditValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((entry) => sanitizeAuditValue(entry));
  if (!isRecord(value)) return value;

  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    sanitized[key] = isSensitiveKey(key) ? REDACTED : sanitizeAuditValue(entry);
  }
  return sanitized;
}

function collectFieldNames(value: unknown, prefix = "", output = new Set<string>()) {
  if (!isRecord(value)) return output;
  for (const [key, entry] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    output.add(path);
    if (isRecord(entry)) collectFieldNames(entry, path, output);
  }
  return output;
}

export function changedFieldNames(before: unknown, after: unknown): string[] {
  const fields = new Set<string>();
  collectFieldNames(before, "", fields);
  collectFieldNames(after, "", fields);
  return [...fields].sort();
}

export async function writeAuditLog(input: {
  actor?: AuditActor;
  actorId?: unknown;
  actorRole?: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before?: unknown;
  after?: unknown;
  requestId?: string | null;
}) {
  await AuditLog.create({
    actorId: input.actorId ?? input.actor?._id ?? null,
    actorRole: input.actorRole ?? input.actor?.role ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    before: sanitizeAuditValue(input.before),
    after: sanitizeAuditValue(input.after),
    changedFields: changedFieldNames(input.before, input.after),
    requestId: input.requestId ?? null,
  });
}
