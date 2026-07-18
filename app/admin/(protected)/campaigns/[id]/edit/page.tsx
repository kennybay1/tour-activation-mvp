import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import CampaignForm, {
  type CampaignFormValues,
} from "../../campaign-form";

export const dynamic = "force-dynamic";

export default async function EditCampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const db = supabaseAdmin();

  const [
    { data: c, error },
    { data: profiles },
    { data: usersData },
    { data: firstLoc },
  ] = await Promise.all([
    db.from("campaigns").select("*").eq("id", id).maybeSingle(),
    db.from("profiles").select("id, org_name").order("created_at"),
    db.auth.admin.listUsers(),
    db
      .from("campaign_locations")
      .select("location_name, lat, lng, radius_m")
      .eq("campaign_id", id)
      .order("sort_order")
      .limit(1)
      .maybeSingle(),
  ]);

  if (error) {
    return (
      <p className="font-medium text-clay">Couldn&apos;t load this campaign.</p>
    );
  }
  if (!c) notFound();

  const emailById = new Map(usersData.users.map((u) => [u.id, u.email]));
  const owners = (profiles ?? []).map((p) => ({
    id: p.id,
    label: p.org_name || emailById.get(p.id) || p.id.slice(0, 8),
  }));

  const initial: CampaignFormValues = {
    slug: c.slug ?? "",
    artist_name: c.artist_name ?? "",
    title: c.title ?? "",
    description: c.description ?? "",
    location_name: firstLoc?.location_name ?? "",
    lat: firstLoc?.lat != null ? String(firstLoc.lat) : "",
    lng: firstLoc?.lng != null ? String(firstLoc.lng) : "",
    radius_m: firstLoc?.radius_m != null ? String(firstLoc.radius_m) : "",
    reward_teaser: c.reward_teaser ?? "",
    reward_content_url: c.reward_content_url ?? "",
    discount_code: c.discount_code ?? "",
    ticket_url: c.ticket_url ?? "",
    startsLocal: "", // filled client-side in the browser's timezone
    endsLocal: "",
    is_active: c.is_active ?? true,
  };

  return (
    <div className="fade-up max-w-2xl">
      <h1 className="font-serif text-3xl">Edit campaign</h1>
      <p className="mt-1 mb-8 text-sm text-ink/50">{c.title}</p>
      <CampaignForm
        campaignId={c.id}
        initial={initial}
        startsIso={c.starts_at}
        endsIso={c.ends_at}
        owners={owners}
        defaultOwnerId={c.owner_id ?? undefined}
        initialStatus={c.status}
      />
    </div>
  );
}
