import "server-only";

// Minimal transactional email via Resend's REST API — no extra dependency.
// Everything is gated on two env vars the owner controls: RESEND_API_KEY and
// EMAIL_FROM (a verified sender, e.g. "Moments <hi@yourdomain.com>"). Until
// BOTH are set, isEmailConfigured() is false, every email feature stays
// hidden from fans, and sendEmail() is a no-op — so nothing half-works on
// the live site before email is actually ready.

export function isEmailConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ sent: boolean }> {
  if (!isEmailConfigured()) return { sent: false };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      }),
    });
    return { sent: res.ok };
  } catch {
    return { sent: false };
  }
}
