"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type Campaign = {
  id: string;
  slug: string;
  artist_name: string;
  title: string;
  description: string | null;
  reward_teaser: string | null;
  ticket_url: string;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
};

type SpotLocation = {
  id: string;
  location_name: string;
  lat: number;
  lng: number;
};

function mapsUrlFor(loc: SpotLocation): string {
  return `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`;
}

type Reward = {
  reward_content_url: string | null;
  discount_code: string | null;
  ticket_url: string;
};

type Step =
  | "loading"
  | "not_found"
  | "landing"
  | "register"
  | "locating"
  | "locked"
  | "unlocked"
  | "expired"
  | "permission_denied"
  | "location_error"
  | "rate_limited";

const SESSION_KEY = "ta_session_id";

function getSessionId(): string {
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return "no-storage";
  }
}

function isInAppBrowser(): boolean {
  return /Instagram|FBAN|FBAV|FB_IAB|FBIOS|TikTok|musical_ly|BytedanceWebview/i.test(
    navigator.userAgent
  );
}

function mediaKind(url: string): "audio" | "video" | "image" {
  const path = url.split("?")[0].toLowerCase();
  if (/\.(mp3|m4a|wav|ogg|aac|flac)$/.test(path)) return "audio";
  if (/\.(mp4|webm|mov|m4v)$/.test(path)) return "video";
  return "image";
}

