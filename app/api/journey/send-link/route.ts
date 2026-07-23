import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { makeRestoreToken } from "@/lib/magic-link";
import { isEmailConfigured, sendEmail } from "@/lib/email";

// "Email me a secure link" — the verified restore (Layer 2b). We find the
// identity session that owns this email, mint a signed link that adopts it,
// and email it to that address. The link, not the typed address, is the
// proof, so it can't be used by someone who merely knows the email.
//
// The response is deliberately identical whether or not the address has a
// collection (or exists at all): it never reveals who's in the list. A
// per-IP rate limit blunts bulk probing.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IP_RATE_LIMIT = 15;
const RATE_WINDOW_MS = 10 * 60 * 1000;

type SendLinkResponse =
  | { ok: true; available: boolean }
  | { status: "expired" }
  | { error: string };

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(
  req: NextRequest
): Promise<NextResponse<SendLinkResponse>> {
  // Never even hint at addresses when email isn't set up.
  if (!isEmailConfigured()) {
    return NextResponse.json({ ok: true, available: false });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const { slug, email } = body as { slug?: unknown; email?: unknown };
  if (typeof slug !== "string" || slug.length === 0) {
    return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
  }
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  const normalizedEmail = email.trim().toLowerCase();
  const now = new Date();
  const db = supabaseAdmin();

  const { data: campaign } = await db
    .from("campaigns")
    .select("id, title, campaign_type, is_active, status, starts_at, ends_at")
    .eq("slug", slug)
    .maybeSingle();
  if (
    !campaign ||
    campaign.campaign_type !== "journey" ||
    campaign.status !== "live" ||
    !campaign.is_active ||
    now < new Date(campaign.starts_at) ||
    now > new Date(campaign.ends_at)
  ) {
    return NextResponse.json({ status: "expired" });
  }

  // Per-IP rate limit against probing.
  const ip = clientIp(req);
  if (ip !== "unknown") {
    const windowStart = new Date(now.getTime() - RATE_WINDOW_MS).toISOString();
    const { count } = await db
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "send_link_attempt")
      .eq("metadata->>ip", ip)
      .gte("created_at", windowStart);
    if ((count ?? 0) >= IP_RATE_LIMIT) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }
  }
  await db.from("events").insert({
    campaign_id: campaign.id,
    event_type: "send_link_attempt",
    metadata: { ip },
  });

  // Only send if this address actually owns a collection here. Silence
  // otherwise — the caller can't tell the difference.
  const { data: identity } = await db
    .from("claims")
    .select("session_id")
    .eq("campaign_id", campaign.id)
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (identity?.session_id) {
    const token = makeRestoreToken(slug, identity.session_id);
    const origin = req.nextUrl.origin;
    const link = `${origin}/api/journey/link?token=${encodeURIComponent(token)}`;
    const title = campaign.title || "your journey";
    await sendEmail({
      to: normalizedEmail,
      subject: `Pick up your ${title} collection`,
      text: `Tap to restore your collection on this device:\n\n${link}\n\nThis link works once and expires in an hour. If you didn't ask for it, you can ignore this email.`,
      html: `<p>Tap to restore your collection on this device:</p>
<p><a href="${link}">Restore my collection</a></p>
<p style="color:#666;font-size:13px">This link expires in an hour. If you didn't ask for it, you can ignore this email.</p>`,
    });
  }

  return NextResponse.json({ ok: true, available: true });
}
