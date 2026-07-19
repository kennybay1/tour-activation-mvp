import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Overpass' free instance is a shared community resource with an
// acceptable-use policy — this route exists so the browser never talks to
// it directly, and so identical scans are served from cache instead of
// re-querying. Keep this in sync with the Vercel function config below.
export const maxDuration = 15;

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const OVERPASS_TIMEOUT_MS = 10_000;
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_RESULTS = 200;
const MIN_RADIUS = 100;
const MAX_RADIUS = 5000;

type Kiosk = {
  lat: number;
  lng: number;
  location_name: string;
  external_ref: string;
  design: string | null;
};

type PresetResponse = { locations: Kiosk[]; cached: boolean } | { error: string };

function overpassQuery(lat: number, lng: number, radius: number): string {
  return `[out:json][timeout:10];
(
  node["amenity"="telephone"]["design"~"^K[0-9]+$",i](around:${radius},${lat},${lng});
  node["disused:amenity"="telephone"]["design"~"^K[0-9]+$",i](around:${radius},${lat},${lng});
  node["amenity"="telephone"]["colour"~"red",i](around:${radius},${lat},${lng});
);
out body ${MAX_RESULTS};`;
}

type OverpassElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
};

function mapElements(elements: OverpassElement[]): Kiosk[] {
  const byId = new Map<number, Kiosk>();
  for (const el of elements) {
    if (el.type !== "node" || el.lat == null || el.lon == null) continue;
    if (byId.has(el.id)) continue;
    const tags = el.tags ?? {};
    const design = tags.design ?? null;
    const name =
      tags.name ??
      (design ? `${design} Kiosk — ${el.id}` : `Telephone Kiosk — ${el.id}`);
    byId.set(el.id, {
      lat: el.lat,
      lng: el.lon,
      location_name: name,
      external_ref: `osm:node:${el.id}`,
      design,
    });
    if (byId.size >= MAX_RESULTS) break;
  }
  return Array.from(byId.values());
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

  const { lat, lng, radius } = body as {
    lat?: unknown;
    lng?: unknown;
    radius?: unknown;
  };

  if (
    typeof lat !== "number" ||
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90
  ) {
    return NextResponse.json({ error: "invalid_lat" }, { status: 400 });
  }
  if (
    typeof lng !== "number" ||
    !Number.isFinite(lng) ||
    lng < -180 ||
    lng > 180
  ) {
    return NextResponse.json({ error: "invalid_lng" }, { status: 400 });
  }
  if (
    typeof radius !== "number" ||
    !Number.isInteger(radius) ||
    radius < MIN_RADIUS ||
    radius > MAX_RADIUS
  ) {
    return NextResponse.json({ error: "invalid_radius" }, { status: 400 });
  }

  const latR = lat.toFixed(3);
  const lngR = lng.toFixed(3);
  const queryKey = `k6:${latR}:${lngR}:${radius}`;
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
      locations: cached.payload as Kiosk[],
      cached: true,
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);

  let overpassRes: Response;
  try {
    overpassRes = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          "Moments (geo-fenced fan engagement platform; contact: kennybay@hotmail.co.uk)",
      },
      body: `data=${encodeURIComponent(overpassQuery(lat, lng, radius))}`,
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

  const locations = mapElements(json.elements ?? []);

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
