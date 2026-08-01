import { useState, useEffect, useCallback, FormEvent } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ShieldAlert, Plus, Pencil, Trash2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

interface Incident {
  id: string;
  title: string;
  description: string;
  discovered_at: string;
  severity: string;
  affected_count: number;
  measures: string;
  cai_notified: boolean;
  persons_notified: boolean;
  status: string;
  created_at: string;
}

const SEVERITY_META: Record<string, { label: string; cls: string }> = {
  faible: { label: 'Faible', cls: 'bg-slate-100 text-slate-700 border-slate-300' },
  moyen: { label: 'Moyen', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  eleve: { label: 'Élevé', cls: 'bg-orange-100 text-orange-800 border-orange-300' },
  critique: { label: 'Critique', cls: 'bg-red-100 text-red-800 border-red-300' },
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  nouveau: { label: 'Nouveau', cls: 'bg-bronze-100 text-bronze-800 border-bronze-300' },
  en_cours: { label: 'En cours', cls: 'bg-sky-100 text-sky-800 border-sky-300' },
  notifie: { label: 'CAI/personnes avisées', cls: 'bg-violet-100 text-violet-800 border-violet-300' },
  clos: { label: 'Clos', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
};

const EMPTY = {
  title: '', description: '', discovered_at: '', severity: 'moyen', affected_count: 0,
  measures: '', cai_notified: false, persons_notified: false, status: 'nouveau',
};

export const SuperadminIncidents = (): JSX.Element => {
  const { token } = useAuth();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY });

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await axios.get<Incident[]>(`${API}/incidents`, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      setIncidents(res.data);
    } catch {
      setIncidents([]);
    }
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh]);

  const openCreate = (): void => { setEditId(null); setForm({ ...EMPTY }); setDialogOpen(true); };
  const openEdit = (i: Incident): void => {
    setEditId(i.id);
    setForm({
      title: i.title, description: i.description, discovered_at: i.discovered_at, severity: i.severity,
      affected_count: i.affected_count, measures: i.measures, cai_notified: i.cai_notified,
      persons_notified: i.persons_notified, status: i.status,
    });
    setDialogOpen(true);
  };

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!form.title.trim()) { toast.error('Le titre est requis.'); return; }
    const headers = { Authorization: `Bearer ${token ?? ''}` };
    try {
      if (editId) {
        await axios.put(`${API}/incidents/${editId}`, form, { headers });
        toast.success('Incident mis à jour.');
      } else {
        await axios.post(`${API}/incidents`, form, { headers });
        toast.success('Incident consigné au registre.');
      }
      setDialogOpen(false);
      await refresh();
    } catch {
      toast.error('Enregistrement impossible.');
    }
  };

  const remove = async (i: Incident): Promise<void> => {
    try {
      await axios.delete(`${API}/incidents/${i.id}`, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      setIncidents((prev) => prev.filter((x) => x.id !== i.id));
      toast.success('Incident supprimé.');
    } catch {
      toast.error('Suppression impossible.');
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-7 mb-10" data-testid="incidents-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="font-heading text-base font-bold text-slate-900 inline-flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-red-600" /> Registre des incidents de confidentialité
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">Obligatoire selon la Loi 25 — consignez chaque incident et le suivi CAI.</p>
        </div>
        <Button data-testid="add-incident-button" size="sm" onClick={openCreate} className="rounded-full bg-emerald-600 hover:bg-emerald-700">
          <Plus className="w-4 h-4 mr-1" /> Nouvel incident
        </Button>
      </div>

      <a
        href="https://www.cai.gouv.qc.ca/entreprises/incident-de-confidentialite"
        target="_blank" rel="noreferrer"
        className="text-xs text-emerald-700 hover:underline inline-flex items-center gap-1 mb-4"
      >
        <ExternalLink className="w-3 h-3" /> Déclarer un incident à la Commission d'accès à l'information (CAI)
      </a>

      <div className="space-y-3">
        {incidents.map((i) => (
          <div key={i.id} data-testid={`incident-row-${i.id}`} className="rounded-lg border border-slate-200 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <p className="text-sm font-bold text-slate-800">{i.title}</p>
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${SEVERITY_META[i.severity]?.cls ?? ''}`}>
                {SEVERITY_META[i.severity]?.label ?? i.severity}
              </span>
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_META[i.status]?.cls ?? ''}`}>
                {STATUS_META[i.status]?.label ?? i.status}
              </span>
            </div>
            {i.description && <p className="text-xs text-slate-600 mb-1">{i.description}</p>}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
              {i.discovered_at && <span>Découvert le {i.discovered_at}</span>}
              <span>{i.affected_count} personne(s) touchée(s)</span>
              <span>CAI avisée : <b className={i.cai_notified ? 'text-emerald-700' : 'text-red-600'}>{i.cai_notified ? 'oui' : 'non'}</b></span>
              <span>Personnes avisées : <b className={i.persons_notified ? 'text-emerald-700' : 'text-red-600'}>{i.persons_notified ? 'oui' : 'non'}</b></span>
            </div>
            {i.measures && <p className="text-xs text-slate-500 mt-1 italic">Mesures : {i.measures}</p>}
            <div className="flex gap-2 mt-2">
              <Button data-testid={`edit-incident-${i.id}`} size="sm" variant="outline" onClick={() => openEdit(i)} className="rounded-full text-xs h-7">
                <Pencil className="w-3 h-3 mr-1" /> Modifier
              </Button>
              <Button data-testid={`delete-incident-${i.id}`} size="sm" variant="outline" onClick={() => void remove(i)} className="rounded-full text-xs h-7 text-red-600 border-red-200 hover:bg-red-50">
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          </div>
        ))}
        {incidents.length === 0 && (
          <p className="text-sm text-slate-500" data-testid="incidents-empty">
            Aucun incident consigné. Espérons que ça dure ! Consignez ici tout accès, perte ou communication non autorisée de renseignements personnels.
          </p>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="incident-dialog" className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading">{editId ? 'Modifier l\'incident' : 'Nouvel incident de confidentialité'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => void submit(e)} className="space-y-4">
            <div className="space-y-2">
              <Label>Titre *</Label>
              <Input data-testid="incident-title-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ex. Courriel envoyé au mauvais destinataire" required />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input data-testid="incident-description-input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Nature de l'incident, renseignements en cause" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Date de découverte</Label>
                <Input data-testid="incident-date-input" type="date" value={form.discovered_at} onChange={(e) => setForm({ ...form, discovered_at: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Personnes touchées</Label>
                <Input data-testid="incident-affected-input" type="number" min={0} value={form.affected_count} onChange={(e) => setForm({ ...form, affected_count: Number(e.target.value) })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Gravité</Label>
                <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v })}>
                  <SelectTrigger data-testid="incident-severity-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(SEVERITY_META).map(([k, m]) => <SelectItem key={k} value={k}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Statut</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger data-testid="incident-status-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUS_META).map(([k, m]) => <SelectItem key={k} value={k}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Mesures prises</Label>
              <Input data-testid="incident-measures-input" value={form.measures} onChange={(e) => setForm({ ...form, measures: e.target.value })} placeholder="Mesures d'atténuation et correctives" />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5">
              <Label className="cursor-pointer">Commission d'accès à l'information (CAI) avisée</Label>
              <Switch data-testid="incident-cai-switch" checked={form.cai_notified} onCheckedChange={(v) => setForm({ ...form, cai_notified: v })} />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5">
              <Label className="cursor-pointer">Personnes concernées avisées</Label>
              <Switch data-testid="incident-persons-switch" checked={form.persons_notified} onCheckedChange={(v) => setForm({ ...form, persons_notified: v })} />
            </div>
            <Button data-testid="incident-submit-button" type="submit" className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              {editId ? 'Enregistrer' : 'Consigner l\'incident'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
