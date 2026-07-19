"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { DEFAULT_RADIUS_M } from "@/lib/campaign-schema";
import {
  type BuilderLocation,
  MAX_LOCATIONS,
  SOFT_WARN_LOCATIONS,
  makeTempId,
} from "./location-types";
import LocationSearch, { type GeocodeResult } from "./location-search";
import LocationAccordion from "./location-accordion";
import {
  PRESETS,
  getPreset,
  boundsAreaKm2,
  MAX_PRESET_AREA_KM2,
} from "@/lib/preset-registry";

export type { BuilderLocation };

const LONDON: [number, number] = [51.5074, -0.1278];
const VIEW_KEY = "moments_map_view";
// How close a commit needs to land to the last search result for its name
// to carry over — close enough that it's clearly "that place", not a
// coincidence of the crosshair drifting nearby.
const SEARCH_NAME_CARRYOVER_RADIUS_M = 150;

// Only Nominatim results have an OSM identity; postcodes.io ones don't.
function externalRefForResult(r: GeocodeResult): string | null {
  return r.osm_type && r.osm_id != null ? `osm:${r.osm_type}:${r.osm_id}` : null;
}

// A node fetched from a preset layer — pure view-state, never persisted.
// Activating one (a click) is what turns it into a real BuilderLocation.
type PresetNode = {
  external_ref: string;
  location_name: string;
  lat: number;
  lng: number;
  preset_id: string;
};

