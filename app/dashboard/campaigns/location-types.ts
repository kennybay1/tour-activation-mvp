// Types and pure helpers shared between campaign-form.tsx (server-rendered)
// and location-builder.tsx (leaflet, browser-only). Keeping this file free
// of any leaflet import means campaign-form can use BuilderLocation and
// friends without pulling leaflet into the SSR bundle — only the dynamic()
// import of the map component itself is browser-only.

// One file or link on a reward. `file` is a freshly picked upload waiting for
// the next save; `storage_path` is one already in storage. Rows with an `id`
// already exist in reward_assets.
export type BuilderAsset = {
  id?: string;
  tempId: string;
  kind: "file" | "link";
  storage_path?: string | null;
  url?: string;
  label?: string;
  file?: File;
};

export const MAX_ASSETS_PER_REWARD = 12;

export type BuilderLocation = {
  id?: string;
  tempId: string;
  location_name: string;
  lat: number;
  lng: number;
  radius_m: number;
  sort_order: number;
  source: string;
  external_ref?: string | null;
  // Per-stop reward — used only by Journey campaigns. Optional on the type
  // so single-drop builders, older data, and the admin form need no change.
  reward_teaser?: string;
  discount_code?: string;
  ticket_url?: string;
  // Files and links for this stop, in display order.
  assets?: BuilderAsset[];
};

export const MAX_LOCATIONS = 100;
export const SOFT_WARN_LOCATIONS = 25;

export function makeTempId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `t-${Math.random().toString(36).slice(2)}`;
}
