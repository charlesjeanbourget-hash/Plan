import { useState, useEffect, useCallback, FormEvent } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { useHR } from '@/context/HRContext';
import { Delivery } from '@/types';
import { ModuleHeader } from '@/components/modules/shared';
import { DeliveryProofDialog, DeliveryProof } from '@/components/DeliveryProofDialog';
import { DeliveryProofsPanel } from '@/components/DeliveryProofsPanel';
import { DeliveryTourDialog } from '@/components/DeliveryTourDialog';
import { MileagePanel } from '@/components/MileagePanel';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Truck, MapPin, Phone, Package, Trash2, CircleCheck, Navigation, Route, Store, ShieldCheck, Fuel } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const STATUS_META: Record<Delivery['status'], { label: string; cls: string }> = {
  a_ramasser: { label: 'À ramasser', cls: 'bg-bronze-100 text-bronze-800' },
  en_route: { label: 'En route', cls: 'bg-sky-100 text-sky-800' },
  livree: { label: 'Livrée', cls: 'bg-emerald-100 text-emerald-800' },
};

const mapsUrl = (address: string): string =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

const fmtTime = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString('fr-CA', { dateStyle: 'short', timeStyle: 'short' }) : '';

const apiError = (err: unknown): string => {
  if (axios.isAxiosError(err) && err.response) {
    const detail = (err.response.data as { detail?: unknown }).detail;
    if (typeof detail === 'string') return detail;
  }
  return 'Une erreur est survenue.';
};

