"use server";

import { revalidatePath } from "next/cache";
import { getAdminUser } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  validateCampaign,
  type CampaignInput,
} from "@/lib/campaign-schema";

export type SaveResult =
  | { ok: true; id: string }
  | { ok: false; errors: Record<string, string> };

// Shape a validated input into the exact DB columns. Location fields go
// to campaign_locations, never to the legacy campaign columns.
function toRow(input: CampaignInput) {
  return {
    slug: input.slug.trim(),
    artist_name: input.artist_name.trim(),
    title: input.title.trim(),
    description: input.description.trim() || null,
    reward_teaser: input.reward_teaser.trim() || null,
    reward_content_url: input.reward_content_url.trim() || null,
    discount_code: input.discount_code.trim() || null,
    ticket_url: input.ticket_url.trim() || null,
    starts_at: new Date(input.starts_at).toISOString(),
    ends_at: new Date(input.ends_at).toISOString(),
    is_active: input.is_active,
  };
}

// Rewards are read from reward_assets now, so the single link this form
// edits has to be mirrored there — otherwise a change here would be quietly
// ignored in favour of a stale item. Only the campaign's own link item is
// touched; uploaded files (added in the organiser dashboard) are left alone.
async function syncAdminLinkAsset(campaignId: string, input: CampaignInput) {
  const db = supabaseAdmin();
  const url = input.reward_content_url.trim();
  await db
    .from("reward_assets")
    .delete()
    .eq("campaign_id", campaignId)
    .eq("kind", "link");
  if (!url) return;
  await db.from("reward_assets").insert({
    campaign_id: campaignId,
    kind: "link",
    storage_path: null,
    url,
    label: null,
    sort_order: 99,
  });
}

// The admin form edits a single (primary) location; other locations a
// campaign may have are left untouched.
async function syncPrimaryLocation(campaignId: string, input: CampaignInput) {
  const db = supabaseAdmin();
  const loc = {
    location_name: (input.location_name ?? "").trim(),
    lat: Number(input.lat),
    lng: Number(input.lng),
    radius_m: Number(input.radius_m),
  };
  const { data: existing } = await db
    .from("campaign_locations")
    .select("id")
    .eq("campaign_id", campaignId)
    .order("sort_order")
    .limit(1)
    .maybeSingle();
  const res = existing
    ? await db.from("campaign_locations").update(loc).eq("id", existing.id)
    : await db
        .from("campaign_locations")
        .insert({ ...loc, campaign_id: campaignId, sort_order: 0 });
  return res.error ?? null;
}

export async function saveCampaign(
  input: CampaignInput,
  opts: { id?: string; ownerId?: string; status?: string } = {}
): Promise<SaveResult> {
  const { id, ownerId, status } = opts;
  // Auth gate — every write is behind the admin check.
  const admin = await getAdminUser();
  if (!admin) return { ok: false, errors: { _form: "Not authorised." } };

  const errors = validateCampaign(input);

  if (ownerId === undefined || ownerId === "") {
    errors.owner_id = "Choose which account owns this campaign.";
  }
  if (status && !["draft", "live", "archived"].includes(status)) {
    errors.status = "Invalid status.";
  }

  // Slug uniqueness needs the database, so it lives here rather than in the
  // pure schema module.
  if (!errors.slug) {
    const { data: clash, error: clashError } = await supabaseAdmin()
      .from("campaigns")
      .select("id")
      .eq("slug", input.slug.trim())
      .maybeSingle();
    if (clashError) {
      return { ok: false, errors: { _form: "Couldn't check the slug. Try again." } };
    }
    if (clash && clash.id !== id) {
      errors.slug = "That slug is already used by another campaign.";
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const row = {
    ...toRow(input),
    owner_id: ownerId,
    ...(status ? { status } : {}),
  };

  if (id) {
    const { error } = await supabaseAdmin()
      .from("campaigns")
      .update(row)
      .eq("id", id);
    if (error) return { ok: false, errors: { _form: "Couldn't save. Try again." } };
    const locError = await syncPrimaryLocation(id, input);
    if (locError) {
      return { ok: false, errors: { _form: "Couldn't save the location. Try again." } };
    }
    await syncAdminLinkAsset(id, input);
    revalidatePath("/admin");
    revalidatePath(`/c/${row.slug}`);
    return { ok: true, id };
  }

  const { data, error } = await supabaseAdmin()
    .from("campaigns")
    .insert(row)
    .select("id")
    .single();
  if (error || !data) {
    return { ok: false, errors: { _form: "Couldn't create the campaign. Try again." } };
  }
  const locError = await syncPrimaryLocation(data.id, input);
  if (locError) {
    return { ok: false, errors: { _form: "Campaign created, but its location failed to save — edit it to retry." } };
  }
  await syncAdminLinkAsset(data.id, input);
  revalidatePath("/admin");
  revalidatePath(`/c/${row.slug}`);
  return { ok: true, id: data.id };
}

// Live slug-availability check used on blur in the form.
export async function checkSlugAvailable(
  slug: string,
  excludeId?: string
): Promise<{ available: boolean }> {
  const admin = await getAdminUser();
  if (!admin) return { available: false };
  const { data } = await supabaseAdmin()
    .from("campaigns")
    .select("id")
    .eq("slug", slug.trim())
    .maybeSingle();
  return { available: !data || data.id === excludeId };
}
