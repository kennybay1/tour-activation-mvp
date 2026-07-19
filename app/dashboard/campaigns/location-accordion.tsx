"use client";

import { memo, useEffect, useRef, useState } from "react";
import {
  MIN_RADIUS_M,
  RADIUS_WARN_BELOW,
  RADIUS_STRONG_WARN_BELOW,
} from "@/lib/campaign-schema";
import { type BuilderLocation } from "./location-types";
import { getPreset } from "@/lib/preset-registry";

// Rendering all rows plainly is fine up to the ~100-location cap this app
// enforces elsewhere — collapsed rows are cheap. This page-size just keeps
// the initial paint light and gives marker clicks on far-down locations
// somewhere to "reveal to" without rendering everything at once.
const PAGE_SIZE = 40;

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      className={`shrink-0 text-ink/50 transition-transform ${expanded ? "rotate-90" : ""}`}
      aria-hidden="true"
    >
      <path
        d="M5 3l6 5-6 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// A single below-radius message, most severe first — showing all three at
// once would just be noise.
function radiusMessage(
  radius: number
): { text: string; strong: boolean } | null {
  if (!(radius > 0)) return null;
  if (radius < MIN_RADIUS_M) {
    return { text: `Radius must be at least ${MIN_RADIUS_M}m.`, strong: true };
  }
  if (radius < RADIUS_STRONG_WARN_BELOW) {
    return {
      text: `Below ${RADIUS_STRONG_WARN_BELOW}m — a meaningful share of fans standing at the location may still be rejected. Suits interiors and small, precise targets only.`,
      strong: true,
    };
  }
  if (radius < RADIUS_WARN_BELOW) {
    return {
      text: `Below ${RADIUS_WARN_BELOW}m — GPS accuracy in dense urban areas may prevent genuine fans from unlocking.`,
      strong: false,
    };
  }
  return null;
}

const rowInputCls =
  "min-w-[10rem] flex-1 rounded-lg border border-ink/20 bg-transparent px-3 py-1.5 text-sm text-ink placeholder-ink/30 outline-none focus:border-forest";

type RowProps = {
  location: BuilderLocation;
  index: number;
  expanded: boolean;
  error?: string;
  overlapping: boolean;
  registerRef: (tempId: string, el: HTMLDivElement | null) => void;
  onToggleExpand: (tempId: string) => void;
  onFocusRow: (tempId: string) => void;
  onHover: (tempId: string | null) => void;
  onUpdate: (tempId: string, patch: Partial<BuilderLocation>) => void;
  onRemove: (tempId: string) => void;
};