export default function DeliveriesModule(): JSX.Element {
  const { token, currentUser } = useAuth();
  const { state } = useHR();
  const isManager = currentUser?.role !== 'employee';
  const headers = { Authorization: `Bearer ${token ?? ''}` };
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [view, setView] = useState<'list' | 'proofs' | 'mileage'>('list');
  const [createOpen, setCreateOpen] = useState(false);
  const [client, setClient] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [orderRef, setOrderRef] = useState('');
  const [products, setProducts] = useState('');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState('normal');
  const [courierId, setCourierId] = useState('');
  const [busy, setBusy] = useState(false);
  const [proofFor, setProofFor] = useState<Delivery | null>(null);
  const [proofBusy, setProofBusy] = useState(false);
  const [viewProof, setViewProof] = useState<Delivery | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const [addrOpen, setAddrOpen] = useState(false);
  const [pharmAddr, setPharmAddr] = useState('');
  const [addrBusy, setAddrBusy] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await axios.get<Delivery[]>(`${API}/deliveries`, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      setDeliveries(res.data);
    } catch {
      toast.error('Impossible de charger les livraisons.');
    }
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (isManager) return undefined;
    const id = window.setInterval(() => void refresh(), 20000);
    return () => window.clearInterval(id);
  }, [isManager, refresh]);

  useEffect(() => {
    if (!addrOpen) return;
    axios.get<{ address: string }>(`${API}/pharmacy/settings`, { headers: { Authorization: `Bearer ${token ?? ''}` } })
      .then((r) => setPharmAddr(r.data.address))
      .catch(() => undefined);
  }, [addrOpen, token]);

  const saveAddr = async (): Promise<void> => {
    if (!pharmAddr.trim()) {
      toast.error('Adresse requise.');
      return;
    }
    setAddrBusy(true);
    try {
      await axios.put(`${API}/pharmacy/settings`, { address: pharmAddr }, { headers });
      toast.success('Adresse de départ des tournées enregistrée.');
      setAddrOpen(false);
    } catch {
      toast.error('Enregistrement impossible.');
    } finally {
      setAddrBusy(false);
    }
  };

  const couriers = [...state.employees].filter((e) => e.status === 'Actif')
    .sort((a, b) => Number(b.position === 'Livreur(se)') - Number(a.position === 'Livreur(se)'));

  const submitCreate = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const emp = state.employees.find((x) => x.id === courierId);
    if (!emp) {
      toast.error('Choisissez un livreur.');
      return;
    }
    setBusy(true);
    try {
      const res = await axios.post<Delivery & { email_sent: boolean }>(`${API}/deliveries`, {
        client_name: client, address, phone, order_ref: orderRef, products, notes, priority,
        courier_employee_id: emp.id, courier_name: `${emp.firstName} ${emp.lastName}`,
      }, { headers });
      toast.success(res.data.email_sent
        ? `Livraison créée — directives envoyées par courriel à ${emp.firstName}.`
        : `Livraison créée et visible dans le compte de ${emp.firstName}.`);
      setCreateOpen(false);
      setClient(''); setAddress(''); setPhone(''); setOrderRef(''); setProducts(''); setNotes('');
      setPriority('normal'); setCourierId('');
      await refresh();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (d: Delivery, status: Delivery['status']): Promise<void> => {
    try {
      await axios.put(`${API}/deliveries/${d.id}/status`, { status }, { headers });
      toast.success(status === 'en_route' ? 'Colis ramassé — bonne route !' : 'Statut mis à jour.');
      await refresh();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const confirmDelivered = async (proof: DeliveryProof | null): Promise<void> => {
    if (!proofFor) return;
    setProofBusy(true);
    try {
      await axios.put(`${API}/deliveries/${proofFor.id}/status`, {
        status: 'livree', proof_image: proof?.image ?? '', proof_type: proof?.type ?? '',
      }, { headers });
      toast.success(proof ? 'Livraison confirmée avec preuve — merci !' : 'Livraison complétée, bravo !');
      setProofFor(null);
      await refresh();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setProofBusy(false);
    }
  };

  const remove = async (d: Delivery): Promise<void> => {
    try {
      await axios.delete(`${API}/deliveries/${d.id}`, { headers });
      toast.success('Livraison supprimée.');
      await refresh();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const order: Record<Delivery['status'], number> = { a_ramasser: 0, en_route: 1, livree: 2 };
  const sorted = [...deliveries].sort((a, b) =>
    order[a.status] - order[b.status]
    || Number(b.priority === 'urgent') - Number(a.priority === 'urgent')
    || b.created_at.localeCompare(a.created_at));
  const active = sorted.filter((d) => d.status !== 'livree');
  const done = sorted.filter((d) => d.status === 'livree').slice(0, 12);

  const card = (d: Delivery): JSX.Element => {
    const meta = STATUS_META[d.status];
    const mine = currentUser?.employeeId === d.courier_employee_id;
    return (
      <div key={d.id} data-testid={`delivery-card-${d.id}`} className={`bg-white rounded-xl border p-5 ${d.priority === 'urgent' && d.status !== 'livree' ? 'border-red-300' : 'border-slate-200'}`}>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${meta.cls}`} data-testid={`delivery-status-${d.id}`}>{meta.label}</span>
          {d.priority === 'urgent' && (
            <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700" data-testid={`delivery-urgent-${d.id}`}>URGENT</span>
          )}
          {d.order_ref && <span className="text-xs text-slate-400">#{d.order_ref}</span>}
          {isManager && (
            <button data-testid={`delivery-delete-${d.id}`} onClick={() => void remove(d)} className="ml-auto text-slate-300 hover:text-red-500 transition-colors" aria-label="Supprimer">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
        <p className="font-heading font-bold text-slate-900">{d.client_name}</p>
        <a
          data-testid={`delivery-maps-${d.id}`}
          href={mapsUrl(d.address)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-start gap-1.5 text-sm text-emerald-700 hover:text-emerald-900 hover:underline mt-1"
        >
          <MapPin className="w-4 h-4 mt-0.5 shrink-0" /> {d.address}
        </a>
        {d.phone && (
          <a href={`tel:${d.phone}`} className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 mt-1">
            <Phone className="w-3.5 h-3.5" /> {d.phone}
          </a>
        )}
        {d.products && (
          <p className="flex items-start gap-1.5 text-sm text-slate-600 mt-1">
            <Package className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {d.products}
          </p>
        )}
        {d.notes && <p className="text-xs text-slate-500 mt-1.5 italic">{d.notes}</p>}
        <p className="text-[11px] text-slate-400 mt-2">
          Livreur : <span className="font-semibold text-slate-600">{d.courier_name}</span>
          {d.picked_up_at && <> · ramassé {fmtTime(d.picked_up_at)}</>}
          {d.delivered_at && <> · livré {fmtTime(d.delivered_at)}</>}
        </p>
        {d.proof_image && (
          <button data-testid={`delivery-proof-thumb-${d.id}`} onClick={() => setViewProof(d)} className="mt-2 block text-left">
            <img src={d.proof_image} alt="Preuve de livraison" className="h-14 rounded-lg border border-slate-200 object-cover" />
            <span className="text-[10px] text-slate-400">{d.proof_type === 'signature' ? 'Signature du client — cliquer pour agrandir' : 'Photo de livraison — cliquer pour agrandir'}</span>
          </button>
        )}
        {(mine || isManager) && d.status !== 'livree' && (
          <div className="flex flex-wrap gap-2 mt-3">
            {d.status === 'a_ramasser' && (
              <Button data-testid={`delivery-pickup-${d.id}`} size="sm" onClick={() => void setStatus(d, 'en_route')} className="rounded-full bg-sky-600 hover:bg-sky-700 text-xs">
                <Navigation className="w-3.5 h-3.5 mr-1" /> Colis ramassé — en route
              </Button>
            )}
            {d.status === 'en_route' && (
              <Button data-testid={`delivery-done-${d.id}`} size="sm" onClick={() => setProofFor(d)} className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs">
                <CircleCheck className="w-3.5 h-3.5 mr-1" /> Marquer livrée
              </Button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div data-testid="deliveries-module">
      <ModuleHeader
        title="Livraisons"
        subtitle={isManager
          ? 'Envoyez les directives de livraison directement dans le compte des livreurs — ils reçoivent aussi un courriel avec l\'adresse et les détails.'
          : 'Vos livraisons du jour : ramassez le colis à la pharmacie, l\'adresse et l\'itinéraire sont à un clic.'}
        action={isManager ? (
          <div className="flex flex-wrap gap-2">
            <Button data-testid="pharmacy-address-button" variant="outline" onClick={() => setAddrOpen(true)} className="rounded-full">
              <Store className="w-4 h-4 mr-1" /> Adresse de départ
            </Button>
            <Button data-testid="add-delivery-button" onClick={() => setCreateOpen(true)} className="rounded-full bg-emerald-600 hover:bg-emerald-700">
              <Plus className="w-4 h-4 mr-1" /> Nouvelle livraison
            </Button>
          </div>
        ) : (active.length > 0 ? (
          <Button data-testid="my-tour-button" onClick={() => setTourOpen(true)} className="rounded-full bg-bronze-600 hover:bg-bronze-700 text-white">
            <Route className="w-4 h-4 mr-1" /> Ma tournée du jour
          </Button>
        ) : undefined)}
      />

      {isManager && (
        <div className="inline-flex rounded-full border border-slate-200 bg-white p-1 mb-6">
          <button
            data-testid="deliveries-view-list"
            onClick={() => setView('list')}
            className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${view === 'list' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:text-emerald-700'}`}
          >
            <Truck className="w-3.5 h-3.5" /> Livraisons
          </button>
          <button
            data-testid="deliveries-view-proofs"
            onClick={() => setView('proofs')}
            className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${view === 'proofs' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:text-emerald-700'}`}
          >
            <ShieldCheck className="w-3.5 h-3.5" /> Preuves clients
          </button>
          <button
            data-testid="deliveries-view-mileage"
            onClick={() => setView('mileage')}
            className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${view === 'mileage' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:text-emerald-700'}`}
          >
            <Fuel className="w-3.5 h-3.5" /> Kilométrage
          </button>
        </div>
      )}

      {view === 'proofs' && isManager ? (
        <DeliveryProofsPanel />
      ) : view === 'mileage' && isManager ? (
        <MileagePanel />
      ) : (
        <>
          <h2 className="font-heading text-base font-bold text-slate-900 mb-3 inline-flex items-center gap-2">
            <Truck className="w-4 h-4 text-bronze-600" /> En cours ({active.length})
          </h2>
          {active.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-10 text-center mb-8">
              <p data-testid="deliveries-empty" className="text-sm text-slate-500">Aucune livraison en cours.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-8">{active.map(card)}</div>
          )}

          {done.length > 0 && (
            <>
              <h2 className="font-heading text-base font-bold text-slate-900 mb-3 inline-flex items-center gap-2">
                <CircleCheck className="w-4 h-4 text-emerald-600" /> Livrées récemment
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 opacity-80">{done.map(card)}</div>
            </>
          )}
        </>
      )}

      <DeliveryTourDialog open={tourOpen} onClose={() => setTourOpen(false)} />

      <DeliveryProofDialog
        delivery={proofFor}
        busy={proofBusy}
        onClose={() => setProofFor(null)}
        onConfirm={(p) => void confirmDelivered(p)}
      />

      <Dialog open={viewProof !== null} onOpenChange={(o) => !o && setViewProof(null)}>
        <DialogContent data-testid="proof-view-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Preuve de livraison — {viewProof?.client_name}</DialogTitle>
            <DialogDescription>
              {viewProof?.proof_type === 'signature' ? 'Signature du client' : 'Photo prise à la livraison'}
              {viewProof?.delivered_at ? ` · ${fmtTime(viewProof.delivered_at)}` : ''}
            </DialogDescription>
          </DialogHeader>
          {viewProof?.proof_image && (
            <img src={viewProof.proof_image} alt="Preuve de livraison" className="w-full rounded-lg border border-slate-200" />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={addrOpen} onOpenChange={setAddrOpen}>
        <DialogContent data-testid="pharmacy-address-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Adresse de départ des tournées</DialogTitle>
            <DialogDescription>
              L'adresse de votre pharmacie — point de départ pour ordonner les tournées des livreurs et estimer les kilomètres.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Adresse complète</Label>
            <Input data-testid="pharmacy-address-input" value={pharmAddr} onChange={(e) => setPharmAddr(e.target.value)} placeholder="Ex. 5090 Rue Sherbrooke Est, Montréal, QC" />
          </div>
          <Button data-testid="pharmacy-address-save" disabled={addrBusy} onClick={() => void saveAddr()} className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
            {addrBusy ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent data-testid="create-delivery-dialog" className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading">Nouvelle livraison</DialogTitle>
            <DialogDescription>Le livreur recevra les directives instantanément dans son compte et par courriel.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void submitCreate(e)} className="space-y-4">
            <div className="space-y-2">
              <Label>Client</Label>
              <Input data-testid="delivery-client-input" value={client} onChange={(e) => setClient(e.target.value)} placeholder="Ex. Mme Gisèle Fortin" required />
            </div>
            <div className="space-y-2">
              <Label>Adresse de livraison</Label>
              <Input data-testid="delivery-address-input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Ex. 1234 rue Sainte-Catherine E, Montréal" required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Téléphone</Label>
                <Input data-testid="delivery-phone-input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="514-555-0199" />
              </div>
              <div className="space-y-2">
                <Label># Commande</Label>
                <Input data-testid="delivery-order-input" value={orderRef} onChange={(e) => setOrderRef(e.target.value)} placeholder="RX-48213" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Produits à livrer</Label>
              <Input data-testid="delivery-products-input" value={products} onChange={(e) => setProducts(e.target.value)} placeholder="Ex. 2 ordonnances + pilulier Dispill" />
            </div>
            <div className="space-y-2">
              <Label>Notes (facultatif)</Label>
              <Input data-testid="delivery-notes-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex. sonner à l'arrière, réfrigéré" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Priorité</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger data-testid="delivery-priority-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">Normale</SelectItem>
                    <SelectItem value="urgent">Urgente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Livreur</Label>
                <Select value={courierId} onValueChange={setCourierId}>
                  <SelectTrigger data-testid="delivery-courier-select"><SelectValue placeholder="Choisir" /></SelectTrigger>
                  <SelectContent>
                    {couriers.map((emp) => (
                      <SelectItem key={emp.id} value={emp.id}>{emp.firstName} {emp.lastName} — {emp.position}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-slate-500">Le livreur voit la course instantanément dans son compte et reçoit un courriel avec l'adresse et les directives.</p>
            <Button data-testid="delivery-submit-button" type="submit" disabled={busy || !client.trim() || !address.trim() || !courierId} className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              {busy ? 'Création…' : 'Créer et envoyer les directives'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
