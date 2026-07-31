import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { Delivery } from '@/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Search, PenLine, Camera, ShieldCheck } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const fmtTime = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString('fr-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '';

export const DeliveryProofsPanel = (): JSX.Element => {
  const { token } = useAuth();
  const [search, setSearch] = useState('');
  const [proofs, setProofs] = useState<Delivery[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<Delivery | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      axios.get<Delivery[]>(`${API}/deliveries/proofs?client=${encodeURIComponent(search)}`, { headers: { Authorization: `Bearer ${token ?? ''}` } })
        .then((r) => setProofs(r.data))
        .catch(() => setProofs([]))
        .finally(() => setLoaded(true));
    }, 350);
    return () => window.clearTimeout(t);
  }, [search, token]);

  return (
    <div data-testid="proofs-panel">
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
        <h2 className="font-heading text-base font-bold text-slate-900 mb-1 inline-flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-bronze-600" /> Historique des preuves de livraison
        </h2>
        <p className="text-xs text-slate-500 mb-4">
          Recherchez par client pour retrouver instantanément la preuve (photo ou signature) en cas de litige.
        </p>
        <div className="relative max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            data-testid="proofs-search-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nom du client — ex. Sirois"
            className="pl-9"
          />
        </div>
      </div>

      {!loaded ? (
        <p className="text-sm text-slate-400">Chargement…</p>
      ) : proofs.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
          <p data-testid="proofs-empty" className="text-sm text-slate-500">
            {search ? `Aucune preuve trouvée pour « ${search} ».` : 'Aucune livraison avec preuve pour l\'instant — les preuves apparaîtront ici dès que les livreurs en ajouteront.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {proofs.map((d) => (
            <button
              key={d.id}
              data-testid={`proof-history-card-${d.id}`}
              onClick={() => setView(d)}
              className="bg-white rounded-xl border border-slate-200 p-4 text-left hover:border-bronze-300 transition-colors"
            >
              {d.proof_image && (
                <img src={d.proof_image} alt={`Preuve — ${d.client_name}`} className="w-full h-28 object-cover rounded-lg border border-slate-100 mb-3" />
              )}
              <div className="flex items-center gap-2 mb-1">
                <p className="font-heading font-bold text-slate-900 text-sm">{d.client_name}</p>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${d.proof_type === 'signature' ? 'bg-bronze-100 text-bronze-800' : 'bg-sky-100 text-sky-800'}`}>
                  {d.proof_type === 'signature' ? <PenLine className="w-2.5 h-2.5" /> : <Camera className="w-2.5 h-2.5" />}
                  {d.proof_type === 'signature' ? 'Signature' : 'Photo'}
                </span>
              </div>
              <p className="text-xs text-slate-500">{d.address}</p>
              <p className="text-[11px] text-slate-400 mt-1">Livré {fmtTime(d.delivered_at)} · {d.courier_name}{d.order_ref ? ` · #${d.order_ref}` : ''}</p>
            </button>
          ))}
        </div>
      )}

      <Dialog open={view !== null} onOpenChange={(o) => !o && setView(null)}>
        <DialogContent data-testid="proof-history-view-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Preuve — {view?.client_name}</DialogTitle>
            <DialogDescription>
              {view?.proof_type === 'signature' ? 'Signature du client' : 'Photo prise à la livraison'} · livré {fmtTime(view?.delivered_at ?? null)} par {view?.courier_name}
            </DialogDescription>
          </DialogHeader>
          {view?.proof_image && (
            <img src={view.proof_image} alt="Preuve de livraison" className="w-full rounded-lg border border-slate-200" />
          )}
          <p className="text-xs text-slate-500">{view?.address}{view?.order_ref ? ` · Commande #${view.order_ref}` : ''}</p>
        </DialogContent>
      </Dialog>
    </div>
  );
};
