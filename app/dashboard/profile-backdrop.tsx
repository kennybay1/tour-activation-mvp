"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  BG_ALLOWED_RE,
  BG_MAX_BYTES,
  processBackgroundImage,
} from "@/lib/background-image";

// The organiser's dashboard backdrop: picked here, downscaled client-side
// (same treatment as campaign backgrounds), uploaded through the owner-
// authenticated profile route, then the server page re-renders with it.
export default function ProfileBackdrop({ hasImage }: { hasImage: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setError(null);
    if (!BG_ALLOWED_RE.test(f.name)) {
      setError("Use a JPG, PNG or WebP image.");
      return;
    }
    if (f.size > BG_MAX_BYTES) {
      setError("That image is over 8MB.");
      return;
    }
    setBusy(true);
    try {
      const processed = await processBackgroundImage(f);
      const fd = new FormData();
      fd.append("file", processed.blob, `background.${processed.ext}`);
      const res = await fetch("/api/dashboard/profile/background", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        setError("Upload failed — try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't read that image — try a different file.");
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/profile/background", {
        method: "DELETE",
      });
      if (!res.ok) {
        setError("Couldn't remove it — try again.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="text-right">
      <div className="flex items-center justify-end gap-2">
        <label
          className={`rounded-full border border-ink/30 px-4 py-2 text-sm font-medium text-ink/80 transition hover:border-ink/60 ${
            busy ? "pointer-events-none opacity-50" : "cursor-pointer"
          }`}
        >
          {busy ? "Uploading…" : hasImage ? "Change backdrop" : "Add a backdrop"}
          <input
            type="file"
            accept=".jpg,.jpeg,.png,.webp"
            className="hidden"
            onChange={onPick}
            disabled={busy}
          />
        </label>
        {hasImage && (
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            className="rounded-full border border-ink/30 px-4 py-2 text-sm font-medium text-ink/80 transition hover:border-ink/60 disabled:opacity-50"
          >
            Remove
          </button>
        )}
      </div>
      {error && (
        <p className="mt-1.5 text-xs font-medium text-clay">{error}</p>
      )}
    </div>
  );
}
