import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getPreset, type PresetBounds } from "@/lib/preset-registry";

// Overpass' free instance is a shared community resource with an
// acceptable-use policy — this route exists so the browser never talks to
// it directly, and so overlapping viewport scans are served from cache
// instead of re-querying. Keep maxDuration in sync with the Overpass
// timeout below (10s) plus auth/cache overhead.
export const maxDuration = 15;

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const OVERPASS_TIMEOUT_MS = 10_000;
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
// A viewport much bigger than a city district returns too much to be
// useful and leans too hard on Overpass — the client shows "zoom in".
const MAX_AREA_KM2 = 100;

type PresetLocation = {
  lat: number;
  lng: number;
  location_name: string;
  external_ref: string;
  preset_id: string;
};

type PresetResponse =
  | { locations: PresetLocation[]; cached: boolean }
  | { error: string };

type OverpassElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
};

function isFiniteInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
}

function boundsAreaKm2(b: PresetBounds): number {
  const KM_PER_DEG = 111.32;
  const heightKm = (b.north - b.south) * KM_PER_DEG;
  const midLatRad = ((b.north + b.south) / 2) * (Math.PI / 180);
  const widthKm = (b.east - b.west) * KM_PER_DEG * Math.cos(midLatRad);
  return heightKm * widthKm;
}

// Round bounds OUTWARD to a 2-decimal-place grid (~1.1km). Scanning and
// caching the slightly larger quantized box means a small pan re-hits the
// cached superset instead of refetching from Overpass.
function quantizeOutward(b: PresetBounds): PresetBounds {
  return {
    south: Math.floor(b.south * 100) / 100,
    west: Math.floor(b.west * 100) / 100,
    north: Math.ceil(b.north * 100) / 100,
    east: Math.ceil(b.east * 100) / 100,
  };
}

export async function POST(
  req: NextRequest
): Promise<NextResponse<PresetResponse>> {
  // Organiser-only — never exposed to anonymous fan-facing traffic.
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { preset_id, bounds } = body as {
    preset_id?: unknown;
    bounds?: unknown;
  };

  const preset = typeof preset_id === "string" ? getPreset(preset_id) : null;
  if (!preset) {
    return NextResponse.json({ error: "unknown_preset" }, { status: 400 });
  }

  const b = (bounds ?? {}) as Record<string, unknown>;
  if (
    !isFiniteInRange(b.south, -90, 90) ||
    !isFiniteInRange(b.north, -90, 90) ||
    !isFiniteInRange(b.west, -180, 180) ||
    !isFiniteInRange(b.east, -180, 180) ||
    b.south >= b.north ||
    b.west >= b.east
  ) {
    return NextResponse.json({ error: "invalid_bounds" }, { status: 400 });
  }
  const rawBounds: PresetBounds = {
    south: b.south,
    west: b.west,
    north: b.north,
    east: b.east,
  };

  if (boundsAreaKm2(rawBounds) > MAX_AREA_KM2) {
    // Distinct code — the client shows "zoom in" rather than an error.
    return NextResponse.json({ error: "area_too_large" }, { status: 400 });
  }

  const q = quantizeOutward(rawBounds);
  const queryKey = `${preset.id}:bbox:${q.south.toFixed(2)}:${q.west.toFixed(2)}:${q.north.toFixed(2)}:${q.east.toFixed(2)}`;
  const db = supabaseAdmin();

  const { data: cached, error: cacheReadError } = await db
    .from("preset_cache")
    .select("payload, created_at")
    .eq("query_key", queryKey)
    .maybeSingle();
  if (cacheReadError) {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
  if (
    cached &&
    Date.now() - new Date(cached.created_at).getTime() < CACHE_MAX_AGE_MS
  ) {
    return NextResponse.json({
      locations: cached.payload as PresetLocation[],
      cached: true,
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);

  let overpassRes: Response;
  try {
    // The QUANTIZED bounds are what's actually queried — the cached payload
    // must cover the whole grid cell it's keyed by, not just this viewport.
    overpassRes = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": `Moments (geo-fenced fan engagement platform; contact: ${process.env.APP_CONTACT_EMAIL ?? "not-configured"})`,
      },
      body: `data=${encodeURIComponent(preset.buildQuery(q))}`,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json(
        { error: "The map data service is taking too long — try again in a minute." },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { error: "Couldn't reach the map data service. Try again shortly." },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeout);
  }

  if (overpassRes.status === 429) {
    return NextResponse.json(
      { error: "The map data service is busy — try again in a minute." },
      { status: 429 }
    );
  }
  if (overpassRes.status === 504 || overpassRes.status === 503) {
    return NextResponse.json(
      { error: "The map data service is overloaded — try again shortly." },
      { status: 504 }
    );
  }
  if (!overpassRes.ok) {
    return NextResponse.json(
      { error: "The map data service returned an error. Try again shortly." },
      { status: 502 }
    );
  }

  let json: { elements?: OverpassElement[] };
  try {
    json = await overpassRes.json();
  } catch {
    return NextResponse.json(
      { error: "The map data service returned an unexpected response." },
      { status: 502 }
    );
  }

  // The union query can match one node under several tag clauses —
  // deduplicate by OSM id.
  const byId = new Map<number, PresetLocation>();
  for (const el of json.elements ?? []) {
    if (el.type !== "node" || el.lat == null || el.lon == null) continue;
    if (byId.has(el.id)) continue;
    byId.set(el.id, {
      lat: el.lat,
      lng: el.lon,
      location_name: el.tags?.name ?? preset.fallbackName(el.id),
      external_ref: `osm:node:${el.id}`,
      preset_id: preset.id,
    });
  }
  const locations = Array.from(byId.values());

  // Only successful, parsed responses are cached — a failure must never
  // poison the cache for the next attempt.
  const { error: cacheWriteError } = await db
    .from("preset_cache")
    .upsert(
      { query_key: queryKey, payload: locations, created_at: new Date().toISOString() },
      { onConflict: "query_key" }
    );
  if (cacheWriteError) {
    // Non-fatal — the scan succeeded even if we couldn't cache it.
    console.error("preset_cache upsert failed:", cacheWriteError.message);
  }

  return NextResponse.json({ locations, cached: false });
}
