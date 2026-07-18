import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "FAQ" };

// Single source of truth: renders the accordion AND generates the
// FAQPage JSON-LD below.
const FAQS = [
  {
    q: "What is Moments?",
    a: "A self-serve platform for geo-fenced fan engagement campaigns. You drop exclusive content at a real-world location; fans go there to unlock it in their browser; you keep the engagement data and own the fan relationship.",
  },
  {
    q: "Do fans need to download an app?",
    a: "No. A fan taps a link, and everything happens on a mobile web page.",
  },
  {
    q: "How is presence verified?",
    a: "The fan's browser shares their position with the fan's permission, and our server checks the distance against your campaign's geofence before anything unlocks. The reward is never present on the page until that check passes.",
  },
  {
    q: "How precise is the geofence?",
    a: "Phone GPS in the real world is accurate to tens of metres, sometimes worse indoors or between tall buildings. We recommend a radius of 150–250 metres so genuine fans standing at the spot aren't turned away by GPS noise. Tighter is possible; we'll tell you honestly what it does to unlock rates.",
  },
  {
    q: "Can fans cheat it?",
    a: "We check presence server-side and rate-limit attempts, which stops casual workarounds. Like every location-based platform, sophisticated GPS spoofing can't be fully eliminated — Moments is built to make showing up the easiest path, and to give you clean signal on real-world engagement, not to be a security system.",
  },
  {
    q: "What data do I get?",
    a: "Page views, registrations, location-permission rates, unlock successes, near-miss attempts, and ticket click-throughs — plus an exportable list of fans who gave marketing consent. You also see the fans who registered but didn't make it: your highest-intent audience for the next campaign.",
  },
  {
    q: "What about fan privacy?",
    a: "Consent-first by design: the marketing checkbox is never pre-ticked, and we never store a fan's coordinates — only their distance from your location and whether they unlocked. We'll agree data-processing terms with every pilot partner.",
  },
  {
    q: "What content works?",
    a: "Anything a mobile browser can display or play. Unreleased audio, voice notes, video files, exclusive artwork, discount codes or tour presale links. The most successful campaigns pair location-relevant content with an urgent reason to act, like a limited time window or exclusive ticket access.",
  },
  {
    q: "Where can a Moment be?",
    a: "Anywhere on earth with GPS coordinates - a festival stage, an indie retail shop, a public park, or the exact street corner from an album cover. Because dense urban environments and indoor spaces can degrade GPS signals, we will help you scale your radius to match the environment.",
  },
  {
    q: "How long does setup take?",
    a: "If you have your asset ready and selected your location(s), it takes less than five minutes. Campaigns can run for a few hours, a weekend, or several weeks.",
  },
  {
    q: "What does it cost?",
    a: "It is completely free to sign up and draft your campaigns. Live campaigns start at £50, determined by duration and the number of active locations.",
  },
  {
    q: "Who is Moments for?",
    a: "Labels, managers, promoters, and independent artists: anyone looking to bridge the gap between digital content and physical community.",
  },
  {
    q: "How do I start?",
    a: "Create an account to build and preview your first campaign for free. If you would rather map out a more complex roll-out strategy before building, you can contact us directly.",
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQS.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.a },
  })),
};

export default function FaqPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <h1 className="font-serif text-4xl">FAQ</h1>
      <p className="mt-2 text-ink/60">
        Answers to the questions we hear most.
      </p>

      <div className="mt-8 divide-y divide-ink/15 border-y border-ink/25">
        {FAQS.map((f) => (
          <details key={f.q} className="group py-4">
            <summary className="flex cursor-pointer list-none items-baseline justify-between gap-4 font-serif text-xl marker:hidden [&::-webkit-details-marker]:hidden">
              {f.q}
              <span
                aria-hidden
                className="shrink-0 font-mono text-sm text-clay transition group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="mt-3 leading-relaxed text-ink/70">{f.a}</p>
          </details>
        ))}
      </div>

      <div className="mt-10 flex flex-wrap gap-4">
        <Link
          href="/signup"
          className="rounded-full bg-forest-deep px-7 py-3 font-semibold text-parchment transition active:scale-[0.98]"
        >
          Get started
        </Link>
        <Link
          href="/request-access"
          className="rounded-full border border-ink/30 px-7 py-3 font-medium text-ink/80 transition hover:border-ink/60"
        >
          Talk to us
        </Link>
      </div>
    </div>
  );
}
