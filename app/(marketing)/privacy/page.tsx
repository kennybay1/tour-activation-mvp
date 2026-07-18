import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy" };

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-5">
      <h3 className="font-serif text-xl">{label}</h3>
      <p className="mt-2 leading-relaxed text-ink/70">{children}</p>
    </div>
  );
}

export default function PrivacyPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-16">
      <h1 className="font-serif text-4xl">Privacy</h1>

      <h2 className="mt-10 text-xs font-medium uppercase tracking-[0.3em] text-clay">
        For Fans
      </h2>
      <div className="mt-2 divide-y divide-ink/15 border-y border-ink/25">
        <Item label="Data Collected">
          Email address (optional marketing consent, never pre-ticked).
        </Item>
        <Item label="Location Data">
          One-time browser-based location access used exclusively for a
          server-side distance check. Moments does not store your exact
          latitude or longitude coordinates.
        </Item>
        <Item label="Analytics">
          We record distance metrics and pass/fail success rates. Funnel
          events are logged under an anonymous, randomized session ID to
          evaluate campaign performance without identifying individuals.
        </Item>
        <Item label="Rights">
          Users can contact us at any time to request data access or
          permanent deletion.
        </Item>
      </div>

      <h2 className="mt-12 text-xs font-medium uppercase tracking-[0.3em] text-clay">
        For Organizers
      </h2>
      <div className="mt-2 divide-y divide-ink/15 border-y border-ink/25">
        <Item label="Account Information">
          Name, organization, and email address collected at registration.
        </Item>
        <Item label="Authentication">
          Essential session cookies are used strictly to maintain secure
          login states.
        </Item>
        <Item label="Asset Management">
          Uploaded campaign media (audio, video, links) is stored securely
          and delivered to verified fans via private, expiring access links.
        </Item>
        <Item label="Third-Party Sub-processors">
          Infrastructure data is limited strictly to secure cloud hosting and
          database providers (Vercel and Supabase). No data is brokered or
          sold to third-party ad networks.
        </Item>
      </div>
    </div>
  );
}
