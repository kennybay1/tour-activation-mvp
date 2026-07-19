// The single home of preset-scan definitions. Adding a new preset type
// later means adding one entry here — the /api/presets/query route and the
// map-builder scan UI both render generically from this list and need no
// changes. Kept free of server-only imports on purpose: the UI reads
// id/label/defaultRadius from the same module, and the Overpass query text
// is not a secret.

export type PresetBounds = {
  south: number;
  west: number;
  north: number;
  east: number;
};

export type PresetDefinition = {
  id: string;
  label: string;
  // radius_m applied to locations committed from this preset's results.
  defaultRadius: number;
  // Plural noun for count badges — "34 kiosks in view".
  countNoun: string;
  buildQuery: (b: PresetBounds) => string;
  // Display name for a node whose OSM tags carry no name.
  fallbackName: (osmId: number) => string;
};

// Viewports larger than this are rejected server-side and pre-checked
// client-side (to skip the pointless request entirely) — one shared cap.
export const MAX_PRESET_AREA_KM2 = 100;

export function boundsAreaKm2(b: PresetBounds): number {
  const KM_PER_DEG = 111.32;
  const heightKm = (b.north - b.south) * KM_PER_DEG;
  const midLatRad = ((b.north + b.south) / 2) * (Math.PI / 180);
  const widthKm = (b.east - b.west) * KM_PER_DEG * Math.cos(midLatRad);
  return heightKm * widthKm;
}

// The corrected K6 tag matching, verified to return 409 nodes across
// London — do not modify the tag clauses.
function k6Query(b: PresetBounds): string {
  const bbox = `${b.south},${b.west},${b.north},${b.east}`;
  return `[out:json][timeout:10];
(
  node["amenity"="telephone"]["booth"~"K6",i](${bbox});
  node["amenity"="telephone"]["design"~"K6",i](${bbox});
  node["amenity"="telephone"]["colour"~"red",i](${bbox});
  node["disused:amenity"="telephone"]["booth"~"K6",i](${bbox});
  node["disused:amenity"="telephone"]["colour"~"red",i](${bbox});
);
out body 500;`;
}

export const PRESETS: PresetDefinition[] = [
  {
    id: "k6",
    label: "K6 Telephone Kiosks",
    defaultRadius: 200,
    countNoun: "kiosks",
    buildQuery: k6Query,
    fallbackName: (osmId) => `K6 Kiosk — ${osmId}`,
  },
];

export function getPreset(id: string): PresetDefinition | null {
  return PRESETS.find((p) => p.id === id) ?? null;
}
