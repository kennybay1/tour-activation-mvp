import FanPage, { type PreviewPayload } from "./fan-page";
import {
  getAdminUser,
  getSessionUser,
  campaignAccess,
} from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { stopReward, finaleReward } from "@/lib/journey";
import { rewardItems } from "@/lib/rewards";

// Owner-only preview. With ?preview=1 the status gate is bypassed ONLY when
// the requester has an authenticated session AND owns the campaign (or is
// the platform admin) — decided here, server-side, with the service-role
// client. Everyone else falls through to the normal page, where a draft
// still renders not-found via the anon view exactly as before. The anon
// (campaigns_public) path is untouched: reward and discount data reach the
// page exclusively through this authenticated server branch.
async function loadPreview(slug: string): Promise<PreviewPayload | null> {
  const user = await getSessionUser();
  if (!user) return null;

  const db = supabaseAdmin();
  const { data: c } = await db
    .from("campaigns")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (!c) return null;
  // Owner, a workspace member, or the platform admin may preview.
  if (c.owner_id !== user.id) {
    const access = await campaignAccess(user.id, c.id);
    if (!access.ok && !(await getAdminUser())) return null;
  }

  const { data: locs } = await db
    .from("campaign_locations")
    .select(
      "id, location_name, lat, lng, radius_m, sort_order, reward_teaser, reward_content_url, reward_storage_path, discount_code, ticket_url"
    )
    .eq("campaign_id", c.id)
    .order("sort_order");

  // Same treatment the real unlock uses — every file/link on the reward,
  // with uploads signed and raw storage paths kept server-side.
  const campaignItems = await rewardItems(db, { campaignId: c.id }, c);

  // Journey preview content: every stop's reward and the finale, assembled
  // the same server-only way as a real unlock (owner is the viewer here).
  const isJourney = c.campaign_type === "journey";
  const journeyStops = isJourney
    ? await Promise.all((locs ?? []).map((l) => stopReward(db, l)))
    : [];
  const finale = isJourney ? await finaleReward(db, c) : null;

  // Built field-by-field on purpose: spreading the service-role row would
  // silently leak any column added to `campaigns` later.
  return {
    campaign: {
      id: c.id,
      slug: c.slug,
      artist_name: c.artist_name,
      title: c.title,
      description: c.description,
      reward_teaser: c.reward_teaser,
      ticket_url: c.ticket_url,
      starts_at: c.starts_at,
      ends_at: c.ends_at,
      is_active: c.is_active,
      expired_headline: c.expired_headline,
      expired_message: c.expired_message,
      expired_link_url: c.expired_link_url,
      expired_link_label: c.expired_link_label,
      background_image_path: c.background_image_path,
    },
    locations: (locs ?? []).map((l) => ({
      id: l.id,
      location_name: l.location_name,
      lat: l.lat,
      lng: l.lng,
      radius_m: l.radius_m,
    })),
    reward: {
      items: campaignItems,
      reward_content_url: campaignItems[0]?.url ?? null,
      discount_code: c.discount_code,
      ...(c.ticket_url ? { ticket_url: c.ticket_url } : {}),
      location_name: locs?.[0]?.location_name ?? null,
    },
    campaignType: c.campaign_type ?? "single",
    journeyStops,
    finale,
  };
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const { preview } = await searchParams;
  if (preview === "1") {
    const payload = await loadPreview(slug);
    if (payload) return <FanPage slug={slug} preview={payload} />;
  }
  return <FanPage slug={slug} />;
}
