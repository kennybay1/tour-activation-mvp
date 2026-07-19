export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// For the live, client-side distance display only — coarser than raw GPS
// noise deserves, and coarser again once far away where precision doesn't
// matter to a fan deciding which way to walk.
export function roundLiveDistance(m: number): number {
  if (m < 200) return Math.round(m / 10) * 10;
  return Math.round(m / 50) * 50;
}

// Human-readable distance for the "closest spot" line. A fan can open the
// page from anywhere — across town or another country — so this has to
// degrade gracefully into kilometres rather than printing "342550m".
export function formatApproxDistance(m: number): string {
  if (m < 1000) return `${roundLiveDistance(m)}m`;
  if (m < 10000) return `${(m / 1000).toFixed(1)}km`;
  return `${Math.round(m / 1000)}km`;
}
