"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser, supabaseServer } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type ActionResult = { ok: boolean; message?: string };

// The builder saves through the browser Supabase client, so no Server Action
// runs and Next never learns the campaign list changed — "Your campaigns"
// would keep serving its cached copy until a manual refresh. The form calls
// this after every successful save to mark that list stale, the same way
// publish/archive below do.
export async function revalidateDashboard(): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;
  revalidatePath("/dashboard");
}

// Both actions use the organiser's own authenticated client — RLS means the
// update silently matches zero rows unless they own the campaign.

export async function publishCampaign(id: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Please sign in again." };
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("campaigns")
    .update({ status: "live" })
    .eq("id", id)
    .select("id");
  if (error || !data?.length) {
    return { ok: false, message: "Couldn't publish. Try again." };
  }
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function archiveCampaign(id: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Please sign in again." };
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("campaigns")
    .update({ status: "archived" })
    .eq("id", id)
    .select("id");
  if (error || !data?.length) {
    return { ok: false, message: "Couldn't archive. Try again." };
  }
  revalidatePath("/dashboard");
  return { ok: true };
}

// Permanent delete. Unlike archive (a reversible status flip), this removes
// the campaign and everything hanging off it — locations, reward items,
// claims/collections, analytics events, and the uploaded files. Ownership is
// checked explicitly here because the service role (needed to clear rows that
// organisers can't delete under RLS, e.g. claims/events) bypasses RLS.
export async function deleteCampaign(id: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Please sign in again." };
  const db = supabaseAdmin();

  const { data: campaign, error: loadError } = await db
    .from("campaigns")
    .select("id, owner_id, background_image_path, reward_storage_path")
    .eq("id", id)
    .maybeSingle();
  if (loadError) return { ok: false, message: "Couldn't delete. Try again." };
  if (!campaign || campaign.owner_id !== user.id) {
    // Same response whether it's missing or not theirs — never confirm the
    // existence of another owner's campaign.
    return { ok: false, message: "That campaign can't be deleted." };
  }

  // Gather every stored file before the rows that point at them are gone.
  const [{ data: locs }, { data: assets }] = await Promise.all([
    db.from("campaign_locations").select("reward_storage_path").eq("campaign_id", id),
    db.from("reward_assets").select("storage_path").eq("campaign_id", id),
  ]);
  const rewardPaths = [
    campaign.reward_storage_path,
    ...(locs ?? []).map((l) => l.reward_storage_path),
    ...(assets ?? []).map((a) => a.storage_path),
  ].filter((p): p is string => !!p);

  // Children first — some FKs aren't cascade, so the campaign row can't go
  // until these are cleared.
  for (const table of [
    "location_unlocks",
    "events",
    "claims",
    "reward_assets",
    "campaign_locations",
  ]) {
    const { error } = await db.from(table).delete().eq("campaign_id", id);
    if (error) return { ok: false, message: "Couldn't delete. Try again." };
  }
  const { error: delError } = await db.from("campaigns").delete().eq("id", id);
  if (delError) return { ok: false, message: "Couldn't delete. Try again." };

  // Best-effort file cleanup — the rows are already gone, so a storage hiccup
  // here just leaves orphaned files, never a half-deleted campaign.
  if (rewardPaths.length) {
    await db.storage.from("rewards").remove(rewardPaths);
  }
  if (campaign.background_image_path) {
    await db.storage.from("backgrounds").remove([campaign.background_image_path]);
  }

  revalidatePath("/dashboard");
  return { ok: true };
}
