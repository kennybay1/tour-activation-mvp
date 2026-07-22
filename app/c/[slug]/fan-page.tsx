"use client";

import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import { directionsUrlFor } from "./directions";
import { FAN_MAP_HEIGHT } from "./fan-map-constants";
import { formatCountdown, useClockOffsetMs, useCorrectedNow } from "./countdown";
import { formatApproxDistance, haversineMeters, roundLiveDistance } from "./geo";

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
// down with it — this only ever wraps FanMap. Since the map's pins are now
// the only route to most spots' Directions links, a caught error swaps in
// the fallback (the full location list) instead of leaving fans stranded.
class MapErrorBoundary extends Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) return this.props.fallback ?? null;
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
  expired_headline: string | null;
  expired_message: string | null;
  expired_link_url: string | null;
  expired_link_label: string | null;
  background_image_path: string | null;
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

// Journey rewards, mirroring the shapes from /api/claim and
// /api/journey/progress (server-assembled — the raw fields never reach the
// browser except through those owner-gated / geofenced routes).
type StopReward = {
  location_id: string;
  location_name: string;
  reward_teaser: string | null;
  reward_content_url: string | null;
  discount_code: string | null;
  ticket_url?: string;
};
type FinaleReward = {
  reward_teaser: string | null;
  reward_content_url: string | null;
  discount_code: string | null;
  ticket_url?: string;
};
type JourneyState = {
  progress: { collected: number; total: number };
  complete: boolean;
  collected: StopReward[];
  finale: FinaleReward | null;
};

type Step =
  | "loading"
  | "not_found"
  | "not_yet_started"
  // The poster-like first screen: artwork full-bleed, one centred panel
  // with the campaign's name and countdown. Tapping it opens "landing".
  | "cover"
  | "landing"
  | "locating"
  | "locked"
  | "unlocked"
  | "expired"
  | "permission_denied"
  | "location_error"
  | "rate_limited";

// Owner-only preview. The payload is assembled server-side in page.tsx
// after an ownership check — when present, this component renders entirely
// from it: no fetches, no geolocation, no tracking, no claims.
export type PreviewPayload = {
  campaign: Campaign;
  locations: SpotLocation[];
  reward: Reward;
};

// The fan-visible states an owner can flick between in preview.
const PREVIEW_STATES = [
  { step: "cover", label: "Cover" },
  { step: "landing", label: "Landing" },
  { step: "locked", label: "Locked (near miss)" },
  { step: "unlocked", label: "Unlocked" },
  { step: "expired", label: "Expired" },
] as const;
type PreviewStep = (typeof PREVIEW_STATES)[number]["step"];

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

