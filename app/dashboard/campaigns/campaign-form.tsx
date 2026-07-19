"use client";

import { useEffect, useRef, useState } from "react";
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
import { useUnsavedChanges } from "@/app/unsaved-changes";

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
  expired_headline: string;
  expired_message: string;
  expired_link_url: string;
  expired_link_label: string;
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
  expired_headline: "",
  expired_message: "",
  expired_link_url: "",
  expired_link_label: "",
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

const BG_MAX_BYTES = 8 * 1024 * 1024;
const BG_ALLOWED_RE = /\.(jpg|jpeg|png|webp)$/i;
// Fans load the background on mobile data at the very top of the funnel —
// anything bigger than this on the long edge gets downscaled and
// re-encoded before upload.
const BG_MAX_EDGE = 2400;

function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// Downscale to BG_MAX_EDGE and re-encode as WebP (JPEG where WebP encoding
// isn't supported). Runs at pick time so the preview shows exactly what
// will be uploaded, and saving stays fast.
async function processBackgroundImage(
  file: File
): Promise<{ blob: Blob; ext: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, BG_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { blob: file, ext: file.name.split(".").pop() ?? "jpg" };
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const encode = (type: string) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
  const webp = await encode("image/webp");
  if (webp && webp.type === "image/webp") return { blob: webp, ext: "webp" };
  const jpeg = await encode("image/jpeg");
  if (jpeg) return { blob: jpeg, ext: "jpg" };
  return { blob: file, ext: file.name.split(".").pop() ?? "jpg" };
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
  backgroundPath: initialBackgroundPath,
  initialLocations,
  status,
}: {
  campaignId?: string;
  initial?: OrganiserFormValues;
  startsIso?: string;
  endsIso?: string;
  storagePath?: string | null;
  backgroundPath?: string | null;
  initialLocations?: BuilderLocation[];
  // Campaign status when editing — autosave only ever runs for drafts, so
  // half-typed edits can never reach a live fan page.
  status?: string;
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

  // The id this form is writing to — starts as the prop, but a new
  // campaign gets one on its first (auto)save and keeps editing in place.
  const [savedId, setSavedId] = useState<string | undefined>(campaignId);
  const savedIdRef = useRef(savedId);
  savedIdRef.current = savedId;
  // What's actually in storage right now — updated after every successful
  // save so repeat saves neither re-upload nor re-delete.
  const savedRewardPathRef = useRef<string | null>(initialStoragePath ?? null);
  const savedBgPathRef = useRef<string | null>(initialBackgroundPath ?? null);

  // Autosave bookkeeping. Drafts only — see the `status` prop.
  const isDraft = !campaignId || status === "draft";
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const persistInFlightRef = useRef(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistRef = useRef<(opts: { navigate: boolean; silent: boolean }) => Promise<boolean>>(
    async () => false
  );

  // Every user edit flags unsaved changes; header/back/cancel navigation
  // then prompts before discarding them. Cleared on successful save. For
  // drafts, an edit also schedules a silent autosave a few seconds out.
  const guard = useUnsavedChanges();
  const isDraftRef = useRef(isDraft);
  isDraftRef.current = isDraft;
  const markDirty = () => {
    guard?.setDirty(true);
    if (!isDraftRef.current) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      persistRef.current({ navigate: false, silent: true });
    }, 3000);
  };
  useEffect(
    () => () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    },
    []
  );

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
    markDirty();
    setFile(f);
  };

  const clearFile = () => {
    markDirty();
    setFile(null);
    setFileError(null);
    setStoragePath(null);
  };

  const onLocationsChange = (next: BuilderLocation[]) => {
    markDirty();
    setLocations(next);
  };

  // Background image: mirrors the reward-file pattern — the processed blob
  // waits in state and uploads on save, once a campaign id exists.
  const [bgPath, setBgPath] = useState<string | null>(
    initialBackgroundPath ?? null
  );
  const [bgBlob, setBgBlob] = useState<{ blob: Blob; ext: string } | null>(null);
  const [bgPreviewUrl, setBgPreviewUrl] = useState<string | null>(null);
  const [bgError, setBgError] = useState<string | null>(null);
  const [bgProcessing, setBgProcessing] = useState(false);

  const bgPublicUrl = (path: string) =>
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/backgrounds/${path}`;
  // What the preview should show right now: a freshly picked image, else
  // the saved one.
  const bgDisplayUrl =
    bgPreviewUrl ?? (bgPath ? bgPublicUrl(bgPath) : null);

  const onPickBackground = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setBgError(null);
    if (!BG_ALLOWED_RE.test(f.name)) {
      setBgError("Use a JPG, PNG or WebP image.");
      return;
    }
    if (f.size > BG_MAX_BYTES) {
      setBgError("That image is over 8MB.");
      return;
    }
    setBgProcessing(true);
    try {
      const processed = await processBackgroundImage(f);
      markDirty();
      setBgBlob(processed);
      setBgPreviewUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(processed.blob);
      });
    } catch {
      setBgError("Couldn't read that image — try a different file.");
    } finally {
      setBgProcessing(false);
    }
  };

  const clearBackground = () => {
    markDirty();
    setBgBlob(null);
    setBgPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    setBgPath(null);
    setBgError(null);
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
  ) => {
    markDirty();
    setValues((v) => ({ ...v, [key]: value }));
  };

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
    // Compare against savedId (not the prop) — a just-autosaved new draft
    // owns its slug and mustn't be told it's taken by itself.
    const own = savedIdRef.current;
    const taken =
      (mine.data && mine.data.id !== own) || (pub.data && pub.data.id !== own);
    setSlugStatus(taken ? "taken" : "available");
  }

  // The single save pipeline behind everything: the primary submit
  // (navigates back to the dashboard), the in-place Save button, and the
  // debounced draft autosave (silent — skips quietly while the form is
  // still incomplete rather than nagging mid-typing).
  async function persist({
    navigate,
    silent,
  }: {
    navigate: boolean;
    silent: boolean;
  }): Promise<boolean> {
    if (persistInFlightRef.current) return false;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);

    const payload: CampaignInput = {
      ...values,
      starts_at: localToIso(values.startsLocal),
      ends_at: localToIso(values.endsLocal),
      is_active: true,
    };
    const clientErrors = validateCampaignCore(payload);
    const { formError, rowErrors } = validateLocations(locations);
    if (formError) clientErrors._form = formError;
    if (Object.keys(clientErrors).length > 0) {
      if (!silent) {
        setLocErrors(rowErrors);
        setErrors(clientErrors);
      }
      return false;
    }
    if (!silent) {
      setLocErrors({});
      setErrors({});
    }

    persistInFlightRef.current = true;
    if (!silent) setBusy(true);
    setSaveState("saving");
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return false;
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
        ticket_url: values.ticket_url.trim() || null,
        starts_at: payload.starts_at,
        ends_at: payload.ends_at,
        expired_headline: values.expired_headline.trim() || null,
        expired_message: values.expired_message.trim() || null,
        expired_link_url: values.expired_link_url.trim() || null,
        expired_link_label: values.expired_link_label.trim() || null,
      };

      // RLS: inserts must carry the signed-in user's id; updates only
      // match rows this user owns.
      let id = savedIdRef.current;
      if (id) {
        const { error } = await supabase
          .from("campaigns")
          .update(row)
          .eq("id", id);
        if (error) {
          if (!silent) {
            setErrors(
              error.code === "23505"
                ? { slug: "That slug is already used by another campaign." }
                : { _form: "Couldn't save. Try again." }
            );
          }
          setSaveState("error");
          return false;
        }
      } else {
        const { data, error } = await supabase
          .from("campaigns")
          .insert({ ...row, owner_id: user.id })
          .select("id")
          .single();
        if (error || !data) {
          if (!silent) {
            setErrors(
              error?.code === "23505"
                ? { slug: "That slug is already used by another campaign." }
                : { _form: "Couldn't save. Try again." }
            );
          }
          setSaveState("error");
          return false;
        }
        id = data.id;
        setSavedId(id);
        // The slug is now taken by this very draft — stop auto-suggesting
        // over it, and make the URL survive a refresh without remounting
        // the form mid-edit.
        setSlugTouched(true);
        window.history.replaceState(null, "", `/dashboard/campaigns/${id}/edit`);
      }

      // Sync the locations list — update kept rows, insert new ones,
      // delete removed ones. RLS scopes every statement to this owner.
      const { data: existingLocs } = await supabase
        .from("campaign_locations")
        .select("id")
        .eq("campaign_id", id);
      const keepIds = new Set(locations.map((l) => l.id).filter(Boolean));
      const toDelete = (existingLocs ?? [])
        .map((l) => l.id)
        .filter((locId) => !keepIds.has(locId));
      if (toDelete.length) {
        const { error: delError } = await supabase
          .from("campaign_locations")
          .delete()
          .in("id", toDelete);
        if (delError) {
          if (!silent) {
            setErrors({
              _form:
                "Couldn't remove a location — fans have already unlocked there, so it has history attached. Add it back, or archive the campaign instead.",
            });
          }
          setSaveState("error");
          return false;
        }
      }
      // Newly inserted rows report their ids back into state, so the next
      // save updates them in place instead of delete-and-reinserting.
      const insertedIds: Record<string, string> = {};
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
        if (l.id) {
          const res = await supabase
            .from("campaign_locations")
            .update(locData)
            .eq("id", l.id);
          if (res.error) {
            if (!silent) setErrors({ _form: "Couldn't save the locations. Try again." });
            setSaveState("error");
            return false;
          }
        } else {
          const res = await supabase
            .from("campaign_locations")
            .insert({ ...locData, campaign_id: id })
            .select("id")
            .single();
          if (res.error || !res.data) {
            if (!silent) setErrors({ _form: "Couldn't save the locations. Try again." });
            setSaveState("error");
            return false;
          }
          insertedIds[l.tempId] = res.data.id;
        }
      }
      if (Object.keys(insertedIds).length) {
        setLocations((prev) =>
          prev.map((l) =>
            insertedIds[l.tempId] ? { ...l, id: insertedIds[l.tempId] } : l
          )
        );
      }

      // Reward file changes. undefined = leave the stored path untouched.
      let newPath: string | null | undefined = undefined;
      if (file) {
        newPath = `${user.id}/${id}/${sanitizeFilename(file.name)}`;
      } else if (savedRewardPathRef.current && !storagePath) {
        newPath = null; // organiser pressed Remove
      }

      if (file && newPath) {
        if (!silent) setBusyLabel("Uploading file…");
        const { error: uploadError } = await supabase.storage
          .from("rewards")
          .upload(newPath, file, { upsert: true, contentType: file.type });
        if (uploadError) {
          if (!silent) {
            setErrors({
              _form:
                "The campaign saved, but the file upload failed — try the upload again.",
            });
          }
          setSaveState("error");
          return false;
        }
      }

      if (newPath !== undefined) {
        const { error: pathError } = await supabase
          .from("campaigns")
          .update({ reward_storage_path: newPath })
          .eq("id", id);
        if (pathError) {
          if (!silent) setErrors({ _form: "Couldn't attach the file. Try again." });
          setSaveState("error");
          return false;
        }
        // Tidy up a replaced or removed file; best-effort only.
        const previous = savedRewardPathRef.current;
        if (previous && previous !== newPath) {
          await supabase.storage.from("rewards").remove([previous]);
        }
        savedRewardPathRef.current = newPath;
        setFile(null);
        if (newPath) setStoragePath(newPath);
      }

      // Background image — uploaded through our own API route, which does
      // the storage write server-side after checking ownership. No bucket
      // policies involved, so this can't hit a storage RLS wall.
      if (bgBlob) {
        if (!silent) setBusyLabel("Uploading background…");
        const fd = new FormData();
        fd.append("file", bgBlob.blob, `background.${bgBlob.ext}`);
        const res = await fetch(`/api/dashboard/campaigns/${id}/background`, {
          method: "POST",
          body: fd,
        });
        if (!res.ok) {
          if (!silent) {
            setErrors({
              _form:
                "The campaign saved, but the background upload failed — try again.",
            });
          }
          setSaveState("error");
          return false;
        }
        const json = (await res.json()) as { path: string };
        savedBgPathRef.current = json.path;
        setBgBlob(null);
        setBgPath(json.path);
        setBgPreviewUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return null;
        });
      } else if (savedBgPathRef.current && !bgPath) {
        const res = await fetch(`/api/dashboard/campaigns/${id}/background`, {
          method: "DELETE",
        });
        if (!res.ok) {
          if (!silent) {
            setErrors({ _form: "Couldn't remove the background image. Try again." });
          }
          setSaveState("error");
          return false;
        }
        savedBgPathRef.current = null;
      }

      // Everything's persisted — leaving is no longer a loss.
      guard?.setDirty(false);
      setSaveState("saved");
      setLastSavedAt(new Date());
      if (navigate) {
        router.push("/dashboard");
        router.refresh();
      }
      return true;
    } finally {
      persistInFlightRef.current = false;
      if (!silent) {
        setBusy(false);
        setBusyLabel("Saving…");
      }
    }
  }
  persistRef.current = persist;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await persist({ navigate: true, silent: false });
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

      <Field
        label="Background image (optional)"
        error={bgError ?? undefined}
        hint="A landscape photo at least 2000px wide works best. Busy images can make text hard to read — check the preview below. JPG, PNG or WebP, up to 8MB."
      >
        {bgDisplayUrl ? (
          <div>
            {/* Live preview of the fan page treatment: full-bleed image,
                edge scrim, and the translucent panel fan copy sits in — so
                legibility can be judged before publishing. */}
            <div className="relative h-72 overflow-hidden rounded-2xl border border-ink/25">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={bgDisplayUrl}
                alt="Background preview"
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-black/10 to-black/35" />
              <div className="absolute inset-x-6 top-1/2 -translate-y-1/2 rounded-2xl bg-cream/90 p-4 text-center shadow-xl backdrop-blur-md">
                <p className="text-[10px] font-medium uppercase tracking-[0.3em] text-clay">
                  {values.artist_name || "Artist name"}
                </p>
                <p className="mt-1 font-serif text-lg leading-snug text-ink">
                  {values.title || "Campaign title"}
                </p>
                <p className="mt-1 font-mono text-[10px] text-ink/50">
                  Ends in <span className="text-clay">2d 4h 10m</span>
                </p>
              </div>
            </div>
            <div className="mt-2 flex gap-2">
              <label className="cursor-pointer rounded-full border border-ink/30 px-3 py-1.5 text-xs font-medium text-ink/70 transition hover:border-ink/60">
                Replace
                <input
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp"
                  className="hidden"
                  onChange={onPickBackground}
                />
              </label>
              <button
                type="button"
                onClick={clearBackground}
                className="rounded-full border border-ink/30 px-3 py-1.5 text-xs font-medium text-ink/70 transition hover:border-ink/60"
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <label className="flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-ink/35 px-4 py-6 text-sm font-medium text-ink/60 transition hover:border-ink/60">
            {bgProcessing ? "Preparing image…" : "Upload a background image"}
            <input
              type="file"
              accept=".jpg,.jpeg,.png,.webp"
              className="hidden"
              onChange={onPickBackground}
            />
          </label>
        )}
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
          onChange={onLocationsChange}
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

      <Field
        label="Ticket URL (optional)"
        error={errors.ticket_url}
        hint='Adds a "Get tickets" call to action to the unlocked state. Leave blank if there&apos;s nothing to sell — the reward stands on its own.'
      >
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

      <div className="rounded-2xl border border-ink/25 p-5">
        <p className="text-xs font-medium uppercase tracking-[0.15em] text-ink/60">
          After it ends (optional)
        </p>
        <p className="mt-1 text-xs text-ink/50">
          What fans see if they arrive after the campaign has ended. Left
          blank, they get the default &ldquo;This drop has ended&rdquo;
          message.
        </p>
        <div className="mt-4 space-y-4">
          <Field label="Headline" error={errors.expired_headline}>
            <input
              className={inputCls}
              value={values.expired_headline}
              onChange={(e) => set("expired_headline", e.target.value)}
              placeholder="You missed this one…"
            />
          </Field>
          <Field label="Message" error={errors.expired_message}>
            <textarea
              className={inputCls}
              rows={2}
              value={values.expired_message}
              onChange={(e) => set("expired_message", e.target.value)}
              placeholder="But the tour rolls on — catch the next drop."
            />
          </Field>
          <Field label="Link URL" error={errors.expired_link_url}>
            <input
              className={inputCls}
              value={values.expired_link_url}
              onChange={(e) => set("expired_link_url", e.target.value)}
              placeholder="https://linktr.ee/…"
            />
          </Field>
          <Field
            label="Link label"
            error={errors.expired_link_label}
            hint="Required when a link URL is given — it's the button text."
          >
            <input
              className={inputCls}
              value={values.expired_link_label}
              onChange={(e) => set("expired_link_label", e.target.value)}
              placeholder="Follow the tour"
            />
          </Field>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-forest-deep px-7 py-3 font-semibold text-parchment transition active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? busyLabel : savedId ? "Save & close" : "Create draft"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => persist({ navigate: false, silent: false })}
          className="rounded-full border border-ink/30 px-7 py-3 font-medium text-ink/80 transition hover:border-ink/60 disabled:opacity-50"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => {
            // Cancel sits right next to Save — a stray click here is the
            // most likely way to lose a half-built campaign.
            if (guard && !guard.confirmIfDirty()) return;
            router.push("/dashboard");
          }}
          className="rounded-full border border-ink/30 px-7 py-3 font-medium text-ink/80 transition hover:border-ink/60"
        >
          Cancel
        </button>
        <p className="text-xs text-ink/50" aria-live="polite">
          {saveState === "saving"
            ? "Saving…"
            : saveState === "error"
              ? "Couldn't save — check the form."
              : lastSavedAt
                ? `Draft saved ${lastSavedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
                : ""}
        </p>
      </div>
      {!savedId && (
        <p className="text-xs text-ink/50">
          New campaigns start as drafts and save automatically as you go —
          you publish them from the dashboard when you&apos;re ready.
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
