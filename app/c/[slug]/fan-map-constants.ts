// Split out from fan-map.tsx so fan-page.tsx can size the loading
// placeholder without a static import of anything Leaflet touches —
// importing so much as a constant from fan-map.tsx directly would pull its
// whole module, tile library included, into the main bundle ahead of the
// dynamic() boundary.
export const FAN_MAP_HEIGHT = 220;
