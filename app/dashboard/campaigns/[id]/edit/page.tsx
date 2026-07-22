import { notFound } from "next/navigation";
import { requireUser, supabaseServer } from "@/lib/supabase-server";
import OrganiserCampaignForm, {
  type OrganiserFormValues,
} from "../../campaign-form";
import CampaignNav from "../../campaign-nav";

export const dynamic = "force-dynamic";

export default async function EditCampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;

  // Authenticated client — RLS returns nothing unless this user owns it.
  const supabase = await supabaseServer();
  const [{ data: c, error }, { data: locs }] = await Promise.all([
    supabase.from("campaigns").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("campaign_locations")
      .select(
        "id, location_name, lat, lng, radius_m, sort_order, source, external_ref, reward_teaser, discount_code, ticket_url"
      )
      .eq("campaign_id", id)
      .order("sort_order"),
  ]);

  if (error) {
    return (
      <p className="font-medium text-clay">Couldn&apos;t load this campaign.</p>
    );
  }
  if (!c) notFound();

  // Reward items: the campaign's own, plus every stop's. Fetched by explicit
  // ids so one campaign can never pull in another's.
  const ASSET_COLS = "id, location_id, kind, storage_path, url, label, sort_order";
  const locIds = (locs ?? []).map((l) => l.id);
  const [{ data: campaignAssetRows }, { data: locAssetRows }] =
    await Promise.all([
      supabase
        .from("reward_assets")
        .select(ASSET_COLS)
        .eq("campaign_id", id)
        .order("sort_order"),
      locIds.length
        ? supabase
            .from("reward_assets")
            .select(ASSET_COLS)
            .in("location_id", locIds)
            .order("sort_order")
        : Promise.resolve({ data: [] as never[] }),
    ]);

  const toAsset = (a: {
    id: string;
    kind: string;
    storage_path: string | null;
    url: string | null;
    label: string | null;
  }) => ({
    id: a.id,
    tempId: a.id,
    kind: a.kind === "link" ? ("link" as const) : ("file" as const),
    storage_path: a.storage_path,
    url: a.url ?? undefined,
    label: a.label ?? undefined,
  });

  const initialAssets = (campaignAssetRows ?? []).map(toAsset);
  const assetsByLocation = new Map<string, ReturnType<typeof toAsset>[]>();
  for (const a of locAssetRows ?? []) {
    if (!a.location_id) continue;
    const list = assetsByLocation.get(a.location_id) ?? [];
    list.push(toAsset(a));
    assetsByLocation.set(a.location_id, list);
  }

  const initial: OrganiserFormValues = {
    slug: c.slug ?? "",
    artist_name: c.artist_name ?? "",
    title: c.title ?? "",
    description: c.description ?? "",
    campaign_type: c.campaign_type ?? "single",
    reward_teaser: c.reward_teaser ?? "",
    reward_content_url: c.reward_content_url ?? "",
    discount_code: c.discount_code ?? "",
    ticket_url: c.ticket_url ?? "",
    startsLocal: "",
    endsLocal: "",
    expired_headline: c.expired_headline ?? "",
    expired_message: c.expired_message ?? "",
    expired_link_url: c.expired_link_url ?? "",
    expired_link_label: c.expired_link_label ?? "",
  };

  // tempId reuses the DB id — stable across re-renders, and doubles as
  // the "this row already exists" marker the form uses to decide
  // update vs. insert on save.
  const initialLocations = (locs ?? []).map((l) => ({
    id: l.id,
    tempId: l.id,
    location_name: l.location_name,
    lat: l.lat,
    lng: l.lng,
    radius_m: l.radius_m,
    sort_order: l.sort_order,
    source: l.source,
    external_ref: l.external_ref ?? undefined,
    reward_teaser: l.reward_teaser ?? "",
    discount_code: l.discount_code ?? "",
    ticket_url: l.ticket_url ?? "",
    assets: assetsByLocation.get(l.id) ?? [],
  }));

  return (
    <div className="fade-up max-w-2xl">
      <CampaignNav crumb={{ title: c.title, page: "Edit" }} />
      <h1 className="font-serif text-3xl">Edit campaign</h1>
      <p className="mt-1 mb-8 text-sm text-ink/50">{c.title}</p>
      <OrganiserCampaignForm
        campaignId={c.id}
        initial={initial}
        startsIso={c.starts_at}
        endsIso={c.ends_at}
        backgroundPath={c.background_image_path}
        initialLocations={initialLocations}
        initialAssets={initialAssets}
        status={c.status}
      />
    </div>
  );
}
