// Types and pure helpers shared between campaign-form.tsx (server-rendered)
// and location-builder.tsx (leaflet, browser-only). Keeping this file free
// of any leaflet import means campaign-form can use BuilderLocation and
// friends without pulling leaflet into the SSR bundle — only the dynamic()
// import of the map component itself is browser-only.

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
};

export const MAX_LOCATIONS = 100;
export const SOFT_WARN_LOCATIONS = 25;

export function makeTempId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `t-${Math.random().toString(36).slice(2)}`;
}
