"use client";

import { GuardedLink } from "@/app/unsaved-changes";

// The escape hatch at the top of every campaign sub-page: a back link so
// nobody is ever stranded mid-draft, plus (on pages about one specific
// campaign) a breadcrumb line. Both routes go through GuardedLink, so a
// half-built campaign prompts before it's abandoned.
export default function CampaignNav({
  crumb,
}: {
  crumb?: { title: string; page: "Edit" | "Results" };
}) {
  return (
    <div className="mb-5">
      <GuardedLink
        href="/dashboard"
        className="text-sm font-medium text-ink/60 underline-offset-4 hover:text-ink hover:underline"
      >
        ← Campaigns
      </GuardedLink>
      {crumb && (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-ink/50">
          <GuardedLink
            href="/dashboard"
            className="underline-offset-4 hover:underline"
          >
            Campaigns
          </GuardedLink>
          <span aria-hidden="true">/</span>
          <span className="max-w-[16rem] truncate">{crumb.title}</span>
          <span aria-hidden="true">/</span>
          <span className="text-ink/70">{crumb.page}</span>
        </p>
      )}
    </div>
  );
}
