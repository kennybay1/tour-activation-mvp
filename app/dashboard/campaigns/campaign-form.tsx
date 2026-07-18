"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  validateCampaign,
  suggestSlug,
  DEFAULT_RADIUS_M,
  RADIUS_WARN_BELOW,
  type CampaignInput,
} from "@/lib/campaign-schema";

export type OrganiserFormValues = {
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
  startsLocal: string;
  endsLocal: string;
};

const EMPTY: OrganiserFormValues = {
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
};

function localToIso(local: string): string {
  if (!local) return "";
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function isoToLocal(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate()
  )}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function OrganiserCampaignForm({
  campaignId,
  initial,
  startsIso,
  endsIso,
}: {
  campaignId?: string;
  initial?: OrganiserFormValues;
  startsIso?: string;
  endsIso?: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState<OrganiserFormValues>(initial ?? EMPTY);
  const [slugTouched, setSlugTouched] = useState(Boolean(campaignId));
  const [slugStatus, setSlugStatus] = useState<
    "idle" | "checking" | "available" | "taken"
  >("idle");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!startsIso && !endsIso) return;
    setValues((v) => ({
      ...v,
      startsLocal: isoToLocal(startsIso),
      endsLocal: isoToLocal(endsIso),
    }));
  }, [startsIso, endsIso]);

  const set = <K extends keyof OrganiserFormValues>(
    key: K,
    value: OrganiserFormValues[K]
  ) => setValues((v) => ({ ...v, [key]: value }));

  // Auto-suggest slug from artist name until the organiser edits it.
  useEffect(() => {
    if (slugTouched || campaignId) return;
    setValues((v) => ({ ...v, slug: suggestSlug(v.artist_name, "") }));
  }, [values.artist_name, slugTouched, campaignId]);

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

  // Best-effort availability check: own campaigns (RLS) + live public ones.
  // The database's unique constraint is the real enforcement on save.
  async function onSlugBlur() {
    const s = values.slug.trim();
    if (!s) {
      setSlugStatus("idle");
      return;
    }
    setSlugStatus("checking");
    const [mine, pub] = await Promise.all([
      supabase.from("campaigns").select("id").eq("slug", s).maybeSingle(),
      supabase.from("campaigns_public").select("id").eq("slug", s).maybeSingle(),
    ]);
    const taken =
      (mine.data && mine.data.id !== campaignId) ||
      (pub.data && pub.data.id !== campaignId);
    setSlugStatus(taken ? "taken" : "available");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);

    const payload: CampaignInput = {
      ...values,
      starts_at: localToIso(values.startsLocal),
      ends_at: localToIso(values.endsLocal),
      is_active: true,
    };
    const clientErrors = validateCampaign(payload);
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      setBusy(false);
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }

    const row = {
      slug: values.slug.trim(),
      artist_name: values.artist_name.trim(),
      title: values.title.trim(),
      description: values.description.trim() || null,
      location_name: values.location_name.trim(),
      lat: Number(values.lat),
      lng: Number(values.lng),
      radius_m: Number(values.radius_m),
      reward_teaser: values.reward_teaser.trim() || null,
      reward_content_url: values.reward_content_url.trim() || null,
      discount_code: values.discount_code.trim() || null,
      ticket_url: values.ticket_url.trim(),
      starts_at: payload.starts_at,
      ends_at: payload.ends_at,
    };

    // RLS: inserts must carry the signed-in user's id; updates only match
    // rows this user owns.
    const { error } = campaignId
      ? await supabase.from("campaigns").update(row).eq("id", campaignId)
      : await supabase
          .from("campaigns")
          .insert({ ...row, owner_id: user.id });

    if (error) {
      setErrors(
        error.code === "23505"
          ? { slug: "That slug is already used by another campaign." }
          : { _form: "Couldn't save. Try again." }
      );
      setBusy(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      {errors._form && (
        <p className="rounded-xl border border-clay/60 bg-clay/10 p-3 text-sm font-medium text-clay">
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
          <p className="mt-1 text-xs text-ink/50">Checking availability…</p>
        )}
        {slugStatus === "available" && (
          <p className="mt-1 text-xs font-medium text-forest">✓ Available</p>
        )}
        {slugStatus === "taken" && (
          <p className="mt-1 text-xs font-medium text-clay">
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
      <p className="-mt-3 text-xs text-ink/50">
        Right-click the spot in Google Maps and copy the coordinates, then
        paste them here.
        {mapsPreview && (
          <>
            {" "}
            <a
              href={mapsPreview}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-clay underline underline-offset-4"
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
          <p className="mt-1 text-xs font-medium text-clay">
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

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-forest-deep px-7 py-3 font-semibold text-parchment transition active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? "Saving…" : campaignId ? "Save changes" : "Create draft"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/dashboard")}
          className="rounded-full border border-ink/30 px-7 py-3 font-medium text-ink/80 transition hover:border-ink/60"
        >
          Cancel
        </button>
      </div>
      {!campaignId && (
        <p className="text-xs text-ink/50">
          New campaigns start as drafts — you publish them from the dashboard
          when you&apos;re ready.
        </p>
      )}
    </form>
  );
}

const inputCls =
  "w-full rounded-xl border border-ink/30 bg-transparent px-4 py-3 text-ink placeholder-ink/30 outline-none focus:border-forest";

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
      <label className="mb-2 block text-xs font-medium uppercase tracking-[0.15em] text-ink/60">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-ink/50">{hint}</p>}
      {error && <p className="mt-1 text-xs font-medium text-clay">{error}</p>}
    </div>
  );
}
