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

  // Before any image exists the control has to advertise itself — a
  // labelled pill. Once a backdrop is set it steps back to two quiet icon
  // buttons so "New campaign" stays the only prominent action.
  const iconBtn = `flex h-9 w-9 items-center justify-center rounded-full border border-ink/20 text-ink/50 transition hover:border-ink/50 hover:text-ink ${
    busy ? "pointer-events-none opacity-40" : "cursor-pointer"
  }`;

  return (
    <div className="text-right">
      <div className="flex items-center justify-end gap-2">
        {hasImage ? (
          <>
            <label
              className={iconBtn}
              title="Change backdrop"
              aria-label="Change backdrop"
            >
              {busy ? (
                <span
                  aria-hidden
                  className="h-4 w-4 animate-spin rounded-full border-2 border-ink/20 border-t-ink/60"
                />
              ) : (
                <svg
                  aria-hidden
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="9" cy="9" r="2" />
                  <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                </svg>
              )}
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.webp"
                className="hidden"
                onChange={onPick}
                disabled={busy}
              />
            </label>
            <button
              type="button"
              onClick={onRemove}
              disabled={busy}
              title="Remove backdrop"
              aria-label="Remove backdrop"
              className={iconBtn}
            >
              <svg
                aria-hidden
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 6h18" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </button>
          </>
        ) : (
          <label
            className={`rounded-full border border-ink/30 px-4 py-2 text-sm font-medium text-ink/80 transition hover:border-ink/60 ${
              busy ? "pointer-events-none opacity-50" : "cursor-pointer"
            }`}
          >
            {busy ? "Uploading…" : "Add a backdrop"}
            <input
              type="file"
              accept=".jpg,.jpeg,.png,.webp"
              className="hidden"
              onChange={onPick}
              disabled={busy}
            />
          </label>
        )}
      </div>
      {error && (
        <p className="mt-1.5 text-xs font-medium text-clay">{error}</p>
      )}
    </div>
  );
}
