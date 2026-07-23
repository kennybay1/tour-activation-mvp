import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { buildJourneyState, type JourneyState } from "@/lib/journey";

// Cross-device continuity for journeys, without login (Layer 2a).
//
// An email can sit on only one claim per campaign (a DB unique constraint),
// so the FIRST session to save an address becomes that fan's "identity"
// session. When the same address is entered on another device, that device
// ADOPTS the identity session — its durable cookie (see /api/session) is
// rewritten to the identity's id — after merging in whatever it collected on
// its own first. From then on every device the fan uses shares one identity
// and one growing collection.
//
// This is deliberately UNVERIFIED: a typed address is treated as proof, which
// is fine for discount codes and photos but not for genuinely exclusive
// content. A per-IP rate limit blunts bulk email guessing.

const COOKIE = "ta_sid";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 400;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IP_RATE_LIMIT = 20;
const RATE_WINDOW_MS = 10 * 60 * 1000;

type RestoreResponse =
  | ({ session_id: string; restored_count: number } & JourneyState)
  | { status: "expired" }
  | { error: string };

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(
  req: NextRequest
): Promise<NextResponse<RestoreResponse>> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { slug, session_id, email, marketing_consent } = body as {
    slug?: unknown;
    session_id?: unknown;
    email?: unknown;
    marketing_consent?: unknown;
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
  const currentSession = session_id;
  const normalizedEmail = email.trim().toLowerCase();
  const consent = marketing_consent === true;
  const now = new Date();
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
  if (
    !campaign ||
    campaign.campaign_type !== "journey" ||
    campaign.status !== "live" ||
    !campaign.is_active ||
    now < new Date(campaign.starts_at) ||
    now > new Date(campaign.ends_at)
  ) {
    // Consistent with claim/progress: nothing is served outside the window.
    return NextResponse.json({ status: "expired" });
  }

  // Per-IP rate limit against bulk email guessing.
  const ip = clientIp(req);
  if (ip !== "unknown") {
    const windowStart = new Date(now.getTime() - RATE_WINDOW_MS).toISOString();
    const { count } = await db
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "restore_attempt")
      .eq("metadata->>ip", ip)
      .gte("created_at", windowStart);
    if ((count ?? 0) >= IP_RATE_LIMIT) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }
  }
  await db.from("events").insert({
    campaign_id: campaign.id,
    session_id: currentSession,
    event_type: "restore_attempt",
    metadata: { ip },
  });

  const { data: locations, error: locationsError } = await db
    .from("campaign_locations")
    .select(
      "id, location_name, sort_order, reward_teaser, reward_content_url, reward_storage_path, discount_code, ticket_url"
    )
    .eq("campaign_id", campaign.id);
  if (locationsError) {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  // Who already owns this email on this campaign?
  const { data: identityClaim } = await db
    .from("claims")
    .select("session_id, marketing_consent")
    .eq("campaign_id", campaign.id)
    .eq("email", normalizedEmail)
    .maybeSingle();

  let identitySession = identityClaim?.session_id ?? null;
  let restoredCount = 0;

  if (!identitySession) {
    // First use of this address — the current session becomes the identity.
    const { error } = await db.from("claims").upsert(
      {
        campaign_id: campaign.id,
        session_id: currentSession,
        email: normalizedEmail,
        email_source: "journey_save",
        email_captured_at: now.toISOString(),
        marketing_consent: consent,
        consent_at: consent ? now.toISOString() : null,
      },
      { onConflict: "campaign_id,session_id" }
    );
    if (error) {
      return NextResponse.json({ error: "server_error" }, { status: 500 });
    }
    identitySession = currentSession;
  } else if (identitySession !== currentSession) {
    // Another device already holds this address. Adopt it — but first fold
    // in anything THIS device collected so no progress is lost either way.
    const [{ data: currentUnlocks }, { data: identityUnlocks }] =
      await Promise.all([
        db
          .from("location_unlocks")
          .select("location_id, distance_m")
          .eq("campaign_id", campaign.id)
          .eq("session_id", currentSession),
        db
          .from("location_unlocks")
          .select("location_id")
          .eq("campaign_id", campaign.id)
          .eq("session_id", identitySession),
      ]);
    const currentIds = new Set((currentUnlocks ?? []).map((u) => u.location_id));
    const identityIds = new Set(
      (identityUnlocks ?? []).map((u) => u.location_id)
    );
    // Stops the fan gains by adopting the identity (collected on other
    // devices) — this is what "restored" means to them.
    restoredCount = [...identityIds].filter((id) => !currentIds.has(id)).length;

    // Push this device's own stops onto the identity so it holds the union.
    const toAdd = (currentUnlocks ?? []).filter(
      (u) => !identityIds.has(u.location_id)
    );
    if (toAdd.length) {
      await db.from("location_unlocks").insert(
        toAdd.map((u) => ({
          campaign_id: campaign.id,
          location_id: u.location_id,
          session_id: identitySession,
          distance_m: u.distance_m ?? null,
        }))
      );
    }

    // Marketing consent is one-way — only ever flip false → true.
    if (consent && identityClaim?.marketing_consent !== true) {
      await db
        .from("claims")
        .update({ marketing_consent: true, consent_at: now.toISOString() })
        .eq("campaign_id", campaign.id)
        .eq("session_id", identitySession);
    }
  }

  const state = await buildJourneyState(
    db,
    campaign,
    locations ?? [],
    identitySession
  );

  const res = NextResponse.json({
    session_id: identitySession,
    restored_count: restoredCount,
    ...state,
  });
  // The device now IS the identity session — make that durable.
  res.cookies.set(COOKIE, identitySession, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return res;
}
