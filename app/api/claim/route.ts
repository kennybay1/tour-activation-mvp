import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  buildJourneyState,
  stopReward,
  type JourneyState,
  type StopReward,
} from "@/lib/journey";
import { rewardItems, type RewardItem } from "@/lib/rewards";

// Identity is the client-generated session id — email is no longer asked
// for before the location check (it's requested after unlock, via
// /api/claim/email). Raw coordinates are still used only for the distance
// computation and never stored.

const SESSION_RATE_LIMIT = 10;
const IP_RATE_LIMIT = 30;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const MAX_ACCURACY_GRACE_M = 50;

type ClaimSuccess = {
  status: "unlocked" | "already_claimed";
  items: RewardItem[];
  reward_content_url: string | null;
  discount_code: string | null;
  ticket_url?: string;
  location_name: string | null;
};
// Journey unlocks return the stop just collected plus the running collection
// and progress; the finale rides along on the response that completes the set.
type JourneyClaimSuccess = {
  status: "unlocked" | "already_claimed";
  mode: "journey";
  just_unlocked: StopReward;
} & JourneyState;
type ClaimResponse =
  | { status: "expired" }
  | { status: "out_of_range"; distance_m: number; nearest_location_name: string }
  | ClaimSuccess
  | JourneyClaimSuccess
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

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
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

  const { slug, lat, lng, accuracy, session_id } = body as {
    slug?: unknown;
    lat?: unknown;
    lng?: unknown;
    accuracy?: unknown;
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

  const sessionId = session_id;
  const ip = clientIp(req);
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
    return NextResponse.json({ status: "expired" });
  }

  // A campaign can have many locations; a campaign with none can't unlock.
  const isJourney = campaign.campaign_type === "journey";
  // One static column set for both modes — single drops just ignore the
  // reward columns (null for them). A conditional select string would defeat
  // the client's column-type inference.
  const { data: locations, error: locationsError } = await db
    .from("campaign_locations")
    .select(
      "id, location_name, lat, lng, radius_m, sort_order, reward_teaser, reward_content_url, reward_storage_path, discount_code, ticket_url"
    )
    .eq("campaign_id", campaign.id);
  if (locationsError) {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
  if (!locations?.length) {
    return NextResponse.json({ status: "expired" });
  }

  // Rate limits, counted via claim_attempt events (works across serverless
  // instances): per session AND per IP, since a session id costs nothing to
  // mint. The IP is recorded only in event metadata for this counting —
  // never on the claim.
  const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS).toISOString();
  const [sessionCount, ipCount] = await Promise.all([
    db
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaign.id)
      .eq("event_type", "claim_attempt")
      .eq("session_id", sessionId)
      .gte("created_at", windowStart),
    db
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "claim_attempt")
      .eq("metadata->>ip", ip)
      .gte("created_at", windowStart),
  ]);
  if (sessionCount.error || ipCount.error) {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
  if (
    (sessionCount.count ?? 0) >= SESSION_RATE_LIMIT ||
    (ip !== "unknown" && (ipCount.count ?? 0) >= IP_RATE_LIMIT)
  ) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  await db.from("events").insert({
    campaign_id: campaign.id,
    session_id: sessionId,
    event_type: "claim_attempt",
    metadata: { ip },
  });

  // Register the claim regardless of the location outcome. Only identity
  // and user agent are written here — the email fields belong to
  // /api/claim/email and must survive repeat attempts untouched.
  const { data: claim, error: claimError } = await db
    .from("claims")
    .upsert(
      {
        campaign_id: campaign.id,
        session_id: sessionId,
        user_agent: req.headers.get("user-agent"),
      },
      { onConflict: "campaign_id,session_id" }
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

  // ── Journey: collect THIS stop, return its own reward + progress ──────
  if (isJourney) {
    // One row per (stop, session). The unique constraint makes re-collecting
    // the same stop a no-op — a 23505 means "already had this one".
    const insertRes = await db
      .from("location_unlocks")
      .insert({
        campaign_id: campaign.id,
        location_id: nearest.id,
        session_id: sessionId,
        distance_m: distanceM,
      })
      .select("id")
      .maybeSingle();
    const alreadyHadStop = insertRes.error?.code === "23505";
    if (insertRes.error && !alreadyHadStop) {
      return NextResponse.json({ error: "server_error" }, { status: 500 });
    }

    // Keep the per-session claim flagged unlocked for reporting parity; the
    // per-stop truth lives in location_unlocks. unlocked_at is set once.
    await db
      .from("claims")
      .update({
        unlocked: true,
        distance_m: distanceM,
        location_accuracy_m: accuracyM,
        unlocked_location_id: nearest.id,
        ...(claim.unlocked ? {} : { unlocked_at: now.toISOString() }),
      })
      .eq("id", claim.id);

    if (!alreadyHadStop) {
      await db.from("events").insert({
        campaign_id: campaign.id,
        claim_id: claim.id,
        session_id: sessionId,
        event_type: "unlock_success",
        metadata: {
          distance_m: distanceM,
          location_id: nearest.id,
          journey: true,
        },
      });
    }

    const state = await buildJourneyState(db, campaign, locations, sessionId);
    const justUnlocked = await stopReward(db, nearest);
    return NextResponse.json({
      status: alreadyHadStop ? "already_claimed" : "unlocked",
      mode: "journey",
      just_unlocked: justUnlocked,
      ...state,
    });
  }

  // ── Single drop: the existing one-reward, unlock-anywhere flow ────────
  // The reward can hold several files and/or links; uploaded files come back
  // as short-lived signed links, and the raw storage paths never leave the
  // server. reward_content_url stays as the first item for compatibility.
  const items = await rewardItems(db, { campaignId: campaign.id }, campaign);

  // ticket_url is optional — omitted from the payload entirely when the
  // campaign has none, so the client never renders an empty CTA.
  const successBase = {
    items,
    reward_content_url: items[0]?.url ?? null,
    discount_code: campaign.discount_code,
    ...(campaign.ticket_url ? { ticket_url: campaign.ticket_url } : {}),
  };

  if (claim.unlocked) {
    // Name the location this fan ORIGINALLY unlocked at, not whichever is
    // nearest right now — those can differ if they're revisiting a
    // different valid spot in the same multi-location campaign.
    const originalLocation = locations.find(
      (l) => l.id === claim.unlocked_location_id
    );
    return NextResponse.json({
      status: "already_claimed",
      ...successBase,
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
    ...successBase,
    location_name: nearest.location_name,
  });
}
