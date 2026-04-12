export function buildDirectionsUrl(args: {
  destinationLat: number;
  destinationLng: number;
  originLat?: number;
  originLng?: number;
}): string {
  const { destinationLat, destinationLng, originLat, originLng } = args;

  if (typeof originLat === "number" && typeof originLng === "number") {
    return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${originLat}%2C${originLng}%3B${destinationLat}%2C${destinationLng}`;
  }

  return `https://www.openstreetmap.org/?mlat=${destinationLat}&mlon=${destinationLng}#map=16/${destinationLat}/${destinationLng}`;
}

export function normalizeQuery(q: string): string {
  return q
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}