// Full-viewport campaign background — fixed, cropped to fill, and faded in
// only once loaded so it never blocks first paint. The dark edge gradient
// plus the translucent cream panel the content sits in keep body text, the
// distance counter and the countdown readable over any photograph, light
// or dark.
function FanBackground({ url }: { url: string }) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // The load event can fire before hydration attaches React's onLoad (the
  // SSR'd <img> starts downloading immediately), and a cached image can be
  // complete before any listener exists. Checking .complete AND attaching
  // a native listener in one effect covers every ordering.
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    if (img.complete && img.naturalWidth > 0) {
      setLoaded(true);
      return;
    }
    const onLoad = () => setLoaded(true);
    img.addEventListener("load", onLoad);
    return () => img.removeEventListener("load", onLoad);
  }, [url]);

  return (
    <div className="fixed inset-0" aria-hidden="true">
      <Image
        ref={imgRef}
        src={url}
        alt=""
        fill
        sizes="100vw"
        className={`object-cover transition-opacity duration-700 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-black/10 to-black/35" />
    </div>
  );
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
  inert,
}: {
  slug: string;
  sessionId: string;
  source: "post_unlock" | "near_miss";
  artistName: string;
  onDone: () => void;
  // Present only on the post-unlock variant — dismissible means dismissible.
  onDismiss?: () => void;
  // Preview: render exactly as fans see it, but every interaction just
  // shows a "disabled in preview" note — nothing is ever submitted.
  inert?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inertNote, setInertNote] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inert) {
      setInertNote(true);
      return;
    }
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
      noValidate={inert}
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
      {inertNote && (
        <p className="mt-2 text-xs text-ink/50">Disabled in preview.</p>
      )}
      {onDismiss && (
        <button
          type="button"
          onClick={() => {
            if (inert) {
              setInertNote(true);
              return;
            }
            onDismiss();
          }}
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

// The unlocked media itself — audio, video, or image. Shared by the single
// unlocked screen and every journey reward card.
function RewardMedia({ url }: { url: string }) {
  const kind = mediaKind(url);
  return (
    <div className="rounded-2xl bg-forest-deep p-4">
      {kind === "audio" && <audio controls src={url} className="w-full" />}
      {kind === "video" && (
        <video controls playsInline src={url} className="w-full rounded-xl" />
      )}
      {kind === "image" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="Your unlocked reward" className="w-full rounded-xl" />
      )}
    </div>
  );
}

// A copyable discount code with its own copy state, so several can appear at
// once (one per collected stop) without sharing a single "Copied ✓".
function DiscountCodeBlock({
  code,
  label = "Your discount code",
}: {
  code: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };
  return (
    <div className="rounded-2xl bg-forest p-5 text-center text-parchment">
      <div className="rounded-xl border border-parchment/25 p-5">
        <p className="text-xs font-medium uppercase tracking-[0.3em] text-sage">
          {label}
        </p>
        <p className="mt-3 font-mono text-2xl font-medium tracking-[0.15em]">
          {code}
        </p>
        <button
          onClick={copy}
          className="mt-4 rounded-full border border-parchment/40 px-5 py-2 text-sm font-medium text-parchment transition active:scale-[0.98]"
        >
          {copied ? "Copied ✓" : "Copy code"}
        </button>
      </div>
    </div>
  );
}

// One collected stop (or the finale), rendered as a self-contained reward
// card: name, optional teaser, media, discount, ticket.
function JourneyRewardCard({
  title,
  teaser,
  contentUrl,
  discountCode,
  ticketUrl,
  onTicket,
  highlight,
}: {
  title: string;
  teaser: string | null;
  contentUrl: string | null;
  discountCode: string | null;
  ticketUrl?: string;
  onTicket?: () => void;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        highlight ? "border-forest bg-forest/10" : "border-ink/20"
      }`}
    >
      <p className="text-sm font-semibold text-ink">{title}</p>
      {teaser && <p className="mt-1 text-sm text-ink/60">{teaser}</p>}
      {contentUrl && (
        <div className="mt-3">
          <RewardMedia url={contentUrl} />
        </div>
      )}
      {discountCode && (
        <div className="mt-3">
          <DiscountCodeBlock code={discountCode} />
        </div>
      )}
      {ticketUrl && onTicket && (
        <button
          onClick={onTicket}
          className="mt-3 w-full rounded-full bg-clay py-3 text-sm font-bold text-cream transition active:scale-[0.98]"
        >
          Get tickets
        </button>
      )}
    </div>
  );
}

