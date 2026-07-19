import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT_MAX_ATTEMPTS = 10;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const MAX_ACCURACY_GRACE_M = 50;

type ClaimSuccess = {
  status: "unlocked" | "already_claimed";
  reward_content_url: string | null;
  discount_code: string | null;
  ticket_url: string;
  location_name: string | null;
};
type ClaimResponse =
  | { status: "expired" }
  | { status: "out_of_range"; distance_m: number; nearest_location_name: string }
  | ClaimSuccess
  | { error: string };

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function POST(
  req: NextRequest
): Promise<NextResponse<ClaimResponse>> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { slug, email, marketing_consent, lat, lng, accuracy, session_id } =
    body as {
      slug?: unknown;
      email?: unknown;
      marketing_consent?: unknown;
      lat?: unknown;
      lng?: unknown;
      accuracy?: unknown;
      session_id?: unknown;
    };

  if (typeof slug !== "string" || slug.length === 0) {
    return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
  }
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    typeof accuracy !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    !Number.isFinite(accuracy) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180 ||
    accuracy < 0
  ) {
    return NextResponse.json({ error: "invalid_location" }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const sessionId = typeof session_id === "string" ? session_id : null;
  const consent = marketing_consent === true;
  const db = supabaseAdmin();

  const { data: campaign, error: campaignError } = await db
    .from("campaigns")
    .select(
      "id, reward_content_url, reward_storage_path, discount_code, ticket_url, starts_at, ends_at, is_active, status"
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
    return NextResponse.json({ status: "expired" });
  }

  // A campaign can have many locations; a campaign with none can't unlock.
  const { data: locations, error: locationsError } = await db
    .from("campaign_locations")
    .select("id, location_name, lat, lng, radius_m")
    .eq("campaign_id", campaign.id);
  if (locationsError) {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
  if (!locations?.length) {
    return NextResponse.json({ status: "expired" });
  }

  // Rate limit: max 10 attempts per email per campaign in a 10-minute window,
  // counted via claim_attempt events (works across serverless instances).
  const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count, error: countError } = await db
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign.id)
    .eq("event_type", "claim_attempt")
    .eq("metadata->>email", normalizedEmail)
    .gte("created_at", windowStart);
  if (countError) {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
  if ((count ?? 0) >= RATE_LIMIT_MAX_ATTEMPTS) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  await db.from("events").insert({
    campaign_id: campaign.id,
    session_id: sessionId,
    event_type: "claim_attempt",
    metadata: { email: normalizedEmail },
  });

  // Register the claim regardless of the location outcome.
  const { data: claim, error: claimError } = await db
    .from("claims")
    .upsert(
      {
        campaign_id: campaign.id,
        email: normalizedEmail,
        marketing_consent: consent,
        consent_at: consent ? now.toISOString() : null,
        user_agent: req.headers.get("user-agent"),
      },
      { onConflict: "campaign_id,email" }
    )
    .select("id, unlocked, unlocked_location_id")
    .single();
  if (claimError || !claim) {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  // Raw lat/lng is used only for this computation and never stored.
  // Nearest location wins — never first match — so overlapping geofences
  // resolve to the one the fan is actually closest to.
  let nearest = locations[0];
  let nearestDistance = Infinity;
  for (const loc of locations) {
    const d = haversineMeters(lat, lng, loc.lat, loc.lng);
    if (d < nearestDistance) {
      nearestDistance = d;
      nearest = loc;
    }
  }
  const distanceM = Math.round(nearestDistance);
  const accuracyM = Math.round(accuracy);
  const effectiveRadius =
    nearest.radius_m + Math.min(accuracyM, MAX_ACCURACY_GRACE_M);

  if (distanceM > effectiveRadius) {
    await db
      .from("claims")
      .update({ distance_m: distanceM, location_accuracy_m: accuracyM })
      .eq("id", claim.id);
    await db.from("events").insert({
      campaign_id: campaign.id,
      claim_id: claim.id,
      session_id: sessionId,
      event_type: "unlock_out_of_range",
      metadata: { distance_m: distanceM, location_id: nearest.id },
    });
    return NextResponse.json({
      status: "out_of_range",
      distance_m: distanceM,
      nearest_location_name: nearest.location_name,
    });
  }

  // An uploaded reward lives in the private storage bucket; hand out a
  // two-hour signed link instead of the raw path, which never leaves the
  // server.
  let rewardContentUrl: string | null = campaign.reward_content_url;
  if (campaign.reward_storage_path) {
    const { data: signed } = await db.storage
      .from("rewards")
      .createSignedUrl(campaign.reward_storage_path, 60 * 60 * 2);
    if (signed?.signedUrl) rewardContentUrl = signed.signedUrl;
  }

  if (claim.unlocked) {
    // Name the location this fan ORIGINALLY unlocked at, not whichever is
    // nearest right now — those can differ if they're revisiting a
    // different valid spot in the same multi-location campaign.
    const originalLocation = locations.find(
      (l) => l.id === claim.unlocked_location_id
    );
    return NextResponse.json({
      status: "already_claimed",
      reward_content_url: rewardContentUrl,
      discount_code: campaign.discount_code,
      ticket_url: campaign.ticket_url,
      location_name: originalLocation?.location_name ?? nearest.location_name,
    });
  }

  const { error: unlockError } = await db
    .from("claims")
    .update({
      unlocked: true,
      unlocked_at: now.toISOString(),
      distance_m: distanceM,
      location_accuracy_m: accuracyM,
      unlocked_location_id: nearest.id,
    })
    .eq("id", claim.id);
  if (unlockError) {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
  await db.from("events").insert({
    campaign_id: campaign.id,
    claim_id: claim.id,
    session_id: sessionId,
    event_type: "unlock_success",
    metadata: { distance_m: distanceM, location_id: nearest.id },
  });

  return NextResponse.json({
    status: "unlocked",
    reward_content_url: rewardContentUrl,
    discount_code: campaign.discount_code,
    ticket_url: campaign.ticket_url,
    location_name: nearest.location_name,
  });
}
