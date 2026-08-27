// Transactional email via Resend's HTTP API.
//
// Called with fetch rather than the SDK to keep the dependency surface small —
// it is a single POST. When RESEND_API_KEY is absent the sender degrades to a
// clearly-labelled console fallback so local development still works, and it
// never reports success for an email it did not actually send.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type EmailResult = { delivered: boolean; reason?: string };

function configured(): { key: string; from: string } | null {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  return key && from ? { key, from } : null;
}

export async function sendEmail(to: string, subject: string, html: string, text: string): Promise<EmailResult> {
  const config = configured();
  if (!config) {
    console.log(`[EMAIL NOT SENT — no RESEND_API_KEY] to=${to} subject="${subject}"\n${text}`);
    return { delivered: false, reason: "Email provider is not configured" };
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${config.key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: config.from, to: [to], subject, html, text }),
    });

    if (!response.ok) {
      // Resend's message explains the real cause (unverified domain, bad key,
      // rate limit); surfacing it beats a generic failure.
      const detail = await response.text().catch(() => "");
      console.error(`Resend rejected the email (${response.status}): ${detail}`);
      return { delivered: false, reason: `Email provider returned ${response.status}` };
    }

    return { delivered: true };
  } catch (error) {
    console.error("Could not reach Resend:", error instanceof Error ? error.message : error);
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
