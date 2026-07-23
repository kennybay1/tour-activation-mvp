import Link from "next/link";
import StatusActions from "./campaigns/status-actions";

// One compact campaign entry in the "Your campaigns" list. Everything is
// left-aligned in a tight stack — no right-hand column — so the panel stays
// slim and the backdrop photo stays the star.

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

export type CampaignListItem = {
  id: string;
  slug: string;
  title: string;
  artist_name: string;
  description: string | null;
  status: string;
  starts_at: string;
  ends_at: string;
};

export default function CampaignRow({
  c,
  locationCount,
  thumbnailUrl,
  shared,
}: {
  c: CampaignListItem;
  locationCount: number;
  // The campaign's own artwork, or the organiser's dashboard backdrop as a
  // stand-in when none was uploaded — resolved by the page, not here.
  thumbnailUrl: string | null;
  // A campaign owned by someone whose workspace you're a collaborator in.
  shared?: boolean;
}) {
  const locationSummary =
    locationCount === 0
      ? "No locations yet"
      : locationCount === 1
        ? "1 location"
        : `${locationCount} locations`;

  return (
    <li className="flex items-start gap-3.5 py-4">
      {thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbnailUrl}
          alt=""
          className="mt-0.5 h-16 w-16 shrink-0 rounded-xl object-cover"
        />
      ) : (
        <div className="mt-0.5 flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-ink/5 text-ink/30">
          <svg
            aria-hidden
            className="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
          </svg>
        </div>
      )}
      <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="font-medium">{c.title}</p>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${
            STATUS_STYLES[c.status] ?? STATUS_STYLES.draft
          }`}
        >
          {c.status}
        </span>
        {shared && (
          <span className="shrink-0 rounded-full border border-ink/25 px-2.5 py-0.5 text-xs font-medium text-ink/55">
            Shared with you
          </span>
        )}
      </div>
      {c.description && (
        <p className="mt-1 max-w-prose text-sm text-ink/60">{c.description}</p>
      )}
      <p className="mt-1 text-sm text-ink/50">
        {c.artist_name} · {locationSummary} · {fmt(c.starts_at)} –{" "}
        {fmt(c.ends_at)}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <a
          href={`/c/${c.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-clay underline underline-offset-4"
        >
          Live link ↗
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
        <StatusActions id={c.id} status={c.status} />
      </div>
      </div>
    </li>
  );
}
