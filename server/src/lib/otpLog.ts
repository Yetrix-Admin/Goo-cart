// Structured, safe logging for the OTP flow. Never logs the OTP code itself,
// nor any Gmail/OAuth credential — only event names and identifiers masked
// enough to be useless for account takeover but still useful for debugging a
// specific report ("customer says they never got a code").

export type OtpLogEvent = "EMAIL_OTP_REQUESTED" | "EMAIL_OTP_SENT" | "EMAIL_OTP_VERIFIED" | "EMAIL_OTP_FAILED" | "EMAIL_OTP_EXPIRED" | "EMAIL_SEND_FAILED";

/** "someone@example.com" -> "so***@example.com"; a bare phone number is masked to its last 2 digits. */
export function maskIdentifier(identifier: string): string {
  const at = identifier.indexOf("@");
  if (at === -1) return identifier.length <= 2 ? "**" : `${"*".repeat(identifier.length - 2)}${identifier.slice(-2)}`;
  const local = identifier.slice(0, at);
  const domain = identifier.slice(at);
  return `${local.slice(0, Math.min(2, local.length))}***${domain}`;
}

export function logOtpEvent(event: OtpLogEvent, fields: { identifier: string; purpose: string; reason?: string }): void {
  console.log(JSON.stringify({ event, identifier: maskIdentifier(fields.identifier), purpose: fields.purpose, reason: fields.reason, at: new Date().toISOString() }));
}
