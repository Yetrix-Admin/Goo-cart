// Transactional email via Gmail SMTP (nodemailer), sent as the account named
// by GMAIL_USER using an App Password — not the account's real login
// password. Requires 2-Step Verification enabled on that Google account and
// an App Password generated at https://myaccount.google.com/apppasswords.
//
// Gmail cannot prove domain ownership the way a custom domain can, so this
// trades away Resend-style deliverability/scale for the ability to send from
// a real Gmail address with zero DNS setup. Regular Gmail accounts are capped
// around 500 sends/day — fine at launch, a real limit at scale.
//
// When GMAIL_USER/GMAIL_APP_PASSWORD are absent the sender degrades to a
// clearly-labelled console fallback so local development still works, and it
// never reports success for an email it did not actually send.

import nodemailer, { type Transporter } from "nodemailer";

export type EmailResult = { delivered: boolean; reason?: string };

// Reused across calls: Gmail rate-limits new SMTP connections, and nodemailer
// pools/keeps this one alive rather than reconnecting per send.
let transporter: Transporter | null = null;
let transporterUser: string | null = null;

function getTransporter(): { transporter: Transporter; from: string } | null {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;

  if (!transporter || transporterUser !== user) {
    transporter = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
    transporterUser = user;
  }
  return { transporter, from: `Goocart <${user}>` };
}

export async function sendEmail(to: string, subject: string, html: string, text: string): Promise<EmailResult> {
  const config = getTransporter();
  if (!config) {
    console.log(`[EMAIL NOT SENT — GMAIL_USER/GMAIL_APP_PASSWORD not configured] to=${to} subject="${subject}"\n${text}`);
    return { delivered: false, reason: "Email provider is not configured" };
  }

  try {
    await config.transporter.sendMail({ from: config.from, to, subject, html, text });
    return { delivered: true };
  } catch (error) {
    // Gmail's own message explains the real cause (bad app password, 2FA not
    // enabled, sending cap hit); surfacing it beats a generic failure.
    console.error("Gmail SMTP rejected the email:", error instanceof Error ? error.message : error);
    return { delivered: false, reason: "Email provider rejected the message" };
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
