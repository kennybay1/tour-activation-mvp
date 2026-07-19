import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Post-unlock (or near-miss) email capture. The fan already has — or
// missed — the reward; this only attaches contact details to the claim row
// that /api/claim created for their session. Never gates anything.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SOURCES = ["post_unlock", "near_miss"] as const;
type EmailSource = (typeof SOURCES)[number];

type EmailResponse = { ok: true } | { error: string };

export async function POST(
  req: NextRequest
): Promise<NextResponse<EmailResponse>> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { slug, session_id, email, marketing_consent, source } = body as {
    slug?: unknown;
    session_id?: unknown;
    email?: unknown;
    marketing_consent?: unknown;
    source?: unknown;
  };

  if (typeof slug !== "string" || slug.length === 0) {
    return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
  }
  if (
    typeof session_id !== "string" ||
    session_id.length === 0 ||
    session_id.length > 100
  ) {
    return NextResponse.json({ error: "invalid_session" }, { status: 400 });
  }
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  if (
    typeof source !== "string" ||
    !SOURCES.includes(source as EmailSource)
  ) {
    return NextResponse.json({ error: "invalid_source" }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const consent = marketing_consent === true;
  const now = new Date().toISOString();
  const db = supabaseAdmin();

  const { data: campaign, error: campaignError } = await db
    .from("campaigns")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (campaignError) {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
  if (!campaign) {
    return NextResponse.json({ error: "campaign_not_found" }, { status: 404 });
  }

  const { data: claim, error: claimError } = await db
    .from("claims")
    .select("id, marketing_consent, consent_at")
    .eq("campaign_id", campaign.id)
    .eq("session_id", session_id)
    .maybeSingle();
  if (claimError) {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
  if (!claim) {
    // The UI only offers this form after a claim attempt, so a missing row
    // means a stale or fabricated session.
    return NextResponse.json({ error: "claim_not_found" }, { status: 404 });
  }

  // Consent is one-way: false→true records a fresh consent timestamp;
  // true stays true with its original consent_at, whatever this request says.
  const alreadyConsented = claim.marketing_consent === true;
  const { error: updateError } = await db
    .from("claims")
    .update({
      email: normalizedEmail,
      email_source: source,
      email_captured_at: now,
      marketing_consent: alreadyConsented || consent,
      consent_at: alreadyConsented
        ? claim.consent_at
        : consent
          ? now
          : null,
    })
    .eq("id", claim.id);
  if (updateError) {
    // A unique constraint on (campaign_id, email) may reject an address
    // already attached to another claim for this campaign. That's not the
    // fan's problem — the address is captured, just on the earlier row.
    if (updateError.code === "23505") {
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
