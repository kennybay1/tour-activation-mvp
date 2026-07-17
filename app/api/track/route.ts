import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const ALLOWED_EVENT_TYPES = [
  "page_view",
  "permission_granted",
  "permission_denied",
  "location_error",
  "register",
  "ticket_click",
] as const;
type AllowedEventType = (typeof ALLOWED_EVENT_TYPES)[number];

type TrackResponse = { ok: true } | { error: string };

export async function POST(
  req: NextRequest
): Promise<NextResponse<TrackResponse>> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { slug, session_id, event_type, metadata } = body as {
    slug?: unknown;
    session_id?: unknown;
    event_type?: unknown;
    metadata?: unknown;
  };

  if (typeof slug !== "string" || slug.length === 0) {
    return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
  }
  if (
    typeof event_type !== "string" ||
    !ALLOWED_EVENT_TYPES.includes(event_type as AllowedEventType)
  ) {
    return NextResponse.json({ error: "invalid_event_type" }, { status: 400 });
  }
  if (
    metadata !== undefined &&
    metadata !== null &&
    (typeof metadata !== "object" || Array.isArray(metadata))
  ) {
    return NextResponse.json({ error: "invalid_metadata" }, { status: 400 });
  }

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

  const { error: insertError } = await db.from("events").insert({
    campaign_id: campaign.id,
    session_id: typeof session_id === "string" ? session_id : null,
    event_type,
    metadata: metadata ?? null,
  });
  if (insertError) {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