const LAYER_REFETCH_DEBOUNCE_MS = 600;

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
// default image icons 404. Selected takes precedence over hover.
function markerIcon(n: number, selected: boolean, hovered: boolean): L.DivIcon {
  const cls = selected
    ? " moment-marker--active"
    : hovered
      ? " moment-marker--hover"
      : "";
  return L.divIcon({
    className: "",
    html: `<div class="moment-marker${cls}">${String(n).padStart(2, "0")}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

// Outline-only square, no fill, no geofence circle — visually unmistakable
// from an activated (filled circular) marker. One shared instance: divIcons
// are stateless and there can be hundreds of dormant nodes at once.
const DORMANT_ICON = L.divIcon({
  className: "",
  html: `<div class="moment-marker-dormant"></div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

// Memoized so pans/selection changes don't re-render hundreds of dormant
// markers. Left-click activates; right-click is deliberately inert on
// dormant nodes (deactivation is only for already-active preset nodes).
const DormantNode = memo(function DormantNode({
  node,
  onActivate,
}: {
  node: PresetNode;
  onActivate: (n: PresetNode) => void;
}) {
  return (
    <Marker
      position={[node.lat, node.lng]}
      icon={DORMANT_ICON}
      eventHandlers={{
        click: (e) => {
          L.DomEvent.stopPropagation(e);
          onActivate(node);
        },
        contextmenu: (e) => {
          L.DomEvent.stopPropagation(e);
        },
      }}
    />
  );
});

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

// Preset layers refetch for the new viewport after every pan/zoom — the
// debounce lives in the parent so a fling of successive moveends coalesces
// into one request.
function MoveEndWatcher({ onMoveEnd }: { onMoveEnd: () => void }) {
  useMapEvents({ moveend: onMoveEnd });
  return null;
}

// While add-mode is on, clicking the map places a marker there. Otherwise,
// clicking empty map space (a marker click stops its own event from
// reaching here) clears the current selection.
function MapInteractions({
  addModeActive,
  onPlace,
  onDeselect,
}: {
  addModeActive: boolean;
  onPlace: (lat: number, lng: number) => void;
  onDeselect: () => void;
}) {
  useMapEvents({
    click: (e) => {
      if (addModeActive) onPlace(e.latlng.lat, e.latlng.lng);
      else onDeselect();
    },
  });
  return null;
}

type LocationMapItemProps = {
  location: BuilderLocation;
  index: number;
  isSelected: boolean;
  isHovered: boolean;
  onSelect: (tempId: string, additive: boolean) => void;
  onDragEnd: (tempId: string, lat: number, lng: number) => void;
  // Right-click / long-press. The parent decides what (if anything) it
  // does — only preset-sourced locations deactivate.
  onContextMenu: (tempId: string) => void;
};

// One marker + its geofence circle, memoized so dragging or editing one
// location — or changing selection elsewhere — doesn't force every other
// marker on the map to re-render. The circle live-follows its marker
// during drag via a local ref, bypassing React entirely for that path;
// only dragend commits to state.
const LocationMapItem = memo(function LocationMapItem({
  location,
  index,
  isSelected,
  isHovered,
  onSelect,
  onDragEnd,
  onContextMenu,
}: LocationMapItemProps) {
  const circleRef = useRef<L.Circle | null>(null);

  return (
    <>
      <Marker
        position={[location.lat, location.lng]}
        draggable
        icon={markerIcon(index + 1, isSelected, isHovered)}
        eventHandlers={{
          click: (e) => {
            L.DomEvent.stopPropagation(e);
            const oe = e.originalEvent;
            onSelect(location.tempId, oe.metaKey || oe.ctrlKey || oe.shiftKey);
          },
          contextmenu: (e) => {
            L.DomEvent.stopPropagation(e);
            onContextMenu(location.tempId);
          },
          drag: (e) => {
            const p = (e.target as L.Marker).getLatLng();
            circleRef.current?.setLatLng(p);
          },
          dragend: (e) => {
            const p = (e.target as L.Marker).getLatLng();
            onDragEnd(location.tempId, p.lat, p.lng);
          },
        }}
      />
      <Circle
        ref={(instance) => {
          circleRef.current = instance;
        }}
        center={[location.lat, location.lng]}
        radius={Math.max(location.radius_m || 1, 1)}
        pathOptions={{
          color: isSelected ? "#b0603a" : "#20402f",
          weight: isSelected ? 2 : 1.5,
          fillColor: isSelected ? "#b0603a" : "#20402f",
          fillOpacity: isSelected ? 0.12 : 0.06,
        }}
      />
    </>
  );
});

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
  const didInitialFit = useRef(false);
  // The most recent search result the user navigated to — used to carry
  // its name/identity over onto the next commit, if it lands nearby.
  const [lastSearchResult, setLastSearchResult] = useState<GeocodeResult | null>(null);

  // selectedIds doubles as "expanded" — a location is expanded in the
  // accordion exactly when it's selected, so the map and the list always
  // agree on what's active. focusedId is the most recent single item to
  // become active, purely to drive scroll/pan; hoveredId is lighter still
  // (marker highlight only, never pans).
  //
  // focusNonce always increments alongside focusedId, even when the id is
  // unchanged (e.g. re-clicking an already-expanded row after manually
  // panning the map away). Effects key off the nonce, not the id, so
  // "focus this again" reliably re-triggers the pan/scroll — an id-only
  // dependency would bail out on a same-value update, per React's usual
  // effect semantics, and the map just wouldn't move back.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);

  const focusOn = useCallback((tempId: string | null) => {
    setFocusedId(tempId);
    setFocusNonce((n) => n + 1);
  }, []);

  // Ref mirrors of state let stable (useCallback, empty-dep) handlers read
  // the latest values without their own identity changing on every edit —
  // that identity stability is what lets LocationMapItem and LocationRow
  // actually skip re-rendering via memo.
  const locationsRef = useRef(locations);
  locationsRef.current = locations;
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;

  // Preset layers. layerNodes is the merged, deduped-by-external_ref pool
  // of every node fetched so far (across pans) — pure view-state, never
  // saved. activeLayers drives which presets' dormant nodes render.
  // viewBounds tracks the current viewport for the "N in view" badges.
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  const [activeLayers, setActiveLayers] = useState<Set<string>>(new Set());
  const [layerNodes, setLayerNodes] = useState<Map<string, PresetNode>>(
    new Map()
  );
  const [layerLoading, setLayerLoading] = useState(false);
  const [layerNotice, setLayerNotice] = useState<string | null>(null);
  const [viewBounds, setViewBounds] = useState<L.LatLngBounds | null>(null);
  const activeLayersRef = useRef(activeLayers);
  activeLayersRef.current = activeLayers;
  const layerAbortRef = useRef<AbortController | null>(null);
  const layerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    setLastSearchResult(result);
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
    // Right-click (and long-press on touch) is a deactivation gesture on
    // preset markers — the browser's own context menu must never appear
    // anywhere on the map canvas. Leaflet still delivers its contextmenu
    // events to markers; this only suppresses the native menu.
    m.getContainer().addEventListener("contextmenu", (e) => e.preventDefault());
    setViewBounds(m.getBounds());
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

  const update = useCallback(
    (tempId: string, patch: Partial<BuilderLocation>) =>
      onChange(
        locationsRef.current.map((l) =>
          l.tempId === tempId ? { ...l, ...patch } : l
        )
      ),
    [onChange]
  );

  // Exclusive select — a plain marker click or a fresh add/focus.
  const selectOnly = useCallback(
    (tempId: string) => {
      setSelectedIds(new Set([tempId]));
      focusOn(tempId);
    },
    [focusOn]
  );

  // Additive toggle — modifier-click on a marker, or clicking a row's own
  // disclosure header (which independently toggles per bullet 1, no
  // modifier needed there). Always re-focuses the toggled row; if it was
  // already in view (e.g. the row was just clicked directly), the
  // resulting pan/scroll are no-ops.
  const toggleSelect = useCallback(
    (tempId: string) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(tempId)) next.delete(tempId);
        else next.add(tempId);
        return next;
      });
      focusOn(tempId);
    },
    [focusOn]
  );

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    focusOn(null);
  }, [focusOn]);

  const focusRow = focusOn;
  const setHovered = useCallback((tempId: string | null) => setHoveredId(tempId), []);

  const expandAll = useCallback(() => {
    setSelectedIds(new Set(locationsRef.current.map((l) => l.tempId)));
  }, []);
  const collapseAll = useCallback(() => {
    setSelectedIds(new Set());
    focusOn(null);
  }, [focusOn]);

  const onMarkerSelect = useCallback(
    (tempId: string, additive: boolean) => {
      if (additive) toggleSelect(tempId);
      else selectOnly(tempId);
    },
    [toggleSelect, selectOnly]
  );

  const onMarkerDragEnd = useCallback(
    (tempId: string, lat: number, lng: number) => update(tempId, { lat, lng }),
    [update]
  );

  // Selects and gently recentres on an already-committed location, in lieu
  // of adding a duplicate on top of it.
  const focusExisting = (loc: BuilderLocation) => {
    selectOnly(loc.tempId);
  };

  // Pan (but never zoom) to the focused location if it's off-screen —
  // covers both "expanding/focusing a row" from the accordion and
  // re-selecting via the map itself, where the bounds check naturally
  // no-ops since the marker just got clicked. Keyed on the nonce, not the
  // id, so re-focusing the same row after the map has drifted away still
  // pans back — see the note by focusNonce above.
  useEffect(() => {
    if (!focusedId) return;
    const loc = locationsRef.current.find((l) => l.tempId === focusedId);
    const m = mapRef.current;
    if (!loc || !m) return;
    const pt = L.latLng(loc.lat, loc.lng);
    if (!m.getBounds().contains(pt)) m.panTo(pt);
  }, [focusNonce, focusedId]);

  const addAt = (lat: number, lng: number) => {
    if (locations.length >= MAX_LOCATIONS) return;

    // If this commit lands close to the last place the user searched for,
    // carry its name and OSM identity over rather than falling back to an
    // anonymous LOC-{n} — selecting a result never creates a location on
    // its own, but this is the organiser explicitly committing a point
    // right where they just navigated to.
    let name = `LOC-${String(locations.length + 1).padStart(3, "0")}`;
    let source = "manual";
    let externalRef: string | null = null;
    if (
      lastSearchResult &&
      haversineMeters(lat, lng, lastSearchResult.lat, lastSearchResult.lng) <=
        SEARCH_NAME_CARRYOVER_RADIUS_M
    ) {
      name = lastSearchResult.name || lastSearchResult.display_name;
      source = "search";
      externalRef = externalRefForResult(lastSearchResult);
    }

    if (externalRef) {
      const existing = locations.find((l) => l.external_ref === externalRef);
      if (existing) {
        focusExisting(existing);
        return;
      }
    }

    const next: BuilderLocation = {
      tempId: makeTempId(),
      location_name: name,
      lat,
      lng,
      radius_m: DEFAULT_RADIUS_M,
      sort_order: locations.length,
      source,
      external_ref: externalRef,
    };
    onChange([...locations, next]);
    selectOnly(next.tempId);
  };

  const addAtCentre = () => {
    const m = mapRef.current;
    if (!m) return;
    const c = m.getCenter();
    addAt(c.lat, c.lng);
  };

  // "Add here" on a search result row — adds that exact result directly,
  // independent of the map centre. Still a fully explicit user action;
  // merely selecting/navigating to a result never does this on its own.
  const addSearchResult = (result: GeocodeResult) => {
    if (locations.length >= MAX_LOCATIONS) return;
    const externalRef = externalRefForResult(result);
    if (externalRef) {
      const existing = locations.find((l) => l.external_ref === externalRef);
      if (existing) {
        focusExisting(existing);
        return;
      }
    }
    const next: BuilderLocation = {
      tempId: makeTempId(),
      location_name: result.name || result.display_name,
      lat: result.lat,
      lng: result.lng,
      radius_m: DEFAULT_RADIUS_M,
      sort_order: locations.length,
      source: "search",
      external_ref: externalRef,
    };
    onChange([...locations, next]);
    selectOnly(next.tempId);
  };

  const remove = useCallback(
    (tempId: string) => {
      onChange(
        locationsRef.current
          .filter((l) => l.tempId !== tempId)
          .map((l, i) => ({ ...l, sort_order: i }))
      );
      setSelectedIds((prev) => {
        if (!prev.has(tempId)) return prev;
        const next = new Set(prev);
        next.delete(tempId);
        return next;
      });
    },
    [onChange]
  );

  const removeSelected = useCallback(() => {
    setSelectedIds((toRemove) => {
      onChange(
        locationsRef.current
          .filter((l) => !toRemove.has(l.tempId))
          .map((l, i) => ({ ...l, sort_order: i }))
      );
      return new Set();
    });
    focusOn(null);
  }, [onChange, focusOn]);

  const setRadiusSelected = useCallback(
    (radius: number) => {
      onChange(
        locationsRef.current.map((l) =>
          selectedIdsRef.current.has(l.tempId) ? { ...l, radius_m: radius } : l
        )
      );
    },
    [onChange]
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

  // ── Preset layers ───────────────────────────────────────────────

  const committedRefs = useMemo(
    () => new Set(locations.map((l) => l.external_ref).filter(Boolean) as string[]),
    [locations]
  );

  const fetchLayers = useCallback(async () => {
    const m = mapRef.current;
    const ids = Array.from(activeLayersRef.current);
    if (!m || !ids.length) return;
    const b = m.getBounds();
    const bounds = {
      south: b.getSouth(),
      west: b.getWest(),
      north: b.getNorth(),
      east: b.getEast(),
    };
    // Same cap the server enforces — checked here first so a zoomed-out
    // map shows "zoom in" without a doomed request. Existing nodes stay.
    if (boundsAreaKm2(bounds) > MAX_PRESET_AREA_KM2) {
      setLayerNotice("Zoom in to load kiosks.");
      return;
    }
    layerAbortRef.current?.abort();
    const controller = new AbortController();
    layerAbortRef.current = controller;
    setLayerLoading(true);
    setLayerNotice(null);
    try {
      const results = await Promise.all(
        ids.map(async (id) => {
          const res = await fetch("/api/presets/query", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ preset_id: id, bounds }),
            signal: controller.signal,
          });
          const json = await res.json();
          if (!res.ok) {
            throw new Error(
              json.error === "area_too_large"
                ? "Zoom in to load kiosks."
                : typeof json.error === "string" && json.error.includes(" ")
                  ? json.error
                  : "Couldn't load preset nodes. Try again."
            );
          }
          return json.locations as PresetNode[];
        })
      );
      // Merge into the pool — a node seen on an earlier pan is kept, never
      // duplicated, keyed by its stable external_ref.
      setLayerNodes((prev) => {
        const next = new Map(prev);
        for (const list of results) {
          for (const n of list) {
            if (!next.has(n.external_ref)) next.set(n.external_ref, n);
          }
        }
        return next;
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setLayerNotice(
        err instanceof Error ? err.message : "Couldn't load preset nodes. Try again."
      );
    } finally {
      // A newer fetch may have superseded this one — only the latest
      // request owns the loading flag.
      if (layerAbortRef.current === controller) setLayerLoading(false);
    }
  }, []);

  // Immediate fetch when a layer turns on (or the active set changes).
  useEffect(() => {
    if (activeLayers.size) fetchLayers();
  }, [activeLayers, fetchLayers]);

  // Cancel any in-flight work when the builder unmounts.
  useEffect(
    () => () => {
      layerAbortRef.current?.abort();
      if (layerTimerRef.current) clearTimeout(layerTimerRef.current);
    },
    []
  );

  const onMapMoveEnd = useCallback(() => {
    const m = mapRef.current;
    if (m) setViewBounds(m.getBounds());
    if (!activeLayersRef.current.size) return;
    if (layerTimerRef.current) clearTimeout(layerTimerRef.current);
    layerTimerRef.current = setTimeout(fetchLayers, LAYER_REFETCH_DEBOUNCE_MS);
  }, [fetchLayers]);

  const toggleLayer = (id: string) => {
    const next = new Set(activeLayers);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setActiveLayers(next);
    if (!next.size) {
      layerAbortRef.current?.abort();
      if (layerTimerRef.current) clearTimeout(layerTimerRef.current);
      setLayerLoading(false);
      setLayerNotice(null);
    }
  };

  // Dormant = fetched, layer on, and not already a campaign location —
  // activated nodes render as normal markers via `locations`, and this
  // derivation is also what returns a node to dormant the moment its
  // location is removed (right-click or the accordion's Remove).
  const dormantNodes = useMemo(() => {
    if (!activeLayers.size) return [];
    const out: PresetNode[] = [];
    for (const n of layerNodes.values()) {
      if (activeLayers.has(n.preset_id) && !committedRefs.has(n.external_ref)) {
        out.push(n);
      }
    }
    return out;
  }, [layerNodes, activeLayers, committedRefs]);

  // "N kiosks in view" badges — counts every known node of the preset
  // inside the current viewport, activated or not.
  const inViewCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (!viewBounds) return counts;
    for (const n of layerNodes.values()) {
      if (viewBounds.contains([n.lat, n.lng])) {
        counts[n.preset_id] = (counts[n.preset_id] ?? 0) + 1;
      }
    }
    return counts;
  }, [layerNodes, viewBounds]);

  const activateNode = useCallback(
    (node: PresetNode) => {
      // The cap banner below the map is already visible whenever at cap.
      if (locationsRef.current.length >= MAX_LOCATIONS) return;
      if (locationsRef.current.some((l) => l.external_ref === node.external_ref))
        return;
      const next: BuilderLocation = {
        tempId: makeTempId(),
        location_name: node.location_name,
        lat: node.lat,
        lng: node.lng,
        radius_m: getPreset(node.preset_id)?.defaultRadius ?? DEFAULT_RADIUS_M,
        sort_order: locationsRef.current.length,
        source: `preset:${node.preset_id}`,
        external_ref: node.external_ref,
      };
      onChange([...locationsRef.current, next]);
      selectOnly(next.tempId);
    },
    [onChange, selectOnly]
  );

  // Right-click deactivation is a preset-only shortcut — manually added
  // and searched locations are untouched by it.
  const onMarkerContextMenu = useCallback(
    (tempId: string) => {
      const loc = locationsRef.current.find((l) => l.tempId === tempId);
      if (!loc || !loc.source.startsWith("preset:")) return;
      remove(tempId);
    },
    [remove]
  );

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
          <MoveEndWatcher onMoveEnd={onMapMoveEnd} />
          <MapInteractions
            addModeActive={addMode && !atCap}
            onPlace={addAt}
            onDeselect={clearSelection}
          />

          {locations.map((l, i) => (
            <LocationMapItem
              key={l.tempId}
              location={l}
              index={i}
              isSelected={selectedIds.has(l.tempId)}
              isHovered={hoveredId === l.tempId}
              onSelect={onMarkerSelect}
              onDragEnd={onMarkerDragEnd}
              onContextMenu={onMarkerContextMenu}
            />
          ))}

          {dormantNodes.map((n) => (
            <DormantNode
              key={n.external_ref}
              node={n}
              onActivate={activateNode}
            />
          ))}
        </MapContainer>

        {/* Persistent, non-interactive crosshair marking the map's exact
            centre — "Add at centre" drops a marker here. */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-[400] h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-ink/40">
          <span className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink/50" />
        </div>

        <div className="absolute left-3 top-3 z-[1000] flex flex-col items-start gap-2">
          <LocationSearch
            getBounds={getMapBounds}
            onNavigate={navigateToResult}
            onAddHere={addSearchResult}
          />

          <button
            type="button"
            aria-expanded={presetMenuOpen}
            onClick={() => setPresetMenuOpen((o) => !o)}
            className={
              activeLayers.size
                ? "rounded-full bg-clay px-4 py-1.5 text-xs font-semibold text-cream shadow-sm transition"
                : controlBtn
            }
          >
            Presets{activeLayers.size ? ` — ${activeLayers.size} on` : ""}
          </button>

          {presetMenuOpen && (
            <div className="w-64 rounded-xl border border-ink/25 bg-cream p-3 shadow-md">
              <p className="text-xs font-medium uppercase tracking-[0.15em] text-ink/60">
                Preset layers
              </p>
              {/* Rendered generically from the registry — a future preset
                  appears here with no UI changes. */}
              {PRESETS.map((p) => {
                const on = activeLayers.has(p.id);
                return (
                  <div
                    key={p.id}
                    className="mt-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-ink">{p.label}</p>
                      {on && (
                        <p className="text-xs text-ink/50">
                          {inViewCounts[p.id] ?? 0} {p.countNoun} in view
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label={`Toggle ${p.label}`}
                      onClick={() => toggleLayer(p.id)}
                      className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                        on ? "bg-forest-deep" : "bg-ink/20"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-5 w-5 rounded-full bg-cream shadow-sm transition-all ${
                          on ? "left-[22px]" : "left-0.5"
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {layerLoading && (
            <p className="rounded-full bg-cream/90 px-3 py-1 text-xs text-ink/60 shadow-sm">
              Loading presets…
            </p>
          )}
          {layerNotice && !layerLoading && (
            <p className="max-w-[16rem] rounded-full bg-cream/90 px-3 py-1 text-xs font-medium text-clay shadow-sm">
              {layerNotice}
            </p>
          )}
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
        </div>

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

      <LocationAccordion
        locations={locations}
        selectedIds={selectedIds}
        focusedId={focusedId}
        focusNonce={focusNonce}
        rowErrors={rowErrors}
        overlapping={overlapping}
        onToggleExpand={toggleSelect}
        onFocusRow={focusRow}
        onHover={setHovered}
        onUpdate={update}
        onRemove={remove}
        onExpandAll={expandAll}
        onCollapseAll={collapseAll}
        onSetRadiusSelected={setRadiusSelected}
        onRemoveSelected={removeSelected}
      />
    </div>
  );
}
