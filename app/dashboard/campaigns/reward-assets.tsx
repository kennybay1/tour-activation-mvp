"use client";

import { useState } from "react";
import {
  type BuilderAsset,
  MAX_ASSETS_PER_REWARD,
  makeTempId,
} from "./location-types";

// A reward can hold any mix of uploaded files and links — this is the editor
// for that list. Used for a single drop's reward, a journey's finale, and
// every stop. Files upload on save, not here.

const FILE_RE = /\.(mp3|m4a|mp4|jpg|jpeg|png|webp)$/i;
const MAX_FILE_BYTES = 50 * 1024 * 1024;

const inputCls =
  "w-full rounded-lg border border-ink/20 bg-transparent px-3 py-1.5 text-sm text-ink placeholder-ink/30 outline-none focus:border-forest";
const chipBtn =
  "rounded-full border border-ink/30 px-3 py-1.5 text-xs font-medium text-ink/70 transition hover:border-ink/60 disabled:opacity-40";

function fileName(a: BuilderAsset): string {
  if (a.file) return `${a.file.name} — uploads when you save`;
  return a.storage_path?.split("/").pop() ?? "No file chosen";
}

export default function RewardAssets({
  assets,
  onChange,
  compact,
}: {
  assets: BuilderAsset[];
  onChange: (next: BuilderAsset[]) => void;
  // Stops render tighter than the campaign-level reward.
  compact?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const atCap = assets.length >= MAX_ASSETS_PER_REWARD;

  const patch = (tempId: string, next: Partial<BuilderAsset>) =>
    onChange(
      assets.map((a) => (a.tempId === tempId ? { ...a, ...next } : a))
    );

  const remove = (tempId: string) =>
    onChange(assets.filter((a) => a.tempId !== tempId));

  const move = (index: number, delta: number) => {
    const to = index + delta;
    if (to < 0 || to >= assets.length) return;
    const next = [...assets];
    const [moved] = next.splice(index, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  const addLink = () => {
    setError(null);
    if (atCap) return;
    onChange([...assets, { tempId: makeTempId(), kind: "link", url: "" }]);
  };

  const addFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!picked.length) return;
    setError(null);
    const room = MAX_ASSETS_PER_REWARD - assets.length;
    if (room <= 0) return;
    const accepted: BuilderAsset[] = [];
    for (const f of picked.slice(0, room)) {
      if (!FILE_RE.test(f.name)) {
        setError("Use MP3, M4A, MP4, JPG, PNG or WebP.");
        continue;
      }
      if (f.size > MAX_FILE_BYTES) {
        setError(`"${f.name}" is over 50MB.`);
        continue;
      }
      accepted.push({ tempId: makeTempId(), kind: "file", file: f });
    }
    if (accepted.length) onChange([...assets, ...accepted]);
  };

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {assets.map((a, i) => (
        <div
          key={a.tempId}
          className="rounded-xl border border-ink/20 p-3"
        >
          <div className="flex items-center gap-2">
            <span className="shrink-0 rounded-full bg-ink/5 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink/60">
              {a.kind}
            </span>
            <input
              value={a.label ?? ""}
              onChange={(e) => patch(a.tempId, { label: e.target.value })}
              placeholder="Label shown to fans (optional)"
              className={`${inputCls} min-w-0 flex-1`}
            />
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label="Move up"
                className="rounded-full border border-ink/25 px-2 py-1 text-xs text-ink/60 transition hover:border-ink/60 disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === assets.length - 1}
                aria-label="Move down"
                className="rounded-full border border-ink/25 px-2 py-1 text-xs text-ink/60 transition hover:border-ink/60 disabled:opacity-30"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => remove(a.tempId)}
                aria-label="Remove"
                className="rounded-full border border-ink/25 px-2 py-1 text-xs text-ink/60 transition hover:border-clay hover:text-clay"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="mt-2">
            {a.kind === "file" ? (
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate font-mono text-xs text-ink/70">
                  {fileName(a)}
                </span>
                <label className={`${chipBtn} shrink-0 cursor-pointer`}>
                  Replace
                  <input
                    type="file"
                    accept=".mp3,.m4a,.mp4,.jpg,.jpeg,.png,.webp"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (!f) return;
                      setError(null);
                      if (!FILE_RE.test(f.name)) {
                        setError("Use MP3, M4A, MP4, JPG, PNG or WebP.");
                        return;
                      }
                      if (f.size > MAX_FILE_BYTES) {
                        setError("That file is over 50MB.");
                        return;
                      }
                      patch(a.tempId, { file: f });
                    }}
                  />
                </label>
              </div>
            ) : (
              <input
                value={a.url ?? ""}
                onChange={(e) => patch(a.tempId, { url: e.target.value })}
                placeholder="https://…"
                className={inputCls}
              />
            )}
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <label
          className={`${chipBtn} ${atCap ? "pointer-events-none opacity-40" : "cursor-pointer"}`}
        >
          + Add file
          <input
            type="file"
            multiple
            accept=".mp3,.m4a,.mp4,.jpg,.jpeg,.png,.webp"
            className="hidden"
            onChange={addFile}
            disabled={atCap}
          />
        </label>
        <button
          type="button"
          onClick={addLink}
          disabled={atCap}
          className={chipBtn}
        >
          + Add link
        </button>
        {assets.length === 0 && (
          <span className="text-xs text-ink/50">
            Add any mix of files and links.
          </span>
        )}
      </div>

      {atCap && (
        <p className="text-xs text-ink/50">
          That&apos;s the limit of {MAX_ASSETS_PER_REWARD} items.
        </p>
      )}
      {error && <p className="text-xs font-medium text-clay">{error}</p>}
    </div>
  );
}
