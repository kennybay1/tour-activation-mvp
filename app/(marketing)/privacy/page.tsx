import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-16">
      <h1 className="font-serif text-4xl">Privacy</h1>
      <p className="mt-2 text-sm text-ink/50">
        The plain-English version, last updated July 2026.
      </p>

      <div className="mt-8 space-y-8 leading-relaxed text-ink/80">
        <section>
          <h2 className="font-serif text-2xl">What we collect from fans</h2>
          <p className="mt-2">
            When you register for a drop we collect your email address and
            whether you ticked the marketing consent box. If you consented,
            your email is shared with the artist team running that drop —
            that&apos;s the point of the box — and with no one else.
          </p>
        </section>
        <section>
          <h2 className="font-serif text-2xl">Location</h2>
          <p className="mt-2">
            Your location is checked once, in your browser, at the moment you
            try to unlock — only to measure how far you are from the spot. We
            store that distance in metres. We never store your coordinates,
            and we can&apos;t track you.
          </p>
        </section>
        <section>
          <h2 className="font-serif text-2xl">What we collect from organisers</h2>
          <p className="mt-2">
            Your email, organisation name and contact name, used to run your
            account and nothing else.
          </p>
        </section>
        <section>
          <h2 className="font-serif text-2xl">Where it lives</h2>
          <p className="mt-2">
            Data is stored with Supabase and the site is hosted on Vercel.
            We keep it as long as the campaign owner keeps the campaign.
          </p>
        </section>
        <section>
          <h2 className="font-serif text-2xl">Your rights</h2>
          <p className="mt-2">
            Want your data corrected or deleted? Email us via the Talk to us
            page and we&apos;ll sort it.
          </p>
        </section>
      </div>
    </div>
  );
}
