"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type Campaign = {
  id: string;
  slug: string;
  artist_name: string;
  title: string;
  description: string | null;
  location_name: string;
  lat: number;
  lng: number;
  radius_m: number;
  reward_teaser: string | null;
  ticket_url: string;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
};

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
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          setStep("not_found");
          return;
        }
        const c = data as Campaign;
        setCampaign(c);
        const now = new Date();
        if (!c.is_active || now < new Date(c.starts_at) || now > new Date(c.ends_at)) {
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

  const mapsUrl = campaign
    ? `https://www.google.com/maps/search/?api=1&query=${campaign.lat},${campaign.lng}`
    : "#";

  const inAppBanner = inApp && (
    <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
      <p className="font-semibold">Open this link in Safari or Chrome</p>
      <p className="mt-1 text-amber-200/80">
        Location often fails inside this app&apos;s browser. Tap the menu (⋯ or
        share icon) and choose &ldquo;Open in browser&rdquo;.
      </p>
    </div>
  );

  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100 antialiased">
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-8">
        {step === "loading" && (
          <Center>
            <div className="h-3 w-3 animate-ping rounded-full bg-fuchsia-500" />
          </Center>
        )}

        {step === "not_found" && (
          <Center>
            <h1 className="text-2xl font-bold">This link doesn&apos;t exist</h1>
            <p className="mt-2 text-zinc-400">
              Check the address, or ask whoever sent it for a new one.
            </p>
          </Center>
        )}

        {step === "expired" && campaign && (
          <Center>
            <p className="text-sm uppercase tracking-widest text-zinc-500">
              {campaign.artist_name}
            </p>
            <h1 className="mt-2 text-2xl font-bold">This drop has ended</h1>
            <p className="mt-2 text-zinc-400">
              Follow {campaign.artist_name} to catch the next one.
            </p>
          </Center>
        )}

        {step === "landing" && campaign && (
          <div className="flex flex-1 flex-col gap-6">
            <div className="mt-4">
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-fuchsia-400">
                {campaign.artist_name}
              </p>
              <h1 className="mt-3 text-4xl font-bold leading-tight tracking-tight">
                {campaign.title}
              </h1>
              {campaign.description && (
                <p className="mt-4 text-lg text-zinc-300">
                  {campaign.description}
                </p>
              )}
            </div>

            {campaign.reward_teaser && (
              <div className="rounded-2xl border border-fuchsia-500/30 bg-gradient-to-br from-fuchsia-500/15 to-violet-600/15 p-5">
                <p className="text-sm font-semibold uppercase tracking-widest text-fuchsia-300">
                  The reward
                </p>
                <p className="mt-2 text-lg text-zinc-100">
                  {campaign.reward_teaser}
                </p>
              </div>
            )}

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
              <p className="text-sm font-semibold uppercase tracking-widest text-zinc-500">
                The spot
              </p>
              <p className="mt-2 text-lg font-medium">{campaign.location_name}</p>
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-sm font-medium text-fuchsia-400 underline underline-offset-4"
              >
                Open in Google Maps
              </a>
            </div>

            <p className="text-zinc-400">
              How it works: get yourself to the spot → unlock what&apos;s
              waiting there.
            </p>

            {inAppBanner}

            <div className="mt-auto pt-4">
              <button
                onClick={() => setStep("register")}
                className="w-full rounded-2xl bg-zinc-50 py-4 text-lg font-semibold text-zinc-950 transition active:scale-[0.98]"
              >
                I&apos;m ready
              </button>
            </div>
          </div>
        )}

        {step === "register" && campaign && (
          <form onSubmit={onRegister} className="flex flex-1 flex-col gap-6">
            <div className="mt-4">
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-fuchsia-400">
                {campaign.artist_name}
              </p>
              <h1 className="mt-3 text-3xl font-bold tracking-tight">
                Almost there
              </h1>
              <p className="mt-3 text-zinc-400">
                Drop your email so we can let you in.
              </p>
            </div>

            <div>
              <label
                htmlFor="email"
                className="mb-2 block text-sm font-medium text-zinc-300"
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
                className="w-full rounded-2xl border border-zinc-700 bg-zinc-900 px-5 py-4 text-lg text-zinc-100 placeholder-zinc-600 outline-none focus:border-fuchsia-500"
              />
            </div>

            <label className="flex items-start gap-3 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-fuchsia-500"
              />
              <span>
                I agree to receive marketing from {campaign.artist_name} and
                their team
              </span>
            </label>

            <p className="text-sm text-zinc-500">
              Next we&apos;ll ask for your location — it&apos;s only used to
              check you&apos;re at the spot, and we never store your
              coordinates.
            </p>

            {inAppBanner}

            <div className="mt-auto pt-4">
              <button
                type="submit"
                className="w-full rounded-2xl bg-zinc-50 py-4 text-lg font-semibold text-zinc-950 transition active:scale-[0.98]"
              >
                Continue
              </button>
            </div>
          </form>
        )}

        {step === "locating" && campaign && (
          <Center>
            <div className="relative flex h-16 w-16 items-center justify-center">
              <div className="absolute inset-0 animate-ping rounded-full bg-fuchsia-500/30" />
              <div className="h-4 w-4 rounded-full bg-fuchsia-500" />
            </div>
            <p className="mt-6 text-lg font-medium">
              Checking you&apos;re at {campaign.location_name}…
            </p>
            <p className="mt-2 text-sm text-zinc-500">
              This can take a few seconds.
            </p>
          </Center>
        )}

        {step === "locked" && campaign && (
          <Center>
            <h1 className="text-3xl font-bold">Not quite there yet</h1>
            <p className="mt-3 text-lg text-zinc-300">
              You&apos;re about {distance}m away.
            </p>
            <p className="mt-2 text-zinc-400">
              The drop unlocks at {campaign.location_name}.
            </p>
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 text-sm font-medium text-fuchsia-400 underline underline-offset-4"
            >
              Open in Google Maps
            </a>
            <button
              onClick={runGeolocation}
              className="mt-8 w-full rounded-2xl bg-zinc-50 py-4 text-lg font-semibold text-zinc-950 transition active:scale-[0.98]"
            >
              Try again
            </button>
          </Center>
        )}

        {step === "unlocked" && campaign && reward && (
          <div className="flex flex-1 flex-col gap-6">
            <div className="mt-4 text-center">
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-fuchsia-400">
                {campaign.artist_name}
              </p>
              <h1 className="mt-3 text-4xl font-bold tracking-tight">
                Unlocked 🎉
              </h1>
            </div>

            {reward.reward_content_url && (
              <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
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
              <div className="rounded-2xl border border-fuchsia-500/30 bg-gradient-to-br from-fuchsia-500/15 to-violet-600/15 p-5 text-center">
                <p className="text-sm font-semibold uppercase tracking-widest text-fuchsia-300">
                  Your discount code
                </p>
                <p className="mt-2 font-mono text-2xl font-bold tracking-wider">
                  {reward.discount_code}
                </p>
                <button
                  onClick={copyCode}
                  className="mt-3 rounded-xl border border-zinc-600 px-5 py-2.5 text-sm font-semibold text-zinc-200 transition active:scale-[0.98]"
                >
                  {copied ? "Copied ✓" : "Copy code"}
                </button>
              </div>
            )}

            <div className="mt-auto pt-4">
              <button
                onClick={() => {
                  track("ticket_click");
                  window.open(reward.ticket_url, "_blank", "noopener");
                }}
                className="w-full rounded-2xl bg-gradient-to-r from-fuchsia-500 to-violet-600 py-4 text-lg font-bold text-white transition active:scale-[0.98]"
              >
                Get tickets
              </button>
            </div>
          </div>
        )}

        {step === "permission_denied" && (
          <Center>
            <h1 className="text-2xl font-bold">Location is blocked</h1>
            <p className="mt-3 text-zinc-400">
              We need your location to check you&apos;re at the spot. To
              re-enable it:
            </p>
            <ul className="mt-4 space-y-2 text-left text-sm text-zinc-300">
              <li className="rounded-xl bg-zinc-900 p-3">
                <span className="font-semibold">Safari:</span> tap the aA /
                icon in the address bar → Website Settings → Location → Allow.
              </li>
              <li className="rounded-xl bg-zinc-900 p-3">
                <span className="font-semibold">Chrome:</span> tap the lock
                icon by the address bar → Permissions → Location → Allow.
              </li>
            </ul>
            <button
              onClick={runGeolocation}
              className="mt-8 w-full rounded-2xl bg-zinc-50 py-4 text-lg font-semibold text-zinc-950 transition active:scale-[0.98]"
            >
              Try again
            </button>
          </Center>
        )}

        {step === "location_error" && (
          <Center>
            <h1 className="text-2xl font-bold">
              Couldn&apos;t get your location
            </h1>
            <p className="mt-3 text-zinc-400">
              Your phone didn&apos;t return a position — this sometimes happens
              indoors or with a weak signal. Step outside if you can, then try
              again.
            </p>
            <button
              onClick={runGeolocation}
              className="mt-8 w-full rounded-2xl bg-zinc-50 py-4 text-lg font-semibold text-zinc-950 transition active:scale-[0.98]"
            >
              Try again
            </button>
          </Center>
        )}

        {step === "rate_limited" && (
          <Center>
            <h1 className="text-2xl font-bold">Too many attempts</h1>
            <p className="mt-3 text-zinc-400">
              Give it ten minutes, then try again.
            </p>
          </Center>
        )}
      </div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      {children}
    </div>
  );
}
