"use client";

import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";
import { directionsUrlFor } from "./directions";
import { FAN_MAP_HEIGHT } from "./fan-map-constants";
import { formatCountdown, useClockOffsetMs, useCorrectedNow } from "./countdown";
import { haversineMeters, roundLiveDistance } from "./geo";

// Leaflet touches window/document at import time (browser-only), and this
// page is the top of the conversion funnel on mobile data — the tile
// library must never sit ahead of the location list in the initial bundle.
// ssr:false + a fixed-height loading placeholder (matching the real map's
// height) means the list paints immediately with no layout shift once the
// map chunk finishes downloading in the background.
const FanMap = dynamic(() => import("./fan-map"), {
  ssr: false,
  loading: () => (
    <div
      style={{ height: FAN_MAP_HEIGHT }}
      className="flex items-center justify-center rounded-2xl border border-ink/25 bg-cream-deep/40 text-sm text-ink/50"
    >
      Loading map…
    </div>
  ),
});

// A map failure (blocked chunk, offline) must never take the unlock flow
// down with it — this only ever wraps FanMap, so a caught error just
// removes the map card; the list above it with working Directions links
// is a separate render tree and is completely unaffected.
class MapErrorBoundary extends Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

type Campaign = {
  id: string;
  slug: string;
  artist_name: string;
  title: string;
  description: string | null;
  reward_teaser: string | null;
  ticket_url: string | null;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
};

type SpotLocation = {
  id: string;
  location_name: string;
  lat: number;
  lng: number;
  radius_m: number;
};

type Reward = {
  reward_content_url: string | null;
  discount_code: string | null;
  // Omitted by the server when the campaign has no ticket link — the
  // "Get tickets" button simply doesn't render.
  ticket_url?: string;
  location_name: string | null;
};

type Step =
  | "loading"
  | "not_found"
  | "not_yet_started"
  | "landing"
  | "locating"
  | "locked"
  | "unlocked"
  | "expired"
  | "permission_denied"
  | "location_error"
  | "rate_limited";

const SESSION_KEY = "ta_session_id";
const CLAIM_DEBOUNCE_MS = 15_000;
// Once a fan submits or dismisses the email ask for a campaign, never
// prompt them again on this device.
const EMAIL_PROMPT_KEY_PREFIX = "ta_email_prompt_";

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

function nearestOf(
  lat: number,
  lng: number,
  locations: SpotLocation[]
): { location: SpotLocation; distanceM: number } | null {
  if (!locations.length) return null;
  let best = locations[0];
  let bestDist = Infinity;
  for (const l of locations) {
    const d = haversineMeters(lat, lng, l.lat, l.lng);
    if (d < bestDist) {
      bestDist = d;
      best = l;
    }
  }
  return { location: best, distanceM: bestDist };
}

const primaryBtn =
  "w-full rounded-full bg-forest-deep py-4 text-lg font-semibold text-parchment transition active:scale-[0.98] disabled:opacity-50";
const ticketBtn =
  "w-full rounded-full bg-clay py-4 text-lg font-bold text-cream transition active:scale-[0.98]";
const eyebrow = "text-xs font-medium uppercase tracking-[0.3em] text-clay";

function CountdownLine({ label, msRemaining }: { label: string; msRemaining: number }) {
  return (
    <p className="mt-2 font-mono text-xs text-ink/50">
      {label}{" "}
      <span className="font-medium text-clay">{formatCountdown(msRemaining)}</span>
    </p>
  );
}

