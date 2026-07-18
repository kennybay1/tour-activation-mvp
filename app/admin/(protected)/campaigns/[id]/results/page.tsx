import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type FunnelRow = {
  page_views: number;
  permission_granted: number;
  grant_rate_pct: number | null;
  permission_denied: number;
  registrations: number;
  unlocks: number;
  out_of_range_attempts: number;
  ticket_clicks: number;
  unlock_to_click_rate_pct: number | null;
};

function pct(v: number | null | undefined): string {
  return v == null ? "—" : `${v}%`;
}

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const db = supabaseAdmin();

  const { data: campaign } = await db
    .from("campaigns")
    .select("id, slug, title, artist_name")
    .eq("id", id)
    .maybeSingle();
  if (!campaign) notFound();

  // The funnel is computed inside Postgres by the funnel_summary view
  // (see reports/funnel.sql) — no event rows are loaded into the app.
  const { data: funnel, error: funnelError } = (await db
    .from("funnel_summary")
    .select(
      "page_views, permission_granted, grant_rate_pct, permission_denied, registrations, unlocks, out_of_range_attempts, ticket_clicks, unlock_to_click_rate_pct"
    )
    .eq("slug", campaign.slug)
    .maybeSingle()) as { data: FunnelRow | null; error: { message: string } | null };

  const { data: highIntent } = await db
    .from("claims")
    .select("email, marketing_consent, consent_at, distance_m, created_at")
    .eq("campaign_id", campaign.id)
    .eq("unlocked", false)
    .order("created_at", { ascending: false })
    .limit(500);

  return (
    <div>
      <Link
        href="/admin"
        className="text-sm font-medium text-zinc-400 underline underline-offset-4 hover:text-zinc-200"
      >
        ← All campaigns
      </Link>
      <h1 className="mt-3 text-2xl font-bold tracking-tight">
        Results — {campaign.title}
      </h1>
      <p className="mt-1 text-sm text-zinc-500">{campaign.artist_name}</p>

      {funnelError ? (
        <div className="mt-8 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm text-amber-200">
          <p className="font-semibold">One-off setup needed</p>
          <p className="mt-1 text-amber-200/80">
            The funnel is computed by a database view that hasn&apos;t been
            created yet. Open the Supabase SQL editor and run the
            &ldquo;funnel_summary&rdquo; section at the bottom of{" "}
            <span className="font-mono">reports/funnel.sql</span>, then reload
            this page.
          </p>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Unique page views" value={funnel?.page_views ?? 0} />
          <Stat
            label="Permission granted"
            value={funnel?.permission_granted ?? 0}
            sub={`${pct(funnel?.grant_rate_pct)} of visitors`}
          />
          <Stat
            label="Permission denied"
            value={funnel?.permission_denied ?? 0}
          />
          <Stat label="Registrations" value={funnel?.registrations ?? 0} />
          <Stat label="Unlocks" value={funnel?.unlocks ?? 0} />
          <Stat
            label="Out-of-range attempts"
            value={funnel?.out_of_range_attempts ?? 0}
          />
          <Stat label="Ticket clicks" value={funnel?.ticket_clicks ?? 0} />
          <Stat
            label="Unlock → ticket click"
            value={pct(funnel?.unlock_to_click_rate_pct)}
          />
        </div>
      )}

      <div className="mt-10 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold tracking-tight">
          High intent, didn&apos;t make it
        </h2>
        <div className="flex gap-3">
          <a
            href={`/api/admin/campaigns/${campaign.id}/export?type=consented`}
            className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition hover:border-zinc-500"
          >
            Download consented contacts (CSV)
          </a>
          <a
            href={`/api/admin/campaigns/${campaign.id}/export?type=all`}
            className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition hover:border-zinc-500"
          >
            Download all claims (CSV)
          </a>
        </div>
      </div>
      <p className="mt-1 text-sm text-zinc-500">
        Fans who registered but never unlocked — worth a follow-up if they
        consented.
      </p>

      {!highIntent?.length ? (
        <p className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 text-sm text-zinc-500">
          No one in this list{" "}
          {funnel?.registrations ? "— everyone who registered unlocked. 🎉" : "yet."}
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-900/60 text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Marketing consent</th>
                <th className="px-4 py-3 font-medium">Closest distance</th>
                <th className="px-4 py-3 font-medium">Registered</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {highIntent.map((r) => (
                <tr key={r.email}>
                  <td className="px-4 py-3 text-zinc-100">{r.email}</td>
                  <td className="px-4 py-3">
                    {r.marketing_consent ? (
                      <span className="text-emerald-400">Yes</span>
                    ) : (
                      <span className="text-zinc-500">No</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-400">
                    {r.distance_m != null ? `${r.distance_m}m away` : "—"}
                  </td>
                  <td className="px-4 py-3 text-zinc-400">
                    {new Date(r.created_at).toLocaleDateString("en-GB")}
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

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: number | string;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <p className="text-xs uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-zinc-100">{value}</p>
      {sub && <p className="mt-1 text-xs text-zinc-500">{sub}</p>}
    </div>
  );
}
