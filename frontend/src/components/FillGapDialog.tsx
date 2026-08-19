import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { POSITIONS, Position } from '@/types';
import { DEPARTMENTS } from '@/lib/pharmacy';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Megaphone, Building2 } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const URGENCIES = ['Faible', 'Normale', 'Élevée', 'Urgente'];

export interface CoverageGap {
  date: string;
  start: string;
  end: string;
  branchId: string;
  branchName: string;
}

export const FillGapDialog = ({ gap, onClose }: { gap: CoverageGap | null; onClose: () => void }): JSX.Element => {
  const { token } = useAuth();
  const [action, setAction] = useState<'open_shift' | 'replacement'>('open_shift');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [department, setDepartment] = useState('Général');
  const [mode, setMode] = useState<'premier_arrive' | 'anciennete'>('premier_arrive');
  const [role, setRole] = useState<Position>('Pharmacien(ne)');
  const [urgency, setUrgency] = useState('Normale');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (gap) {
      setStart(gap.start);
      setEnd(gap.end);
      setAction('open_shift');
    }
  }, [gap]);

  if (!gap) return <></>;

  const dateLabel = new Date(`${gap.date}T12:00:00`).toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' });
  const headers = { Authorization: `Bearer ${token ?? ''}` };

  const submit = async (): Promise<void> => {
    if (!start || !end || start >= end) {
      toast.error('Vérifiez les heures : le début doit précéder la fin.');
      return;
    }
    setBusy(true);
    try {
      if (action === 'open_shift') {
        await axios.post(`${API}/open-shifts`, {
          date: gap.date, start, end, department, branch_id: gap.branchId,
          note: `Trou de couverture — ${gap.branchName}`, mode, positions: [],
        }, { headers });
        toast.success(mode === 'anciennete'
          ? 'Quart ouvert publié : attribution par ancienneté après la période de candidatures.'
          : 'Quart ouvert publié : premier employé qualifié à le réclamer l\u2019obtient.');
      } else {
        const res = await axios.post<{ emails_sent: number }>(`${API}/replacements/requests`, {
          role, urgency, slots: [{ date: gap.date, start, end }],
          notes: `Trou de couverture à combler — ${gap.branchName}`,
          public_base_url: window.location.origin,
        }, { headers });
        toast.success(`Demande de remplaçant envoyée${res.data.emails_sent ? ` à ${res.data.emails_sent} agence(s)` : ''} — suivez les offres dans le module Remplacements.`);
      }
      onClose();
    } catch (e) {
      const detail = axios.isAxiosError(e) && e.response ? (e.response.data as { detail?: unknown }).detail : null;
      toast.error(typeof detail === 'string' ? detail : 'Action impossible pour le moment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent data-testid="fill-gap-dialog" className="max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="font-heading">Combler ce trou de couverture</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-500 -mt-2 capitalize">
          {dateLabel} · <span className="font-semibold text-slate-700">{gap.branchName}</span> · {gap.start}–{gap.end}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="fill-gap-mode-open-shift"
            onClick={() => setAction('open_shift')}
            className={`flex-1 px-3 py-2.5 rounded-xl text-xs font-semibold border transition-colors inline-flex items-center justify-center gap-1.5 ${action === 'open_shift' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300'}`}
          >
            <Megaphone className="w-3.5 h-3.5" /> Quart ouvert (interne)
          </button>
          <button
            type="button"
            data-testid="fill-gap-mode-replacement"
            onClick={() => setAction('replacement')}
            className={`flex-1 px-3 py-2.5 rounded-xl text-xs font-semibold border transition-colors inline-flex items-center justify-center gap-1.5 ${action === 'replacement' ? 'bg-bronze-600 text-white border-bronze-600' : 'bg-white text-slate-600 border-slate-200 hover:border-bronze-300'}`}
          >
            <Building2 className="w-3.5 h-3.5" /> Remplaçant d'agence
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Début</Label>
            <Input data-testid="fill-gap-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Fin</Label>
            <Input data-testid="fill-gap-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="h-9" />
          </div>
        </div>
        {action === 'open_shift' ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Département</Label>
              <Select value={department} onValueChange={setDepartment}>
                <SelectTrigger data-testid="fill-gap-department" className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>{DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Attribution</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as 'premier_arrive' | 'anciennete')}>
                <SelectTrigger data-testid="fill-gap-attribution" className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="premier_arrive">Premier arrivé</SelectItem>
                  <SelectItem value="anciennete">Par ancienneté</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Poste recherché</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Position)}>
                <SelectTrigger data-testid="fill-gap-role" className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>{POSITIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Urgence</Label>
              <Select value={urgency} onValueChange={setUrgency}>
                <SelectTrigger data-testid="fill-gap-urgency" className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>{URGENCIES.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
        )}
        <Button data-testid="fill-gap-submit" onClick={() => void submit()} disabled={busy}
          className={`w-full rounded-full ${action === 'open_shift' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-bronze-600 hover:bg-bronze-700'}`}>
          {busy ? 'Envoi…' : action === 'open_shift' ? 'Publier le quart ouvert' : 'Envoyer aux agences'}
        </Button>
      </DialogContent>
    </Dialog>
  );
};
