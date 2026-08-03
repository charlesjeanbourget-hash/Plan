import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useHR } from '@/context/HRContext';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DEPARTMENTS } from '@/lib/pharmacy';
import { POSITIONS } from '@/types';
import { HandMetal, Plus, X, CheckCircle2, Megaphone } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

interface OpenShift {
  id: string;
  date: string;
  start: string;
  end: string;
  department: string;
  positions: string[];
  note: string;
  status: string;
  claimed_by: string | null;
  claimed_by_name: string | null;
}

const fmtDate = (d: string): string => new Date(`${d}T12:00:00`).toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' });

export const OpenShiftsPanel = ({ mode }: { mode: 'admin' | 'employee' }): JSX.Element | null => {
  const { state } = useHR();
  const { currentUser, token } = useAuth();
  const headers = { Authorization: `Bearer ${token ?? ''}` };
  const me = state.employees.find((e) => e.id === currentUser?.employeeId);

  const [shifts, setShifts] = useState<OpenShift[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');
  const [department, setDepartment] = useState('Général');
  const [positions, setPositions] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [claiming, setClaiming] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!token) return;
    try {
      const res = await axios.get<OpenShift[]>(`${API}/open-shifts`, { headers: { Authorization: `Bearer ${token}` } });
      setShifts(res.data);
    } catch {
      /* hors ligne */
    }
  }, [token]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 20000);
    return () => clearInterval(id);
  }, [refresh]);

  const publish = async (): Promise<void> => {
    try {
      await axios.post(`${API}/open-shifts`, { date, start, end, department, positions, note }, { headers });
      toast.success('Quart publié — tous les employés sont notifiés. Premier arrivé, premier servi !');
      setDialogOpen(false);
      setNote('');
      setPositions([]);
      void refresh();
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
      toast.error(typeof detail === 'string' ? detail : 'Publication impossible.');
    }
  };

  const claim = async (s: OpenShift): Promise<void> => {
    setClaiming(s.id);
    try {
      await axios.post(`${API}/open-shifts/${s.id}/claim`, {
        position: me?.position ?? '',
        employee_name: me ? `${me.firstName} ${me.lastName}` : currentUser?.name ?? '',
      }, { headers });
      toast.success(`Le quart du ${s.date} est à vous ! Il apparaît maintenant dans votre horaire.`);
      void refresh();
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
      toast.error(typeof detail === 'string' ? detail : 'Réclamation impossible.');
      void refresh();
    }
    setClaiming(null);
  };

  const cancel = async (id: string): Promise<void> => {
    await axios.delete(`${API}/open-shifts/${id}`, { headers }).catch(() => undefined);
    void refresh();
  };

  const openOnes = shifts.filter((s) => s.status === 'open');
  const claimedOnes = shifts.filter((s) => s.status === 'claimed');

  if (mode === 'employee' && openOnes.length === 0 && claimedOnes.length === 0) return null;

  return (
    <div data-testid="open-shifts-panel" className="mb-6 rounded-2xl border border-sky-200 bg-sky-50/60 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h3 className="font-heading font-bold text-slate-900 inline-flex items-center gap-2">
          <Megaphone className="w-4 h-4 text-sky-600" /> Quarts à combler
          {openOnes.length > 0 && <span className="px-2 py-0.5 rounded-full bg-sky-600 text-white text-[11px] font-bold">{openOnes.length}</span>}
        </h3>
        {mode === 'admin' && (
          <Button data-testid="open-shift-publish-button" size="sm" onClick={() => setDialogOpen(true)} className="rounded-full bg-sky-600 hover:bg-sky-700 text-white">
            <Plus className="w-4 h-4 mr-1" /> Publier un quart ouvert
          </Button>
        )}
      </div>

      {openOnes.length === 0 && mode === 'admin' && (
        <p className="text-sm text-slate-500" data-testid="open-shifts-empty">Aucun quart ouvert en ce moment. Publiez-en un — vos employés le réclameront en un tap.</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {openOnes.map((s) => {
          const eligible = !s.positions.length || !me || s.positions.includes(me.position);
          return (
            <div key={s.id} data-testid={`open-shift-card-${s.id}`} className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="font-heading font-bold text-slate-900 text-sm capitalize">{fmtDate(s.date)}</p>
              <p className="text-sm text-slate-600 mt-0.5">{s.start} – {s.end} · {s.department}</p>
              {s.positions.length > 0 && (
                <p className="text-[11px] text-bronze-700 font-semibold mt-1">Réservé : {s.positions.join(', ')}</p>
              )}
              {s.note && <p className="text-xs text-slate-500 mt-1">{s.note}</p>}
              <div className="mt-3 flex gap-2">
                {mode === 'employee' ? (
                  <Button
                    data-testid={`claim-shift-${s.id}`}
                    size="sm"
                    disabled={claiming === s.id || !eligible}
                    onClick={() => void claim(s)}
                    className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-white flex-1"
                  >
                    <HandMetal className="w-3.5 h-3.5 mr-1.5" />
                    {eligible ? (claiming === s.id ? 'Réclamation…' : 'Je le prends !') : 'Poste non admissible'}
                  </Button>
                ) : (
                  <Button data-testid={`cancel-open-shift-${s.id}`} size="sm" variant="outline" onClick={() => void cancel(s.id)} className="rounded-full text-xs text-red-600">
                    <X className="w-3 h-3 mr-1" /> Retirer
                  </Button>
                )}
              </div>
            </div>
          );
        })}
        {claimedOnes.map((s) => (
          <div key={s.id} data-testid={`claimed-shift-card-${s.id}`} className="bg-emerald-50/70 rounded-xl border border-emerald-200 p-4">
            <p className="font-heading font-bold text-slate-900 text-sm capitalize">{fmtDate(s.date)}</p>
            <p className="text-sm text-slate-600 mt-0.5">{s.start} – {s.end} · {s.department}</p>
            <p className="text-xs text-emerald-700 font-semibold mt-2 inline-flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {s.claimed_by === currentUser?.employeeId ? 'Réclamé par vous — dans votre horaire' : `Réclamé par ${s.claimed_by_name}`}
            </p>
          </div>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="open-shift-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Publier un quart ouvert</DialogTitle>
            <DialogDescription>Les employés sont notifiés et peuvent le réclamer en un tap — premier arrivé, premier servi.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5 col-span-1">
                <Label>Date</Label>
                <Input data-testid="open-shift-date-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Début</Label>
                <Input data-testid="open-shift-start-input" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Fin</Label>
                <Input data-testid="open-shift-end-input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Département</Label>
              <Select value={department} onValueChange={setDepartment}>
                <SelectTrigger data-testid="open-shift-dept-select"><SelectValue /></SelectTrigger>
                <SelectContent>{DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Postes admissibles (aucun = tous)</Label>
              <div className="flex flex-wrap gap-2">
                {POSITIONS.map((p) => (
                  <button
                    key={p}
                    data-testid={`open-shift-position-${p}`}
                    onClick={() => setPositions((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]))}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${positions.includes(p) ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-600 border-slate-200 hover:border-sky-300'}`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Note (facultatif)</Label>
              <Input data-testid="open-shift-note-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Remplacement maladie — prime de dernière minute applicable" />
            </div>
            <Button data-testid="open-shift-submit-button" onClick={() => void publish()} className="w-full rounded-full bg-sky-600 hover:bg-sky-700">
              Publier et notifier l'équipe
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
