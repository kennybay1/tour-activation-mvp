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
