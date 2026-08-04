import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { ModuleHeader, CollapsibleSection, EmptyState } from '@/components/modules/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { HeartPulse, Plus, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

interface SstIncident {
  id: string;
  employee_name: string;
  date: string;
  incident_type: string;
  location: string;
  description: string;
  severity: string;
  witness: string;
  status: string;
  corrective_actions: string;
  created_at: string;
}

const TYPE_LABELS: Record<string, string> = {
  accident: 'Accident de travail', incident: 'Incident', premiers_soins: 'Premiers soins', quasi_accident: 'Quasi-accident',
};
const SEV_STYLE: Record<string, string> = {
  mineure: 'bg-slate-100 text-slate-600', moderee: 'bg-amber-100 text-amber-800', majeure: 'bg-red-100 text-red-700',
};
const STATUS_LABELS: Record<string, string> = { ouvert: 'Ouvert', en_analyse: 'En analyse', clos: 'Clos' };
const STATUS_STYLE: Record<string, string> = {
  ouvert: 'bg-red-100 text-red-700', en_analyse: 'bg-sky-100 text-sky-700', clos: 'bg-emerald-100 text-emerald-700',
};

export default function SstModule(): JSX.Element {
  const { currentUser, token } = useAuth();
  const isAdmin = currentUser?.role !== 'employee';
  const headers = { Authorization: `Bearer ${token ?? ''}` };
  const [incidents, setIncidents] = useState<SstIncident[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), incident_type: 'incident', location: '', description: '', severity: 'mineure', witness: '' });
  const [actionsDraft, setActionsDraft] = useState<Record<string, string>>({});

  const refresh = useCallback(async (): Promise<void> => {
    if (!token) return;
    try {
      const r = await axios.get<SstIncident[]>(`${API}/sst/incidents`, { headers: { Authorization: `Bearer ${token}` } });
      setIncidents(r.data);
    } catch { /* hors ligne */ }
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh]);

  const declare = async (): Promise<void> => {
    try {
      await axios.post(`${API}/sst/incidents`, form, { headers });
      toast.success('Déclaration envoyée — les gestionnaires sont notifiés.');
      setDialogOpen(false);
      setForm({ ...form, location: '', description: '', witness: '' });
      void refresh();
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
      toast.error(typeof detail === 'string' ? detail : 'Envoi impossible.');
    }
  };

  const patch = async (id: string, body: { status?: string; corrective_actions?: string }): Promise<void> => {
    try {
      await axios.patch(`${API}/sst/incidents/${id}`, body, { headers });
      toast.success('Déclaration mise à jour.');
      void refresh();
    } catch {
      toast.error('Mise à jour impossible.');
    }
  };

  const open = incidents.filter((i) => i.status !== 'clos');
  const closed = incidents.filter((i) => i.status === 'clos');

  const card = (i: SstIncident): JSX.Element => (
    <div key={i.id} data-testid={`sst-card-${i.id}`} className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-heading font-bold text-slate-900 text-sm">{TYPE_LABELS[i.incident_type] ?? i.incident_type}</p>
        <span className={`rounded-full text-[10px] font-bold px-2 py-0.5 ${SEV_STYLE[i.severity]}`}>{i.severity}</span>
        <span data-testid={`sst-status-${i.id}`} className={`rounded-full text-[10px] font-bold px-2 py-0.5 ${STATUS_STYLE[i.status]}`}>{STATUS_LABELS[i.status]}</span>
        <span className="ml-auto text-[11px] text-slate-400">{i.date}</span>
      </div>
      <p className="text-xs text-slate-500 mt-1.5">{i.employee_name}{i.location ? ` · ${i.location}` : ''}{i.witness ? ` · témoin : ${i.witness}` : ''}</p>
      <p className="text-sm text-slate-700 mt-2 whitespace-pre-wrap">{i.description}</p>
      {i.corrective_actions && (
        <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mt-2">
          <span className="font-bold">Mesures correctives :</span> {i.corrective_actions}
        </p>
      )}
      {isAdmin && i.status !== 'clos' && (
        <div className="mt-3 space-y-2">
          <Textarea
            data-testid={`sst-actions-input-${i.id}`}
            value={actionsDraft[i.id] ?? i.corrective_actions}
            onChange={(e) => setActionsDraft({ ...actionsDraft, [i.id]: e.target.value })}
            placeholder="Mesures correctives prises ou prévues…"
            className="text-sm min-h-[60px]"
          />
          <div className="flex gap-2">
            {i.status === 'ouvert' && (
              <Button data-testid={`sst-analyse-${i.id}`} size="sm" variant="outline" className="rounded-full text-xs" onClick={() => void patch(i.id, { status: 'en_analyse', corrective_actions: actionsDraft[i.id] ?? i.corrective_actions })}>
                Passer en analyse
              </Button>
            )}
            <Button data-testid={`sst-close-${i.id}`} size="sm" className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs" onClick={() => void patch(i.id, { status: 'clos', corrective_actions: actionsDraft[i.id] ?? i.corrective_actions })}>
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Clore le dossier
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div data-testid="sst-module">
      <ModuleHeader
        title="Santé & sécurité"
        subtitle={isAdmin ? 'Registre des accidents et incidents de travail — conforme CNESST.' : 'Déclarez tout accident, incident ou situation à risque.'}
        action={(
          <Button data-testid="sst-declare-button" onClick={() => setDialogOpen(true)} className="rounded-full bg-emerald-600 hover:bg-emerald-700">
            <Plus className="w-4 h-4 mr-1" /> Déclarer
          </Button>
        )}
      />

      {incidents.length === 0 ? (
        <EmptyState text="Aucune déclaration — c'est une bonne nouvelle ! Déclarez tout événement dès qu'il survient." />
      ) : (
        <>
          <CollapsibleSection id="sst-open" title="Dossiers actifs" icon={ShieldAlert} badge={open.length > 0 ? String(open.length) : undefined} badgeTone={open.length > 0 ? 'amber' : 'slate'} defaultOpen className="mb-4">
            {open.length === 0
              ? <p className="text-sm text-slate-500 bg-white rounded-xl border border-slate-200 p-5">Aucun dossier actif.</p>
              : <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">{open.map(card)}</div>}
          </CollapsibleSection>
          <CollapsibleSection id="sst-closed" title="Dossiers clos" icon={CheckCircle2} badge={closed.length > 0 ? String(closed.length) : undefined} className="mb-4">
            {closed.length === 0
              ? <p className="text-sm text-slate-500 bg-white rounded-xl border border-slate-200 p-5">Aucun dossier clos.</p>
              : <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">{closed.map(card)}</div>}
          </CollapsibleSection>
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="sst-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading inline-flex items-center gap-2"><HeartPulse className="w-4 h-4 text-red-500" /> Déclaration santé & sécurité</DialogTitle>
            <DialogDescription>Votre déclaration est confidentielle et transmise aux gestionnaires.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Date de l'événement</Label>
                <Input data-testid="sst-date-input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={form.incident_type} onValueChange={(v) => setForm({ ...form, incident_type: v })}>
                  <SelectTrigger data-testid="sst-type-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Gravité</Label>
                <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v })}>
                  <SelectTrigger data-testid="sst-severity-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mineure">Mineure</SelectItem>
                    <SelectItem value="moderee">Modérée</SelectItem>
                    <SelectItem value="majeure">Majeure</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Lieu (facultatif)</Label>
                <Input data-testid="sst-location-input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Laboratoire, entrepôt…" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea data-testid="sst-description-input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Décrivez ce qui s'est passé…" className="min-h-[90px]" />
            </div>
            <div className="space-y-1.5">
              <Label>Témoin (facultatif)</Label>
              <Input data-testid="sst-witness-input" value={form.witness} onChange={(e) => setForm({ ...form, witness: e.target.value })} placeholder="Nom du témoin" />
            </div>
            <Button data-testid="sst-submit-button" onClick={() => void declare()} disabled={!form.description.trim()} className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              Envoyer la déclaration
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
