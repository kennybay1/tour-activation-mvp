"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  validateCampaign,
  suggestSlug,
  DEFAULT_RADIUS_M,
  RADIUS_WARN_BELOW,
  type CampaignInput,
} from "@/lib/campaign-schema";
import { saveCampaign, checkSlugAvailable } from "./actions";

export type CampaignFormValues = {
  slug: string;
  artist_name: string;
  title: string;
  description: string;
  location_name: string;
  lat: string;
  lng: string;
  radius_m: string;
  reward_teaser: string;
  reward_content_url: string;
  discount_code: string;
  ticket_url: string;
  startsLocal: string; // datetime-local string
  endsLocal: string; // datetime-local string
  is_active: boolean;
};

const EMPTY: CampaignFormValues = {
  slug: "",
  artist_name: "",
  title: "",
  description: "",
  location_name: "",
  lat: "",
  lng: "",
  radius_m: String(DEFAULT_RADIUS_M),
  reward_teaser: "",
  reward_content_url: "",
  discount_code: "",
  ticket_url: "",
  startsLocal: "",
  endsLocal: "",
  is_active: true,
};

function localToIso(local: string): string {
  if (!local) return "";
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

// ISO → "YYYY-MM-DDTHH:mm" in the browser's own timezone. Runs client-side
// only (via effect) so the admin sees times in their local zone, and so
// there's no server/client hydration mismatch.
function isoToLocal(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate()
  )}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function CampaignForm({
  campaignId,
  initial,
  startsIso,
  endsIso,
}: {
  campaignId?: string;
  initial?: CampaignFormValues;
  startsIso?: string;
  endsIso?: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState<CampaignFormValues>(initial ?? EMPTY);

  // Fill the date fields in local time after mount (edit case).
  useEffect(() => {
    if (!startsIso && !endsIso) return;
    setValues((v) => ({
      ...v,
      startsLocal: isoToLocal(startsIso),
      endsLocal: isoToLocal(endsIso),
    }));
  }, [startsIso, endsIso]);
  const [city, setCity] = useState(""); // only feeds slug suggestion; not saved
  const [slugTouched, setSlugTouched] = useState(Boolean(campaignId));
  const [slugStatus, setSlugStatus] = useState<
    "idle" | "checking" | "available" | "taken"
  >("idle");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof CampaignFormValues>(
    key: K,
    value: CampaignFormValues[K]
  ) => setValues((v) => ({ ...v, [key]: value }));

  // Auto-suggest slug from artist + city on new campaigns, until the user
  // edits the slug field themselves.
  useEffect(() => {
    if (slugTouched || campaignId) return;
    const suggestion = suggestSlug(values.artist_name, city);
    setValues((v) => ({ ...v, slug: suggestion }));
  }, [values.artist_name, city, slugTouched, campaignId]);

  const mapsPreview = useMemo(() => {
    const lat = Number(values.lat);
    const lng = Number(values.lng);
    if (
      values.lat.trim() === "" ||
      values.lng.trim() === "" ||
      Number.isNaN(lat) ||
      Number.isNaN(lng)
    )
      return null;
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  }, [values.lat, values.lng]);

  const radiusLow =
    values.radius_m.trim() !== "" &&
    Number(values.radius_m) > 0 &&
    Number(values.radius_m) < RADIUS_WARN_BELOW;

  async function onSlugBlur() {
    if (!values.slug.trim() || errors.slug) {
      setSlugStatus("idle");
      return;
    }
    setSlugStatus("checking");
    const { available } = await checkSlugAvailable(values.slug, campaignId);
    setSlugStatus(available ? "available" : "taken");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);

    const payload: CampaignInput = {
      slug: values.slug,
      artist_name: values.artist_name,
      title: values.title,
      description: values.description,
      location_name: values.location_name,
      lat: values.lat,
      lng: values.lng,
      radius_m: values.radius_m,
      reward_teaser: values.reward_teaser,
      reward_content_url: values.reward_content_url,
      discount_code: values.discount_code,
      ticket_url: values.ticket_url,
      starts_at: localToIso(values.startsLocal),
      ends_at: localToIso(values.endsLocal),
      is_active: values.is_active,
    };

    const clientErrors = validateCampaign(payload);
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      setBusy(false);
      return;
    }

    const res = await saveCampaign(payload, campaignId);
    if (!res.ok) {
      setErrors(res.errors);
      setBusy(false);
      return;
    }
    router.push("/admin");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      {errors._form && (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {errors._form}
        </p>
      )}

      <Field label="Artist name" error={errors.artist_name}>
        <input
          className={inputCls}
          value={values.artist_name}
          onChange={(e) => set("artist_name", e.target.value)}
        />
      </Field>

      <Field label="Title" error={errors.title}>
        <input
          className={inputCls}
          value={values.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="Unlock a message from…"
        />
      </Field>

      {!campaignId && (
        <Field
          label="City (only used to suggest a slug — not saved)"
          error={undefined}
        >
          <input
            className={inputCls}
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="London"
          />
        </Field>
      )}

      <Field
        label="Slug (the campaign's web address)"
        error={errors.slug}
        hint="Fans visit /c/your-slug. Lowercase letters, numbers and hyphens."
      >
        <input
          className={inputCls}
          value={values.slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlugStatus("idle");
            set("slug", e.target.value);
          }}
          onBlur={onSlugBlur}
          placeholder="test-band-london"
        />
        {slugStatus === "checking" && (
          <p className="mt-1 text-xs text-zinc-500">Checking availability…</p>
        )}
        {slugStatus === "available" && (
          <p className="mt-1 text-xs text-emerald-400">✓ Available</p>
        )}
        {slugStatus === "taken" && (
          <p className="mt-1 text-xs text-red-400">
            ✗ Already used by another campaign
          </p>
        )}
      </Field>

      <Field label="Description" error={errors.description}>
        <textarea
          className={inputCls}
          rows={3}
          value={values.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </Field>

      <Field label="Location name" error={errors.location_name}>
        <input
          className={inputCls}
          value={values.location_name}
          onChange={(e) => set("location_name", e.target.value)}
          placeholder="Outside the Roundhouse, Chalk Farm Rd"
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Latitude" error={errors.lat}>
          <input
            className={inputCls}
            inputMode="decimal"
            value={values.lat}
            onChange={(e) => set("lat", e.target.value)}
            placeholder="51.5432"
          />
        </Field>
        <Field label="Longitude" error={errors.lng}>
          <input
            className={inputCls}
            inputMode="decimal"
            value={values.lng}
            onChange={(e) => set("lng", e.target.value)}
            placeholder="-0.1519"
          />
        </Field>
      </div>
      <p className="-mt-3 text-xs text-zinc-500">
        Right-click the spot in Google Maps and copy the coordinates, then
        paste them here.
        {mapsPreview && (
          <>
            {" "}
            <a
              href={mapsPreview}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-fuchsia-400 underline underline-offset-4"
            >
              Preview on Google Maps
            </a>
          </>
        )}
      </p>

      <Field
        label="Unlock radius (metres)"
        error={errors.radius_m}
        hint="How close a fan must be to unlock. Default 200."
      >
        <input
          className={inputCls}
          inputMode="numeric"
          value={values.radius_m}
          onChange={(e) => set("radius_m", e.target.value)}
        />
        {radiusLow && (
          <p className="mt-1 text-xs text-amber-400">
            Below {RADIUS_WARN_BELOW}m, everyday GPS wobble may block real fans
            who are actually there.
          </p>
        )}
      </Field>

      <Field label="Reward teaser" error={errors.reward_teaser}>
        <input
          className={inputCls}
          value={values.reward_teaser}
          onChange={(e) => set("reward_teaser", e.target.value)}
          placeholder="An exclusive voice note + 20% off tickets"
        />
      </Field>

      <Field
        label="Reward content URL"
        error={errors.reward_content_url}
        hint="Audio, video or image the fan unlocks. Optional."
      >
        <input
          className={inputCls}
          value={values.reward_content_url}
          onChange={(e) => set("reward_content_url", e.target.value)}
          placeholder="https://…/voice-note.mp3"
        />
      </Field>

      <Field label="Discount code" error={errors.discount_code}>
        <input
          className={inputCls}
          value={values.discount_code}
          onChange={(e) => set("discount_code", e.target.value)}
          placeholder="TESTBAND20"
        />
      </Field>

      <Field label="Ticket URL" error={errors.ticket_url}>
        <input
          className={inputCls}
          value={values.ticket_url}
          onChange={(e) => set("ticket_url", e.target.value)}
          placeholder="https://tickets.example.com/…"
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Starts" error={errors.starts_at}>
          <input
            type="datetime-local"
            className={inputCls}
            value={values.startsLocal}
            onChange={(e) => set("startsLocal", e.target.value)}
          />
        </Field>
        <Field label="Ends" error={errors.ends_at}>
          <input
            type="datetime-local"
            className={inputCls}
            value={values.endsLocal}
            onChange={(e) => set("endsLocal", e.target.value)}
          />
        </Field>
      </div>

      <label className="flex items-center gap-3 text-sm text-zinc-300">
        <input
          type="checkbox"
          checked={values.is_active}
          onChange={(e) => set("is_active", e.target.checked)}
          className="h-5 w-5 accent-fuchsia-500"
        />
        Active (fans can access the page while it&apos;s within the dates above)
      </label>

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-zinc-50 px-6 py-3 font-semibold text-zinc-950 transition active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? "Saving…" : campaignId ? "Save changes" : "Create campaign"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/admin")}
          className="rounded-xl border border-zinc-700 px-6 py-3 font-medium text-zinc-300 transition hover:border-zinc-500"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

const inputCls =
  "w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-zinc-100 placeholder-zinc-600 outline-none focus:border-fuchsia-500";

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-zinc-300">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}
