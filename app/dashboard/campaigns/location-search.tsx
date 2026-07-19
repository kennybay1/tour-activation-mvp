"use client";

import { useRef, useState } from "react";

export type GeocodeResult = {
  display_name: string;
  name: string;
  lat: number;
  lng: number;
  // Nominatim's native order: [minLat, maxLat, minLon, maxLon].
  boundingbox: [number, number, number, number] | null;
  type: string;
  osm_type: string | null;
  osm_id: number | null;
};

type Bounds = { minLat: number; minLng: number; maxLat: number; maxLng: number };

// A minimalist search-on-submit box. It only ever moves the map — see
// onNavigate in the parent, which is the sole place map.fitBounds/flyTo is
// called. Selecting a result never creates a location.
export default function LocationSearch({
  getBounds,
  onNavigate,
  onAddHere,
}: {
  getBounds: () => Bounds | null;
  onNavigate: (result: GeocodeResult) => void;
  // Explicit "Add here" per result — a separate action from selecting a
  // result, which still only ever moves the viewport (see onNavigate).
  onAddHere: (result: GeocodeResult) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(-1);
  const abortRef = useRef<AbortController | null>(null);

  const runSearch = async () => {
    const q = query.trim();
    if (!q) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    setHighlighted(-1);
    try {
      const params = new URLSearchParams({ q });
      const bounds = getBounds();
      if (bounds) {
        params.set("minLat", String(bounds.minLat));
        params.set("minLng", String(bounds.minLng));
        params.set("maxLat", String(bounds.maxLat));
        params.set("maxLng", String(bounds.maxLng));
      }
      const res = await fetch(`/api/geocode/search?${params}`, {
        signal: controller.signal,
      });
      const json = await res.json();
      if (!res.ok) {
        setError(
          typeof json.error === "string"
            ? json.error
            : "Couldn't search right now. Try again."
        );
        setResults(null);
        return;
      }
      setResults(json.results ?? []);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError("Couldn't reach the search service. Try again.");
      setResults(null);
    } finally {
      setLoading(false);
    }
  };

  const selectResult = (r: GeocodeResult) => {
    onNavigate(r);
    setResults(null);
    setHighlighted(-1);
    setQuery(r.name || r.display_name);
  };

  const addHere = (r: GeocodeResult) => {
    onAddHere(r);
    setResults(null);
    setHighlighted(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setResults(null);
      setHighlighted(-1);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (results && results.length && highlighted >= 0) {
        // A row is highlighted — select it rather than re-searching.
        selectResult(results[highlighted]);
      } else {
        runSearch();
      }
      return;
    }
    if (!results || !results.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, -1));
    }
  };

  return (
    <div className="relative">
      {/* A plain div, not <form> — this widget lives inside the outer
          campaign form, and nested <form> elements are invalid HTML;
          browsers silently drop the inner tag, which would route Enter
          and the Search button into the OUTER form's submit instead. */}
      <div className="flex items-center gap-1.5 rounded-full border border-ink/30 bg-cream px-1.5 py-1 shadow-sm">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search a place or postcode…"
          className="w-44 bg-transparent px-2 py-1 text-xs text-ink placeholder-ink/40 outline-none sm:w-56"
        />
        <button
          type="button"
          onClick={runSearch}
          disabled={loading || !query.trim()}
          className="shrink-0 rounded-full bg-forest-deep px-3 py-1 text-xs font-medium text-parchment transition disabled:opacity-50"
        >
          {loading ? "…" : "Search"}
        </button>
      </div>

      {error && (
        <p className="mt-1 max-w-xs text-xs font-medium text-clay">{error}</p>
      )}

      {results !== null && (
        <div className="absolute left-0 top-full z-[1001] mt-1 max-h-64 w-64 overflow-y-auto rounded-xl border border-ink/25 bg-cream shadow-md sm:w-72">
          {results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-ink/50">
              No results — try a postcode or street name
            </p>
          ) : (
            results.map((r, i) => (
              // A div, not a button — it holds two separate buttons
              // (select vs. Add here), and buttons can't nest.
              <div
                key={`${r.name}-${r.lat}-${r.lng}-${i}`}
                onMouseEnter={() => setHighlighted(i)}
                className={`flex items-stretch border-b border-ink/10 last:border-b-0 ${
                  i === highlighted ? "bg-cream-deep" : ""
                }`}
              >
                <button
                  type="button"
                  onClick={() => selectResult(r)}
                  className="min-w-0 flex-1 px-3 py-2 text-left"
                >
                  <p className="truncate text-xs font-medium text-ink">
                    {r.name}
                  </p>
                  <p className="truncate text-xs text-ink/50">
                    {r.display_name}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => addHere(r)}
                  className="shrink-0 self-center px-2 text-xs font-medium text-forest-deep underline-offset-2 hover:underline"
                >
                  Add here
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
