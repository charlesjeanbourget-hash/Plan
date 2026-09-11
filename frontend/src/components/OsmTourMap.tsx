import { useEffect, useRef } from 'react';
import { GeoPos } from '@/lib/osmRoute';

interface Props {
  points: GeoPos[];
  geometry: [number, number][];
}

export function OsmTourMap({ points, geometry }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || points.length === 0) return undefined;
    const w = window as Window & { L?: any };
    const draw = (): void => {
      const L = w.L;
      if (!L || !el) return;
      el.innerHTML = '';
      const map = L.map(el, { scrollWheelZoom: false });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19,
      }).addTo(map);
      const latlngs = (geometry.length ? geometry : points.map((p) => [p.lat, p.lng])) as [number, number][];
      if (latlngs.length) {
        L.polyline(latlngs, { color: '#059669', weight: 4, opacity: 0.85 }).addTo(map);
        map.fitBounds(L.latLngBounds(latlngs), { padding: [24, 24] });
      }
      points.forEach((p, i) => {
        L.circleMarker([p.lat, p.lng], {
          radius: 8,
          color: i === 0 ? '#059669' : '#c2410c',
          fillColor: i === 0 ? '#10b981' : '#f59e0b',
          fillOpacity: 1,
        }).addTo(map).bindPopup(`${i === 0 ? 'Départ' : `#${i}`} — ${p.label}`);
      });
    };
    if (w.L) {
      draw();
      return undefined;
    }
    if (!document.getElementById('ap-leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'ap-leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s.onload = draw;
    document.body.appendChild(s);
    return undefined;
  }, [points, geometry]);

  return <div ref={ref} data-testid="osm-tour-map" className="w-full h-56 rounded-xl border border-slate-200 overflow-hidden z-0" />;
}
