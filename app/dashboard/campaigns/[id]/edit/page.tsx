import { notFound } from "next/navigation";
import { requireUser, supabaseServer } from "@/lib/supabase-server";
import OrganiserCampaignForm, {
  type OrganiserFormValues,
} from "../../campaign-form";

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
      .select("id, location_name, lat, lng, radius_m, sort_order, source, external_ref")
      .eq("campaign_id", id)
      .order("sort_order"),
  ]);

  if (error) {
    return (
      <p className="font-medium text-clay">Couldn&apos;t load this campaign.</p>
    );
  }
  if (!c) notFound();

  const initial: OrganiserFormValues = {
    slug: c.slug ?? "",
    artist_name: c.artist_name ?? "",
    title: c.title ?? "",
    description: c.description ?? "",
    reward_teaser: c.reward_teaser ?? "",
    reward_content_url: c.reward_content_url ?? "",
    discount_code: c.discount_code ?? "",
    ticket_url: c.ticket_url ?? "",
    startsLocal: "",
    endsLocal: "",
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
  }));

  return (
    <div className="fade-up max-w-2xl">
      <h1 className="font-serif text-3xl">Edit campaign</h1>
      <p className="mt-1 mb-8 text-sm text-ink/50">{c.title}</p>
      <OrganiserCampaignForm
        campaignId={c.id}
        initial={initial}
        startsIso={c.starts_at}
        endsIso={c.ends_at}
        storagePath={c.reward_storage_path}
        initialLocations={initialLocations}
      />
    </div>
  );
}
