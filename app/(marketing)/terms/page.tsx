import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms" };

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-5">
      <h3 className="font-serif text-xl">{label}</h3>
      <p className="mt-2 leading-relaxed text-ink/70">{children}</p>
    </div>
  );
}

export default function TermsPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-16">
      <h1 className="font-serif text-4xl">Terms of Service</h1>

      <h2 className="mt-10 text-xs font-medium uppercase tracking-[0.3em] text-clay">
        Core Terms
      </h2>
      <div className="mt-2 divide-y divide-ink/15 border-y border-ink/25">
        <Item label="Campaign Compliance">
          Organizers are solely responsible for ensuring that physical drop
          locations are safe, accessible, and compliant with local public
          access laws.
        </Item>
        <Item label="Content Rights">
          Organizers guarantee they hold all necessary copyrights and
          licensing rights for any audio, video, or intellectual property
          uploaded as a campaign reward.
        </Item>
        <Item label="Platform Security">
          Attempting to reverse-engineer server-side verification systems or
          bypass location parameters via automated exploits is strictly
          prohibited.
        </Item>
        <Item label="Pilot Limitations">
          During the pilot phase, services are provided on an
          &ldquo;as-is&rdquo; basis while platform scaling and optimization
          are finalized.
        </Item>
      </div>
    </div>
  );
}