// The collect-them-all hub — one evolving screen for a Journey. Shows the
// running progress, the growing collection of stop rewards, a prompt to find
// the next stop, and the grand finale once every stop is in. The map card
// and in-app banner are passed in as children so the hub owns only the
// journey-specific chrome.
function JourneyHub({
  campaign,
  journey,
  justUnlocked,
  totalStops,
  nearMiss,
  roundedDistance,
  nearestName,
  msRemaining,
  onUnlock,
  busy,
  previewBlocked,
  onTicket,
  children,
}: {
  campaign: Campaign;
  journey: JourneyState | null;
  justUnlocked: StopReward | null;
  totalStops: number;
  nearMiss: boolean;
  roundedDistance: number | null;
  nearestName: string | null;
  msRemaining: number;
  onUnlock: () => void;
  busy: boolean;
  previewBlocked: boolean;
  onTicket: () => void;
  children: React.ReactNode;
}) {
  const collected = journey?.collected ?? [];
  const collectedCount = journey?.progress.collected ?? collected.length;
  const total = journey?.progress.total ?? totalStops;
  const complete = journey?.complete ?? false;
  const finale = journey?.finale ?? null;
  const pct = total > 0 ? Math.round((collectedCount / total) * 100) : 0;
  const remaining = Math.max(total - collectedCount, 0);
  const openTicket = (url?: string) => {
    if (!url) return;
    onTicket();
    window.open(url, "_blank", "noopener");
  };

  return (
    <div className="fade-up flex flex-1 flex-col gap-6">
      <div className="mt-2">
        <p className={eyebrow}>{campaign.artist_name}</p>
        <h1 className="mt-4 font-serif text-[2.6rem] leading-[1.06]">
          {campaign.title}
        </h1>
        <CountdownLine label="Ends in" msRemaining={msRemaining} />
        {collectedCount === 0 && campaign.description && (
          <p className="mt-4 text-lg leading-relaxed text-ink/70">
            {campaign.description}
          </p>
        )}
      </div>

      {/* Progress */}
      <div className="rounded-2xl border border-ink/25 p-5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-[0.3em] text-ink/50">
            Your journey
          </p>
          <p className="font-mono text-sm text-forest-deep">
            {collectedCount} / {total}
          </p>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-ink/10">
          <div
            className="h-full rounded-full bg-forest transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-2 text-sm text-ink/60">
          {complete
            ? "Every stop collected."
            : collectedCount === 0
              ? `Collect a reward at each of the ${total} stops.`
              : `${remaining} ${remaining === 1 ? "stop" : "stops"} to go.`}
        </p>
      </div>

      {/* Your collection so far */}
      {collected.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-[0.3em] text-ink/50">
            Your collection
          </p>
          {collected.map((s) => (
            <JourneyRewardCard
              key={s.location_id}
              title={s.location_name}
              teaser={s.reward_teaser}
              contentUrl={s.reward_content_url}
              discountCode={s.discount_code}
              ticketUrl={s.ticket_url}
              onTicket={() => openTicket(s.ticket_url)}
              highlight={justUnlocked?.location_id === s.location_id}
            />
          ))}
        </div>
      )}

      {/* Grand finale, once every stop is collected */}
      {complete && (
        <div className="space-y-3">
          <div className="text-center">
            <h2 className="font-serif text-3xl">You collected them all</h2>
          </div>
          {finale ? (
            <>
              <p className="text-center text-xs font-medium uppercase tracking-[0.3em] text-clay">
                The grand finale
              </p>
              <JourneyRewardCard
                title={finale.reward_teaser ?? "Grand finale"}
                teaser={
                  finale.reward_teaser
                    ? null
                    : "Your reward for finishing the journey."
                }
                contentUrl={finale.reward_content_url}
                discountCode={finale.discount_code}
                ticketUrl={finale.ticket_url}
                onTicket={() => openTicket(finale.ticket_url)}
                highlight
              />
            </>
          ) : (
            <p className="text-center text-ink/60">
              Nice work — you visited every stop.
            </p>
          )}
        </div>
      )}

      {/* Find the next stop */}
      {!complete && (
        <>
          {nearMiss ? (
            <div className="text-center">
              <h2 className="font-serif text-2xl">So close!</h2>
              <p className="mt-2 text-ink/60">
                You&apos;re right at the edge — move a few metres and we&apos;ll
                pick it up.
              </p>
            </div>
          ) : roundedDistance != null && nearestName ? (
            <p className="text-center text-sm text-ink/60">
              About {roundedDistance}m to {nearestName}.
            </p>
          ) : null}

          {children}

          <div className="pt-2">
            <button onClick={onUnlock} disabled={busy} className={primaryBtn}>
              {busy
                ? "Checking…"
                : collectedCount === 0
                  ? "I'm here — unlock"
                  : "I'm at the next stop — unlock"}
            </button>
            {previewBlocked && (
              <p className="mt-2 text-center text-xs text-ink/50">
                Disabled in preview.
              </p>
            )}
            <p className="mt-3 text-center text-xs text-ink/50">
              We&apos;ll ask for your location — only to check you&apos;re at a
              stop, and we never store your coordinates.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// The fan-initiated "how close am I?" control: one browser location read,
// used only in the page (distance maths + the map dot) — never sent
// anywhere, so the "we never store your coordinates" promise holds.
type LocateControl = {
  run: () => void;
  busy: boolean;
  error: string | null;
  // Preview tapped it — show the standard "disabled" note instead.
  blocked: boolean;
};

function LocationsCard({
  locations,
  nearest,
  fanPosition,
  locate,
  focusedLocationId,
  focusNonce,
  onFocusLocation,
}: {
  locations: SpotLocation[];
  nearest: { location: SpotLocation; distanceM: number } | null;
  fanPosition: { lat: number; lng: number } | null;
  locate: LocateControl | null;
  focusedLocationId: string | null;
  focusNonce: number;
  onFocusLocation: (id: string) => void;
}) {
  // Only one spot gets a row above the map: the closest once we know where
  // the fan is. A lone location is trivially "closest" with no position at
  // all; with several spots and no position yet, the map alone carries it.
  const featured =
    nearest?.location ?? (locations.length === 1 ? locations[0] : null);

  // If the map chunk ever fails to load, its pins' Directions links go with
  // it — the boundary swaps in this full list so every spot stays reachable.
  const fullListFallback = (
    <ul className="space-y-4">
      {locations.map((l) => (
        <li key={l.id} className="flex items-center gap-3">
          <p className="min-w-0 flex-1 text-lg font-medium">
            {l.location_name}
          </p>
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
  );

  return (
    <div className="rounded-2xl border border-ink/25 p-5">
      <p className="text-xs font-medium uppercase tracking-[0.3em] text-ink/50">
        {locations.length === 1
          ? "The spot"
          : nearest
            ? "Your closest spot"
            : "The spots"}
      </p>
      {locations.length > 1 && (
        <p className="mt-2 text-sm text-ink/70">
          {nearest
            ? `Unlock at any of ${locations.length} locations — the others are pins on the map.`
            : `Unlock at any of ${locations.length} locations — tap a pin on the map for directions.`}
        </p>
      )}
      {featured && (
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={() => onFocusLocation(featured.id)}
            className="min-w-0 flex-1 text-left"
          >
            <p className="text-lg font-medium">{featured.location_name}</p>
            {nearest && (
              <p className="text-sm text-ink/60">
                about {formatApproxDistance(nearest.distanceM)} away
              </p>
            )}
          </button>
          <a
            href={directionsUrlFor(featured)}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-full border border-clay/60 px-4 py-2 text-sm font-medium text-clay transition active:scale-[0.98]"
          >
            Directions
          </a>
        </div>
      )}

      {locate && (
        <div className="mt-3">
          <button
            type="button"
            onClick={locate.run}
            disabled={locate.busy}
            className="w-full rounded-full border border-forest/50 py-2.5 text-sm font-medium text-forest transition active:scale-[0.98] disabled:opacity-50"
          >
            {locate.busy
              ? "Finding you…"
              : nearest
                ? "Update my distance"
                : "How close am I?"}
          </button>
          {locate.error && (
            <p className="mt-1.5 text-xs font-medium text-clay">
              {locate.error}
            </p>
          )}
          {locate.blocked && (
            <p className="mt-1.5 text-center text-xs text-ink/50">
              Disabled in preview.
            </p>
          )}
        </div>
      )}

      <div className="mt-4">
        <MapErrorBoundary fallback={fullListFallback}>
          <FanMap
            locations={locations}
            focusedId={focusedLocationId}
            focusNonce={focusNonce}
            fanPosition={fanPosition}
          />
        </MapErrorBoundary>
      </div>
    </div>
  );
}

export default function FanPage({
  slug,
  preview,
}: {
  slug: string;
  preview?: PreviewPayload | null;
}) {
  const isPreview = !!preview;
  const [step, setStep] = useState<Step>("loading");
  // Which controls the owner has tapped in preview — each shows a small
  // "disabled in preview" note instead of doing its real work.
  const [previewBlocked, setPreviewBlocked] = useState<string | null>(null);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [locations, setLocations] = useState<SpotLocation[]>([]);
  const [reward, setReward] = useState<Reward | null>(null);
  const [copied, setCopied] = useState(false);
  const [inApp, setInApp] = useState(false);
  const sessionRef = useRef<string>("");
  const viewTracked = useRef(false);

  // Journey state. isJourney flips the fan experience to the collect-them-all
  // hub; `journey` holds what's been collected so far (restored on load, and
  // updated after every stop unlock); justUnlocked highlights the stop just
  // collected. Refs mirror them for the stable claim callback.
  const [isJourney, setIsJourney] = useState(false);
  const [journey, setJourney] = useState<JourneyState | null>(null);
  const [justUnlocked, setJustUnlocked] = useState<StopReward | null>(null);
  const isJourneyRef = useRef(isJourney);
  isJourneyRef.current = isJourney;

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

  // Display-only position for the "closest spot" card on screens shown
  // before tracking starts. Fetched once, and ONLY when the browser reports
  // permission is already granted — so it can never raise a permission
  // prompt; that moment still belongs to the "I'm here — unlock" tap.
  // Never feeds claims: attemptClaim only ever runs off the live watcher.
  const [passivePosition, setPassivePosition] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  useEffect(() => {
    // Preview must never touch geolocation, even this passive read.
    if (isPreview) return;
    if (!("geolocation" in navigator) || !("permissions" in navigator)) return;
    let cancelled = false;
    navigator.permissions
      .query({ name: "geolocation" })
      .then((status) => {
        if (cancelled || status.state !== "granted") return;
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (cancelled) return;
            setPassivePosition({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
            });
          },
          () => {},
          // A coarse, possibly cached fix is plenty for "which spot is
          // closest" — high accuracy would just burn battery here.
          { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 }
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isPreview]);
  const [checking, setChecking] = useState(false);
  const [nearMiss, setNearMiss] = useState(false);
  const watchIdRef = useRef<number | null>(null);
  const firstFixHandledRef = useRef(false);
  const lastClaimAttemptAtRef = useRef(0);
  const locationsRef = useRef(locations);
  locationsRef.current = locations;

  const track = useCallback(
    (event_type: string, metadata?: Record<string, unknown>) => {
      // Guarded at the helper itself so no state transition can slip an
      // analytics event through while the owner is previewing.
      if (isPreview) return;
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
    [slug, isPreview]
  );

  // ── Preview bootstrap ───────────────────────────────────────────────
  // Everything comes from the owner-authenticated server payload; the anon
  // fetch below never runs, and no page_view is tracked.
  useEffect(() => {
    if (!preview) return;
    sessionRef.current = "preview";
    setCampaign(preview.campaign);
    setLocations(preview.locations);
    setReward(preview.reward);
    setStep("cover");
  }, [preview]);

  // ── Initial campaign load ───────────────────────────────────────────
  useEffect(() => {
    if (isPreview) return;
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

        // Ask the server which experience this is, and (inside the live
        // window) what this device has already collected. This is the only
        // way the client learns the mode — campaign_type is never exposed on
        // the public view, and rewards are never in it either.
        try {
          const res = await fetch("/api/journey/progress", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slug, session_id: sessionRef.current }),
          });
          const pj = await res.json();
          if (cancelled) return;
          if (pj.mode === "journey") {
            setIsJourney(true);
            if (pj.live) {
              setJourney({
                progress: pj.progress,
                complete: pj.complete,
                collected: pj.collected,
                finale: pj.finale,
              });
            }
          }
        } catch {}
      });
    return () => {
      cancelled = true;
    };
  }, [slug, track, isPreview]);

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
      // Preview can never claim — belt and braces on top of the guarded
      // entry points, so no future code path can reach /api/claim either.
      if (isPreview) return;
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
        if (json.mode === "journey") {
          // A stop was collected. Fold in the new state, highlight it, and
          // return to the journey hub (never the terminal single screen) so
          // the fan can go on to the next stop — or see the finale.
          stopWatching();
          setNearMiss(false);
          setJourney({
            progress: json.progress,
            complete: json.complete,
            collected: json.collected,
            finale: json.finale,
          });
          setJustUnlocked(json.just_unlocked);
          setStep("landing");
        } else if (
          json.status === "unlocked" ||
          json.status === "already_claimed"
        ) {
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
          // Journeys keep the fan on the hub; single drops use the locked
          // near-miss screen.
          setStep((s) =>
            s === "locating" ? (isJourneyRef.current ? "landing" : "locked") : s
          );
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
    [slug, stopWatching, isPreview]
  );

  const onPosition = useCallback(
    (pos: GeolocationPosition) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const accuracy = pos.coords.accuracy;
      setPosition({ lat, lng, accuracy });
      setStep((s) =>
        s === "locating" ? (isJourneyRef.current ? "landing" : "locked") : s
      );

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
    // In preview the unlock button stays visible but inert — geolocation
    // must never be requested.
    if (isPreview) {
      setPreviewBlocked("unlock");
      return;
    }
    setStep("locating");
    startWatching();
  };

  const checkAgain = useCallback(() => {
    if (isPreview) {
      setPreviewBlocked("check");
      return;
    }
    if (!position) return;
    const nearest = nearestOf(position.lat, position.lng, locationsRef.current);
    const inRange = !!nearest && nearest.distanceM <= nearest.location.radius_m;
    attemptClaim(position.lat, position.lng, position.accuracy, inRange);
  }, [position, attemptClaim, isPreview]);

  // ── Battery/lifecycle: item 7 ────────────────────────────────────────
  useEffect(() => {
    // Preview forces `step` into "locked" without ever starting a watcher —
    // this restart-on-return logic would start one for real. Skip entirely.
    if (isPreview) return;
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
  }, [step, stopWatching, startWatching, isPreview]);

  useEffect(() => stopWatching, [stopWatching]);

  // ── Clock-driven transitions: not-yet-started / landing / expired ──
  useEffect(() => {
    // In preview the owner picks the state by hand — a draft whose dates
    // are already past must not be yanked to "expired" by the clock.
    if (isPreview) return;
    if (!campaign) return;
    if (now > endsAtMs) {
      if (!["unlocked", "expired", "not_found", "rate_limited"].includes(step)) {
        stopWatching();
        setStep("expired");
      }
      return;
    }
    if (now < startsAtMs) {
      if (step === "loading" || step === "cover" || step === "landing") {
        setStep("not_yet_started");
      }
      return;
    }
    // A freshly opened (or newly started) campaign begins at the cover;
    // the fan taps through to the landing screen themselves.
    if (step === "loading" || step === "not_yet_started") setStep("cover");
  }, [now, campaign, endsAtMs, startsAtMs, step, stopWatching, isPreview]);

  // Post-expiry traffic: fire once per page load whether the fan landed on
  // an already-ended campaign or it expired mid-session. The results page
  // counts distinct sessions, so repeat loads don't inflate the metric.
  const expiredViewTracked = useRef(false);
  useEffect(() => {
    if (step !== "expired" || !campaign || expiredViewTracked.current) return;
    expiredViewTracked.current = true;
    track("expired_view");
  }, [step, campaign, track]);

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

  // Fan-initiated one-shot location read for the "How close am I?" button.
  // Feeds the same passive display position — distance line, closest-spot
  // pick and the map's "you are here" dot — and nothing else. Coordinates
  // stay in the browser; no server call is involved.
  const [locateBusy, setLocateBusy] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const locateMe = useCallback(() => {
    if (isPreview) {
      setPreviewBlocked("locate");
      return;
    }
    if (!("geolocation" in navigator)) {
      setLocateError("This browser doesn't support location.");
      return;
    }
    setLocateBusy(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPassivePosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setLocateBusy(false);
      },
      (err) => {
        setLocateBusy(false);
        setLocateError(
          err.code === err.PERMISSION_DENIED
            ? "Location is blocked for this site — allow it in your browser settings, then try again."
            : "Couldn't get a fix — try again, or step outside."
        );
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }
    );
  }, [isPreview]);
  const locate: LocateControl = {
    run: locateMe,
    busy: locateBusy,
    error: locateError,
    blocked: previewBlocked === "locate",
  };

  // Live position wins; the passive one covers screens before tracking
  // starts (landing, not-yet-started) for fans who granted location before.
  const displayPosition = position ?? passivePosition;
  const nearest = useMemo(
    () =>
      displayPosition
        ? nearestOf(displayPosition.lat, displayPosition.lng, locations)
        : null,
    [displayPosition, locations]
  );
  const roundedDistance = nearest ? roundLiveDistance(nearest.distanceM) : null;
  const canCheckAgain =
    !checking && Date.now() - lastClaimAttemptAtRef.current >= CLAIM_DEBOUNCE_MS;

  // Preview state switcher. "Locked" plants a simulated position a
  // plausible near-miss distance outside the first spot's radius, so the
  // distance ring, closest-spot card and near-miss copy all render with
  // realistic numbers against the campaign's real locations. Purely local
  // state — none of the real entry points (watcher, claim, track) run.
  const goToPreviewState = (target: PreviewStep) => {
    if (!preview) return;
    setPreviewBlocked(null);
    setNearMiss(target === "locked");
    if (target === "locked") {
      const l0 = preview.locations[0];
      if (l0) {
        // Just outside the radius — a genuine "right at the edge" miss.
        const missM = l0.radius_m + 15;
        // ~111,320 m per degree of latitude.
        setPosition({ lat: l0.lat + missM / 111320, lng: l0.lng, accuracy: 12 });
      }
    }
    setStep(target);
  };

  const bgUrl = campaign?.background_image_path
    ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/backgrounds/${campaign.background_image_path}`
    : null;

  return (
    <div
      className={`grain relative min-h-dvh bg-cream font-sans text-ink ${
        isPreview ? "pt-24" : ""
      }`}
    >
      {isPreview && (
        <div className="fixed inset-x-0 top-0 z-50 bg-forest-deep text-parchment shadow-md">
          <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sage">
              Preview — this is what fans will see
            </p>
            <div className="flex flex-wrap gap-1.5">
              {PREVIEW_STATES.map((s) => (
                <button
                  key={s.step}
                  type="button"
                  onClick={() => goToPreviewState(s.step)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    step === s.step
                      ? "bg-parchment text-forest-deep"
                      : "border border-parchment/40 text-parchment/90 hover:border-parchment"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {bgUrl && <FanBackground url={bgUrl} />}
      <div className={bgUrl ? "relative z-10 p-4 sm:p-6" : undefined}>
        {/* On the cover step the artwork IS the page — the usual full-height
            cream panel drops away and only the small centred card floats
            over it (the card itself renders in the cover step below). */}
        <div
          className={`mx-auto flex w-full flex-col ${
            step === "cover" ? "max-w-2xl" : "max-w-md"
          } ${
            bgUrl
              ? `min-h-[calc(100dvh-2rem)] px-5 py-8 sm:min-h-[calc(100dvh-3rem)] ${
                  step === "cover"
                    ? ""
                    : "rounded-3xl bg-cream/90 shadow-xl backdrop-blur-md"
                }`
              : "min-h-dvh px-5 py-8"
          }`}
        >
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
            <p className="mt-2 text-sm text-ink/50">{campaign.title}</p>
            <h1 className="mt-4 font-serif text-4xl">
              {campaign.expired_headline || "This drop has ended"}
            </h1>
            <p className="mt-3 text-ink/60">
              {campaign.expired_message ||
                `Follow ${campaign.artist_name} to catch the next one.`}
            </p>
            {campaign.expired_link_url && campaign.expired_link_label && (
              <button
                onClick={() => {
                  track("expired_link_click");
                  window.open(campaign.expired_link_url!, "_blank", "noopener");
                }}
                className={`mt-8 ${ticketBtn}`}
              >
                {campaign.expired_link_label}
              </button>
            )}
            {campaign.ticket_url && (
              // Secondary beneath any custom link; the lone prominent
              // action when there isn't one.
              <button
                onClick={() => {
                  track("ticket_click");
                  window.open(campaign.ticket_url!, "_blank", "noopener");
                }}
                className={
                  campaign.expired_link_url && campaign.expired_link_label
                    ? "mt-3 w-full rounded-full border border-ink/30 py-4 text-lg font-medium text-ink/80 transition hover:border-ink/60 active:scale-[0.98]"
                    : `mt-8 ${ticketBtn}`
                }
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
              nearest={nearest}
              fanPosition={displayPosition}
              locate={locate}
              focusedLocationId={focusedLocationId}
              focusNonce={focusNonce}
              onFocusLocation={focusLocation}
            />

            {inAppBanner}
          </div>
        )}

        {step === "cover" && campaign && (
          <div className="fade-up flex flex-1 items-center justify-center">
            <button
              type="button"
              onClick={() => setStep("landing")}
              aria-label={`Open ${campaign.title}`}
              className="w-full rounded-[2rem] bg-cream/90 px-8 py-12 text-center shadow-xl backdrop-blur-md transition active:scale-[0.99]"
            >
              <p className={eyebrow}>{campaign.artist_name}</p>
              <h1 className="mt-3 font-serif text-4xl sm:text-5xl">
                {campaign.title}
              </h1>
              <CountdownLine label="Ends in" msRemaining={endsAtMs - now} />
            </button>
          </div>
        )}

        {step === "landing" && campaign && isJourney && (
          <JourneyHub
            campaign={campaign}
            journey={journey}
            justUnlocked={justUnlocked}
            totalStops={locations.length}
            nearMiss={nearMiss}
            roundedDistance={roundedDistance}
            nearestName={nearest?.location.location_name ?? null}
            msRemaining={endsAtMs - now}
            onUnlock={beginTracking}
            busy={checking}
            previewBlocked={previewBlocked === "unlock"}
            onTicket={() => {
              track("ticket_click");
            }}
          >
            <LocationsCard
              locations={locations}
              nearest={nearest}
              fanPosition={displayPosition}
              locate={locate}
              focusedLocationId={focusedLocationId}
              focusNonce={focusNonce}
              onFocusLocation={focusLocation}
            />
            {inAppBanner}
          </JourneyHub>
        )}

        {step === "landing" && campaign && !isJourney && (
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
              nearest={nearest}
              fanPosition={displayPosition}
              locate={locate}
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
              {previewBlocked === "unlock" && (
                <p className="mt-2 text-center text-xs text-ink/50">
                  Disabled in preview.
                </p>
              )}
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
              nearest={nearest}
              fanPosition={displayPosition}
              // Live tracking is already running here and "Check again" is
              // the primary action — a second locate button would compete.
              locate={null}
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
            {previewBlocked === "check" && (
              <p className="text-center text-xs text-ink/50">
                Disabled in preview.
              </p>
            )}

            {/* Clearly secondary, and always BELOW the distance counter,
                countdown and locations — those stay the primary content. */}
            {emailPrompt !== "done" ? (
              <EmailCaptureCard
                slug={slug}
                sessionId={sessionRef.current}
                source="near_miss"
                artistName={campaign.artist_name}
                onDone={() => rememberEmailPrompt("done", campaign.id)}
                inert={isPreview}
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
                inert={isPreview}
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
              nearest={nearest}
              fanPosition={displayPosition}
              locate={locate}
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
              nearest={nearest}
              fanPosition={displayPosition}
              locate={locate}
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
