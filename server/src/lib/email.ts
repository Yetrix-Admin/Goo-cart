// Transactional email via the Gmail REST API over HTTPS — deliberately NOT
// SMTP. Cloud hosts (this app runs on Render) commonly block outbound SMTP
// ports 465/587 as an anti-spam measure; every send silently hung until
// timeout when this used nodemailer over SMTP, even with correct
// credentials. The Gmail API is plain HTTPS on 443, which is never blocked.
//
// Authenticated as GMAIL_USER via OAuth2 — GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET
// identify the app, GMAIL_REFRESH_TOKEN is a one-time consent grant for that
// mailbox. None of these are the account's real password. When any is absent
// the sender degrades to a clearly-labelled console fallback so local
// development still works, and it never reports success for an email it did
// not actually send.

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SEND_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

export type EmailResult = { delivered: boolean; reason?: string };

type GmailConfig = { user: string; clientId: string; clientSecret: string; refreshToken: string };

function configured(): GmailConfig | null {
  const user = process.env.GMAIL_USER;
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  return user && clientId && clientSecret && refreshToken ? { user, clientId, clientSecret, refreshToken } : null;
}

// Google's access tokens are short-lived (~1hr); cached and reused across
// calls instead of exchanging the refresh token on every send.
let cachedToken: { accessToken: string; expiresAt: number } | null = null;

async function getAccessToken(config: GmailConfig): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.accessToken;

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Google token refresh returned ${response.status}: ${detail}`);
  }
  const data = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

function base64Url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A minimal RFC 2822 message with a UTF-8 HTML body, the shape the Gmail API's `raw` field expects. */
function buildRawMessage(from: string, to: string, subject: string, html: string): string {
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, "utf-8").toString("base64")}?=`;
  const headers = [`From: ${from}`, `To: ${to}`, `Subject: ${encodedSubject}`, "MIME-Version: 1.0", 'Content-Type: text/html; charset="UTF-8"', "Content-Transfer-Encoding: base64"].join(
    "\r\n",
  );
  const body = Buffer.from(html, "utf-8").toString("base64");
  return `${headers}\r\n\r\n${body}`;
}

export async function sendEmail(to: string, subject: string, html: string, text: string): Promise<EmailResult> {
  const config = configured();
  if (!config) {
    console.log(`[EMAIL NOT SENT — Gmail OAuth env vars not configured] to=${to} subject="${subject}"\n${text}`);
    return { delivered: false, reason: "Email provider is not configured" };
  }

  try {
    const accessToken = await getAccessToken(config);
    const raw = base64Url(Buffer.from(buildRawMessage(`Goocart <${config.user}>`, to, subject, html), "utf-8"));

    const response = await fetch(SEND_ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ raw }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error(`Gmail API rejected the email (${response.status}): ${detail}`);
      return { delivered: false, reason: `Email provider returned ${response.status}` };
    }

    return { delivered: true };
  } catch (error) {
    console.error("Could not send via the Gmail API:", error instanceof Error ? error.message : error);
    return { delivered: false, reason: "Could not reach the email provider" };
  }
}

export function otpEmail(code: string): { subject: string; html: string; text: string } {
  return {
    subject: `${code} is your Goocart verification code`,
    text: `Your Goocart verification code is ${code}. It expires in 5 minutes. If you did not request it, ignore this email.`,
    html: `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#FAFAFA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#27272A">
    <table role="presentation" style="max-width:440px;margin:0 auto;background:#FFFFFF;border-radius:16px;padding:32px">
      <tr><td>
        <p style="margin:0 0 4px;font-size:12px;font-weight:800;letter-spacing:1.5px;color:#FF6B35">GOOCART</p>
        <h1 style="margin:0 0 16px;font-size:22px;font-weight:600">Verify it's you</h1>
        <p style="margin:0 0 24px;font-size:14px;line-height:22px;color:#71717A">
          Enter this code to continue. It expires in 5 minutes.
        </p>
        <p style="margin:0 0 24px;font-size:34px;font-weight:800;letter-spacing:10px;text-align:center;padding:18px;background:#FFF1EB;border-radius:12px">${code}</p>
        <p style="margin:0;font-size:12px;line-height:19px;color:#A1A1AA">
          If you didn't request this, you can safely ignore this email. Never share this code with anyone.
        </p>
      </td></tr>
    </table>
  </body>
</html>`,
  };
}
