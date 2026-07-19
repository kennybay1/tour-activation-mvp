// The single home of preset-scan definitions. Adding a new preset type
// later means adding one entry here — the /api/presets/query route and the
// map-builder scan UI both render generically from this list and need no
// changes. Kept free of server-only imports on purpose: the UI reads
// id/label/defaultRadius from the same module, and the Overpass query text
// is not a secret.
//
// Query conventions every preset follows:
// - `nwr` (node/way/relation) clauses, so mapped buildings and areas match
//   as well as point nodes; `out center` gives ways/relations a centroid.
// - The out statement asks for DENSITY_LIMIT + 1 elements — the route uses
//   the overflow to detect an over-dense viewport and tells the client to
//   zoom in rather than flooding the map.

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
  // Dormant-marker accent so mixed layers stay tellable-apart on the map.
  markerColor: string;
  buildQuery: (b: PresetBounds) => string;
  // Display name for a node whose OSM tags carry no name.
  fallbackName: (osmId: number) => string;
};

// Viewports larger than this are rejected server-side and pre-checked
// client-side (to skip the pointless request entirely) — one shared cap.
export const MAX_PRESET_AREA_KM2 = 100;

// Per-preset density guard: more than this many results in one viewport
// means "zoom in", not "render them all". Stations and places of worship
// hit this in city centres by design.
export const PRESET_DENSITY_LIMIT = 200;

export function boundsAreaKm2(b: PresetBounds): number {
  const KM_PER_DEG = 111.32;
  const heightKm = (b.north - b.south) * KM_PER_DEG;
  const midLatRad = ((b.north + b.south) / 2) * (Math.PI / 180);
  const widthKm = (b.east - b.west) * KM_PER_DEG * Math.cos(midLatRad);
  return heightKm * widthKm;
}

function bboxOf(b: PresetBounds): string {
  return `${b.south},${b.west},${b.north},${b.east}`;
}

// Wrap one or more nwr clauses in the standard query envelope.
function overpass(clauses: (bbox: string) => string[]): (b: PresetBounds) => string {
  return (b) => {
    const bbox = bboxOf(b);
    return `[out:json][timeout:10];
(
${clauses(bbox)
  .map((c) => `  ${c}`)
  .join("\n")}
);
out center ${PRESET_DENSITY_LIMIT + 1};`;
  };
}

