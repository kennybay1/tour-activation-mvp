import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-16">
      <h1 className="font-serif text-4xl">Terms</h1>
      <p className="mt-2 text-sm text-ink/50">
        The short version, last updated July 2026.
      </p>

      <div className="mt-8 space-y-8 leading-relaxed text-ink/80">
        <section>
          <h2 className="font-serif text-2xl">The service</h2>
          <p className="mt-2">
            Moments lets organisers publish location-unlocked campaigns and
            lets fans unlock them by being there. We provide it as-is while
            in early access, and we may change or withdraw features as it
            evolves.
          </p>
        </section>
        <section>
          <h2 className="font-serif text-2xl">Organiser responsibilities</h2>
          <p className="mt-2">
            You must have the rights to any content you upload, you must only
            contact fans who consented, and you must not send fans anywhere
            unsafe or unlawful. We can suspend campaigns or accounts that
            break this.
          </p>
        </section>
        <section>
          <h2 className="font-serif text-2xl">Fans</h2>
          <p className="mt-2">
            Take care out there — drops are placed by organisers, not by us,
            and you visit locations at your own judgement. Cross roads, not
            fences.
          </p>
        </section>
        <section>
          <h2 className="font-serif text-2xl">Liability</h2>
          <p className="mt-2">
            To the fullest extent the law allows, Moments isn&apos;t liable
            for indirect losses arising from use of the service. Nothing in
            these terms limits liability that can&apos;t legally be limited.
          </p>
        </section>
        <section>
          <h2 className="font-serif text-2xl">Questions</h2>
          <p className="mt-2">Email us via the Talk to us page.</p>
        </section>
      </div>
    </div>
  );
}