// Optional email capture, shown only AFTER the location check — post-unlock
// as a dismissible card beneath the reward, or on the out-of-range screen
// as a clearly secondary inline field. Never gates anything: the reward
// stays fully usable whether or not an email is given.
function EmailCaptureCard({
  slug,
  sessionId,
  source,
  artistName,
  onDone,
  onDismiss,
}: {
  slug: string;
  sessionId: string;
  source: "post_unlock" | "near_miss";
  artistName: string;
  onDone: () => void;
  // Present only on the post-unlock variant — dismissible means dismissible.
  onDismiss?: () => void;
}) {
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/claim/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          session_id: sessionId,
          email,
          marketing_consent: consent,
          source,
        }),
      });
      if (!res.ok) {
        setError("That didn't go through — check the address and try again.");
        return;
      }
      onDone();
    } catch {
      setError("That didn't go through — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className={
        source === "post_unlock"
          ? "rounded-2xl border border-ink/25 p-5"
          : "rounded-2xl border border-ink/15 p-4"
      }
    >
      <p
        className={
          source === "post_unlock"
            ? "font-serif text-xl"
            : "text-sm font-medium text-ink/80"
        }
      >
        {source === "post_unlock"
          ? `Stay close to ${artistName}`
          : "Can't make it?"}
      </p>
      <p className="mt-1 text-sm text-ink/60">
        {source === "post_unlock"
          ? "Drop your email to hear about the next drop first."
          : "We'll let you know about the next drop."}
      </p>
      <div className="mt-3 flex gap-2">
        <input
          type="email"
          required
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="min-w-0 flex-1 rounded-xl border border-ink/30 bg-transparent px-4 py-2.5 text-ink placeholder-ink/30 outline-none focus:border-forest"
        />
        <button
          type="submit"
          disabled={busy}
          className="shrink-0 rounded-full bg-forest-deep px-5 py-2.5 text-sm font-semibold text-parchment transition active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? "…" : "Keep me posted"}
        </button>
      </div>
      <label className="mt-3 flex items-start gap-2 text-xs text-ink/70">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-forest"
        />
        <span>
          I agree to receive marketing from {artistName} and their team (
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
      {error && <p className="mt-2 text-xs font-medium text-clay">{error}</p>}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="mt-3 text-xs font-medium text-ink/50 underline-offset-4 hover:underline"
        >
          No thanks
        </button>
      )}
    </form>
  );
}

function RewardTeaserCard({ teaser }: { teaser: string }) {
  return (
    <div className="rounded-2xl bg-forest p-5 text-parchment">
      <div className="rounded-xl border border-parchment/25 p-4">
        <p className="text-xs font-medium uppercase tracking-[0.3em] text-sage">
          The reward
        </p>
        <p className="mt-2 font-serif text-2xl leading-snug">{teaser}</p>
      </div>
    </div>
  );
}

function LocationsCard({
  locations,
  focusedLocationId,
  focusNonce,
  onFocusLocation,
}: {
  locations: SpotLocation[];
  focusedLocationId: string | null;
  focusNonce: number;
  onFocusLocation: (id: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-ink/25 p-5">
      <p className="text-xs font-medium uppercase tracking-[0.3em] text-ink/50">
        {locations.length > 1 ? "The spots" : "The spot"}
      </p>
      {locations.length > 1 && (
        <p className="mt-2 text-sm text-ink/70">
          Unlock at any of {locations.length} locations.
        </p>
      )}
      <ul className="mt-2 space-y-4">
        {locations.map((l) => (
          <li key={l.id} className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onFocusLocation(l.id)}
              className="min-w-0 flex-1 text-left"
            >
              <p className="text-lg font-medium">{l.location_name}</p>
            </button>
            <a
              href={directionsUrlFor(l)}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 rounded-full border border-clay/60 px-4 py-2 text-sm font-medium text-clay transition active:scale-[0.98]"
            >
              Directions
            </a>
          </li>
        ))}
      </ul>

      <div className="mt-4">
        <MapErrorBoundary>
          <FanMap
            locations={locations}
            focusedId={focusedLocationId}
            focusNonce={focusNonce}
          />
        </MapErrorBoundary>
      </div>
    </div>
  );
}

