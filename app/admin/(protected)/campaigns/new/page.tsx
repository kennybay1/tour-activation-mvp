import { requireAdmin } from "@/lib/supabase-server";
import CampaignForm from "../campaign-form";

export const dynamic = "force-dynamic";

export default async function NewCampaignPage() {
  await requireAdmin();
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">New campaign</h1>
      <p className="mt-1 mb-8 text-sm text-zinc-500">
        Fill in the details below. You can edit everything later.
      </p>
      <CampaignForm />
    </div>
  );
}
