"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  validateCampaignCore,
  validateLocationRow,
  suggestSlug,
  DEFAULT_RADIUS_M,
  RADIUS_WARN_BELOW,
  type CampaignInput,
  type LocationRowInput,
} from "@/lib/campaign-schema";

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

const EMPTY_LOCATION: LocationRowInput = {
  location_name: "",
  lat: "",
  lng: "",
  radius_m: String(DEFAULT_RADIUS_M),
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
  initialLocations?: LocationRowInput[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<OrganiserFormValues>(initial ?? EMPTY);
  const [locRows, setLocRows] = useState<LocationRowInput[]>(
    initialLocations?.length ? initialLocations : [{ ...EMPTY_LOCATION }]
  );

  const setLoc = (i: number, key: keyof LocationRowInput, value: string) =>
    setLocRows((rows) =>
      rows.map((r, idx) => (idx === i ? { ...r, [key]: value } : r))
    );
  const addLoc = () =>
    setLocRows((rows) => [...rows, { ...EMPTY_LOCATION }]);
  const removeLoc = (i: number) =>
    setLocRows((rows) =>
      rows.length > 1 ? rows.filter((_, idx) => idx !== i) : rows
    );
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

  const rowMapsPreview = (r: LocationRowInput): string | null => {
    const lat = Number(r.lat);
    const lng = Number(r.lng);
    if (
      r.lat.trim() === "" ||
      r.lng.trim() === "" ||
      Number.isNaN(lat) ||
      Number.isNaN(lng)
    )
      return null;
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  };

  const rowRadiusLow = (r: LocationRowInput): boolean =>
    r.radius_m.trim() !== "" &&
    Number(r.radius_m) > 0 &&
    Number(r.radius_m) < RADIUS_WARN_BELOW;

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
    locRows.forEach((r, i) => {
      for (const [k, v] of Object.entries(validateLocationRow(r))) {
        clientErrors[`loc_${i}_${k}`] = v;
      }
    });
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
    // removed ones. RLS scopes every statement to this owner.
    const { data: existingLocs } = await supabase
      .from("campaign_locations")
      .select("id")
      .eq("campaign_id", savedId);
    const keepIds = new Set(locRows.map((r) => r.id).filter(Boolean));
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
    for (let i = 0; i < locRows.length; i++) {
      const r = locRows[i];
      const locData = {
        location_name: r.location_name.trim(),
        lat: Number(r.lat),
        lng: Number(r.lng),
        radius_m: Number(r.radius_m),
        sort_order: i,
      };
      const res = r.id
        ? await supabase
            .from("campaign_locations")
            .update(locData)
            .eq("id", r.id)
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
          Fans can unlock at any of these — the nearest one counts.
          Right-click each spot in Google Maps and copy the coordinates.
        </p>
        <div className="space-y-4">
          {locRows.map((r, i) => {
            const preview = rowMapsPreview(r);
            return (
              <div
                key={r.id ?? `new-${i}`}
                className="rounded-2xl border border-ink/25 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-xs text-clay">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {locRows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeLoc(i)}
                      className="rounded-full border border-ink/30 px-3 py-1 text-xs font-medium text-ink/60 transition hover:border-ink/60"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div className="mt-3 space-y-4">
                  <Field
                    label="Location name"
                    error={errors[`loc_${i}_location_name`]}
                  >
                    <input
                      className={inputCls}
                      value={r.location_name}
                      onChange={(e) =>
                        setLoc(i, "location_name", e.target.value)
                      }
                      placeholder="Outside the Roundhouse, Chalk Farm Rd"
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Latitude" error={errors[`loc_${i}_lat`]}>
                      <input
                        className={inputCls}
                        inputMode="decimal"
                        value={r.lat}
                        onChange={(e) => setLoc(i, "lat", e.target.value)}
                        placeholder="51.5432"
                      />
                    </Field>
                    <Field label="Longitude" error={errors[`loc_${i}_lng`]}>
                      <input
                        className={inputCls}
                        inputMode="decimal"
                        value={r.lng}
                        onChange={(e) => setLoc(i, "lng", e.target.value)}
                        placeholder="-0.1519"
                      />
                    </Field>
                  </div>
                  {preview && (
                    <p className="-mt-2 text-xs">
                      <a
                        href={preview}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-clay underline underline-offset-4"
                      >
                        Preview on Google Maps
                      </a>
                    </p>
                  )}
                  <Field
                    label="Unlock radius (metres)"
                    error={errors[`loc_${i}_radius_m`]}
                    hint="How close a fan must be to unlock. Default 200."
                  >
                    <input
                      className={inputCls}
                      inputMode="numeric"
                      value={r.radius_m}
                      onChange={(e) => setLoc(i, "radius_m", e.target.value)}
                    />
                    {rowRadiusLow(r) && (
                      <p className="mt-1 text-xs font-medium text-clay">
                        Below {RADIUS_WARN_BELOW}m, everyday GPS wobble may
                        block real fans who are actually there.
                      </p>
                    )}
                  </Field>
                </div>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={addLoc}
          className="mt-3 rounded-full border border-ink/30 px-5 py-2 text-sm font-medium text-ink/70 transition hover:border-ink/60"
        >
          + Add location
        </button>
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
