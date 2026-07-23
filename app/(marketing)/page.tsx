import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: { absolute: "Moments — geo-fenced fan engagement for artist teams" },
  description:
    "First-party data from dropping exclusive content at real-world locations. Fans unlock it by being there — no app, just a link.",
};

const STEPS = [
  {
    n: "01",
    title: "Set it up",
    body: "Choose a spot anywhere in the world, set a radius and a time window, and upload the reward: an unreleased track, a voice note, a video, a ticket presale, a discount code.",
  },
  {
    n: "02",
    title: "Announce it",
    body: "Share one link — newsletter, socials, bio. No app to download. Everything happens in the fan's browser.",
  },
  {
    n: "03",
    title: "Fans show up",
    body: "At the location, the moment unlocks. Presence is checked server-side against your geofence.",
  },
  {
    n: "04",
    title: "You own what comes back",
    body: "Capture registrations, opted-in emails, unlock rates and ticket clicks. You get high-intent, first-party data that belongs to you.",
  },
];

const USE_CASES = [
  {
    title: "The unreleased track drop",
    body: "Hear the single before anyone else: hidden at five hometown spots for 72 hours before release day.",
  },
  {
    title: "The artist voice note",
    body: "A 60-second unproduced message at a park bench or street corner. Only fans who travel there will ever hear it.",
  },
  {
    title: "City-by-city tour activation",
    body: "Land a moment in each city two weeks before the show; a live recording unlocks the presale link. Listening becomes buying in the same session.",
  },
  {
    title: "The venue drop",
    body: "Content that only unlocks inside the venue, announced from the stage. Gone at midnight.",
  },
  {
    title: "The record shop activation",
    body: "Ten independent shops, each hiding a different B-side. Footfall for the shop, geographic fan intelligence for you.",
  },
  {
    title: "The album scavenger hunt",
    body: "Ten tracks hidden at the ten places that inspired them. Fans piece the album together before it exists.",
  },
];

export default function Home() {
  return (
    <>
      {/* Hero */}
      <section className="mx-auto flex w-full max-w-4xl flex-col items-center px-5 pb-20 pt-16 text-center">
        <div className="relative flex h-40 w-40 items-center justify-center">
          <span className="absolute inset-0 rounded-full border border-forest/25" />
          <span className="absolute inset-[18%] rounded-full border border-forest/45" />
          <span className="absolute inset-[36%] rounded-full border border-forest/70" />
          <span className="h-2 w-2 rounded-full bg-forest" />
        </div>
        <h1 className="mt-8 font-serif text-6xl">Moments</h1>
        <p className="mt-4 text-xl text-ink/80">IRL drop zones</p>
        <p className="mt-2 max-w-xl leading-relaxed text-ink/60">
          Engage fans | Own the relationship
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/signup"
            className="rounded-full bg-forest-deep px-8 py-3.5 font-semibold text-parchment transition active:scale-[0.98]"
          >
            Get started
          </Link>
          <a
            href="#how-it-works"
            className="rounded-full border border-ink/30 px-8 py-3.5 font-medium text-ink/80 transition hover:border-ink/60"
          >
            See how it works
          </a>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="border-t border-ink/20">
        <div className="mx-auto w-full max-w-4xl px-5 py-16">
          <h2 className="text-xs font-medium uppercase tracking-[0.3em] text-clay">
            How it works
          </h2>
          <div className="mt-8 divide-y divide-ink/15 border-y border-ink/25">
            {STEPS.map((s) => (
              <div
                key={s.n}
                className="grid gap-2 py-6 sm:grid-cols-[4rem_16rem_1fr] sm:gap-6"
              >
                <span className="font-mono text-sm text-clay">{s.n}</span>
                <h3 className="font-serif text-2xl">{s.title}</h3>
                <p className="leading-relaxed text-ink/70">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Use cases */}
      <section id="use-cases" className="border-t border-ink/20">
        <div className="mx-auto w-full max-w-4xl px-5 py-16">
          <h2 className="text-xs font-medium uppercase tracking-[0.3em] text-clay">
            Use cases
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {USE_CASES.map((u) => (
              <div key={u.title} className="rounded-2xl border border-ink/25 p-6">
                <h3 className="font-serif text-2xl leading-snug">{u.title}</h3>
                <p className="mt-2 leading-relaxed text-ink/70">{u.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why now */}
      <section className="border-t border-ink/20">
        <div className="mx-auto w-full max-w-2xl px-5 py-16">
          <h2 className="text-xs font-medium uppercase tracking-[0.3em] text-clay">
            Why now
          </h2>
          <p className="mt-6 font-serif text-2xl leading-relaxed sm:text-3xl">
            Until now, location-based campaigns meant an agency, months of
            build time, and budgets that excluded almost every artist. Moments
            makes the same mechanic self-serve: minutes to launch, priced for
            a single artist&apos;s release cycle, and the fan data comes home
            to you instead of a platform.
          </p>
        </div>
      </section>

      {/* What you own */}
      <section className="border-t border-ink/20">
        <div className="mx-auto w-full max-w-2xl px-5 py-16">
          <h2 className="text-xs font-medium uppercase tracking-[0.3em] text-clay">
            What you own
          </h2>
          <p className="mt-6 leading-relaxed text-ink/80">
            Every campaign builds an actionable marketing funnel. Track views,
            registrations, location-permission rates, successful arrivals and
            ticket click-throughs. Crucially, you walk away with an exportable
            list of opted-in emails from the fans who show up.
          </p>
          <p className="mt-4 leading-relaxed text-ink/80">
            Our privacy architecture is built to be transparent: Moments never
            stores a fan&apos;s exact coordinates. We only calculate their
            distance from your target location to verify the unlock.
          </p>
        </div>
      </section>

      {/* Pricing */}
      <section className="border-t border-ink/20">
        <div className="mx-auto w-full max-w-2xl px-5 py-16">
          <h2 className="text-xs font-medium uppercase tracking-[0.3em] text-clay">
            Pricing
          </h2>
          <div className="mt-6 rounded-2xl border border-ink/25 p-6 sm:p-8">
            <p className="leading-relaxed text-ink/80">
              Signing up and building a campaign is free. Live campaigns start
              at £50 and are priced based on the number of locations and
              duration. Get started building, or reach out to scope a campaign
              with us.
            </p>
            <div className="mt-6 flex flex-wrap gap-4">
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
                Reach out
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-ink/20">
        <div className="mx-auto w-full max-w-4xl px-5 py-16">
          <div className="rounded-2xl bg-forest p-8 text-parchment sm:p-12">
            <div className="rounded-xl border border-parchment/25 p-6 text-center sm:p-10">
              <h2 className="font-serif text-3xl sm:text-4xl">
                Put something real in the world.
              </h2>
              <Link
                href="/signup"
                className="mt-6 inline-block rounded-full bg-clay px-8 py-3.5 font-semibold text-cream transition active:scale-[0.98]"
              >
                Get started
              </Link>
              <p className="mt-4 text-sm text-parchment/70">
                Prefer to talk first?{" "}
                <Link
                  href="/request-access"
                  className="font-medium text-parchment underline underline-offset-4"
                >
                  Talk to us
                </Link>
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
