import Link from "next/link";
import { requireUser, supabaseServer } from "@/lib/supabase-server";
import StatusActions from "./campaigns/status-actions";
import ProfileBackdrop from "./profile-backdrop";

const STATUS_STYLES: Record<string, string> = {
  live: "bg-forest text-parchment",
  draft: "bg-sage/50 text-ink",
  archived: "bg-ink/10 text-ink/50",
};

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

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

  // Authenticated client — RLS returns only campaigns this organiser owns.
  const supabase = await supabaseServer();
  const { data: campaigns, error } = await supabase
    .from("campaigns")
    .select(
      "id, slug, title, artist_name, location_name, status, starts_at, ends_at"
    )
    .order("created_at", { ascending: false });

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
            ? "relative z-10 rounded-3xl bg-cream/90 p-6 shadow-xl backdrop-blur-md sm:p-8"
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
        <p className="mt-6 font-medium text-clay">
          Couldn&apos;t load your campaigns.
        </p>
      ) : !campaigns?.length ? (
        <p className="mt-6 text-ink/60">
          No campaigns yet — click &ldquo;New campaign&rdquo; to build your
          first drop.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-ink/15 border-y border-ink/25">
          {campaigns.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-start justify-between gap-4 py-5"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <p className="font-medium">{c.title}</p>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${
                      STATUS_STYLES[c.status] ?? STATUS_STYLES.draft
                    }`}
                  >
                    {c.status}
                  </span>
                </div>
                <p className="mt-1 text-sm text-ink/50">
                  {c.artist_name} · {c.location_name} · {fmt(c.starts_at)} –{" "}
                  {fmt(c.ends_at)}
                </p>
                <div className="mt-2 flex gap-4 text-sm">
                  <a
                    href={`/c/${c.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-clay underline underline-offset-4"
                  >
                    /c/{c.slug}
                  </a>
                  <Link
                    href={`/dashboard/campaigns/${c.id}/results`}
                    className="font-medium text-ink/70 underline underline-offset-4 hover:text-ink"
                  >
                    Results
                  </Link>
                  <Link
                    href={`/dashboard/campaigns/${c.id}/edit`}
                    className="font-medium text-ink/70 underline underline-offset-4 hover:text-ink"
                  >
                    Edit
                  </Link>
                </div>
              </div>
              <StatusActions id={c.id} status={c.status} />
            </li>
          ))}
        </ul>
      )}
      </div>
      </div>
    </>
  );
}
