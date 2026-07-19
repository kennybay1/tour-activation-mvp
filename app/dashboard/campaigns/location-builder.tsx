"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import {
  MapContainer,
  TileLayer,
  Marker,
  Circle,
  ZoomControl,
  useMap,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { DEFAULT_RADIUS_M, RADIUS_WARN_BELOW } from "@/lib/campaign-schema";
import {
  type BuilderLocation,
  MAX_LOCATIONS,
  SOFT_WARN_LOCATIONS,
  makeTempId,
} from "./location-types";
import LocationSearch, { type GeocodeResult } from "./location-search";

export type { BuilderLocation };

const LONDON: [number, number] = [51.5074, -0.1278];
const VIEW_KEY = "moments_map_view";
const MIN_SCAN_RADIUS = 100;
const MAX_SCAN_RADIUS = 5000;

type GhostKiosk = {
  external_ref: string;
  location_name: string;
  lat: number;
  lng: number;
  design: string | null;
  selected: boolean;
};

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// CSS-drawn divIcon markers sidestep the bundler issue where Leaflet's
// default image icons 404.
function markerIcon(n: number, active: boolean): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div class="moment-marker${active ? " moment-marker--active" : ""}">${String(
      n
    ).padStart(2, "0")}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

// Outline-only square, no fill — visually unmistakable from a committed
// (filled circular) marker, since it isn't one yet.
function ghostIcon(selected: boolean): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div class="moment-marker-ghost${selected ? " moment-marker-ghost--selected" : ""}"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

