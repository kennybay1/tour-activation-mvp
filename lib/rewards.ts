import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// A reward can hold several items — any mix of uploaded files and links.
// They live in reward_assets, attached either to a campaign (a single drop's
// reward, or a journey's finale) or to one stop. Assembled server-side only:
// uploaded files are handed out as short-lived signed links and the raw
// storage path never leaves the server.

export type RewardItem = {
  kind: "file" | "link";
  url: string;
  label: string | null;
};

type AssetRow = {
  kind: string;
  storage_path: string | null;
  url: string | null;
  label: string | null;
  sort_order: number | null;
};

// Campaigns created before reward_assets existed — and anything still saved
// through the legacy admin form — keep their single file/link in these
// columns. Used only when a reward has no items of its own.
export type LegacyReward = {
  reward_storage_path: string | null;
  reward_content_url: string | null;
};

async function signFile(
  db: SupabaseClient,
  storagePath: string
): Promise<string | null> {
  const { data } = await db.storage
    .from("rewards")
    .createSignedUrl(storagePath, 60 * 60 * 2);
  return data?.signedUrl ?? null;
}

async function toItems(
  db: SupabaseClient,
  rows: AssetRow[]
): Promise<RewardItem[]> {
  const items = await Promise.all(
    rows.map(async (r): Promise<RewardItem | null> => {
      if (r.kind === "file") {
        if (!r.storage_path) return null;
        const url = await signFile(db, r.storage_path);
        return url ? { kind: "file", url, label: r.label ?? null } : null;
      }
      if (!r.url) return null;
      return { kind: "link", url: r.url, label: r.label ?? null };
    })
  );
  return items.filter((i): i is RewardItem => i !== null);
}

async function legacyItems(
  db: SupabaseClient,
  legacy: LegacyReward | undefined
): Promise<RewardItem[]> {
  if (!legacy) return [];
  const out: RewardItem[] = [];
  if (legacy.reward_storage_path) {
    const url = await signFile(db, legacy.reward_storage_path);
    if (url) out.push({ kind: "file", url, label: null });
  }
  // The old model treated the link as a fallback for the file, so only use it
  // when there's no file — matching exactly what fans saw before.
  if (!out.length && legacy.reward_content_url?.trim()) {
    out.push({ kind: "link", url: legacy.reward_content_url.trim(), label: null });
  }
  return out;
}

// Every item for one reward, in the order the organiser arranged them.
export async function rewardItems(
  db: SupabaseClient,
  ref: { campaignId?: string; locationId?: string },
  legacy?: LegacyReward
): Promise<RewardItem[]> {
  const column = ref.locationId ? "location_id" : "campaign_id";
  const value = ref.locationId ?? ref.campaignId;
  if (!value) return [];

  const { data } = await db
    .from("reward_assets")
    .select("kind, storage_path, url, label, sort_order")
    .eq(column, value)
    .order("sort_order");

  const rows = (data ?? []) as AssetRow[];
  if (rows.length) return toItems(db, rows);
  return legacyItems(db, legacy);
}
