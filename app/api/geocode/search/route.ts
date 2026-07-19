import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Nominatim is a shared free community resource with a strict usage
// policy — this route exists so the browser never calls it directly (it
// can't set a User-Agent anyway), and so identical searches are served
// from cache instead of re-querying.
export const maxDuration = 15;

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_TIMEOUT_MS = 8_000;
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const USER_AGENT =
  "Moments (geo-fenced fan engagement platform; contact: kennybay@hotmail.co.uk)";

type GeocodeResult = {
  display_name: string;
  name: string;
  lat: number;
  lng: number;
  // Nominatim's native order: [minLat, maxLat, minLon, maxLon].
  boundingbox: [number, number, number, number] | null;
  type: string;
};

type GeocodeResponse = { results: GeocodeResult[] } | { error: string };

const UK_POSTCODE_RE = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/i;

function matchUkPostcode(q: string): string | null {
  const m = q.trim().match(UK_POSTCODE_RE);
  return m ? `${m[1]} ${m[2]}`.toUpperCase() : null;
}

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

// Free, keyless and far more accurate than Nominatim for UK postcodes.
// Returns null on any non-success (404 or otherwise) so the caller falls
// through to Nominatim, per spec.
async function tryPostcode(postcode: string): Promise<GeocodeResult[] | null> {
  try {
    const res = await fetch(
      `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`
    );
    if (!res.ok) return null;
    const json = await res.json();
    if (json.status !== 200 || !json.result) return null;
    const r = json.result;
    return [
      {
        display_name: r.postcode,
        name: r.postcode,
        lat: r.latitude,
        lng: r.longitude,
        boundingbox: null,
        type: "postcode",
      },
    ];
  } catch {
    return null;
  }
}

// Best-effort, in-process throttle — serialises Nominatim calls at least
// 1s apart within a warm serverless instance, per Nominatim's usage
// policy. Combined with the 24h cache and organiser-only auth gate, real
// upstream call volume stays low regardless.
let lastNominatimCallAt = 0;
async function throttleNominatim() {
  const wait = lastNominatimCallAt + 1000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatimCallAt = Date.now();
}

type NominatimResult = {
  display_name: string;
  name?: string;
  lat: string;
  lon: string;
  boundingbox?: string[];
  type: string;
};

export async function GET(
  req: NextRequest
): Promise<NextResponse<GeocodeResponse>> {
  // Organiser-only — never exposed to anonymous fan-facing traffic.
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const q = searchParams.get("q")?.trim() ?? "";
  if (!q || q.length > 200) {
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  }

  // 1. UK postcode path.
  const postcode = matchUkPostcode(q);
  if (postcode) {
    const results = await tryPostcode(postcode);
    if (results) return NextResponse.json({ results });
    // Falls through to Nominatim below on a 404 or any other failure.
  }

  // 2. Cache first — never hit Nominatim for a query we already have.
  const db = supabaseAdmin();
  const cacheKey = `nominatim:${normalizeQuery(q)}`;
  const { data: cached } = await db
    .from("preset_cache")
    .select("payload, created_at")
    .eq("query_key", cacheKey)
    .maybeSingle();
  if (
    cached &&
    Date.now() - new Date(cached.created_at).getTime() < CACHE_MAX_AGE_MS
  ) {
    return NextResponse.json({ results: cached.payload as GeocodeResult[] });
  }

  // 3. Nominatim, biased to the client's current map view. Accepts either
  // a full viewbox (preferred — built from map.getBounds()) or a plain
  // lat/lng, padded into a small viewbox as a fallback.
  const minLat = parseFloat(searchParams.get("minLat") ?? "");
  const minLng = parseFloat(searchParams.get("minLng") ?? "");
  const maxLat = parseFloat(searchParams.get("maxLat") ?? "");
  const maxLng = parseFloat(searchParams.get("maxLng") ?? "");
  let viewbox: string | null = null;
  if ([minLat, minLng, maxLat, maxLng].every(Number.isFinite)) {
    viewbox = `${minLng},${minLat},${maxLng},${maxLat}`;
  } else {
    const lat = parseFloat(searchParams.get("lat") ?? "");
    const lng = parseFloat(searchParams.get("lng") ?? "");
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const pad = 0.05;
      viewbox = `${lng - pad},${lat - pad},${lng + pad},${lat + pad}`;
    }
  }

  await throttleNominatim();

  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("q", q);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("accept-language", "en-GB");
  if (viewbox) {
    url.searchParams.set("viewbox", viewbox);
    url.searchParams.set("bounded", "0");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NOMINATIM_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json(
        { error: "The map search service is taking too long — try again." },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { error: "Couldn't reach the map search service. Try again shortly." },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeout);
  }

  if (res.status === 429) {
    return NextResponse.json(
      { error: "The map search service is busy — try again in a minute." },
      { status: 429 }
    );
  }
  if (!res.ok) {
    return NextResponse.json(
      { error: "The map search service returned an error. Try again shortly." },
      { status: 502 }
    );
  }

  let json: NominatimResult[];
  try {
    json = await res.json();
  } catch {
    return NextResponse.json(
      { error: "The map search service returned an unexpected response." },
      { status: 502 }
    );
  }

  const results: GeocodeResult[] = json.slice(0, 5).map((item) => ({
    display_name: item.display_name,
    name: item.name || item.display_name.split(",")[0].trim(),
    lat: parseFloat(item.lat),
    lng: parseFloat(item.lon),
    boundingbox: item.boundingbox
      ? (item.boundingbox.map(Number) as [number, number, number, number])
      : null,
    type: item.type,
  }));

  // Only successful, parsed responses are cached — a failure must never
  // poison the cache for the next attempt.
  await db.from("preset_cache").upsert(
    { query_key: cacheKey, payload: results, created_at: new Date().toISOString() },
    { onConflict: "query_key" }
  );

  return NextResponse.json({ results });
}
