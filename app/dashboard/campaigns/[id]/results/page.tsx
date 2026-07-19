import { notFound } from "next/navigation";
import { requireUser, supabaseServer } from "@/lib/supabase-server";
import CampaignNav from "../../campaign-nav";

export const dynamic = "force-dynamic";

type FunnelRow = {
  page_views: number;
  permission_granted: number;
  grant_rate_pct: number | null;
  permission_denied: number;
  unlocks: number;
  out_of_range_attempts: number;
  ticket_clicks: number;
  unlock_to_click_rate_pct: number | null;
};

function pct(v: number | null | undefined): string {
  return v == null ? "—" : `${v}%`;
}

export default async function OrganiserResultsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;

  // Authenticated client throughout — RLS scopes every query to this
  // organiser's own campaigns, claims and events.
  const supabase = await supabaseServer();

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, slug, title, artist_name, ticket_url")
    .eq("id", id)
    .maybeSingle();
  if (!campaign) notFound();

  // Event aggregates come from the funnel_summary_owner view; the email
  // metrics are counted from claims directly since P3 split capture into
  // post-unlock and near-miss sources.
  const { data: funnel, error: funnelError } = (await supabase
    .from("funnel_summary_owner")
    .select(
      "page_views, permission_granted, grant_rate_pct, permission_denied, unlocks, out_of_range_attempts, ticket_clicks, unlock_to_click_rate_pct"
    )
    .eq("campaign_id", campaign.id)
    .maybeSingle()) as {
    data: FunnelRow | null;
    error: { message: string } | null;
  };

  const { data: emailRows } = await supabase
    .from("claims")
    .select("email_source, marketing_consent")
    .eq("campaign_id", campaign.id)
    .not("email", "is", null);
  const emailsCaptured = emailRows?.length ?? 0;
  const postUnlockEmails =
    emailRows?.filter((r) => r.email_source === "post_unlock").length ?? 0;
  const nearMissEmails =
    emailRows?.filter((r) => r.email_source === "near_miss").length ?? 0;
  const consentedContacts =
    emailRows?.filter((r) => r.marketing_consent).length ?? 0;

  // "High intent, didn't make it" — fans who couldn't reach the spot but
  // left an email on the out-of-range screen.
  const { data: highIntent } = await supabase
    .from("claims")
    .select("email, marketing_consent, distance_m, email_captured_at")
    .eq("campaign_id", campaign.id)
    .eq("email_source", "near_miss")
    .not("email", "is", null)
    .order("email_captured_at", { ascending: false })
    .limit(500);

  // Per-location breakdown — all RLS-scoped reads of narrow columns.
  const [{ data: locs }, { data: unlockRows }, { data: oorEvents }] =
    await Promise.all([
      supabase
        .from("campaign_locations")
        .select("id, location_name")
        .eq("campaign_id", campaign.id)
        .order("sort_order"),
      supabase
        .from("claims")
        .select("unlocked_location_id")
        .eq("campaign_id", campaign.id)
        .eq("unlocked", true),
      supabase
        .from("events")
        .select("metadata")
        .eq("campaign_id", campaign.id)
        .eq("event_type", "unlock_out_of_range")
        .limit(5000),
    ]);
  const unlocksByLoc = new Map<string, number>();
  let unattributedUnlocks = 0;
  for (const r of unlockRows ?? []) {
    if (r.unlocked_location_id) {
      unlocksByLoc.set(
        r.unlocked_location_id,
        (unlocksByLoc.get(r.unlocked_location_id) ?? 0) + 1
      );
    } else {
      unattributedUnlocks++;
    }
  }
  const oorByLoc = new Map<string, number>();
  for (const e of oorEvents ?? []) {
    const id = (e.metadata as { location_id?: string } | null)?.location_id;
    if (id) oorByLoc.set(id, (oorByLoc.get(id) ?? 0) + 1);
  }

  const hasTicketUrl = !!campaign.ticket_url;

  return (
    <div className="fade-up">
      <CampaignNav crumb={{ title: campaign.title, page: "Results" }} />
      <h1 className="mt-3 font-serif text-3xl">Results — {campaign.title}</h1>
      <p className="mt-1 text-xs uppercase tracking-[0.25em] text-clay">
        {campaign.artist_name}
      </p>

      {funnelError ? (
        <div className="mt-8 rounded-xl border border-clay/60 bg-clay/10 p-5 text-sm">
          <p className="font-semibold text-clay">Analytics warming up</p>
          <p className="mt-1 text-ink/70">
            The results funnel isn&apos;t available just yet — check back
            shortly.
          </p>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-2 border-b border-r border-ink/25 sm:grid-cols-4">
          <Stat label="Unique visitors" value={funnel?.page_views ?? 0} />
          <Stat
            label="Permission granted"
            value={funnel?.permission_granted ?? 0}
            sub={`${pct(funnel?.grant_rate_pct)} of visitors`}
          />
          <Stat
            label="Permission denied"
            value={funnel?.permission_denied ?? 0}
          />
          <Stat label="Unlocks" value={funnel?.unlocks ?? 0} />
          <Stat
            label="Out-of-range attempts"
            value={funnel?.out_of_range_attempts ?? 0}
          />
          <Stat
            label="Emails captured"
            value={emailsCaptured}
            sub={`${postUnlockEmails} post-unlock · ${nearMissEmails} near-miss`}
          />
          <Stat label="Consented contacts" value={consentedContacts} />
          {/* No ticket link on this campaign means no ticket CTA was ever
              shown — a 0% here would misread as underperformance. */}
          {hasTicketUrl && (
            <Stat
              label="Ticket clicks"
              value={funnel?.ticket_clicks ?? 0}
              sub={`${pct(funnel?.unlock_to_click_rate_pct)} of unlocks`}
            />
          )}
        </div>
      )}

      {(locs?.length ?? 0) > 0 && (
        <div className="mt-10">
          <h2 className="font-serif text-2xl">By location</h2>
          <div className="mt-4 overflow-x-auto border-y border-ink/25">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.15em] text-ink/50">
                <tr className="border-b border-ink/25">
                  <th className="px-4 py-3 font-medium">Location</th>
                  <th className="px-4 py-3 text-right font-medium">Unlocks</th>
                  <th className="px-4 py-3 text-right font-medium">
                    Out-of-range attempts
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/15">
                {locs!.map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-3">{l.location_name}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      {unlocksByLoc.get(l.id) ?? 0}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      {oorByLoc.get(l.id) ?? 0}
                    </td>
                  </tr>
                ))}
                {unattributedUnlocks > 0 && (
                  <tr>
                    <td className="px-4 py-3 text-ink/50">
                      (before per-location tracking)
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      {unattributedUnlocks}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      —
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-10 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-serif text-2xl">High intent, didn&apos;t make it</h2>
        <div className="flex gap-3">
          <a
            href={`/api/dashboard/campaigns/${campaign.id}/export?type=consented`}
            className="rounded-full border border-ink/30 px-4 py-2 text-sm font-medium text-ink/80 transition hover:border-ink/60"
          >
            Download consented contacts (CSV)
          </a>
          <a
            href={`/api/dashboard/campaigns/${campaign.id}/export?type=all`}
            className="rounded-full border border-ink/30 px-4 py-2 text-sm font-medium text-ink/80 transition hover:border-ink/60"
          >
            Download all claims (CSV)
          </a>
        </div>
      </div>
      <p className="mt-1 text-sm text-ink/50">
        Fans who couldn&apos;t reach the spot but left an email on the
        out-of-range screen — worth a follow-up if they consented.
      </p>

      {!highIntent?.length ? (
        <p className="mt-6 border-y border-ink/25 py-5 text-sm text-ink/50">
          No one in this list yet.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto border-y border-ink/25">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.15em] text-ink/50">
              <tr className="border-b border-ink/25">
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Marketing consent</th>
                <th className="px-4 py-3 font-medium">Closest distance</th>
                <th className="px-4 py-3 font-medium">Left email</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/15">
              {highIntent.map((r) => (
                <tr key={r.email}>
                  <td className="px-4 py-3">{r.email}</td>
                  <td className="px-4 py-3">
                    {r.marketing_consent ? (
                      <span className="font-medium text-forest">Yes</span>
                    ) : (
                      <span className="text-ink/50">No</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-ink/60">
                    {r.distance_m != null ? `${r.distance_m} m` : "—"}
                  </td>
                  <td className="px-4 py-3 text-ink/60">
                    {r.email_captured_at
                      ? new Date(r.email_captured_at).toLocaleDateString(
                          "en-GB"
                        )
                      : "—"}
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
    <div className="border-l border-t border-ink/25 p-4">
      <p className="text-[10px] uppercase tracking-[0.2em] text-ink/50">
        {label}
      </p>
      <p className="mt-2 font-serif text-3xl">{value}</p>
      {sub && <p className="mt-1 text-xs text-ink/50">{sub}</p>}
    </div>
  );
}
