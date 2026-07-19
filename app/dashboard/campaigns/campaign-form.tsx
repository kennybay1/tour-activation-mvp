"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  validateCampaignCore,
  suggestSlug,
  MIN_RADIUS_M,
  type CampaignInput,
} from "@/lib/campaign-schema";
import {
  type BuilderLocation,
  MAX_LOCATIONS,
} from "./location-types";

// Leaflet touches window/document at import time, so it can only run in
// the browser — ssr:false is required here, and next/dynamic only allows
// that inside a Client Component (this file is one).
const LocationBuilder = dynamic(() => import("./location-builder"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[380px] items-center justify-center rounded-2xl border border-ink/25 bg-cream-deep/40 text-sm text-ink/50">
      Loading map…
    </div>
  ),
});

export type OrganiserFormValues = {
  slug: string;
  artist_name: string;
  title: string;
  description: string;
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

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const ALLOWED_FILE_RE = /\.(mp3|m4a|mp4|jpg|jpeg|png|webp)$/i;

function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function validateLocations(
  locations: BuilderLocation[]
): { formError?: string; rowErrors: Record<string, string> } {
  const rowErrors: Record<string, string> = {};
  if (locations.length === 0) {
    return {
      formError: "Add at least one location on the map before saving.",
      rowErrors,
    };
  }
  if (locations.length > MAX_LOCATIONS) {
    return {
      formError: `A campaign can hold at most ${MAX_LOCATIONS} locations.`,
      rowErrors,
    };
  }
  for (const loc of locations) {
    if (!loc.location_name.trim()) {
      rowErrors[loc.tempId] = "Name is required.";
    } else if (!Number.isFinite(loc.lat) || loc.lat < -90 || loc.lat > 90) {
      rowErrors[loc.tempId] = "Latitude must be between -90 and 90.";
    } else if (!Number.isFinite(loc.lng) || loc.lng < -180 || loc.lng > 180) {
      rowErrors[loc.tempId] = "Longitude must be between -180 and 180.";
    } else if (!Number.isInteger(loc.radius_m) || loc.radius_m < MIN_RADIUS_M) {
      rowErrors[loc.tempId] = `Radius must be a whole number of at least ${MIN_RADIUS_M}m.`;
    }
  }
  return {
    formError: Object.keys(rowErrors).length
      ? "Fix the highlighted locations before saving."
      : undefined,
    rowErrors,
  };
}

export default function OrganiserCampaignForm({
  campaignId,
  initial,
  startsIso,
  endsIso,
  storagePath: initialStoragePath,
  initialLocations,
}: {
  campaignId?: string;
  initial?: OrganiserFormValues;
  startsIso?: string;
  endsIso?: string;
  storagePath?: string | null;
  initialLocations?: BuilderLocation[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<OrganiserFormValues>(initial ?? EMPTY);
  const [locations, setLocations] = useState<BuilderLocation[]>(
    initialLocations ?? []
  );
  const [locErrors, setLocErrors] = useState<Record<string, string>>({});
  const [slugTouched, setSlugTouched] = useState(Boolean(campaignId));
  const [slugStatus, setSlugStatus] = useState<
    "idle" | "checking" | "available" | "taken"
  >("idle");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("Saving…");
  // Reward file: the saved path, a newly chosen (not yet uploaded) file,
  // and the original path so replaced/removed files get deleted on save.
  const [storagePath, setStoragePath] = useState<string | null>(
    initialStoragePath ?? null
  );
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const originalPath = initialStoragePath ?? null;

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setFileError(null);
    if (!ALLOWED_FILE_RE.test(f.name)) {
      setFileError("Use MP3, M4A, MP4, JPG, PNG or WebP.");
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      setFileError("That file is over 50MB.");
      return;
    }
    setFile(f);
  };

  const clearFile = () => {
    setFile(null);
    setFileError(null);
    setStoragePath(null);
  };

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
    const clientErrors = validateCampaignCore(payload);
    const { formError, rowErrors } = validateLocations(locations);
    if (formError) clientErrors._form = formError;
    setLocErrors(rowErrors);
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

    // Locations live in campaign_locations now — the legacy campaign
    // columns are left untouched.
    const row = {
      slug: values.slug.trim(),
      artist_name: values.artist_name.trim(),
      title: values.title.trim(),
      description: values.description.trim() || null,
      reward_teaser: values.reward_teaser.trim() || null,
      reward_content_url: values.reward_content_url.trim() || null,
      discount_code: values.discount_code.trim() || null,
      ticket_url: values.ticket_url.trim(),
      starts_at: payload.starts_at,
      ends_at: payload.ends_at,
    };

    // RLS: inserts must carry the signed-in user's id; updates only match
    // rows this user owns.
    let savedId = campaignId;
    if (campaignId) {
      const { error } = await supabase
        .from("campaigns")
        .update(row)
        .eq("id", campaignId);
      if (error) {
        setErrors(
          error.code === "23505"
            ? { slug: "That slug is already used by another campaign." }
            : { _form: "Couldn't save. Try again." }
        );
        setBusy(false);
        return;
      }
    } else {
      const { data, error } = await supabase
        .from("campaigns")
        .insert({ ...row, owner_id: user.id })
        .select("id")
        .single();
      if (error || !data) {
        setErrors(
          error?.code === "23505"
            ? { slug: "That slug is already used by another campaign." }
            : { _form: "Couldn't save. Try again." }
        );
        setBusy(false);
        return;
      }
      savedId = data.id;
    }

    // Sync the locations list — update kept rows, insert new ones, delete
    // removed ones. RLS scopes every statement to this owner. Locations
    // are only written here, on save — not on every marker drag.
    const { data: existingLocs } = await supabase
      .from("campaign_locations")
      .select("id")
      .eq("campaign_id", savedId);
    const keepIds = new Set(locations.map((l) => l.id).filter(Boolean));
    const toDelete = (existingLocs ?? [])
      .map((l) => l.id)
      .filter((id) => !keepIds.has(id));
    if (toDelete.length) {
      const { error: delError } = await supabase
        .from("campaign_locations")
        .delete()
        .in("id", toDelete);
      if (delError) {
        setErrors({
          _form:
            "Couldn't remove a location — fans have already unlocked there, so it has history attached. Add it back, or archive the campaign instead.",
        });
        setBusy(false);
        return;
      }
    }
    for (let i = 0; i < locations.length; i++) {
      const l = locations[i];
      const locData = {
        location_name: l.location_name.trim(),
        lat: l.lat,
        lng: l.lng,
        radius_m: l.radius_m,
        sort_order: i,
        source: l.source,
        external_ref: l.external_ref ?? null,
      };
      const res = l.id
        ? await supabase
            .from("campaign_locations")
            .update(locData)
            .eq("id", l.id)
        : await supabase
            .from("campaign_locations")
            .insert({ ...locData, campaign_id: savedId });
      if (res.error) {
        setErrors({ _form: "Couldn't save the locations. Try again." });
        setBusy(false);
        return;
      }
    }

    // Reward file changes. undefined = leave the stored path untouched.
    let newPath: string | null | undefined = undefined;
    if (file) {
      newPath = `${user.id}/${savedId}/${sanitizeFilename(file.name)}`;
    } else if (originalPath && !storagePath) {
      newPath = null; // organiser pressed Remove
    }

    if (file && newPath) {
      setBusyLabel("Uploading file…");
      const { error: uploadError } = await supabase.storage
        .from("rewards")
        .upload(newPath, file, { upsert: true, contentType: file.type });
      if (uploadError) {
        setErrors({
          _form:
            "The campaign saved, but the file upload failed — try the upload again from Edit.",
        });
        setBusy(false);
        setBusyLabel("Saving…");
        return;
      }
    }

    if (newPath !== undefined) {
      const { error: pathError } = await supabase
        .from("campaigns")
        .update({ reward_storage_path: newPath })
        .eq("id", savedId);
      if (pathError) {
        setErrors({ _form: "Couldn't attach the file. Try again." });
        setBusy(false);
        setBusyLabel("Saving…");
        return;
      }
      // Tidy up a replaced or removed file; best-effort only.
      if (originalPath && originalPath !== newPath) {
        await supabase.storage.from("rewards").remove([originalPath]);
      }
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

      <div>
        <p className="mb-2 block text-xs font-medium uppercase tracking-[0.15em] text-ink/60">
          Locations
        </p>
        <p className="mb-3 text-xs text-ink/50">
          Fans can unlock at any of these — the nearest one counts. Drag
          markers to fine-tune, or add more spots on the map.
        </p>
        <LocationBuilder
          locations={locations}
          onChange={setLocations}
          rowErrors={locErrors}
        />
      </div>

      <Field label="Reward teaser" error={errors.reward_teaser}>
        <input
          className={inputCls}
          value={values.reward_teaser}
          onChange={(e) => set("reward_teaser", e.target.value)}
          placeholder="An exclusive voice note + 20% off tickets"
        />
      </Field>

      <Field
        label="Reward file"
        error={fileError ?? undefined}
        hint="Audio (MP3, M4A), video (MP4) or image (JPG, PNG, WebP), up to 50MB. Stored privately — fans only ever get a temporary link, after unlocking."
      >
        {file || storagePath ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-ink/25 px-4 py-3">
            <span className="min-w-0 truncate font-mono text-xs text-ink/80">
              {file ? `${file.name} — uploads when you save` : storagePath?.split("/").pop()}
            </span>
            <div className="flex shrink-0 gap-2">
              <label className="cursor-pointer rounded-full border border-ink/30 px-3 py-1.5 text-xs font-medium text-ink/70 transition hover:border-ink/60">
                Replace
                <input
                  type="file"
                  accept=".mp3,.m4a,.mp4,.jpg,.jpeg,.png,.webp"
                  className="hidden"
                  onChange={onPickFile}
                />
              </label>
              <button
                type="button"
                onClick={clearFile}
                className="rounded-full border border-ink/30 px-3 py-1.5 text-xs font-medium text-ink/70 transition hover:border-ink/60"
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <label className="flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-ink/35 px-4 py-6 text-sm font-medium text-ink/60 transition hover:border-ink/60">
            Upload a file
            <input
              type="file"
              accept=".mp3,.m4a,.mp4,.jpg,.jpeg,.png,.webp"
              className="hidden"
              onChange={onPickFile}
            />
          </label>
        )}
      </Field>

      <Field
        label="Or link to hosted content"
        error={errors.reward_content_url}
        hint="Used only if no file is uploaded above. Optional."
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
          {busy ? busyLabel : campaignId ? "Save changes" : "Create draft"}
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
