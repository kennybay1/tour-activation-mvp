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
  const { data: c, error } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .maybeSingle();

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
    location_name: c.location_name ?? "",
    lat: c.lat != null ? String(c.lat) : "",
    lng: c.lng != null ? String(c.lng) : "",
    radius_m: c.radius_m != null ? String(c.radius_m) : "",
    reward_teaser: c.reward_teaser ?? "",
    reward_content_url: c.reward_content_url ?? "",
    discount_code: c.discount_code ?? "",
    ticket_url: c.ticket_url ?? "",
    startsLocal: "",
    endsLocal: "",
  };

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
      />
    </div>
  );
}
