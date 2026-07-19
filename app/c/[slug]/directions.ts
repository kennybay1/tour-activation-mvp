// Shared between fan-page.tsx (always loaded) and fan-map.tsx (dynamically
// loaded, Leaflet-only) — kept free of any Leaflet import so pulling it into
// the main bundle never drags the map library along with it.
export function directionsUrlFor(loc: { lat: number; lng: number }): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}`;
}