const LocationRow = memo(function LocationRow({
  location,
  index,
  expanded,
  error,
  overlapping,
  registerRef,
  onToggleExpand,
  onFocusRow,
  onHover,
  onUpdate,
  onRemove,
}: RowProps) {
  const code = `LOC-${String(index + 1).padStart(3, "0")}`;
  const headerId = `loc-header-${location.tempId}`;
  const panelId = `loc-panel-${location.tempId}`;
  const radiusMsg = radiusMessage(location.radius_m);

  return (
    <div
      ref={(el) => registerRef(location.tempId, el)}
      onMouseEnter={() => onHover(location.tempId)}
      onMouseLeave={() => onHover(null)}
      className={`transition ${expanded ? "bg-cream-deep/60" : ""}`}
    >
      <h3 className="flex items-stretch">
        <button
          type="button"
          id={headerId}
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => onToggleExpand(location.tempId)}
          onFocus={() => onFocusRow(location.tempId)}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-forest"
        >
          <ChevronIcon expanded={expanded} />
          <span className="w-14 shrink-0 font-mono text-xs text-clay">
            {code}
          </span>
          <span className="min-w-0 flex-1 truncate">
            {location.location_name || (
              <span className="text-ink/40">Untitled</span>
            )}
          </span>
          <span className="shrink-0 font-mono text-xs text-ink/50">
            {location.radius_m}m
          </span>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(location.tempId);
          }}
          aria-label={`Remove ${location.location_name || code}`}
          className="shrink-0 self-center rounded-full border border-ink/30 px-3 py-1 text-xs font-medium text-ink/60 transition hover:border-ink/60"
        >
          Remove
        </button>
      </h3>

      {expanded && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={headerId}
          className="flex flex-wrap items-center gap-3 px-2 pb-3 pl-9"
        >
          <input
            value={location.location_name}
            onChange={(e) =>
              onUpdate(location.tempId, { location_name: e.target.value })
            }
            placeholder="Name this spot"
            className={rowInputCls}
          />
          <span className="shrink-0 font-mono text-xs text-ink/50">
            {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
          </span>
          <label className="flex shrink-0 items-center gap-1.5 font-mono text-xs text-ink/50">
            <input
              inputMode="numeric"
              value={String(location.radius_m)}
              onChange={(e) =>
                onUpdate(location.tempId, {
                  radius_m: Number(e.target.value.replace(/[^0-9]/g, "")) || 0,
                })
              }
              className="w-16 rounded-lg border border-ink/20 bg-transparent px-2 py-1.5 text-right text-sm text-ink outline-none focus:border-forest"
            />
            m
          </label>

          <div className="flex w-full flex-col gap-0.5">
            {error && (
              <p className="text-xs font-medium text-clay">{error}</p>
            )}
            {radiusMsg && (
              <p
                className={`text-xs ${radiusMsg.strong ? "font-medium text-clay" : "text-clay/90"}`}
              >
                {radiusMsg.text}
              </p>
            )}
            {overlapping && (
              <p className="text-xs text-ink/50">
                Overlaps another circle — nearest wins.
              </p>
            )}
            {location.source.startsWith("preset:") && (
              <p className="text-xs text-ink/40">
                From{" "}
                {getPreset(location.source.slice("preset:".length))?.label ??
                  "preset"}{" "}
                scan
                {location.external_ref ? ` · ${location.external_ref}` : ""}
              </p>
            )}
            {location.source.startsWith("preset:") &&
              getPreset(location.source.slice("preset:".length))
                ?.defaultRadius === 250 && (
                <p className="text-xs text-ink/50">
                  Larger radius set because GPS is unreliable indoors.
                </p>
              )}
            {location.source === "search" && (
              <p className="text-xs text-ink/40">
                From search
                {location.external_ref ? ` · ${location.external_ref}` : ""}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

function BulkActionBar({
  count,
  onSetRadius,
  onRemoveAll,
}: {
  count: number;
  onSetRadius: (radius: number) => void;
  onRemoveAll: () => void;
}) {
  const [radiusInput, setRadiusInput] = useState("200");
  const [confirming, setConfirming] = useState(false);
  const radius = Number(radiusInput) || 0;
  const radiusValid = Number.isInteger(radius) && radius >= MIN_RADIUS_M;

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-clay/40 bg-clay/10 px-3 py-2 text-xs">
      <span className="font-medium text-ink/80">{count} selected</span>
      <div className="flex items-center gap-1.5">
        <input
          inputMode="numeric"
          value={radiusInput}
          onChange={(e) =>
            setRadiusInput(e.target.value.replace(/[^0-9]/g, ""))
          }
          className="w-16 rounded-lg border border-ink/20 bg-cream px-2 py-1 text-right font-mono text-xs text-ink outline-none focus:border-forest"
        />
        <span className="text-ink/50">m</span>
        <button
          type="button"
          disabled={!radiusValid}
          onClick={() => onSetRadius(radius)}
          className="rounded-full bg-forest-deep px-3 py-1 font-medium text-parchment transition disabled:opacity-50"
        >
          Set radius for selected
        </button>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        {confirming ? (
          <>
            <span className="font-medium text-clay">
              Remove {count} locations?
            </span>
            <button
              type="button"
              onClick={() => {
                onRemoveAll();
                setConfirming(false);
              }}
              className="rounded-full bg-clay px-3 py-1 font-semibold text-cream transition"
            >
              Yes, remove
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-full border border-ink/30 px-3 py-1 font-medium text-ink/70 transition hover:border-ink/60"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-full border border-clay/50 px-3 py-1 font-medium text-clay transition hover:border-clay"
          >
            Remove selected
          </button>
        )}
      </div>
    </div>
  );
}

export default function LocationAccordion({
  locations,
  selectedIds,
  focusedId,
  focusNonce,
  rowErrors,
  overlapping,
  onToggleExpand,
  onFocusRow,
  onHover,
  onUpdate,
  onRemove,
  onExpandAll,
  onCollapseAll,
  onSetRadiusSelected,
  onRemoveSelected,
}: {
  locations: BuilderLocation[];
  selectedIds: Set<string>;
  focusedId: string | null;
  focusNonce: number;
  rowErrors: Record<string, string>;
  overlapping: Set<string>;
  onToggleExpand: (tempId: string) => void;
  onFocusRow: (tempId: string) => void;
  onHover: (tempId: string | null) => void;
  onUpdate: (tempId: string, patch: Partial<BuilderLocation>) => void;
  onRemove: (tempId: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onSetRadiusSelected: (radius: number) => void;
  onRemoveSelected: () => void;
}) {
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const registerRef = (tempId: string, el: HTMLDivElement | null) => {
    rowRefs.current[tempId] = el;
  };

  // A marker click can focus a row further down the list than what's
  // currently paged in — reveal it before trying to scroll to it.
  useEffect(() => {
    if (!focusedId) return;
    const idx = locations.findIndex((l) => l.tempId === focusedId);
    if (idx >= 0 && idx >= visibleCount) {
      setVisibleCount(Math.ceil((idx + 1) / PAGE_SIZE) * PAGE_SIZE);
    }
  }, [focusNonce, focusedId, locations, visibleCount]);

  useEffect(() => {
    if (!focusedId) return;
    // scrollIntoView with "nearest" is a no-op if already in view, so this
    // is safe to fire regardless of whether the focus originated here.
    // Keyed on the nonce (not just the id) so re-focusing an already-
    // expanded row still scrolls back to it after the user has scrolled
    // away — an id-only dependency would bail out on a same-value update.
    rowRefs.current[focusedId]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [focusNonce, focusedId]);

  if (locations.length === 0) {
    return (
      <p className="mt-3 border-y border-ink/25 py-4 text-sm text-ink/50">
        No locations yet — add one with the controls on the map.
      </p>
    );
  }

  const visible = locations.slice(0, visibleCount);
  const allExpanded = selectedIds.size === locations.length;
  const bulkCount = selectedIds.size;

  return (
    <div className="mt-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs text-ink/50">
          {locations.length} location{locations.length === 1 ? "" : "s"}
        </p>
        <div className="flex items-center gap-3 text-xs font-medium">
          <button
            type="button"
            onClick={onExpandAll}
            disabled={allExpanded}
            className="text-forest-deep underline-offset-2 hover:underline disabled:text-ink/30 disabled:no-underline"
          >
            Expand all
          </button>
          <span className="text-ink/20">|</span>
          <button
            type="button"
            onClick={onCollapseAll}
            disabled={bulkCount === 0}
            className="text-forest-deep underline-offset-2 hover:underline disabled:text-ink/30 disabled:no-underline"
          >
            Collapse all
          </button>
        </div>
      </div>

      {bulkCount > 1 && (
        <BulkActionBar
          count={bulkCount}
          onSetRadius={onSetRadiusSelected}
          onRemoveAll={onRemoveSelected}
        />
      )}

      <div className="divide-y divide-ink/15 border-y border-ink/25">
        {visible.map((l, i) => (
          <LocationRow
            key={l.tempId}
            location={l}
            index={i}
            expanded={selectedIds.has(l.tempId)}
            error={rowErrors[l.tempId]}
            overlapping={overlapping.has(l.tempId)}
            registerRef={registerRef}
            onToggleExpand={onToggleExpand}
            onFocusRow={onFocusRow}
            onHover={onHover}
            onUpdate={onUpdate}
            onRemove={onRemove}
          />
        ))}
      </div>

      {visibleCount < locations.length && (
        <button
          type="button"
          onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
          className="mt-3 w-full rounded-xl border border-ink/25 py-2 text-xs font-medium text-ink/70 transition hover:border-ink/60"
        >
          Show {Math.min(PAGE_SIZE, locations.length - visibleCount)} more
        </button>
      )}
    </div>
  );
}
