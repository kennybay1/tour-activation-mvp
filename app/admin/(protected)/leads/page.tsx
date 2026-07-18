import { requireAdmin } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type LeadRow = {
  id: string;
  email: string;
  marketing_consent: boolean;
  unlocked: boolean;
  ticket_clicked_at: string | null;
  created_at: string;
  campaigns: { title: string; slug: string } | null;
};

export default async function LeadsPage() {
  await requireAdmin();
  const db = supabaseAdmin();

  const { data: leads } = (await db
    .from("claims")
    .select(
      "id, email, marketing_consent, unlocked, ticket_clicked_at, created_at, campaigns(title, slug)"
    )
    .order("created_at", { ascending: false })
    .limit(500)) as { data: LeadRow[] | null };

  return (
    <div className="fade-up">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-serif text-3xl">Leads</h1>
        <a
          href="/api/admin/leads/export"
          className="rounded-full border border-ink/30 px-4 py-2 text-sm font-medium text-ink/80 transition hover:border-ink/60"
        >
          Download all leads (CSV)
        </a>
      </div>
      <p className="mt-1 text-sm text-ink/50">
        Every fan registration across the platform, newest first.
      </p>

      {!leads?.length ? (
        <p className="mt-6 border-y border-ink/25 py-5 text-sm text-ink/50">
          No sign-ups yet — they&apos;ll appear here the moment a fan
          registers on any campaign.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto border-y border-ink/25">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.15em] text-ink/50">
              <tr className="border-b border-ink/25">
                <th className="px-3 py-3 font-medium">Email</th>
                <th className="px-3 py-3 font-medium">Campaign</th>
                <th className="px-3 py-3 font-medium">Consent</th>
                <th className="px-3 py-3 font-medium">Unlocked</th>
                <th className="px-3 py-3 font-medium">Ticket click</th>
                <th className="px-3 py-3 font-medium">Registered</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/15">
              {leads.map((l) => (
                <tr key={l.id}>
                  <td className="px-3 py-3">{l.email}</td>
                  <td className="px-3 py-3 text-ink/60">
                    {l.campaigns?.title ?? "—"}
                  </td>
                  <td className="px-3 py-3">
                    {l.marketing_consent ? (
                      <span className="font-medium text-forest">Yes</span>
                    ) : (
                      <span className="text-ink/50">No</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {l.unlocked ? (
                      <span className="font-medium text-forest">Yes</span>
                    ) : (
                      <span className="text-ink/50">No</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {l.ticket_clicked_at ? (
                      <span className="font-medium text-forest">Yes</span>
                    ) : (
                      <span className="text-ink/50">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-ink/60">
                    {new Date(l.created_at).toLocaleDateString("en-GB")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
