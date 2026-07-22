import Link from "next/link";
import { requireUser, supabaseServer } from "@/lib/supabase-server";
import ProfileBackdrop from "./profile-backdrop";
import CampaignRow, { type CampaignListItem } from "./campaign-row";

export default async function DashboardHome() {
  const user = await requireUser();

  // The organiser's backdrop lives in their auth profile metadata — set
  // only through /api/dashboard/profile/background, owner-authenticated.
  const backdropPath =
    typeof user.user_metadata?.dashboard_background_path === "string"
      ? user.user_metadata.dashboard_background_path
      : null;
  const backdropUrl = backdropPath
    ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/backgrounds/${backdropPath}`
    : null;

  // Authenticated client — RLS returns only campaigns this organiser owns,
  // and only their own locations for the per-campaign counts.
  const supabase = await supabaseServer();
  const [{ data: campaigns, error }, { data: locRows }] = await Promise.all([
    supabase
      .from("campaigns")
      .select(
        "id, slug, title, artist_name, description, status, starts_at, ends_at"
      )
      .order("created_at", { ascending: false }),
    supabase.from("campaign_locations").select("campaign_id"),
  ]);
  const locationCounts = new Map<string, number>();
  for (const row of locRows ?? []) {
    locationCounts.set(
      row.campaign_id,
      (locationCounts.get(row.campaign_id) ?? 0) + 1
    );
  }

  return (
    <>
      {backdropUrl && (
        // Same full-bleed treatment as the fan page: fixed image, cropped
        // to fill, with an edge scrim; the campaign list floats above it in
        // a translucent panel so text stays readable over any photo. Kept
        // OUTSIDE the .fade-up wrapper — its entrance transform would turn
        // "fixed" into "fixed inside this box" and shrink the image to the
        // panel's footprint.
        <div className="fixed inset-0 z-0" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={backdropUrl}
            alt=""
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-black/10 to-black/35" />
        </div>
      )}
      <div className="fade-up">
        <div
          className={
            backdropUrl
              ? "relative z-10 rounded-3xl bg-cream/90 p-5 shadow-xl backdrop-blur-md sm:p-6"
              : undefined
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <h1 className="font-serif text-3xl">Your campaigns</h1>
            <div className="flex flex-wrap items-center gap-2">
              <ProfileBackdrop hasImage={!!backdropUrl} />
              <Link
                href="/dashboard/campaigns/new"
                className="rounded-full bg-forest-deep px-5 py-2.5 text-sm font-semibold text-parchment transition active:scale-[0.98]"
              >
                New campaign
              </Link>
            </div>
          </div>

          {error ? (
            <p className="mt-4 font-medium text-clay">
              Couldn&apos;t load your campaigns.
            </p>
          ) : !campaigns?.length ? (
            <p className="mt-4 text-ink/60">
              No campaigns yet — click &ldquo;New campaign&rdquo; to build your
              first drop.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-ink/15 border-y border-ink/25">
              {campaigns.map((c) => (
                <CampaignRow
                  key={c.id}
                  c={c as CampaignListItem}
                  locationCount={locationCounts.get(c.id) ?? 0}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
