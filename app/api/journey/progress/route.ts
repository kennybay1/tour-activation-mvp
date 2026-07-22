import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { buildJourneyState, type JourneyState } from "@/lib/journey";

// Read-only: what stops has THIS session already collected on a journey, and
// is the set complete? Powers the fan page's progress + "your collection" on
// load and after a refresh. Runs entirely with the service role, so per-stop
// rewards are assembled server-side and never exposed to the public views —
// and only ever for stops this session genuinely unlocked via /api/claim.

type ProgressResponse =
  | { status: "expired" }
  | { mode: "single" }
  | ({ mode: "journey" } & JourneyState)
  | { error: string };

export async function POST(
  req: NextRequest
): Promise<NextResponse<ProgressResponse>> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { slug, session_id } = body as {
    slug?: unknown;
    session_id?: unknown;
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

  const db = supabaseAdmin();
  const { data: campaign, error: campaignError } = await db
    .from("campaigns")
    .select(
      "id, campaign_type, reward_teaser, reward_content_url, reward_storage_path, discount_code, ticket_url, starts_at, ends_at, is_active, status"
    )
    .eq("slug", slug)
    .maybeSingle();
  if (campaignError) {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  const now = new Date();
  if (
    !campaign ||
    campaign.status !== "live" ||
    !campaign.is_active ||
    now < new Date(campaign.starts_at) ||
    now > new Date(campaign.ends_at)
  ) {
    // Matches /api/claim — rewards aren't served outside the live window.
    return NextResponse.json({ status: "expired" });
  }

  // Single drops have no journey state; the caller falls back to its own flow.
  if (campaign.campaign_type !== "journey") {
    return NextResponse.json({ mode: "single" });
  }

  const { data: locations, error: locationsError } = await db
    .from("campaign_locations")
    .select(
      "id, location_name, sort_order, reward_teaser, reward_content_url, reward_storage_path, discount_code, ticket_url"
    )
    .eq("campaign_id", campaign.id);
  if (locationsError) {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  const state = await buildJourneyState(
    db,
    campaign,
    locations ?? [],
    session_id
  );
  return NextResponse.json({ mode: "journey", ...state });
}
