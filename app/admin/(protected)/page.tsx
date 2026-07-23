import Link from "next/link";
import { requireAdmin } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const STATUS_STYLES: Record<string, string> = {
  live: "bg-forest text-parchment",
  draft: "bg-sage/50 text-ink",
  archived: "bg-ink/10 text-ink/50",
};

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });
}

export default async function AdminHome() {
  await requireAdmin();
  const db = supabaseAdmin();

  const [{ data: campaigns, error }, { data: profiles }, { data: stats }] =
    await Promise.all([
      db
        .from("campaigns")
        .select(
          "id, slug, title, artist_name, status, starts_at, ends_at, owner_id"
        )
        .order("created_at", { ascending: false }),
      db.from("profiles").select("id, org_name"),
      // Per-campaign aggregates come from the funnel_summary view — no raw
      // rows are loaded to compute them.
      db.from("funnel_summary").select("slug, registrations, unlocks"),
    ]);

  const orgById = new Map((profiles ?? []).map((p) => [p.id, p.org_name]));
  const statsBySlug = new Map((stats ?? []).map((s) => [s.slug, s]));

  return (
    <div className="fade-up">
      <h1 className="font-serif text-3xl">All campaigns</h1>

      {error ? (
        <p className="mt-6 font-medium text-clay">Couldn&apos;t load campaigns.</p>
      ) : !campaigns?.length ? (
        <p className="mt-6 text-ink/60">No campaigns on the platform yet.</p>
      ) : (
        <div className="mt-6 overflow-x-auto border-y border-ink/25">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.15em] text-ink/50">
              <tr className="border-b border-ink/25">
                <th className="px-3 py-3 font-medium">Owner</th>
                <th className="px-3 py-3 font-medium">Title</th>
                <th className="px-3 py-3 font-medium">Slug</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Runs</th>
                <th className="px-3 py-3 font-medium">Fan page</th>
                <th className="px-3 py-3 text-right font-medium">Regs</th>
                <th className="px-3 py-3 text-right font-medium">Unlocks</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/15">
              {campaigns.map((c) => {
                const s = statsBySlug.get(c.slug);
                return (
                  <tr key={c.id} className="align-top">
                    <td className="px-3 py-3 text-ink/80">
                      {orgById.get(c.owner_id) || (
                        <span className="text-ink/40">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 font-medium">{c.title}</td>
                    <td className="px-3 py-3 font-mono text-xs text-ink/60">
                      {c.slug}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${
                          STATUS_STYLES[c.status] ?? STATUS_STYLES.draft
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-ink/60">
                      {fmt(c.starts_at)} – {fmt(c.ends_at)}
                    </td>
                    <td className="px-3 py-3">
                      <a
                        href={`/c/${c.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-clay underline underline-offset-4"
                      >
                        open
                      </a>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs">
                      {s?.registrations ?? 0}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs">
                      {s?.unlocks ?? 0}
                    </td>
                    <td className="px-3 py-3">
                      <Link
                        href={`/admin/campaigns/${c.id}/results`}
                        className="font-medium text-ink/70 underline underline-offset-4 hover:text-ink"
                      >
                        Results
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
