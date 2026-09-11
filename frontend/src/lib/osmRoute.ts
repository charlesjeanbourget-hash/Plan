export interface GeoPos { lat: number; lng: number; label: string }

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OSRM = 'https://router.project-osrm.org';

const headers = { Accept: 'application/json' };

export async function geocodeOsm(query: string): Promise<GeoPos | null> {
  const q = query.trim();
  if (q.length < 4) return null;
  const url = `${NOMINATIM}?format=json&limit=1&countrycodes=ca&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers });
  if (!res.ok) return null;
  const data = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  if (!data[0]) return null;
  return { lat: Number(data[0].lat), lng: Number(data[0].lon), label: data[0].display_name };
}

export async function suggestOsm(query: string): Promise<GeoPos[]> {
  const q = query.trim();
  if (q.length < 5) return [];
  const url = `${NOMINATIM}?format=json&limit=5&countrycodes=ca&addressdetails=0&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers });
  if (!res.ok) return [];
  const data = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  return data.map((d) => ({ lat: Number(d.lat), lng: Number(d.lon), label: d.display_name }));
}

export interface OptimizedLeg {
  index: number;
  km: number;
  minutes: number;
}

export interface OptimizedTour {
  order: number[];
  totalKm: number;
  totalMin: number;
  geometry: [number, number][];
  legs: OptimizedLeg[];
}

interface OsrmTrip {
  code?: string;
  trips?: { distance: number; duration: number; geometry?: { coordinates?: [number, number][] } }[];
  waypoints?: { waypoint_index: number; trips_index: number }[];
}

export async function optimizeTourOsm(points: GeoPos[]): Promise<OptimizedTour | null> {
  if (points.length < 2) return null;
  const coords = points.map((p) => `${p.lng},${p.lat}`).join(';');
  const url = `${OSRM}/trip/v1/driving/${coords}?source=first&destination=last&roundtrip=false&geometries=geojson&overview=full`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as OsrmTrip;
  if (data.code !== 'Ok' || !data.trips?.[0]) return fallbackNearest(points);
  const trip = data.trips[0];
  const order = (data.waypoints ?? []).map((w) => w.waypoint_index);
  const raw = trip.geometry?.coordinates ?? [];
  return {
    order: order.length ? order : points.map((_, i) => i),
    totalKm: Math.round((trip.distance / 1000) * 10) / 10,
    totalMin: Math.round(trip.duration / 60),
    geometry: raw.map(([lng, lat]) => [lat, lng] as [number, number]),
    legs: [],
  };
}

function haversineKm(a: GeoPos, b: GeoPos): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function fallbackNearest(points: GeoPos[]): OptimizedTour {
  const used = new Set<number>([0]);
  const order = [0];
  let total = 0;
  while (order.length < points.length) {
    const last = points[order[order.length - 1]];
    let best = -1;
    let bestD = Infinity;
    points.forEach((p, i) => {
      if (used.has(i)) return;
      const d = haversineKm(last, p) * 1.3;
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best < 0) break;
    used.add(best);
    order.push(best);
    total += bestD;
  }
  return {
    order,
    totalKm: Math.round(total * 10) / 10,
    totalMin: Math.round(total * 2.2),
    geometry: order.map((i) => [points[i].lat, points[i].lng] as [number, number]),
    legs: [],
  };
}

export function osmDirectionsUrl(points: GeoPos[]): string {
  if (points.length === 0) return 'https://www.openstreetmap.org';
  const last = points[points.length - 1];
  return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${points.map((p) => `${p.lat},${p.lng}`).join(';')}#map=12/${last.lat}/${last.lng}`;
}
