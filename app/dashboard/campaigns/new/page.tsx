import { requireUser } from "@/lib/supabase-server";
import OrganiserCampaignForm from "../campaign-form";

export const dynamic = "force-dynamic";

export default async function NewCampaignPage() {
  await requireUser();
  return (
    <div className="fade-up max-w-2xl">
      <h1 className="font-serif text-3xl">New campaign</h1>
      <p className="mt-1 mb-8 text-sm text-ink/50">
        Fill in the details below. It starts as a draft — nothing goes public
        until you press &ldquo;Go live&rdquo;.
      </p>
      <OrganiserCampaignForm />
    </div>
  );
}
