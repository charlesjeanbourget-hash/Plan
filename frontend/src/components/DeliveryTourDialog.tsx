import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Route, MapPin, ExternalLink, AlertTriangle } from 'lucide-react';
import { directionsEmbedUrl, hasGoogleMapsKey, mapsSearchUrl } from '@/lib/googleMaps';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

interface TourStop {
  delivery_id: string;
  client_name: string;
  address: string;
  priority: 'normal' | 'urgent';
  status: string;
  leg_km: number | null;
  located: boolean;
}

interface TourData {
  start_address: string;
  stops: TourStop[];
  total_km: number;
  maps_url: string;
}

export const DeliveryTourDialog = ({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element => {
  const { token } = useAuth();
  const [tour, setTour] = useState<TourData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setTour(null);
    axios.get<TourData>(`${API}/deliveries/route`, { headers: { Authorization: `Bearer ${token ?? ''}` } })
      .then((r) => setTour(r.data))
      .catch(() => setTour(null))
      .finally(() => setLoading(false));
  }, [open, token]);

  const unlocated = tour?.stops.filter((s) => !s.located) ?? [];
  const embed = tour && hasGoogleMapsKey()
    ? directionsEmbedUrl(tour.start_address, tour.stops.filter((s) => s.address).map((s) => s.address))
    : '';

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="tour-dialog" className="max-h-[85vh] overflow-y-auto max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading inline-flex items-center gap-2">
            <Route className="w-4 h-4 text-bronze-600" /> Ma tournée du jour
          </DialogTitle>
          <DialogDescription>
            Trajet Google Maps : urgences d’abord, kilomètres additionnés, carte intégrée.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-slate-500 py-4 text-center">Calcul de votre tournée en cours…</p>
        ) : !tour || tour.stops.length === 0 ? (
          <p data-testid="tour-empty" className="text-sm text-slate-500 py-4 text-center">Aucune livraison en cours — rien à planifier.</p>
        ) : (
          <>
            {embed ? (
              <iframe
                title="Tournée Google Maps"
                data-testid="tour-maps-embed"
                src={embed}
                className="w-full h-56 rounded-xl border border-slate-200"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            ) : (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Ajoutez <code>REACT_APP_GOOGLE_MAPS_API_KEY</code> (Directions + Places + Embed) pour afficher la carte ici.
              </p>
            )}
            <div className="flex items-start gap-2.5">
              <span className="w-7 h-7 rounded-full bg-emerald-600 text-white text-xs font-bold flex items-center justify-center shrink-0">D</span>
              <div>
                <p className="text-sm font-semibold text-slate-800">Départ — Pharmacie</p>
                <a className="text-xs text-emerald-700 hover:underline" href={mapsSearchUrl(tour.start_address)} target="_blank" rel="noreferrer">{tour.start_address}</a>
              </div>
            </div>
            <div className="space-y-3 border-l-2 border-dashed border-slate-200 ml-3.5 pl-6 py-1">
              {tour.stops.map((s, i) => (
                <div key={s.delivery_id} data-testid={`tour-stop-${i + 1}`} className="relative">
                  <span className="absolute -left-[38px] top-0 w-7 h-7 rounded-full bg-bronze-600 text-white text-xs font-bold flex items-center justify-center">{i + 1}</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-slate-800">{s.client_name}</p>
                    {s.priority === 'urgent' && <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700">URGENT</span>}
                    {s.leg_km !== null && <span className="text-xs font-bold text-bronze-700">+{s.leg_km} km</span>}
                  </div>
                  <a href={mapsSearchUrl(s.address)} target="_blank" rel="noreferrer" className="text-xs text-emerald-700 hover:underline inline-flex items-start gap-1">
                    <MapPin className="w-3 h-3 mt-0.5 shrink-0" /> {s.address}
                  </a>
                  {!s.located && (
                    <p className="text-[11px] text-amber-700 inline-flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Adresse non localisée — placée en fin de tournée
                    </p>
                  )}
                </div>
              ))}
            </div>
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 flex items-center justify-between">
              <p className="text-sm font-bold text-slate-800">Distance totale estimée</p>
              <p data-testid="tour-total-km" className="text-lg font-extrabold text-emerald-700">≈ {tour.total_km} km</p>
            </div>
            {unlocated.length > 0 && (
              <p className="text-[11px] text-slate-400">Le total exclut {unlocated.length} adresse(s) non localisée(s).</p>
            )}
            <Button asChild data-testid="tour-maps-link" className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              <a href={tour.maps_url} target="_blank" rel="noreferrer">
                <ExternalLink className="w-4 h-4 mr-1.5" /> Ouvrir l'itinéraire complet dans Google Maps
              </a>
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
