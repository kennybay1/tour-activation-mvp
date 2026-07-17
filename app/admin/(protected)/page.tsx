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
    <div>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">Campaigns</h1>
        <Link
          href="/admin/campaigns/new"
          className="rounded-xl bg-zinc-50 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition active:scale-[0.98]"
        >
          New campaign
        </Link>
      </div>

      {error ? (
        <p className="mt-6 text-red-400">Couldn&apos;t load campaigns.</p>
      ) : !campaigns?.length ? (
        <p className="mt-6 text-zinc-400">
          No campaigns yet. Click &ldquo;New campaign&rdquo; to add your first.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-900/60 text-xs uppercase tracking-wider text-zinc-500">
              <tr>
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
            <tbody className="divide-y divide-zinc-800">
              {campaigns.map((c) => {
                const now = new Date();
                const live =
                  c.is_active &&
                  now >= new Date(c.starts_at) &&
                  now <= new Date(c.ends_at);
                return (
                  <tr key={c.id} className="align-top">
                    <td className="px-4 py-3 font-medium text-zinc-100">
                      {c.title}
                    </td>
                    <td className="px-4 py-3 text-zinc-300">{c.artist_name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-400">
                      {c.slug}
                    </td>
                    <td className="px-4 py-3 text-zinc-400">
                      {c.location_name}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${
                          live
                            ? "bg-emerald-500/15 text-emerald-400"
                            : c.is_active
                              ? "bg-amber-500/15 text-amber-400"
                              : "bg-zinc-800 text-zinc-500"
                        }`}
                      >
                        {live ? "Live" : c.is_active ? "Scheduled" : "Off"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-400">
                      {fmt(c.starts_at)} – {fmt(c.ends_at)}
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={`/c/${c.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-fuchsia-400 underline underline-offset-4"
                      >
                        /c/{c.slug}
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/campaigns/${c.id}/edit`}
                        className="font-medium text-zinc-300 underline underline-offset-4 hover:text-zinc-100"
                      >
                        Edit
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
