import Link from "next/link";
import { requireAdmin } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default async function AdminHome() {
  await requireAdmin();

  const { data: campaigns, error } = await supabaseAdmin()
    .from("campaigns")
    .select(
      "id, slug, artist_name, title, location_name, is_active, starts_at, ends_at"
    )
    .order("created_at", { ascending: false });

  return (
    <div className="fade-up">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-serif text-3xl">Campaigns</h1>
        <Link
          href="/admin/campaigns/new"
          className="rounded-full bg-forest-deep px-5 py-2.5 text-sm font-semibold text-parchment transition active:scale-[0.98]"
        >
          New campaign
        </Link>
      </div>

      {error ? (
        <p className="mt-6 font-medium text-clay">Couldn&apos;t load campaigns.</p>
      ) : !campaigns?.length ? (
        <p className="mt-6 text-ink/60">
          No campaigns yet. Click &ldquo;New campaign&rdquo; to add your first.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto border-y border-ink/25">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.15em] text-ink/50">
              <tr className="border-b border-ink/25">
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Artist</th>
                <th className="px-4 py-3 font-medium">Slug</th>
                <th className="px-4 py-3 font-medium">Location</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Runs</th>
                <th className="px-4 py-3 font-medium">Fan page</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/15">
              {campaigns.map((c) => {
                const now = new Date();
                const live =
                  c.is_active &&
                  now >= new Date(c.starts_at) &&
                  now <= new Date(c.ends_at);
                return (
                  <tr key={c.id} className="align-top">
                    <td className="px-4 py-3 font-medium">{c.title}</td>
                    <td className="px-4 py-3 text-ink/80">{c.artist_name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-ink/60">
                      {c.slug}
                    </td>
                    <td className="px-4 py-3 text-ink/60">
                      {c.location_name}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${
                          live
                            ? "bg-forest text-parchment"
                            : c.is_active
                              ? "bg-sage/50 text-ink"
                              : "bg-ink/10 text-ink/50"
                        }`}
                      >
                        {live ? "Live" : c.is_active ? "Scheduled" : "Off"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink/60">
                      {fmt(c.starts_at)} – {fmt(c.ends_at)}
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={`/c/${c.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-clay underline underline-offset-4"
                      >
                        /c/{c.slug}
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex gap-3">
                        <Link
                          href={`/admin/campaigns/${c.id}/results`}
                          className="font-medium text-ink/80 underline underline-offset-4 hover:text-ink"
                        >
                          Results
                        </Link>
                        <Link
                          href={`/admin/campaigns/${c.id}/edit`}
                          className="font-medium text-ink/80 underline underline-offset-4 hover:text-ink"
                        >
                          Edit
                        </Link>
                      </span>
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
