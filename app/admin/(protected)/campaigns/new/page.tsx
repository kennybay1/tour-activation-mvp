import { requireAdmin } from "@/lib/supabase-server";
import CampaignForm from "../campaign-form";

export const dynamic = "force-dynamic";

export default async function NewCampaignPage() {
  await requireAdmin();
  return (
    <div className="fade-up max-w-2xl">
      <h1 className="font-serif text-3xl">New campaign</h1>
      <p className="mt-1 mb-8 text-sm text-ink/50">
        Fill in the details below. You can edit everything later.
      </p>
      <CampaignForm />
    </div>
  );
}
