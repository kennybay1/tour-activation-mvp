import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Journey rewards, assembled server-side only. Rewards (files, codes, ticket
// links) live on campaign_locations / campaigns and are NEVER exposed to the
// anon client or the public views — they reach a fan only through the claim
// and progress routes, and only for stops that fan has genuinely collected.

export type StopReward = {
  location_id: string;
  location_name: string;
  reward_teaser: string | null;
  reward_content_url: string | null;
  discount_code: string | null;
  ticket_url?: string;
};

export type FinaleReward = {
  reward_teaser: string | null;
  reward_content_url: string | null;
  discount_code: string | null;
  ticket_url?: string;
};

export type JourneyState = {
  progress: { collected: number; total: number };
  complete: boolean;
  collected: StopReward[];
  finale: FinaleReward | null;
};

// The finale reuses the campaign's own reward fields.
export type CampaignRewardSource = {
  id: string;
  reward_teaser: string | null;
  reward_content_url: string | null;
  reward_storage_path: string | null;
  discount_code: string | null;
  ticket_url: string | null;
};

export type LocationRewardSource = {
  id: string;
  location_name: string;
  sort_order?: number | null;
  reward_teaser: string | null;
  reward_content_url: string | null;
  reward_storage_path: string | null;
  discount_code: string | null;
  ticket_url: string | null;
};

// A private stored file becomes a short-lived signed link; a hosted link is
// used as-is. The raw storage path never leaves the server.
async function signedUrl(
  db: SupabaseClient,
  storagePath: string | null,
  fallback: string | null
): Promise<string | null> {
  if (storagePath) {
    const { data } = await db.storage
      .from("rewards")
      .createSignedUrl(storagePath, 60 * 60 * 2);
    if (data?.signedUrl) return data.signedUrl;
  }
  return fallback ?? null;
}

export async function stopReward(
  db: SupabaseClient,
  loc: LocationRewardSource
): Promise<StopReward> {
  return {
    location_id: loc.id,
    location_name: loc.location_name,
    reward_teaser: loc.reward_teaser ?? null,
    reward_content_url: await signedUrl(
      db,
      loc.reward_storage_path,
      loc.reward_content_url
    ),
    discount_code: loc.discount_code ?? null,
    ...(loc.ticket_url ? { ticket_url: loc.ticket_url } : {}),
  };
}

// The finale exists only if the artist actually filled in a campaign reward.
export async function finaleReward(
  db: SupabaseClient,
  campaign: CampaignRewardSource
): Promise<FinaleReward | null> {
  const hasFinale =
    !!campaign.reward_storage_path ||
    !!campaign.reward_content_url ||
    !!campaign.discount_code;
  if (!hasFinale) return null;
  return {
    reward_teaser: campaign.reward_teaser ?? null,
    reward_content_url: await signedUrl(
      db,
      campaign.reward_storage_path,
      campaign.reward_content_url
    ),
    discount_code: campaign.discount_code ?? null,
    ...(campaign.ticket_url ? { ticket_url: campaign.ticket_url } : {}),
  };
}

// Everything a fan's journey screen needs: which stops they've collected
// (with rewards, in stop order), how far along they are, and the finale
// once every stop is in. Reads location_unlocks for this session only.
export async function buildJourneyState(
  db: SupabaseClient,
  campaign: CampaignRewardSource,
  locations: LocationRewardSource[],
  sessionId: string
): Promise<JourneyState> {
  const { data: unlocks } = await db
    .from("location_unlocks")
    .select("location_id")
    .eq("campaign_id", campaign.id)
    .eq("session_id", sessionId);
  const collectedIds = new Set((unlocks ?? []).map((u) => u.location_id));

  const collectedLocs = locations
    .filter((l) => collectedIds.has(l.id))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const collected = await Promise.all(
    collectedLocs.map((l) => stopReward(db, l))
  );

  const total = locations.length;
  const complete = total > 0 && collectedLocs.length === total;
  const finale = complete ? await finaleReward(db, campaign) : null;

  return {
    progress: { collected: collectedLocs.length, total },
    complete,
    collected,
    finale,
  };
}
