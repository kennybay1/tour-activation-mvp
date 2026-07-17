// Shared, secret-free campaign validation used by BOTH the client form
// (for instant feedback) and the server action (the authority). Keep it
// free of any Node/Supabase imports so it can run in the browser too.

export type CampaignInput = {
  slug: string;
  artist_name: string;
  title: string;
  description: string;
  location_name: string;
  lat: string; // kept as strings from the form; parsed here
  lng: string;
  radius_m: string;
  reward_teaser: string;
  reward_content_url: string;
  discount_code: string;
  ticket_url: string;
  starts_at: string; // ISO string
  ends_at: string; // ISO string
  is_active: boolean;
};

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const RADIUS_WARN_BELOW = 150;
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

// Pure field validation. Slug *uniqueness* is checked in the server action
// (needs the database); everything else lives here.
export function validateCampaign(
  input: CampaignInput
): Record<string, string> {
  const errors: Record<string, string> = {};
  const required: [keyof CampaignInput, string][] = [
    ["slug", "Slug is required."],
    ["artist_name", "Artist name is required."],
    ["title", "Title is required."],
    ["location_name", "Location name is required."],
    ["ticket_url", "Ticket URL is required."],
  ];
  for (const [field, message] of required) {
    if (!String(input[field] ?? "").trim()) errors[field] = message;
  }

  if (input.slug && !SLUG_RE.test(input.slug)) {
    errors.slug =
      "Use lowercase letters, numbers and hyphens only (e.g. test-band-london).";
  }

  const lat = Number(input.lat);
  if (input.lat.trim() === "" || Number.isNaN(lat)) {
    errors.lat = "Latitude is required.";
  } else if (lat < -90 || lat > 90) {
    errors.lat = "Latitude must be between -90 and 90.";
  }

  const lng = Number(input.lng);
  if (input.lng.trim() === "" || Number.isNaN(lng)) {
    errors.lng = "Longitude is required.";
  } else if (lng < -180 || lng > 180) {
    errors.lng = "Longitude must be between -180 and 180.";
  }

  const radius = Number(input.radius_m);
  if (input.radius_m.trim() === "" || !Number.isInteger(radius) || radius <= 0) {
    errors.radius_m = "Radius must be a whole number of metres.";
  }

  if (input.ticket_url && !isValidHttpUrl(input.ticket_url)) {
    errors.ticket_url = "Enter a valid URL starting with http:// or https://.";
  }
  if (input.reward_content_url && !isValidHttpUrl(input.reward_content_url)) {
    errors.reward_content_url =
      "Enter a valid URL starting with http:// or https://.";
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