// Ordering here IS the menu ordering — the scan UI renders this list as-is.
export const PRESETS: PresetDefinition[] = [
  {
    id: "k6",
    label: "K6 Telephone Kiosks",
    defaultRadius: 200,
    countNoun: "kiosks",
    markerColor: "#b0603a",
    // The corrected K6 tag matching, verified to return 409 nodes across
    // London — do not modify the tag clauses.
    buildQuery: overpass((bbox) => [
      `nwr["amenity"="telephone"]["booth"~"K6",i](${bbox});`,
      `nwr["amenity"="telephone"]["design"~"K6",i](${bbox});`,
      `nwr["amenity"="telephone"]["colour"~"red",i](${bbox});`,
      `nwr["disused:amenity"="telephone"]["booth"~"K6",i](${bbox});`,
      `nwr["disused:amenity"="telephone"]["colour"~"red",i](${bbox});`,
    ]),
    fallbackName: (osmId) => `K6 Kiosk — ${osmId}`,
  },
  {
    id: "plaques",
    label: "Blue & Memorial Plaques",
    defaultRadius: 100,
    countNoun: "plaques",
    markerColor: "#1d4ed8",
    buildQuery: overpass((bbox) => [
      `nwr["memorial"~"^(plaque|blue_plaque)$",i](${bbox});`,
    ]),
    fallbackName: (osmId) => `Plaque — ${osmId}`,
  },
  {
    id: "record_shops",
    label: "Independent Record Shops",
    defaultRadius: 150,
    countNoun: "record shops",
    markerColor: "#7c3aed",
    buildQuery: overpass((bbox) => [`nwr["shop"="music"](${bbox});`]),
    fallbackName: (osmId) => `Record Shop — ${osmId}`,
  },
  {
    id: "music_venues",
    label: "Music Venues",
    defaultRadius: 200,
    countNoun: "venues",
    markerColor: "#db2777",
    buildQuery: overpass((bbox) => [`nwr["amenity"="music_venue"](${bbox});`]),
    fallbackName: (osmId) => `Music Venue — ${osmId}`,
  },
  {
    id: "stations",
    label: "Rail & Tube Stations",
    // Indoors and underground, GPS is unreliable — the larger radius stops
    // genuine fans at the platform being rejected.
    defaultRadius: 250,
    countNoun: "stations",
    markerColor: "#0f766e",
    buildQuery: overpass((bbox) => [
      `nwr["railway"="station"](${bbox});`,
      `nwr["station"="subway"](${bbox});`,
    ]),
    fallbackName: (osmId) => `Station — ${osmId}`,
  },
  {
    id: "sacred_spaces",
    label: "Churches & Sacred Spaces",
    defaultRadius: 250,
    countNoun: "places of worship",
    markerColor: "#6d28d9",
    buildQuery: overpass((bbox) => [
      `nwr["amenity"="place_of_worship"](${bbox});`,
    ]),
    fallbackName: (osmId) => `Place of Worship — ${osmId}`,
  },
  {
    id: "bridges",
    label: "Named Bridges",
    defaultRadius: 150,
    countNoun: "bridges",
    markerColor: "#475569",
    // The name requirement is deliberate — unnamed road bridges would
    // flood the layer with noise. Do not remove it.
    buildQuery: overpass((bbox) => [
      `nwr["man_made"="bridge"]["name"](${bbox});`,
    ]),
    fallbackName: (osmId) => `Bridge — ${osmId}`,
  },
  {
    id: "public_art",
    label: "Public Art & Murals",
    defaultRadius: 150,
    countNoun: "artworks",
    markerColor: "#ea580c",
    buildQuery: overpass((bbox) => [`nwr["tourism"="artwork"](${bbox});`]),
    fallbackName: (osmId) => `Artwork — ${osmId}`,
  },
  {
    id: "ancient_monuments",
    label: "Ancient Monuments",
    defaultRadius: 200,
    countNoun: "monuments",
    markerColor: "#92400e",
    buildQuery: overpass((bbox) => [
      `nwr["historic"="archaeological_site"](${bbox});`,
    ]),
    fallbackName: (osmId) => `Ancient Monument — ${osmId}`,
  },
  {
    id: "heritage_trees",
    label: "Heritage Trees",
    defaultRadius: 100,
    countNoun: "trees",
    markerColor: "#15803d",
    buildQuery: overpass((bbox) => [
      `nwr["natural"="tree"]["denotation"~"natural_monument|heritage|memorial",i](${bbox});`,
    ]),
    fallbackName: (osmId) => `Heritage Tree — ${osmId}`,
  },
  {
    id: "post_boxes",
    label: "Post Boxes",
    defaultRadius: 100,
    countNoun: "post boxes",
    markerColor: "#dc2626",
    buildQuery: overpass((bbox) => [`nwr["amenity"="post_box"](${bbox});`]),
    fallbackName: (osmId) => `Post Box — ${osmId}`,
  },
  {
    id: "viewpoints",
    label: "Viewpoints",
    defaultRadius: 150,
    countNoun: "viewpoints",
    markerColor: "#0891b2",
    buildQuery: overpass((bbox) => [`nwr["tourism"="viewpoint"](${bbox});`]),
    fallbackName: (osmId) => `Viewpoint — ${osmId}`,
  },
];

export function getPreset(id: string): PresetDefinition | null {
  return PRESETS.find((p) => p.id === id) ?? null;
}
