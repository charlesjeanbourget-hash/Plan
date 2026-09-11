import { GeoPos, OptimizedTour } from '@/lib/osmRoute';

export const GRAPHHOPPER_KEY =
  process.env.REACT_APP_GRAPHHOPPER_API_KEY || process.env.REACT_APP_GRAPHHOPPER_KEY || '';

export const hasGraphHopper = (): boolean => GRAPHHOPPER_KEY.length > 8;

interface GhPath {
  distance: number;
  time: number;
  points?: { coordinates?: [number, number][] };
}

export async function optimizeTourGraphHopper(points: GeoPos[]): Promise<OptimizedTour | null> {
  if (!hasGraphHopper() || points.length < 2) return null;
  const qs = new URLSearchParams({
    profile: 'car',
    locale: 'fr',
    points_encoded: 'false',
    instructions: 'false',
    optimize: points.length > 2 ? 'true' : 'false',
    key: GRAPHHOPPER_KEY,
  });
  points.forEach((p) => qs.append('point', `${p.lat},${p.lng}`));
  const res = await fetch(`https://graphhopper.com/api/1/route?${qs.toString()}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { paths?: GhPath[] };
  const path = data.paths?.[0];
  if (!path) return null;
  const coords = path.points?.coordinates ?? [];
  return {
    order: points.map((_, i) => i),
    totalKm: Math.round((path.distance / 1000) * 10) / 10,
    totalMin: Math.round(path.time / 60000),
    geometry: coords.map(([lng, lat]) => [lat, lng] as [number, number]),
    legs: [],
  };
}
