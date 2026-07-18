import { requireAdmin } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import CampaignForm from "../campaign-form";

export const dynamic = "force-dynamic";

export default async function NewCampaignPage() {
  const admin = await requireAdmin();
  const db = supabaseAdmin();

  const [{ data: profiles }, { data: usersData }] = await Promise.all([
    db.from("profiles").select("id, org_name").order("created_at"),
    db.auth.admin.listUsers(),
  ]);
  const emailById = new Map(usersData.users.map((u) => [u.id, u.email]));
  const owners = (profiles ?? []).map((p) => ({
    id: p.id,
    label: p.org_name || emailById.get(p.id) || p.id.slice(0, 8),
  }));

  return (
    <div className="fade-up max-w-2xl">
      <h1 className="font-serif text-3xl">Create campaign as…</h1>
      <p className="mt-1 mb-8 text-sm text-ink/50">
        Runs on behalf of the account you pick — it shows up in their
        dashboard like their own.
      </p>
      <CampaignForm owners={owners} defaultOwnerId={admin.id} />
    </div>
  );
}
