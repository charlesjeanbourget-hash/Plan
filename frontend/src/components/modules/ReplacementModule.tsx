import { useState, useEffect, useCallback, FormEvent } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { Agency, ReplacementRequestDoc, ReplacementOfferDoc, ReplacementSlotT, Position, POSITIONS } from '@/types';
import { ModuleHeader, EmptyState } from '@/components/modules/shared';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, CalendarDays, Trash2, Link2, Mail, Building2, CheckCircle2, Users } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const URGENCIES = ['Faible', 'Normale', 'Élevée', 'Urgente'];

const apiError = (err: unknown): string => {
  if (axios.isAxiosError(err) && err.response) {
    const detail = (err.response.data as { detail?: unknown }).detail;
    if (typeof detail === 'string') return detail;
  }
  return 'Une erreur est survenue.';
};

const OFFER_STATUS: Record<ReplacementOfferDoc['status'], { label: string; cls: string }> = {
  received: { label: 'Reçue', cls: 'bg-sky-100 text-sky-800' },
  chosen: { label: 'Retenue', cls: 'bg-emerald-100 text-emerald-800' },
  declined: { label: 'Déclinée', cls: 'bg-slate-200 text-slate-600' },
};

export default function ReplacementModule(): JSX.Element {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token ?? ''}` };
  const [tab, setTab] = useState<'requests' | 'agencies'>('requests');
  const [requests, setRequests] = useState<ReplacementRequestDoc[]>([]);
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [role, setRole] = useState<Position>('Pharmacien(ne)');
  const [urgency, setUrgency] = useState('Normale');
  const [slots, setSlots] = useState<ReplacementSlotT[]>([{ date: new Date().toISOString().slice(0, 10), start: '09:00', end: '17:00' }]);
  const [notes, setNotes] = useState('');
  const [creating, setCreating] = useState(false);
  const [agencyOpen, setAgencyOpen] = useState(false);
  const [agName, setAgName] = useState('');
  const [agEmail, setAgEmail] = useState('');
  const [agRoles, setAgRoles] = useState<string[]>([]);
  const [offersFor, setOffersFor] = useState<ReplacementRequestDoc | null>(null);
  const [offers, setOffers] = useState<ReplacementOfferDoc[]>([]);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [rq, ag] = await Promise.all([
        axios.get<ReplacementRequestDoc[]>(`${API}/replacements/requests`, { headers: { Authorization: `Bearer ${token ?? ''}` } }),
        axios.get<Agency[]>(`${API}/agencies`, { headers: { Authorization: `Bearer ${token ?? ''}` } }),
      ]);
      setRequests(rq.data);
      setAgencies(ag.data);
    } catch {
      toast.error('Impossible de charger les demandes de remplacement.');
    }
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh]);

  const matchingAgencies = agencies.filter((a) => a.roles.includes(role)).length;

  const patchSlot = (i: number, patch: Partial<ReplacementSlotT>): void =>
    setSlots((prev) => prev.map((s, si) => (si === i ? { ...s, ...patch } : s)));

  const submitRequest = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await axios.post<ReplacementRequestDoc & { emails_sent: number }>(`${API}/replacements/requests`, {
        role, slots, notes, urgency, public_base_url: window.location.origin,
      }, { headers });
      toast.success(`Demande publiée — ${res.data.emails_sent} courriel(s) envoyé(s) aux agences avec le lien public.`);
      setCreateOpen(false);
      setNotes('');
      setSlots([{ date: new Date().toISOString().slice(0, 10), start: '09:00', end: '17:00' }]);
      await refresh();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setCreating(false);
    }
  };

  const copyLink = (link: string): void => {
    void navigator.clipboard.writeText(link);
    toast.success('Lien public copié — partagez-le avec vos agences.');
  };

  const openOffers = async (req: ReplacementRequestDoc): Promise<void> => {
    setOffersFor(req);
    try {
      const res = await axios.get<ReplacementOfferDoc[]>(`${API}/replacements/requests/${req.id}/offers`, { headers });
      setOffers(res.data);
    } catch {
      setOffers([]);
    }
  };

  const chooseOffer = async (offer: ReplacementOfferDoc): Promise<void> => {
    if (!offersFor) return;
    try {
      await axios.post(`${API}/replacements/requests/${offersFor.id}/choose`, { offer_id: offer.id }, { headers });
      toast.success(`${offer.candidate_name} retenu(e) ! Toutes les agences ont été avisées par courriel.`);
      setOffersFor(null);
      await refresh();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const deleteRequest = async (req: ReplacementRequestDoc): Promise<void> => {
    try {
      await axios.delete(`${API}/replacements/requests/${req.id}`, { headers });
      toast.success('Demande supprimée.');
      await refresh();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const toggleAgRole = (r: string): void =>
    setAgRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));

  const submitAgency = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (agRoles.length === 0) {
      toast.error('Sélectionnez au moins un poste couvert par cette agence.');
      return;
    }
    try {
      await axios.post(`${API}/agencies`, { name: agName, email: agEmail, roles: agRoles }, { headers });
      toast.success(`Agence « ${agName} » ajoutée.`);
      setAgencyOpen(false);
      setAgName(''); setAgEmail(''); setAgRoles([]);
      await refresh();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const deleteAgency = async (a: Agency): Promise<void> => {
    try {
      await axios.delete(`${API}/agencies/${a.id}`, { headers });
      toast.success(`Agence « ${a.name} » retirée.`);
      await refresh();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  return (
    <div data-testid="replacements-module">
      <ModuleHeader
        title="Remplacements"
        subtitle="Envoyez vos besoins aux agences par courriel avec un lien public — comparez leurs offres et choisissez."
        action={
          <Button data-testid="add-replacement-button" onClick={() => setCreateOpen(true)} className="rounded-full bg-emerald-600 hover:bg-emerald-700">
            <Plus className="w-4 h-4 mr-1" /> Nouvelle demande
          </Button>
        }
      />

      <div className="flex gap-1 border-b border-slate-200 mb-6">
        {([['requests', `Demandes (${requests.length})`], ['agencies', `Agences partenaires (${agencies.length})`]] as const).map(([key, label]) => (
          <button
            key={key}
            data-testid={`replacements-tab-${key}`}
            onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === key ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'requests' && (
        requests.length === 0 ? (
          <EmptyState text="Aucune demande. Créez-en une : les agences couvrant le poste recevront un courriel avec un lien pour proposer leurs candidats." />
        ) : (
          <div className="space-y-4">
            {requests.map((r) => (
              <div key={r.id} data-testid={`replacement-request-${r.id}`} className="bg-white rounded-xl border border-slate-200 p-6">
                <div className="flex flex-wrap items-center gap-3 mb-3">
                  <h3 className="font-heading font-bold text-slate-900">{r.role}</h3>
                  <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${r.status === 'open' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                    {r.status === 'open' ? 'Ouverte' : 'Comblée'}
                  </span>
                  <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${r.urgency === 'Urgente' || r.urgency === 'Élevée' ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-600'}`}>
                    Urgence : {r.urgency}
                  </span>
                </div>
                <div className="flex flex-wrap gap-3 text-sm text-slate-600 mb-2">
                  {r.slots.map((s, i) => (
                    <span key={i} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1">
                      <CalendarDays className="w-3.5 h-3.5" /> {s.date} · {s.start}–{s.end}
                    </span>
                  ))}
                </div>
                {r.notes && <p className="text-sm text-slate-500 mb-3">{r.notes}</p>}
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                  <span className="text-xs text-slate-500 inline-flex items-center gap-1 mr-auto">
                    <Mail className="w-3.5 h-3.5" /> {r.emails_sent} courriel(s) envoyé(s) · {r.offers_count ?? 0} offre(s) reçue(s)
                  </span>
                  {r.link && (
                    <Button data-testid={`copy-link-${r.id}`} size="sm" variant="outline" onClick={() => copyLink(r.link ?? '')} className="rounded-full text-xs">
                      <Link2 className="w-3.5 h-3.5 mr-1" /> Copier le lien public
                    </Button>
                  )}
                  <Button data-testid={`view-offers-${r.id}`} size="sm" onClick={() => void openOffers(r)} className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs">
                    <Users className="w-3.5 h-3.5 mr-1" /> Voir les offres ({r.offers_count ?? 0})
                  </Button>
                  <Button data-testid={`delete-request-${r.id}`} size="sm" variant="outline" onClick={() => void deleteRequest(r)} className="rounded-full text-xs text-red-600 border-red-200 hover:bg-red-50">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'agencies' && (
        <div className="space-y-4">
          <Button data-testid="add-agency-button" variant="outline" onClick={() => setAgencyOpen(true)} className="rounded-full">
            <Plus className="w-4 h-4 mr-1" /> Ajouter une agence partenaire
          </Button>
          {agencies.length === 0 ? (
            <EmptyState text="Aucune agence. Ajoutez vos agences de placement avec les postes qu'elles couvrent — elles recevront automatiquement vos demandes par courriel." />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {agencies.map((a) => (
                <div key={a.id} data-testid={`agency-card-${a.id}`} className="bg-white rounded-xl border border-slate-200 p-5">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="font-heading font-bold text-slate-900 inline-flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-emerald-600" /> {a.name}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">{a.email}</p>
                    </div>
                    <Button data-testid={`delete-agency-${a.id}`} size="sm" variant="outline" onClick={() => void deleteAgency(a)} className="rounded-full text-xs text-red-600 border-red-200 hover:bg-red-50">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {a.roles.map((rr) => (
                      <span key={rr} className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800">{rr}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent data-testid="create-request-dialog" className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading">Nouvelle demande de remplacement</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => void submitRequest(e)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Poste à combler</Label>
                <Select value={role} onValueChange={(v) => setRole(v as Position)}>
                  <SelectTrigger data-testid="request-role-select"><SelectValue /></SelectTrigger>
                  <SelectContent>{POSITIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Urgence</Label>
                <Select value={urgency} onValueChange={setUrgency}>
                  <SelectTrigger data-testid="request-urgency-select"><SelectValue /></SelectTrigger>
                  <SelectContent>{URGENCIES.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <p className={`text-xs rounded-lg p-2.5 ${matchingAgencies > 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`} data-testid="matching-agencies-hint">
              {matchingAgencies > 0
                ? `${matchingAgencies} agence(s) couvrant ce poste recevront la demande par courriel avec le lien public.`
                : 'Aucune agence ne couvre ce poste — la demande sera créée et vous pourrez copier le lien public manuellement.'}
            </p>
            <div className="space-y-2">
              <Label>Plages à combler</Label>
              {slots.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input data-testid={`slot-date-${i}`} type="date" value={s.date} onChange={(e) => patchSlot(i, { date: e.target.value })} required className="flex-1" />
                  <Input data-testid={`slot-start-${i}`} type="time" value={s.start} onChange={(e) => patchSlot(i, { start: e.target.value })} required className="w-28" />
                  <Input data-testid={`slot-end-${i}`} type="time" value={s.end} onChange={(e) => patchSlot(i, { end: e.target.value })} required className="w-28" />
                  {slots.length > 1 && (
                    <button type="button" data-testid={`remove-slot-${i}`} onClick={() => setSlots((prev) => prev.filter((_, si) => si !== i))} className="p-1.5 rounded-full text-red-500 hover:bg-red-50">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
              <Button type="button" data-testid="add-slot-button" size="sm" variant="outline" onClick={() => setSlots((prev) => [...prev, { date: prev[prev.length - 1]?.date ?? '', start: '09:00', end: '17:00' }])} className="rounded-full text-xs">
                <Plus className="w-3.5 h-3.5 mr-1" /> Ajouter une plage
              </Button>
            </div>
            <div className="space-y-2">
              <Label>Précisions (facultatif)</Label>
              <Textarea data-testid="request-notes-input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex. expérience Proxim souhaitée, stationnement disponible…" />
            </div>
            <Button data-testid="request-submit-button" type="submit" disabled={creating} className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              {creating ? 'Envoi en cours…' : 'Publier et envoyer aux agences'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={agencyOpen} onOpenChange={setAgencyOpen}>
        <DialogContent data-testid="add-agency-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Ajouter une agence partenaire</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => void submitAgency(e)} className="space-y-4">
            <div className="space-y-2">
              <Label>Nom de l'agence</Label>
              <Input data-testid="agency-name-input" value={agName} onChange={(e) => setAgName(e.target.value)} placeholder="Ex. Placement Pharma Québec" required />
            </div>
            <div className="space-y-2">
              <Label>Courriel de l'agence</Label>
              <Input data-testid="agency-email-input" type="email" value={agEmail} onChange={(e) => setAgEmail(e.target.value)} placeholder="contact@agence.ca" required />
            </div>
            <div className="space-y-2">
              <Label>Postes couverts</Label>
              <div className="flex flex-wrap gap-2">
                {POSITIONS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    data-testid={`agency-role-${p}`}
                    onClick={() => toggleAgRole(p)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                      agRoles.includes(p) ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-200 text-slate-600 hover:border-emerald-300'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <Button data-testid="agency-submit-button" type="submit" className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              Ajouter l'agence
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={offersFor !== null} onOpenChange={(o) => !o && setOffersFor(null)}>
        <DialogContent data-testid="offers-dialog" className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading">Offres reçues — {offersFor?.role}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {offers.map((o) => {
              const meta = OFFER_STATUS[o.status];
              return (
                <div key={o.id} data-testid={`offer-card-${o.id}`} className={`rounded-xl border p-5 ${o.status === 'chosen' ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200'}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div>
                      <p className="font-heading font-bold text-slate-900">{o.candidate_name}</p>
                      <p className="text-xs text-slate-500">{o.agency_name} · {o.agency_email}</p>
                    </div>
                    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${meta.cls}`}>{meta.label}</span>
                  </div>
                  <div className="flex flex-wrap gap-3 text-sm text-slate-600 mb-2">
                    <span className="font-bold text-emerald-700">{o.hourly_rate.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' })}/h</span>
                    <span>{o.experience_years} an(s) d'expérience</span>
                    {o.license_number && <span>Licence : {o.license_number}</span>}
                    {o.phone && <span>{o.phone}</span>}
                    {o.email && <span>{o.email}</span>}
                  </div>
                  {o.note && <p className="text-sm text-slate-500 mb-2">{o.note}</p>}
                  {offersFor?.status === 'open' && (
                    <Button data-testid={`choose-offer-${o.id}`} size="sm" onClick={() => void chooseOffer(o)} className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs">
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Retenir cette offre
                    </Button>
                  )}
                </div>
              );
            })}
            {offers.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-6">
                Aucune offre pour le moment. Les agences soumettent leurs candidats via le lien public envoyé par courriel.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
