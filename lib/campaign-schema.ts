// Shared, secret-free campaign validation used by BOTH the client form
// (for instant feedback) and the server action (the authority). Keep it
// free of any Node/Supabase imports so it can run in the browser too.

export type CampaignInput = {
  slug: string;
  artist_name: string;
  title: string;
  description: string;
  // Legacy single-location fields — still used by the admin form, which
  // writes them to a campaign_locations row (never to campaign columns).
  location_name?: string;
  lat?: string; // kept as strings from the form; parsed here
  lng?: string;
  radius_m?: string;
  reward_teaser: string;
  reward_content_url: string;
  discount_code: string;
  ticket_url: string;
  starts_at: string; // ISO string
  ends_at: string; // ISO string
  is_active: boolean;
  // "After it ends" customisation — all optional; blank means fans who
  // arrive late see the default expired copy.
  expired_headline?: string;
  expired_message?: string;
  expired_link_url?: string;
  expired_link_label?: string;
};

export type LocationRowInput = {
  id?: string;
  location_name: string;
  lat: string;
  lng: string;
  radius_m: string;
};

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const RADIUS_WARN_BELOW = 150;
export const RADIUS_STRONG_WARN_BELOW = 100;
export const MIN_RADIUS_M = 50;
export const DEFAULT_RADIUS_M = 200;

// Turn "Test Band" + "London" into "test-band-london".
export function suggestSlug(artist: string, city: string): string {
  return [artist, city]
    .join(" ")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// Campaign fields other than location. Slug *uniqueness* is checked in the
// server action (needs the database); everything else lives here.
export function validateCampaignCore(
  input: CampaignInput
): Record<string, string> {
  const errors: Record<string, string> = {};
  // ticket_url is optional — when present it powers the "Get tickets" call
  // to action on the unlocked state; when absent the button is simply
  // hidden. Format is still validated below whenever a value is given.
  const required: [keyof CampaignInput, string][] = [
    ["slug", "Slug is required."],
    ["artist_name", "Artist name is required."],
    ["title", "Title is required."],
  ];
  for (const [field, message] of required) {
    if (!String(input[field] ?? "").trim()) errors[field] = message;
  }

  if (input.slug && !SLUG_RE.test(input.slug)) {
    errors.slug =
      "Use lowercase letters, numbers and hyphens only (e.g. test-band-london).";
  }

  if (input.ticket_url && !isValidHttpUrl(input.ticket_url)) {
    errors.ticket_url = "Enter a valid URL starting with http:// or https://.";
  }
  if (input.reward_content_url && !isValidHttpUrl(input.reward_content_url)) {
    errors.reward_content_url =
      "Enter a valid URL starting with http:// or https://.";
  }

  const expiredUrl = (input.expired_link_url ?? "").trim();
  if (expiredUrl && !isValidHttpUrl(expiredUrl)) {
    errors.expired_link_url =
      "Enter a valid URL starting with http:// or https://.";
  }
  // A URL with no label would render an unlabelled button — require both.
  if (expiredUrl && !(input.expired_link_label ?? "").trim()) {
    errors.expired_link_label = "Add a label for the link button.";
  }

  const starts = Date.parse(input.starts_at);
  const ends = Date.parse(input.ends_at);
  if (Number.isNaN(starts)) errors.starts_at = "Start date/time is required.";
  if (Number.isNaN(ends)) errors.ends_at = "End date/time is required.";
  if (!Number.isNaN(starts) && !Number.isNaN(ends) && ends <= starts) {
    errors.ends_at = "End must be after the start.";
  }

  return errors;
}

// One location's fields. Returns errors keyed location_name/lat/lng/radius_m.
export function validateLocationRow(
  row: Pick<LocationRowInput, "location_name" | "lat" | "lng" | "radius_m">
): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!row.location_name.trim()) {
    errors.location_name = "Location name is required.";
  }

  const lat = Number(row.lat);
  if (row.lat.trim() === "" || Number.isNaN(lat)) {
    errors.lat = "Latitude is required.";
  } else if (lat < -90 || lat > 90) {
    errors.lat = "Latitude must be between -90 and 90.";
  }

  const lng = Number(row.lng);
  if (row.lng.trim() === "" || Number.isNaN(lng)) {
    errors.lng = "Longitude is required.";
  } else if (lng < -180 || lng > 180) {
    errors.lng = "Longitude must be between -180 and 180.";
  }

  const radius = Number(row.radius_m);
  if (row.radius_m.trim() === "" || !Number.isInteger(radius) || radius < MIN_RADIUS_M) {
    errors.radius_m = `Radius must be a whole number of at least ${MIN_RADIUS_M}m.`;
  }

  return errors;
}

// Campaign + single-location validation, used by the admin form.
export function validateCampaign(
  input: CampaignInput
): Record<string, string> {
  const locationErrors = validateLocationRow({
    location_name: input.location_name ?? "",
    lat: input.lat ?? "",
    lng: input.lng ?? "",
    radius_m: input.radius_m ?? "",
  });
  return { ...validateCampaignCore(input), ...locationErrors };
}