function MapReady({ onReady }: { onReady: (m: L.Map) => void }) {
  const map = useMap();
  useEffect(() => {
    onReady(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);
  return null;
}

function ViewPersist() {
  useMapEvents({
    moveend: (e) => {
      const m = e.target as L.Map;
      const c = m.getCenter();
      try {
        localStorage.setItem(
          VIEW_KEY,
          JSON.stringify({ lat: c.lat, lng: c.lng, zoom: m.getZoom() })
        );
      } catch {}
    },
  });
  return null;
}

function ClickToPlace({
  active,
  onPlace,
}: {
  active: boolean;
  onPlace: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click: (e) => {
      if (active) onPlace(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function LocationBuilder({
  locations,
  onChange,
  rowErrors,
}: {
  locations: BuilderLocation[];
  onChange: (next: BuilderLocation[]) => void;
  rowErrors: Record<string, string>;
}) {
  const mapRef = useRef<L.Map | null>(null);
  // Circles are moved imperatively while a marker is actively being
  // dragged, bypassing React entirely for that 60fps-ish path. Only
  // dragend commits to React state — see the note by the Marker below.
  const circleRefs = useRef<Record<string, L.Circle | null>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  const didInitialFit = useRef(false);

  // Preset scanner state — entirely separate from the committed
  // `locations` array until the organiser explicitly commits.
  const [scanOpen, setScanOpen] = useState(false);
  const [scanCenter, setScanCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [scanRadius, setScanRadius] = useState(1000);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [ghosts, setGhosts] = useState<GhostKiosk[]>([]);

  const initialView = useMemo(() => {
    try {
      const s = localStorage.getItem(VIEW_KEY);
      if (s) {
        const v = JSON.parse(s);
        if (Number.isFinite(v.lat) && Number.isFinite(v.lng)) {
          return { center: [v.lat, v.lng] as [number, number], zoom: v.zoom ?? 12 };
        }
      }
    } catch {}
    return { center: LONDON, zoom: 12 };
  }, []);

  const fitAll = () => {
    const m = mapRef.current;
    if (!m || !locations.length) return;
    m.fitBounds(
      L.latLngBounds(locations.map((l) => [l.lat, l.lng] as [number, number])),
      { padding: [40, 40], maxZoom: 16 }
    );
  };

  // ── Place search ────────────────────────────────────────────────
  // Search only ever moves the viewport — it never creates a location.
  // Committing a coordinate still happens exclusively via Add/Click to
  // place, matching the existing centre-drop flow below.

  const getMapBounds = () => {
    const m = mapRef.current;
    if (!m) return null;
    const b = m.getBounds();
    return {
      minLat: b.getSouth(),
      minLng: b.getWest(),
      maxLat: b.getNorth(),
      maxLng: b.getEast(),
    };
  };

  const navigateToResult = (result: GeocodeResult) => {
    const m = mapRef.current;
    if (!m) return;
    if (result.boundingbox) {
      const [minLat, maxLat, minLng, maxLng] = result.boundingbox;
      m.fitBounds(L.latLngBounds([minLat, minLng], [maxLat, maxLng]), {
        padding: [40, 40],
      });
    } else {
      m.flyTo([result.lat, result.lng], 16);
    }
  };

  const onMapReady = (m: L.Map) => {
    mapRef.current = m;
    if (!didInitialFit.current && locations.length) {
      didInitialFit.current = true;
      m.fitBounds(
        L.latLngBounds(
          locations.map((l) => [l.lat, l.lng] as [number, number])
        ),
        { padding: [40, 40], maxZoom: 16 }
      );
    }
  };

  const update = (tempId: string, patch: Partial<BuilderLocation>) =>
    onChange(
      locations.map((l) => (l.tempId === tempId ? { ...l, ...patch } : l))
    );

  const addAt = (lat: number, lng: number) => {
    if (locations.length >= MAX_LOCATIONS) return;
    const next: BuilderLocation = {
      tempId: makeTempId(),
      location_name: `LOC-${String(locations.length + 1).padStart(3, "0")}`,
      lat,
      lng,
      radius_m: DEFAULT_RADIUS_M,
      sort_order: locations.length,
      source: "manual",
    };
    onChange([...locations, next]);
    setSelected(next.tempId);
  };

  const addAtCentre = () => {
    const m = mapRef.current;
    if (!m) return;
    const c = m.getCenter();
    addAt(c.lat, c.lng);
  };

  const remove = (tempId: string) =>
    onChange(
      locations
        .filter((l) => l.tempId !== tempId)
        .map((l, i) => ({ ...l, sort_order: i }))
    );

  const overlapping = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < locations.length; i++) {
      for (let j = i + 1; j < locations.length; j++) {
        const a = locations[i];
        const b = locations[j];
        if (
          haversineMeters(a.lat, a.lng, b.lat, b.lng) <
          a.radius_m + b.radius_m
        ) {
          set.add(a.tempId);
          set.add(b.tempId);
        }
      }
    }
    return set;
  }, [locations]);

  const atCap = locations.length >= MAX_LOCATIONS;

  // ── Preset scanner ──────────────────────────────────────────────

  const committedRefs = useMemo(
    () => new Set(locations.map((l) => l.external_ref).filter(Boolean) as string[]),
    [locations]
  );

  const openScan = () => {
    const m = mapRef.current;
    if (!m) return;
    const c = m.getCenter();
    const size = m.getSize();
    // Default the scan radius to whatever's already visible on screen —
    // "use the current map bounds by default" — clamped to the API's
    // accepted range. If the container hasn't been laid out yet (size is
    // degenerate), fall back to a sensible fixed default rather than
    // trusting a near-zero bounding box.
    let defaultRadius = 1000;
    if (size.x > 0 && size.y > 0) {
      const bounds = m.getBounds();
      const edgeDistance = Math.min(
        haversineMeters(c.lat, c.lng, bounds.getNorth(), c.lng),
        haversineMeters(c.lat, c.lng, bounds.getSouth(), c.lng),
        haversineMeters(c.lat, c.lng, c.lat, bounds.getEast()),
        haversineMeters(c.lat, c.lng, c.lat, bounds.getWest())
      );
      if (edgeDistance > MIN_SCAN_RADIUS) defaultRadius = edgeDistance;
    }
    setScanCenter({ lat: c.lat, lng: c.lng });
    setScanRadius(
      Math.round(Math.min(MAX_SCAN_RADIUS, Math.max(MIN_SCAN_RADIUS, defaultRadius)))
    );
    setGhosts([]);
    setScanError(null);
    setScanOpen(true);
  };

  const closeScan = () => {
    setScanOpen(false);
    setGhosts([]);
    setScanError(null);
    setScanning(false);
  };

  const runScan = async () => {
    if (!scanCenter || scanning) return;
    const radius = Math.round(
      Math.min(MAX_SCAN_RADIUS, Math.max(MIN_SCAN_RADIUS, scanRadius))
    );
    setScanning(true);
    setScanError(null);
    try {
      const res = await fetch("/api/presets/phone-boxes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: scanCenter.lat, lng: scanCenter.lng, radius }),
      });
      const json = await res.json();
      if (!res.ok) {
        setScanError(
          typeof json.error === "string"
            ? json.error
            : "Couldn't scan this area. Try again."
        );
        setGhosts([]);
        return;
      }
      setGhosts(
        (json.locations as Omit<GhostKiosk, "selected">[]).map((k) => ({
          ...k,
          selected: true,
        }))
      );
    } catch {
      setScanError("Couldn't reach the scan service. Check your connection and try again.");
      setGhosts([]);
    } finally {
      setScanning(false);
    }
  };

  const toggleGhost = (ref: string) =>
    setGhosts((gs) =>
      gs.map((g) => (g.external_ref === ref ? { ...g, selected: !g.selected } : g))
    );

  const selectableGhosts = ghosts.filter((g) => !committedRefs.has(g.external_ref));
  const selectedCount = selectableGhosts.filter((g) => g.selected).length;

  const commitGhosts = () => {
    const toCommit = selectableGhosts.filter((g) => g.selected);
    if (!toCommit.length) return;
    const total = locations.length + toCommit.length;
    if (total > MAX_LOCATIONS) {
      setScanError(
        `Committing these ${toCommit.length} would put you at ${total} locations — over the ${MAX_LOCATIONS} limit. Deselect some first.`
      );
      return;
    }
    const newLocs: BuilderLocation[] = toCommit.map((g, i) => ({
      tempId: makeTempId(),
      location_name: g.location_name,
      lat: g.lat,
      lng: g.lng,
      radius_m: DEFAULT_RADIUS_M,
      sort_order: locations.length + i,
      source: "preset:k6",
      external_ref: g.external_ref,
    }));
    onChange([...locations, ...newLocs]);
    const committed = new Set(toCommit.map((g) => g.external_ref));
    const remaining = ghosts.filter((g) => !committed.has(g.external_ref));
    setGhosts(remaining);
    setScanError(null);
    if (!remaining.length) setScanOpen(false);
  };

  const controlBtn =
    "rounded-full border border-ink/30 bg-cream px-4 py-1.5 text-xs font-medium text-ink/80 shadow-sm transition hover:border-ink/60 disabled:opacity-50";

  return (
    <div>
      <div className="relative overflow-hidden rounded-2xl border border-ink/25">
        <MapContainer
          center={initialView.center}
          zoom={initialView.zoom}
          style={{ height: 380, width: "100%" }}
          scrollWheelZoom
          zoomControl={false}
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          />
          <ZoomControl position="bottomleft" />
          <MapReady onReady={onMapReady} />
          <ViewPersist />
          <ClickToPlace active={addMode && !atCap} onPlace={addAt} />

          {locations.map((l, i) => (
            <Marker
              key={l.tempId}
              position={[l.lat, l.lng]}
              draggable
              icon={markerIcon(i + 1, selected === l.tempId)}
              eventHandlers={{
                click: () => setSelected(l.tempId),
                // Live-follow the circle without touching React state —
                // committing to state on every drag tick was enough
                // re-render pressure to destabilize Leaflet's SVG
                // renderer mid-drag. dragend is the single source of
                // truth, matching the spec.
                drag: (e) => {
                  const p = (e.target as L.Marker).getLatLng();
                  circleRefs.current[l.tempId]?.setLatLng(p);
                },
                dragend: (e) => {
                  const p = (e.target as L.Marker).getLatLng();
                  update(l.tempId, { lat: p.lat, lng: p.lng });
                },
              }}
            />
          ))}
          {locations.map((l) => (
            <Circle
              key={`c-${l.tempId}`}
              ref={(instance) => {
                circleRefs.current[l.tempId] = instance;
              }}
              center={[l.lat, l.lng]}
              radius={Math.max(l.radius_m || 1, 1)}
              pathOptions={{
                color: selected === l.tempId ? "#b0603a" : "#20402f",
                weight: 1.5,
                fillColor: selected === l.tempId ? "#b0603a" : "#20402f",
                fillOpacity: 0.06,
              }}
            />
          ))}

          {scanOpen && scanCenter && (
            <Circle
              center={[scanCenter.lat, scanCenter.lng]}
              radius={scanRadius}
              pathOptions={{
                color: "#b0603a",
                weight: 2,
                dashArray: "8 6",
                fillOpacity: 0,
              }}
            />
          )}
          {ghosts.map((g) => (
            <Marker
              key={g.external_ref}
              position={[g.lat, g.lng]}
              icon={ghostIcon(g.selected && !committedRefs.has(g.external_ref))}
              eventHandlers={{
                click: () => {
                  if (!committedRefs.has(g.external_ref)) toggleGhost(g.external_ref);
                },
              }}
            />
          ))}
          {ghosts.map((g) => (
            <Circle
              key={`gc-${g.external_ref}`}
              center={[g.lat, g.lng]}
              radius={DEFAULT_RADIUS_M}
              pathOptions={{
                color: g.selected ? "#b0603a" : "#a9bfae",
                weight: 1,
                dashArray: "4 4",
                fillOpacity: 0,
              }}
            />
          ))}
        </MapContainer>

        {/* Persistent, non-interactive crosshair marking the map's exact
            centre — "Add at centre" drops a marker here. */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-[400] h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-ink/40">
          <span className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink/50" />
        </div>

        <div className="absolute left-3 top-3 z-[1000]">
          <LocationSearch getBounds={getMapBounds} onNavigate={navigateToResult} />
        </div>

        <div className="absolute right-3 top-3 z-[1000] flex flex-col items-end gap-2">
          <button
            type="button"
            onClick={addAtCentre}
            disabled={atCap}
            className={controlBtn}
          >
            + Add at centre
          </button>
          <button
            type="button"
            onClick={() => setAddMode(!addMode)}
            disabled={atCap}
            className={
              addMode
                ? "rounded-full bg-clay px-4 py-1.5 text-xs font-semibold text-cream shadow-sm transition"
                : controlBtn
            }
          >
            {addMode ? "Click map to place — on" : "Click to place"}
          </button>
          <button
            type="button"
            onClick={fitAll}
            disabled={!locations.length}
            className={controlBtn}
          >
            Fit all
          </button>
          <button
            type="button"
            onClick={() => (scanOpen ? closeScan() : openScan())}
            disabled={atCap && !scanOpen}
            className={
              scanOpen
                ? "rounded-full bg-clay px-4 py-1.5 text-xs font-semibold text-cream shadow-sm transition"
                : controlBtn
            }
          >
            {scanOpen ? "Scanning presets — on" : "Scan presets"}
          </button>
        </div>

        {scanOpen && (
          <div className="absolute bottom-3 left-3 right-3 z-[1000] max-h-[300px] overflow-y-auto rounded-2xl border border-ink/25 bg-cream/95 p-4 shadow-md backdrop-blur-sm sm:right-auto sm:w-80">
            <p className="text-xs font-medium uppercase tracking-[0.15em] text-ink/60">
              Scan for red telephone kiosks
            </p>
            <div className="mt-3 flex items-center gap-2">
              <label className="flex items-center gap-1.5 font-mono text-xs text-ink/60">
                Radius
                <input
                  inputMode="numeric"
                  value={String(scanRadius)}
                  onChange={(e) =>
                    setScanRadius(
                      Number(e.target.value.replace(/[^0-9]/g, "")) || 0
                    )
                  }
                  className="w-20 rounded-lg border border-ink/20 bg-transparent px-2 py-1.5 text-right text-sm text-ink outline-none focus:border-forest"
                />
                m
              </label>
              <button
                type="button"
                onClick={runScan}
                disabled={
                  scanning ||
                  scanRadius < MIN_SCAN_RADIUS ||
                  scanRadius > MAX_SCAN_RADIUS
                }
                className="rounded-full bg-forest-deep px-4 py-1.5 text-xs font-semibold text-parchment transition active:scale-[0.98] disabled:opacity-50"
              >
                {scanning ? "Scanning…" : ghosts.length ? "Scan again" : "Run scan"}
              </button>
            </div>
            {(scanRadius < MIN_SCAN_RADIUS || scanRadius > MAX_SCAN_RADIUS) && (
              <p className="mt-1 text-xs font-medium text-clay">
                Radius must be between {MIN_SCAN_RADIUS} and {MAX_SCAN_RADIUS}m.
              </p>
            )}
            {scanError && (
              <p className="mt-2 text-xs font-medium text-clay">{scanError}</p>
            )}

            {ghosts.length > 0 && (
              <>
                <p className="mt-4 font-serif text-lg">
                  {ghosts.length} KIOSK{ghosts.length === 1 ? "" : "S"} FOUND
                </p>
                <p className="text-xs text-ink/50">{selectedCount} selected</p>
                <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                  {ghosts.map((g, i) => {
                    const already = committedRefs.has(g.external_ref);
                    return (
                      <label
                        key={g.external_ref}
                        className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs ${
                          already ? "opacity-50" : "hover:bg-cream-deep/60"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={already ? true : g.selected}
                          disabled={already}
                          onChange={() => toggleGhost(g.external_ref)}
                          className="h-4 w-4 shrink-0 accent-clay"
                        />
                        <span className="shrink-0 font-mono text-clay">
                          K-{String(i + 1).padStart(3, "0")}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-ink/80">
                          {g.location_name}
                        </span>
                        {already && (
                          <span className="shrink-0 text-ink/50">
                            Already added
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </>
            )}

            <div className="mt-4 flex gap-2">
              {ghosts.length > 0 && (
                <button
                  type="button"
                  onClick={commitGhosts}
                  disabled={selectedCount === 0}
                  className="rounded-full bg-forest-deep px-4 py-1.5 text-xs font-semibold text-parchment transition active:scale-[0.98] disabled:opacity-50"
                >
                  Commit preset nodes
                </button>
              )}
              <button
                type="button"
                onClick={closeScan}
                className="rounded-full border border-ink/30 px-4 py-1.5 text-xs font-medium text-ink/70 transition hover:border-ink/60"
              >
                {ghosts.length ? "Clear scan" : "Cancel"}
              </button>
            </div>
          </div>
        )}
      </div>

      {atCap && (
        <p className="mt-2 text-xs font-medium text-clay">
          Limit reached — a campaign can hold at most {MAX_LOCATIONS}{" "}
          locations.
        </p>
      )}
      {!atCap && locations.length > SOFT_WARN_LOCATIONS && (
        <p className="mt-2 text-xs font-medium text-clay">
          {locations.length} locations — above {SOFT_WARN_LOCATIONS}, the fan
          experience becomes hard to communicate.
        </p>
      )}
      {overlapping.size > 0 && (
        <p className="mt-2 text-xs font-medium text-clay">
          Some circles overlap — the nearest location wins on unlock.
        </p>
      )}

      {locations.length === 0 ? (
        <p className="mt-3 border-y border-ink/25 py-4 text-sm text-ink/50">
          No locations yet — add one with the controls on the map.
        </p>
      ) : (
        <div className="mt-3 divide-y divide-ink/15 border-y border-ink/25">
          {locations.map((l, i) => (
            <div
              key={l.tempId}
              onMouseEnter={() => setSelected(l.tempId)}
              onClick={() => setSelected(l.tempId)}
              className={`flex flex-wrap items-center gap-3 px-2 py-3 text-sm transition ${
                selected === l.tempId ? "bg-cream-deep/60" : ""
              }`}
            >
              <span className="w-14 shrink-0 font-mono text-xs text-clay">
                LOC-{String(i + 1).padStart(3, "0")}
              </span>
              <input
                value={l.location_name}
                onChange={(e) =>
                  update(l.tempId, { location_name: e.target.value })
                }
                placeholder="Name this spot"
                className="min-w-[10rem] flex-1 rounded-lg border border-ink/20 bg-transparent px-3 py-1.5 text-sm text-ink placeholder-ink/30 outline-none focus:border-forest"
              />
              <span className="shrink-0 font-mono text-xs text-ink/50">
                {l.lat.toFixed(5)}, {l.lng.toFixed(5)}
              </span>
              <label className="flex shrink-0 items-center gap-1.5 font-mono text-xs text-ink/50">
                <input
                  inputMode="numeric"
                  value={String(l.radius_m)}
                  onChange={(e) =>
                    update(l.tempId, {
                      radius_m: Number(e.target.value.replace(/[^0-9]/g, "")) || 0,
                    })
                  }
                  className="w-16 rounded-lg border border-ink/20 bg-transparent px-2 py-1.5 text-right text-sm text-ink outline-none focus:border-forest"
                />
                m
              </label>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(l.tempId);
                }}
                className="shrink-0 rounded-full border border-ink/30 px-3 py-1 text-xs font-medium text-ink/60 transition hover:border-ink/60"
              >
                Remove
              </button>
              <div className="flex w-full flex-col gap-0.5 pl-14">
                {rowErrors[l.tempId] && (
                  <p className="text-xs font-medium text-clay">
                    {rowErrors[l.tempId]}
                  </p>
                )}
                {l.radius_m > 0 && l.radius_m < RADIUS_WARN_BELOW && (
                  <p className="text-xs text-clay/90">
                    Below {RADIUS_WARN_BELOW}m — GPS accuracy in dense urban
                    areas may prevent genuine fans from unlocking.
                  </p>
                )}
                {overlapping.has(l.tempId) && (
                  <p className="text-xs text-ink/50">
                    Overlaps another circle — nearest wins.
                  </p>
                )}
                {l.source === "preset:k6" && (
                  <p className="text-xs text-ink/40">
                    From phone-box scan{l.external_ref ? ` · ${l.external_ref}` : ""}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
