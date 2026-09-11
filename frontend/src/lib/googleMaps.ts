export const GOOGLE_MAPS_KEY =
  process.env.REACT_APP_GOOGLE_MAPS_API_KEY
  || process.env.REACT_APP_GOOGLE_MAPS_KEY
  || '';

export const hasGoogleMapsKey = (): boolean => GOOGLE_MAPS_KEY.length > 20;

let loading: Promise<void> | null = null;

export function loadGoogleMaps(libraries = 'places'): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  const w = window as Window & { google?: { maps?: unknown } };
  if (w.google?.maps) return Promise.resolve();
  if (!hasGoogleMapsKey()) return Promise.reject(new Error('Clé Google Maps absente'));
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const existing = document.getElementById('ap-google-maps');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      return;
    }
    const s = document.createElement('script');
    s.id = 'ap-google-maps';
    s.async = true;
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_KEY)}&libraries=${libraries}&language=fr&region=CA`;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error('Chargement Google Maps impossible'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export function directionsEmbedUrl(origin: string, stops: string[]): string {
  if (!hasGoogleMapsKey() || stops.length === 0) return '';
  const dest = stops[stops.length - 1];
  const mid = stops.slice(0, -1);
  const params = new URLSearchParams({
    key: GOOGLE_MAPS_KEY,
    origin,
    destination: dest,
    mode: 'driving',
    language: 'fr',
  });
  if (mid.length) params.set('waypoints', mid.join('|'));
  return `https://www.google.com/maps/embed/v1/directions?${params.toString()}`;
}

export function mapsSearchUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}
