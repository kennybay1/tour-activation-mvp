import { requireAdmin } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  await requireAdmin();
  const db = supabaseAdmin();

  const { data: leads } = await db
    .from("leads")
    .select(
      "id, name, email, organisation, role, artist_context, message, source, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(500);

  return (
    <div className="fade-up">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-serif text-3xl">Leads</h1>
        <a
          href="/api/admin/leads/export"
          className="rounded-full border border-ink/30 px-4 py-2 text-sm font-medium text-ink/80 transition hover:border-ink/60"
        >
          Download leads (CSV)
        </a>
      </div>
      <p className="mt-1 text-sm text-ink/50">
        People who asked to talk, newest first.
      </p>

      {!leads?.length ? (
        <p className="mt-6 border-y border-ink/25 py-5 text-sm text-ink/50">
          No leads yet — they&apos;ll appear here when someone sends the
          &ldquo;Talk to us&rdquo; form.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto border-y border-ink/25">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.15em] text-ink/50">
              <tr className="border-b border-ink/25">
                <th className="px-3 py-3 font-medium">Name</th>
                <th className="px-3 py-3 font-medium">Email</th>
                <th className="px-3 py-3 font-medium">Organisation</th>
                <th className="px-3 py-3 font-medium">Role</th>
                <th className="px-3 py-3 font-medium">For</th>
                <th className="px-3 py-3 font-medium">Message</th>
                <th className="px-3 py-3 font-medium">Source</th>
                <th className="px-3 py-3 font-medium">Received</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/15">
              {leads.map((l) => (
                <tr key={l.id} className="align-top">
                  <td className="px-3 py-3 font-medium">{l.name}</td>
                  <td className="px-3 py-3 text-ink/80">{l.email}</td>
                  <td className="px-3 py-3 text-ink/60">
                    {l.organisation ?? "—"}
                  </td>
                  <td className="px-3 py-3 text-ink/60">{l.role ?? "—"}</td>
                  <td className="px-3 py-3 text-ink/60">
                    {l.artist_context ?? "—"}
                  </td>
                  <td className="max-w-xs px-3 py-3 text-ink/60">
                    {l.message ?? "—"}
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-ink/50">
                    {l.source}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-ink/60">
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
