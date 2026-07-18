import Link from "next/link";

const STEPS = [
  {
    n: "01",
    title: "Drop something at a spot",
    body: "A voice note, a discount code, a first listen — pinned to a real place with an unlock radius you choose.",
  },
  {
    n: "02",
    title: "Fans go there",
    body: "Share one link. Fans register with an email and their phone checks they're actually standing at the spot.",
  },
  {
    n: "03",
    title: "They unlock, you learn",
    body: "The reward opens on the pavement. You get the funnel: visits, unlocks, ticket clicks and consented contacts.",
  },
];

const USE_CASES = [
  {
    title: "Tour announcements",
    body: "Hide the support act, the presale code or the setlist teaser outside the venue a week early.",
  },
  {
    title: "Release day",
    body: "First listens at the record shop, the studio where it was made, or the corner from the cover art.",
  },
  {
    title: "Ticket pushes",
    body: "A discount code that only unlocks outside the venue turns footfall into sales you can count.",
  },
  {
    title: "City takeovers",
    body: "Five drops across a city makes a scavenger hunt — street teams without the clipboards.",
  },
];

export default function Home() {
  return (
    <>
      <section className="mx-auto flex w-full max-w-4xl flex-col items-center px-5 pb-20 pt-16 text-center">
        <div className="relative flex h-44 w-44 items-center justify-center">
          <span className="absolute inset-0 rounded-full border border-forest/25" />
          <span className="absolute inset-[18%] rounded-full border border-forest/45" />
          <span className="absolute inset-[36%] rounded-full border border-forest/70" />
          <span className="h-2 w-2 rounded-full bg-forest" />
        </div>
        <h1 className="mt-8 max-w-2xl font-serif text-5xl leading-[1.05]">
          Be there to unlock it.
        </h1>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink/70">
          Moments lets artist teams drop rewards at real-world spots — and
          fans have to stand there to get them. No app, just a link.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/signup"
            className="rounded-full bg-forest-deep px-8 py-3.5 font-semibold text-parchment transition active:scale-[0.98]"
          >
            Get started
          </Link>
          <Link
            href="/request-access"
            className="rounded-full border border-ink/30 px-8 py-3.5 font-medium text-ink/80 transition hover:border-ink/60"
          >
            Talk to us
          </Link>
        </div>
      </section>

      <section id="how-it-works" className="border-t border-ink/20">
        <div className="mx-auto w-full max-w-4xl px-5 py-16">
          <p className="text-xs font-medium uppercase tracking-[0.3em] text-clay">
            How it works
          </p>
          <div className="mt-8 divide-y divide-ink/15 border-y border-ink/25">
            {STEPS.map((s) => (
              <div
                key={s.n}
                className="grid gap-2 py-6 sm:grid-cols-[4rem_16rem_1fr] sm:gap-6"
              >
                <span className="font-mono text-sm text-clay">{s.n}</span>
                <h2 className="font-serif text-2xl">{s.title}</h2>
                <p className="leading-relaxed text-ink/70">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="use-cases" className="border-t border-ink/20">
        <div className="mx-auto w-full max-w-4xl px-5 py-16">
          <p className="text-xs font-medium uppercase tracking-[0.3em] text-clay">
            Use cases
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {USE_CASES.map((u) => (
              <div
                key={u.title}
                className="rounded-2xl border border-ink/25 p-6"
              >
                <h2 className="font-serif text-2xl">{u.title}</h2>
                <p className="mt-2 leading-relaxed text-ink/70">{u.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-ink/20">
        <div className="mx-auto w-full max-w-4xl px-5 py-16">
          <div className="rounded-2xl bg-forest p-8 text-parchment sm:p-12">
            <div className="rounded-xl border border-parchment/25 p-6 text-center sm:p-10">
              <h2 className="font-serif text-3xl sm:text-4xl">
                Your first drop takes ten minutes.
              </h2>
              <p className="mx-auto mt-3 max-w-md text-parchment/80">
                Sign up, pin a spot, share the link. Fans do the walking.
              </p>
              <Link
                href="/signup"
                className="mt-6 inline-block rounded-full bg-clay px-8 py-3.5 font-semibold text-cream transition active:scale-[0.98]"
              >
                Get started
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
