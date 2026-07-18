import type { Metadata } from "next";

export const metadata: Metadata = { title: "FAQ" };

const FAQS = [
  {
    q: "What is Moments?",
    a: "A tool for artist teams to drop rewards — audio, video, images, discount codes — at real-world locations. Fans open a link, and the reward unlocks only when their phone confirms they're at the spot.",
  },
  {
    q: "Do fans need to install an app?",
    a: "No. Everything runs in the phone's browser from a single link — scan a QR on a poster or tap through from a bio and you're in.",
  },
  {
    q: "What happens with fans' location data?",
    a: "It's used once, in the moment, to check they're inside the unlock radius — then thrown away. We store the distance from the spot, never their coordinates.",
  },
  {
    q: "How precise is the unlock?",
    a: "You set a radius per drop — 200 metres works well in cities. We add a small allowance for GPS wobble so real fans standing at the spot don't get blocked by a bad signal.",
  },
  {
    q: "What can I see afterwards?",
    a: "A funnel per campaign: page views, location permission rate, registrations, unlocks, out-of-range attempts and ticket clicks — plus a CSV of consented contacts for your mailing list.",
  },
  {
    q: "What does it cost?",
    a: "We're in early access — talk to us and we'll get you set up.",
  },
];

export default function FaqPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-16">
      <h1 className="font-serif text-4xl">FAQ</h1>
      <div className="mt-8 divide-y divide-ink/15 border-y border-ink/25">
        {FAQS.map((f) => (
          <div key={f.q} className="py-6">
            <h2 className="font-serif text-2xl">{f.q}</h2>
            <p className="mt-2 leading-relaxed text-ink/70">{f.a}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