export default function FanPage({ slug }: { slug: string }) {
  const [step, setStep] = useState<Step>("loading");
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [locations, setLocations] = useState<SpotLocation[]>([]);
  const [reward, setReward] = useState<Reward | null>(null);
  const [copied, setCopied] = useState(false);
  const [inApp, setInApp] = useState(false);
  const sessionRef = useRef<string>("");
  const viewTracked = useRef(false);

  // Email is asked for AFTER the location check, never before. "done" =
  // submitted (either variant), "dismissed" = declined the post-unlock
  // card; both persist so a fan is never re-prompted on this device.
  const [emailPrompt, setEmailPrompt] = useState<
    "unset" | "done" | "dismissed"
  >("unset");
  const rememberEmailPrompt = useCallback(
    (value: "done" | "dismissed", campaignId: string) => {
      setEmailPrompt(value);
      try {
        localStorage.setItem(EMAIL_PROMPT_KEY_PREFIX + campaignId, value);
      } catch {}
    },
    []
  );

  // Countdown — every screen's "now" is corrected for client clock skew.
  const clockOffsetMs = useClockOffsetMs();
  const now = useCorrectedNow(clockOffsetMs, !!campaign);
  const startsAtMs = campaign ? new Date(campaign.starts_at).getTime() : 0;
  const endsAtMs = campaign ? new Date(campaign.ends_at).getTime() : 0;

  // Tapping a location in the list opens that marker's popup on the map.
  // The nonce always increments alongside the id, even when re-tapping the
  // same spot, so the map still re-focuses after the fan has since panned
  // it away — an id-only signal would silently no-op on a same-value update.
  const [focusedLocationId, setFocusedLocationId] = useState<string | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const focusLocation = useCallback((id: string) => {
    setFocusedLocationId(id);
    setFocusNonce((n) => n + 1);
  }, []);

  // Live tracking. `position` drives the on-screen distance and updates on
  // every watchPosition callback; the server is only ever consulted per the
  // gated, debounced rules in attemptClaim below — never polled per tick.
  const [position, setPosition] = useState<{
    lat: number;
    lng: number;
    accuracy: number;
  } | null>(null);
  const [checking, setChecking] = useState(false);
  const [nearMiss, setNearMiss] = useState(false);
  const watchIdRef = useRef<number | null>(null);
  const firstFixHandledRef = useRef(false);
  const lastClaimAttemptAtRef = useRef(0);
  const locationsRef = useRef(locations);
  locationsRef.current = locations;

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

  // ── Initial campaign load ───────────────────────────────────────────
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
          .select("id, location_name, lat, lng, radius_m")
          .eq("campaign_id", c.id)
          .order("sort_order");
        if (cancelled) return;
        setCampaign(c);
        setLocations((locs as SpotLocation[]) ?? []);
        try {
          const remembered = localStorage.getItem(
            EMAIL_PROMPT_KEY_PREFIX + c.id
          );
          if (remembered === "done" || remembered === "dismissed") {
            setEmailPrompt(remembered);
          }
        } catch {}
        // Active/has-locations are structural, not time-based — everything
        // date-related (not-yet-started / landing / expired) is decided
        // reactively below, against corrected time, and self-corrects the
        // instant the real clock offset loads.
        if (!c.is_active || !locs?.length) {
          setStep("expired");
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

  // ── Stop/start the geolocation watcher ──────────────────────────────
  const stopWatching = useCallback(() => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  const attemptClaim = useCallback(
    async (
      lat: number,
      lng: number,
      accuracy: number,
      expectedInRange: boolean
    ) => {
      const nowMs = Date.now();
      if (nowMs - lastClaimAttemptAtRef.current < CLAIM_DEBOUNCE_MS) return;
      lastClaimAttemptAtRef.current = nowMs;
      setChecking(true);
      try {
        const res = await fetch("/api/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slug,
            lat,
            lng,
            accuracy,
            session_id: sessionRef.current,
          }),
        });
        if (res.status === 429) {
          stopWatching();
          setStep("rate_limited");
          return;
        }
        const json = await res.json();
        if (json.status === "unlocked" || json.status === "already_claimed") {
          stopWatching();
          setNearMiss(false);
          setReward(json);
          setStep("unlocked");
        } else if (json.status === "out_of_range") {
          // A near miss is specifically when the client's own check thought
          // this attempt would succeed — the server's accuracy grace can
          // differ. A plain "still far away" reading from the unconditional
          // first-fix or manual check is not a near miss.
          setNearMiss(expectedInRange);
          setStep((s) => (s === "locating" ? "locked" : s));
        } else if (json.status === "expired") {
          stopWatching();
          setStep("expired");
        }
        // Any other/unrecognised response is treated as a transient hiccup
        // on this one attempt — stay put, keep watching, don't tear the
        // live-tracking screen down over a single bad request.
      } catch {
        // Network hiccup on this one attempt — same reasoning.
      } finally {
        setChecking(false);
      }
    },
    [slug, stopWatching]
  );

  const onPosition = useCallback(
    (pos: GeolocationPosition) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const accuracy = pos.coords.accuracy;
      setPosition({ lat, lng, accuracy });
      setStep((s) => (s === "locating" ? "locked" : s));

      const nearest = nearestOf(lat, lng, locationsRef.current);
      const inRange = !!nearest && nearest.distanceM <= nearest.location.radius_m;

      if (!firstFixHandledRef.current) {
        firstFixHandledRef.current = true;
        track("permission_granted");
        attemptClaim(lat, lng, accuracy, inRange);
      } else if (inRange) {
        attemptClaim(lat, lng, accuracy, true);
      }
    },
    [attemptClaim, track]
  );

  const startWatching = useCallback(() => {
    if (!("geolocation" in navigator)) {
      track("location_error", { reason: "unsupported" });
      setStep("location_error");
      return;
    }
    if (watchIdRef.current != null) return;
    watchIdRef.current = navigator.geolocation.watchPosition(
      onPosition,
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          stopWatching();
          track("permission_denied");
          setStep("permission_denied");
        } else if (!firstFixHandledRef.current) {
          // No fix has ever landed — treat like the original one-shot flow.
          stopWatching();
          track("location_error", { code: err.code });
          setStep("location_error");
        }
        // Once tracking is already live, a transient error (signal blip,
        // one timed-out attempt) shouldn't tear the whole screen down —
        // watchPosition keeps trying on its own.
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  }, [onPosition, track, stopWatching]);

  const beginTracking = () => {
    setStep("locating");
    startWatching();
  };

  const checkAgain = useCallback(() => {
    if (!position) return;
    const nearest = nearestOf(position.lat, position.lng, locationsRef.current);
    const inRange = !!nearest && nearest.distanceM <= nearest.location.radius_m;
    attemptClaim(position.lat, position.lng, position.accuracy, inRange);
  }, [position, attemptClaim]);

  // ── Battery/lifecycle: item 7 ────────────────────────────────────────
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        stopWatching();
      } else if (
        (step === "locating" || step === "locked") &&
        watchIdRef.current == null
      ) {
        startWatching();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [step, stopWatching, startWatching]);

  useEffect(() => stopWatching, [stopWatching]);

  // ── Clock-driven transitions: not-yet-started / landing / expired ──
  useEffect(() => {
    if (!campaign) return;
    if (now > endsAtMs) {
      if (!["unlocked", "expired", "not_found", "rate_limited"].includes(step)) {
        stopWatching();
        setStep("expired");
      }
      return;
    }
    if (now < startsAtMs) {
      if (step === "loading" || step === "landing") setStep("not_yet_started");
      return;
    }
    if (step === "loading" || step === "not_yet_started") setStep("landing");
  }, [now, campaign, endsAtMs, startsAtMs, step, stopWatching]);

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

  const nearest = useMemo(
    () => (position ? nearestOf(position.lat, position.lng, locations) : null),
    [position, locations]
  );
  const roundedDistance = nearest ? roundLiveDistance(nearest.distanceM) : null;
  const canCheckAgain =
    !checking && Date.now() - lastClaimAttemptAtRef.current >= CLAIM_DEBOUNCE_MS;

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
            <p className={eyebrow}>{campaign.artist_name}</p>
            <h1 className="mt-4 font-serif text-4xl">This drop has ended</h1>
            <p className="mt-3 text-ink/60">
              Follow {campaign.artist_name} to catch the next one.
            </p>
            {campaign.ticket_url && (
              <button
                onClick={() => {
                  track("ticket_click");
                  window.open(campaign.ticket_url!, "_blank", "noopener");
                }}
                className={`mt-8 ${ticketBtn}`}
              >
                Get tickets
              </button>
            )}
          </Center>
        )}

        {step === "not_yet_started" && campaign && (
          <div className="fade-up flex flex-1 flex-col gap-6">
            <div className="mt-2">
              <p className={eyebrow}>{campaign.artist_name}</p>
              <h1 className="mt-4 font-serif text-[2.6rem] leading-[1.06]">
                {campaign.title}
              </h1>
            </div>

            <div className="rounded-2xl border border-ink/25 p-6 text-center">
              <p className="text-xs font-medium uppercase tracking-[0.3em] text-ink/50">
                Opens in
              </p>
              <p className="mt-2 font-mono text-3xl text-clay">
                {formatCountdown(startsAtMs - now)}
              </p>
            </div>

            {campaign.reward_teaser && (
              <RewardTeaserCard teaser={campaign.reward_teaser} />
            )}

            <LocationsCard
              locations={locations}
              focusedLocationId={focusedLocationId}
              focusNonce={focusNonce}
              onFocusLocation={focusLocation}
            />

            {inAppBanner}
          </div>
        )}

        {step === "landing" && campaign && (
          <div className="fade-up flex flex-1 flex-col gap-6">
            <div className="mt-2">
              <p className={eyebrow}>{campaign.artist_name}</p>
              <h1 className="mt-4 font-serif text-[2.6rem] leading-[1.06]">
                {campaign.title}
              </h1>
              <CountdownLine label="Ends in" msRemaining={endsAtMs - now} />
              {campaign.description && (
                <p className="mt-4 text-lg leading-relaxed text-ink/70">
                  {campaign.description}
                </p>
              )}
            </div>

            {campaign.reward_teaser && (
              <RewardTeaserCard teaser={campaign.reward_teaser} />
            )}

            <LocationsCard
              locations={locations}
              focusedLocationId={focusedLocationId}
              focusNonce={focusNonce}
              onFocusLocation={focusLocation}
            />

            <div className="divide-y divide-ink/15 border-y border-ink/25">
              {[
                ["01", "Get yourself to the spot"],
                ["02", "Tap unlock when you're there"],
                ["03", "Enjoy what's waiting"],
              ].map(([n, label]) => (
                <div key={n} className="flex items-baseline gap-4 py-3">
                  <span className="font-mono text-xs text-clay">{n}</span>
                  <span className="text-ink/80">{label}</span>
                </div>
              ))}
            </div>

            <p className="text-sm text-ink/50">
              We&apos;ll ask for your location — it&apos;s only used to check
              you&apos;re at the spot, and we never store your coordinates.
            </p>

            {inAppBanner}

            <div className="mt-auto pt-4">
              <button onClick={beginTracking} className={primaryBtn}>
                I&apos;m here — unlock
              </button>
            </div>
          </div>
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
            <CountdownLine label="Ends in" msRemaining={endsAtMs - now} />
          </Center>
        )}

        {step === "locked" && campaign && (
          <div className="fade-up flex flex-1 flex-col gap-6">
            <div className="mt-2 text-center">
              <p className={eyebrow}>{campaign.artist_name}</p>
              <h1 className="mt-4 font-serif text-3xl">
                {campaign.title}
              </h1>
            </div>

            <div className="flex items-center justify-center gap-4">
              <div className="relative flex h-40 w-40 shrink-0 items-center justify-center">
                <span className="absolute inset-0 rounded-full border border-forest/25" />
                <span className="absolute inset-[15%] rounded-full border border-forest/40" />
                <span className="absolute inset-[30%] rounded-full border border-forest/60" />
                <div className="text-center">
                  <p className="font-mono text-lg text-forest">
                    {roundedDistance != null ? `~${roundedDistance}m` : "—"}
                  </p>
                  <p className="mt-1 text-[9px] uppercase tracking-[0.2em] text-ink/50">
                    to {nearest?.location.location_name ?? "go"}
                  </p>
                </div>
              </div>
              <div className="flex h-40 w-32 shrink-0 flex-col items-center justify-center rounded-2xl border border-ink/20 text-center">
                <p className="font-mono text-lg text-clay">
                  {formatCountdown(endsAtMs - now)}
                </p>
                <p className="mt-1 text-[9px] uppercase tracking-[0.2em] text-ink/50">
                  time left
                </p>
              </div>
            </div>

            <div className="text-center">
              {nearMiss ? (
                <>
                  <h2 className="font-serif text-2xl">So close!</h2>
                  <p className="mt-2 text-ink/60">
                    You&apos;re right at the edge — move a few metres and
                    we&apos;ll pick it up.
                  </p>
                </>
              ) : (
                <>
                  <h2 className="font-serif text-2xl">Not quite there yet</h2>
                  <p className="mt-2 text-ink/60">
                    {roundedDistance != null
                      ? `You're about ${roundedDistance}m from ${nearest?.location.location_name}.`
                      : `The drop unlocks at ${locations.length > 1 ? "one of these spots" : locations[0]?.location_name}.`}
                  </p>
                </>
              )}
            </div>

            {campaign.reward_teaser && (
              <RewardTeaserCard teaser={campaign.reward_teaser} />
            )}

            <LocationsCard
              locations={locations}
              focusedLocationId={focusedLocationId}
              focusNonce={focusNonce}
              onFocusLocation={focusLocation}
            />

            {inAppBanner}

            <button
              onClick={checkAgain}
              disabled={!canCheckAgain}
              className={`mt-2 ${primaryBtn}`}
            >
              {checking ? "Checking…" : "Check again"}
            </button>

            {/* Clearly secondary, and always BELOW the distance counter,
                countdown and locations — those stay the primary content. */}
            {emailPrompt !== "done" ? (
              <EmailCaptureCard
                slug={slug}
                sessionId={sessionRef.current}
                source="near_miss"
                artistName={campaign.artist_name}
                onDone={() => rememberEmailPrompt("done", campaign.id)}
              />
            ) : (
              <p className="text-center text-sm text-ink/50">
                You&apos;re on the list — we&apos;ll let you know about the
                next drop.
              </p>
            )}
          </div>
        )}

        {step === "unlocked" && campaign && reward && (
          <div className="fade-up flex flex-1 flex-col gap-6">
            <div className="mt-2 text-center">
              <p className={eyebrow}>{campaign.artist_name}</p>
              <h1 className="mt-3 font-serif text-5xl">Unlocked</h1>
              <CountdownLine label="Drop ends in" msRemaining={endsAtMs - now} />
              {locations.length > 1 && reward.location_name && (
                <p className="mt-2 text-sm text-ink/50">
                  Unlocked at {reward.location_name}
                </p>
              )}
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

            {/* Optional and dismissible — the fan already has the reward;
                this is about staying close to the artist, never access. */}
            {emailPrompt === "unset" && (
              <EmailCaptureCard
                slug={slug}
                sessionId={sessionRef.current}
                source="post_unlock"
                artistName={campaign.artist_name}
                onDone={() => rememberEmailPrompt("done", campaign.id)}
                onDismiss={() => rememberEmailPrompt("dismissed", campaign.id)}
              />
            )}
            {emailPrompt === "done" && (
              <p className="text-center text-sm text-ink/50">
                You&apos;re on the list. 🎉
              </p>
            )}

            {reward.ticket_url && (
              <div className="mt-auto pt-4">
                <button
                  onClick={() => {
                    track("ticket_click");
                    window.open(reward.ticket_url, "_blank", "noopener");
                  }}
                  className={ticketBtn}
                >
                  Get tickets
                </button>
              </div>
            )}
          </div>
        )}

        {step === "permission_denied" && campaign && (
          <div className="fade-up flex flex-1 flex-col gap-6">
            <Center>
              <h1 className="font-serif text-3xl">Location is blocked</h1>
              <CountdownLine label="Ends in" msRemaining={endsAtMs - now} />
              <p className="mt-3 text-ink/60">
                We need your location to check you&apos;re at the spot. To
                re-enable it:
              </p>
              <ul className="mt-4 w-full space-y-2 text-left text-sm text-ink/80">
                <li className="rounded-xl border border-ink/20 p-3">
                  <span className="font-semibold">Safari:</span> tap the aA /
                  icon in the address bar → Website Settings → Location →
                  Allow.
                </li>
                <li className="rounded-xl border border-ink/20 p-3">
                  <span className="font-semibold">Chrome:</span> tap the lock
                  icon by the address bar → Permissions → Location → Allow.
                </li>
              </ul>
              <button onClick={beginTracking} className={`mt-8 ${primaryBtn}`}>
                Try again
              </button>
            </Center>

            <LocationsCard
              locations={locations}
              focusedLocationId={focusedLocationId}
              focusNonce={focusNonce}
              onFocusLocation={focusLocation}
            />
          </div>
        )}

        {step === "location_error" && campaign && (
          <div className="fade-up flex flex-1 flex-col gap-6">
            <Center>
              <h1 className="font-serif text-3xl">
                Couldn&apos;t get your location
              </h1>
              <CountdownLine label="Ends in" msRemaining={endsAtMs - now} />
              <p className="mt-3 text-ink/60">
                Your phone didn&apos;t return a position — this sometimes
                happens indoors or with a weak signal. Step outside if you
                can, then try again.
              </p>
              <button onClick={beginTracking} className={`mt-8 ${primaryBtn}`}>
                Try again
              </button>
            </Center>

            <LocationsCard
              locations={locations}
              focusedLocationId={focusedLocationId}
              focusNonce={focusNonce}
              onFocusLocation={focusLocation}
            />
          </div>
        )}

        {step === "rate_limited" && campaign && (
          <Center>
            <h1 className="font-serif text-3xl">Too many attempts</h1>
            <CountdownLine label="Ends in" msRemaining={endsAtMs - now} />
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