export default function FanPage({ slug }: { slug: string }) {
  const [step, setStep] = useState<Step>("loading");
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [locations, setLocations] = useState<SpotLocation[]>([]);
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [reward, setReward] = useState<Reward | null>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [inApp, setInApp] = useState(false);
  const sessionRef = useRef<string>("");
  const viewTracked = useRef(false);

  const track = useCallback(
    (event_type: string, metadata?: Record<string, unknown>) => {
      fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          session_id: sessionRef.current,
          event_type,
          metadata,
        }),
        keepalive: true,
      }).catch(() => {});
    },
    [slug]
  );

  useEffect(() => {
    sessionRef.current = getSessionId();
    setInApp(isInAppBrowser());
    let cancelled = false;
    supabase
      .from("campaigns_public")
      .select("*")
      .eq("slug", slug)
      .maybeSingle()
      .then(async ({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          setStep("not_found");
          return;
        }
        const c = data as Campaign;
        const { data: locs } = await supabase
          .from("campaign_locations_public")
          .select("id, location_name, lat, lng")
          .eq("campaign_id", c.id)
          .order("sort_order");
        if (cancelled) return;
        setCampaign(c);
        setLocations((locs as SpotLocation[]) ?? []);
        const now = new Date();
        if (
          !c.is_active ||
          now < new Date(c.starts_at) ||
          now > new Date(c.ends_at) ||
          !locs?.length
        ) {
          setStep("expired");
        } else {
          setStep("landing");
        }
        if (!viewTracked.current) {
          viewTracked.current = true;
          track("page_view");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug, track]);

  const submitClaim = useCallback(
    async (lat: number, lng: number, accuracy: number) => {
      try {
        const res = await fetch("/api/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slug,
            email,
            marketing_consent: consent,
            lat,
            lng,
            accuracy,
            session_id: sessionRef.current,
          }),
        });
        if (res.status === 429) {
          setStep("rate_limited");
          return;
        }
        const json = await res.json();
        if (json.status === "unlocked" || json.status === "already_claimed") {
          setReward(json);
          setStep("unlocked");
        } else if (json.status === "out_of_range") {
          setDistance(Math.max(50, Math.round(json.distance_m / 50) * 50));
          setStep("locked");
        } else if (json.status === "expired") {
          setStep("expired");
        } else {
          setStep("location_error");
        }
      } catch {
        setStep("location_error");
      }
    },
    [slug, email, consent]
  );

  const runGeolocation = useCallback(() => {
    setStep("locating");
    if (!("geolocation" in navigator)) {
      track("location_error", { reason: "unsupported" });
      setStep("location_error");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        track("permission_granted");
        submitClaim(
          pos.coords.latitude,
          pos.coords.longitude,
          pos.coords.accuracy
        );
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          track("permission_denied");
          setStep("permission_denied");
        } else {
          track("location_error", { code: err.code });
          setStep("location_error");
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, [track, submitClaim]);

  const onRegister = (e: React.FormEvent) => {
    e.preventDefault();
    track("register", { marketing_consent: consent });
    runGeolocation();
  };

  const copyCode = async () => {
    if (!reward?.discount_code) return;
    try {
      await navigator.clipboard.writeText(reward.discount_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const inAppBanner = inApp && (
    <div className="rounded-xl border border-clay/60 bg-clay/10 p-4 text-sm">
      <p className="font-semibold text-clay">
        Open this link in Safari or Chrome
      </p>
      <p className="mt-1 text-ink/70">
        Location often fails inside this app&apos;s browser. Tap the menu (⋯ or
        share icon) and choose &ldquo;Open in browser&rdquo;.
      </p>
    </div>
  );

  const primaryBtn =
    "w-full rounded-full bg-forest-deep py-4 text-lg font-semibold text-parchment transition active:scale-[0.98]";

  return (
    <div className="grain min-h-dvh bg-cream font-sans text-ink">
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-8">
        {step === "loading" && (
          <Center>
            <div className="relative flex h-16 w-16 items-center justify-center">
              <span className="ring-pulse absolute inset-0 rounded-full border border-forest/60" />
              <span className="h-2.5 w-2.5 rounded-full bg-forest" />
            </div>
          </Center>
        )}

        {step === "not_found" && (
          <Center>
            <h1 className="font-serif text-4xl">
              This link doesn&apos;t exist
            </h1>
            <p className="mt-3 text-ink/60">
              Check the address, or ask whoever sent it for a new one.
            </p>
          </Center>
        )}

        {step === "expired" && campaign && (
          <Center>
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-clay">
              {campaign.artist_name}
            </p>
            <h1 className="mt-4 font-serif text-4xl">This drop has ended</h1>
            <p className="mt-3 text-ink/60">
              Follow {campaign.artist_name} to catch the next one.
            </p>
          </Center>
        )}

        {step === "landing" && campaign && (
          <div className="fade-up flex flex-1 flex-col gap-6">
            <div className="mt-2">
              <p className="text-xs font-medium uppercase tracking-[0.3em] text-clay">
                {campaign.artist_name}
              </p>
              <h1 className="mt-4 font-serif text-[2.6rem] leading-[1.06]">
                {campaign.title}
              </h1>
              {campaign.description && (
                <p className="mt-4 text-lg leading-relaxed text-ink/70">
                  {campaign.description}
                </p>
              )}
            </div>

            {campaign.reward_teaser && (
              <div className="rounded-2xl bg-forest p-5 text-parchment">
                <div className="rounded-xl border border-parchment/25 p-4">
                  <p className="text-xs font-medium uppercase tracking-[0.3em] text-sage">
                    The reward
                  </p>
                  <p className="mt-2 font-serif text-2xl leading-snug">
                    {campaign.reward_teaser}
                  </p>
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-ink/25 p-5">
              <p className="text-xs font-medium uppercase tracking-[0.3em] text-ink/50">
                {locations.length > 1 ? "The spots" : "The spot"}
              </p>
              <ul className="mt-2 space-y-4">
                {locations.map((l) => (
                  <li key={l.id}>
                    <p className="text-lg font-medium">{l.location_name}</p>
                    <a
                      href={mapsUrlFor(l)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-block text-sm font-medium text-clay underline underline-offset-4"
                    >
                      Open in Google Maps
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            <div className="divide-y divide-ink/15 border-y border-ink/25">
              {[
                ["01", "Drop your email"],
                ["02", "Get yourself to the spot"],
                ["03", "Unlock what's waiting there"],
              ].map(([n, label]) => (
                <div key={n} className="flex items-baseline gap-4 py-3">
                  <span className="font-mono text-xs text-clay">{n}</span>
                  <span className="text-ink/80">{label}</span>
                </div>
              ))}
            </div>

            {inAppBanner}

            <div className="mt-auto pt-4">
              <button onClick={() => setStep("register")} className={primaryBtn}>
                I&apos;m ready
              </button>
            </div>
          </div>
        )}

        {step === "register" && campaign && (
          <form
            onSubmit={onRegister}
            className="fade-up flex flex-1 flex-col gap-6"
          >
            <div className="mt-2">
              <p className="text-xs font-medium uppercase tracking-[0.3em] text-clay">
                {campaign.artist_name}
              </p>
              <h1 className="mt-4 font-serif text-4xl">Almost there</h1>
              <p className="mt-3 text-ink/60">
                Drop your email so we can let you in.
              </p>
            </div>

            <div>
              <label
                htmlFor="email"
                className="mb-2 block text-xs font-medium uppercase tracking-[0.2em] text-ink/60"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-ink/30 bg-transparent px-5 py-4 text-lg text-ink placeholder-ink/30 outline-none focus:border-forest"
              />
            </div>

            <label className="flex items-start gap-3 text-sm text-ink/80">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-forest"
              />
              <span>
                I agree to receive marketing from {campaign.artist_name} and
                their team (
                <a
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-ink"
                >
                  privacy
                </a>
                )
              </span>
            </label>

            <p className="text-sm text-ink/50">
              Next we&apos;ll ask for your location — it&apos;s only used to
              check you&apos;re at the spot, and we never store your
              coordinates.
            </p>

            {inAppBanner}

            <div className="mt-auto pt-4">
              <button type="submit" className={primaryBtn}>
                Continue
              </button>
            </div>
          </form>
        )}

        {step === "locating" && campaign && (
          <Center>
            <div className="relative flex h-56 w-56 items-center justify-center">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="ring-pulse absolute inset-0 rounded-full border border-forest/70"
                  style={{ animationDelay: `${i * 0.85}s` }}
                />
              ))}
              <span className="h-3 w-3 rounded-full bg-forest" />
            </div>
            <p className="mt-4 font-serif text-2xl italic">Finding you…</p>
            <p className="mt-2 text-sm text-ink/60">
              Checking you&apos;re at{" "}
              {locations.length > 1
                ? "one of the spots"
                : locations[0]?.location_name}
              . This can take a few seconds.
            </p>
          </Center>
        )}

        {step === "locked" && campaign && (
          <Center>
            <div className="relative flex h-60 w-60 items-center justify-center">
              <span className="absolute inset-0 rounded-full border border-forest/25" />
              <span className="absolute inset-[15%] rounded-full border border-forest/40" />
              <span className="absolute inset-[30%] rounded-full border border-forest/60" />
              <div className="text-center">
                <p className="font-mono text-xl text-forest">
                  ~{distance} m
                </p>
                <p className="mt-1 text-[10px] uppercase tracking-[0.25em] text-ink/50">
                  to go
                </p>
              </div>
            </div>
            <h1 className="mt-4 font-serif text-3xl">Not quite there yet</h1>
            <p className="mt-2 text-ink/60">
              {locations.length > 1
                ? "That's the distance to the nearest spot. The drop unlocks at any of these:"
                : `The drop unlocks at ${locations[0]?.location_name}.`}
            </p>
            {locations.length > 1 ? (
              <ul className="mt-3 space-y-1 text-sm">
                {locations.map((l) => (
                  <li key={l.id}>
                    <a
                      href={mapsUrlFor(l)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-clay underline underline-offset-4"
                    >
                      {l.location_name}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              locations[0] && (
                <a
                  href={mapsUrlFor(locations[0])}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 text-sm font-medium text-clay underline underline-offset-4"
                >
                  Open in Google Maps
                </a>
              )
            )}
            <button onClick={runGeolocation} className={`mt-8 ${primaryBtn}`}>
              Try again
            </button>
          </Center>
        )}

        {step === "unlocked" && campaign && reward && (
          <div className="fade-up flex flex-1 flex-col gap-6">
            <div className="mt-2 text-center">
              <p className="text-xs font-medium uppercase tracking-[0.3em] text-clay">
                {campaign.artist_name}
              </p>
              <h1 className="mt-3 font-serif text-5xl">Unlocked</h1>
            </div>

            {reward.reward_content_url && (
              <div className="rounded-2xl bg-forest-deep p-4">
                {mediaKind(reward.reward_content_url) === "audio" && (
                  <audio
                    controls
                    src={reward.reward_content_url}
                    className="w-full"
                  />
                )}
                {mediaKind(reward.reward_content_url) === "video" && (
                  <video
                    controls
                    playsInline
                    src={reward.reward_content_url}
                    className="w-full rounded-xl"
                  />
                )}
                {mediaKind(reward.reward_content_url) === "image" && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={reward.reward_content_url}
                    alt="Your unlocked reward"
                    className="w-full rounded-xl"
                  />
                )}
              </div>
            )}

            {reward.discount_code && (
              <div className="rounded-2xl bg-forest p-5 text-center text-parchment">
                <div className="rounded-xl border border-parchment/25 p-5">
                  <p className="text-xs font-medium uppercase tracking-[0.3em] text-sage">
                    Your discount code
                  </p>
                  <p className="mt-3 font-mono text-2xl font-medium tracking-[0.15em]">
                    {reward.discount_code}
                  </p>
                  <button
                    onClick={copyCode}
                    className="mt-4 rounded-full border border-parchment/40 px-5 py-2 text-sm font-medium text-parchment transition active:scale-[0.98]"
                  >
                    {copied ? "Copied ✓" : "Copy code"}
                  </button>
                </div>
              </div>
            )}

            <div className="mt-auto pt-4">
              <button
                onClick={() => {
                  track("ticket_click");
                  window.open(reward.ticket_url, "_blank", "noopener");
                }}
                className="w-full rounded-full bg-clay py-4 text-lg font-bold text-cream transition active:scale-[0.98]"
              >
                Get tickets
              </button>
            </div>
          </div>
        )}

        {step === "permission_denied" && (
          <Center>
            <h1 className="font-serif text-3xl">Location is blocked</h1>
            <p className="mt-3 text-ink/60">
              We need your location to check you&apos;re at the spot. To
              re-enable it:
            </p>
            <ul className="mt-4 w-full space-y-2 text-left text-sm text-ink/80">
              <li className="rounded-xl border border-ink/20 p-3">
                <span className="font-semibold">Safari:</span> tap the aA /
                icon in the address bar → Website Settings → Location → Allow.
              </li>
              <li className="rounded-xl border border-ink/20 p-3">
                <span className="font-semibold">Chrome:</span> tap the lock
                icon by the address bar → Permissions → Location → Allow.
              </li>
            </ul>
            <button onClick={runGeolocation} className={`mt-8 ${primaryBtn}`}>
              Try again
            </button>
          </Center>
        )}

        {step === "location_error" && (
          <Center>
            <h1 className="font-serif text-3xl">
              Couldn&apos;t get your location
            </h1>
            <p className="mt-3 text-ink/60">
              Your phone didn&apos;t return a position — this sometimes happens
              indoors or with a weak signal. Step outside if you can, then try
              again.
            </p>
            <button onClick={runGeolocation} className={`mt-8 ${primaryBtn}`}>
              Try again
            </button>
          </Center>
        )}

        {step === "rate_limited" && (
          <Center>
            <h1 className="font-serif text-3xl">Too many attempts</h1>
            <p className="mt-3 text-ink/60">
              Give it ten minutes, then try again.
            </p>
          </Center>
        )}

        <p className="pt-8 text-center text-xs text-ink/40">
          Powered by{" "}
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-serif italic text-ink/60 underline-offset-4 hover:underline"
          >
            Moments
          </a>{" "}
          — Be there.
        </p>
      </div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="fade-up flex flex-1 flex-col items-center justify-center text-center">
      {children}
    </div>
  );
}
