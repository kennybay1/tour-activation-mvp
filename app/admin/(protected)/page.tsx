import { requireAdmin } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export default async function AdminHome() {
  await requireAdmin();

  const { data: campaigns, error } = await supabaseAdmin()
    .from("campaigns")
    .select(
      "id, slug, artist_name, title, location_name, is_active, starts_at, ends_at"
    )
    .order("created_at", { ascending: false });

  if (error) {
    return <p className="text-red-400">Couldn&apos;t load campaigns.</p>;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Campaigns</h1>
      {!campaigns?.length ? (
        <p className="mt-4 text-zinc-400">
          No campaigns yet — add one in the Supabase table editor.
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {campaigns.map((c) => {
            const now = new Date();
            const live =
              c.is_active &&
              now >= new Date(c.starts_at) &&
              now <= new Date(c.ends_at);
            return (
              <li
                key={c.id}
                className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm uppercase tracking-widest text-fuchsia-400">
                      {c.artist_name}
                    </p>
                    <p className="mt-1 font-semibold">{c.title}</p>
                    <p className="mt-1 text-sm text-zinc-500">
                      {c.location_name} · ends{" "}
                      {new Date(c.ends_at).toLocaleDateString("en-GB")}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                      live
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-zinc-800 text-zinc-500"
                    }`}
                  >
                    {live ? "Live" : "Off"}
                  </span>
                </div>
                <a
                  href={`/c/${c.slug}`}
                  target="_blank"
                  className="mt-3 inline-block text-sm font-medium text-fuchsia-400 underline underline-offset-4"
                >
                  Open fan page → /c/{c.slug}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
