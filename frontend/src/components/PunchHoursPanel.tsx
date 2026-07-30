import { useState, useEffect, useCallback, FormEvent } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { useHR } from '@/context/HRContext';
import { PaySettings, PunchSummaryRow, Punch } from '@/types';
import { fmtTime } from '@/lib/pharmacy';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Timer, ChevronLeft, ChevronRight, Plus, Trash2, Wallet, Settings2 } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const addDays = (d: string, n: number): string => {
  const dt = new Date(`${d}T00:00:00`);
  dt.setDate(dt.getDate() + n);
  return dt.toISOString().slice(0, 10);
};

const periodFor = (settings: PaySettings, offset: number): { start: string; end: string } => {
  const len = settings.period_type === 'weekly' ? 7 : 14;
  const anchor = new Date(`${settings.anchor}T00:00:00`);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - anchor.getTime()) / 86400000);
  const idx = Math.floor(diffDays / len) + offset;
  const start = addDays(settings.anchor, idx * len);
  return { start, end: addDays(start, len - 1) };
};

export const PunchHoursPanel = (): JSX.Element => {
  const { token } = useAuth();
  const { state, addPayrollEntry } = useHR();
  const headers = { Authorization: `Bearer ${token ?? ''}` };
  const [settings, setSettings] = useState<PaySettings | null>(null);
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<PunchSummaryRow[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detailEmployee, setDetailEmployee] = useState<PunchSummaryRow | null>(null);
  const [detailPunches, setDetailPunches] = useState<Punch[]>([]);
  const [manualOpen, setManualOpen] = useState(false);
  const [mEmployeeId, setMEmployeeId] = useState('');
  const [mDate, setMDate] = useState(new Date().toISOString().slice(0, 10));
  const [mStart, setMStart] = useState('09:00');
  const [mEnd, setMEnd] = useState('17:00');
  const [mNote, setMNote] = useState('');

  const period = settings ? periodFor(settings, offset) : null;

  useEffect(() => {
    axios.get<PaySettings>(`${API}/pay-settings`, { headers })
      .then((r) => setSettings(r.data))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (!period) return;
    try {
      const res = await axios.get<PunchSummaryRow[]>(`${API}/punches/summary?start=${period.start}&end=${period.end}`, { headers });
      setRows(res.data);
    } catch {
      toast.error('Impossible de charger les heures punchées.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period?.start, period?.end]);

  useEffect(() => { void refresh(); }, [refresh]);

  const saveSettings = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!settings) return;
    try {
      await axios.post(`${API}/pay-settings`, { period_type: settings.period_type, anchor: settings.anchor }, { headers });
      toast.success('Période de paie enregistrée.');
      setSettingsOpen(false);
      setOffset(0);
    } catch {
      toast.error('Enregistrement impossible.');
    }
  };

  const openDetail = async (row: PunchSummaryRow): Promise<void> => {
    if (!period) return;
    setDetailEmployee(row);
    try {
      const res = await axios.get<Punch[]>(`${API}/punches?start=${period.start}&end=${period.end}&employee_id=${row.employee_id}`, { headers });
      setDetailPunches(res.data);
    } catch {
      setDetailPunches([]);
    }
  };

  const deletePunch = async (id: string): Promise<void> => {
    try {
      await axios.delete(`${API}/punches/${id}`, { headers });
      toast.success('Entrée supprimée.');
      setDetailPunches(detailPunches.filter((p) => p.id !== id));
      await refresh();
    } catch {
      toast.error('Suppression impossible.');
    }
  };

  const submitManual = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const emp = state.employees.find((e2) => e2.id === mEmployeeId);
    if (!emp) return;
    try {
      await axios.post(`${API}/punches/manual`, {
        employee_id: emp.id, employee_name: `${emp.firstName} ${emp.lastName}`,
        date: mDate, start_time: mStart, end_time: mEnd, note: mNote,
      }, { headers });
      toast.success('Heures ajoutées manuellement (journalisé).');
      setManualOpen(false);
      setMNote('');
      await refresh();
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
      toast.error(typeof detail === 'string' ? detail : 'Ajout impossible.');
    }
  };

  const createPayrollEntry = (row: PunchSummaryRow): void => {
    if (!period) return;
    const emp = state.employees.find((e2) => e2.id === row.employee_id);
    if (!emp) {
      toast.error('Employé introuvable dans le dossier RH.');
      return;
    }
    const gross = Math.round(row.total_hours * emp.hourlyRate * 100) / 100;
    const deductions = Math.round(gross * 0.25 * 100) / 100;
    addPayrollEntry({
      employeeId: emp.id,
      period: `Du ${period.start} au ${period.end}`,
      periodStart: period.start,
      periodEnd: period.end,
      hoursWorked: row.total_hours,
      overtimeHours: 0,
      grossPay: gross,
      deductions,
      netPay: Math.round((gross - deductions) * 100) / 100,
      status: 'En préparation',
    });
    toast.success(`Entrée de paie créée pour ${row.employee_name} : ${row.total_hours} h punchées.`);
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 mb-8" data-testid="punch-hours-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <h2 className="font-heading text-base font-bold text-slate-900 inline-flex items-center gap-2">
          <Timer className="w-4 h-4 text-emerald-600" /> Heures punchées (source officielle de la paie)
        </h2>
        <div className="flex gap-2">
          <Button data-testid="add-manual-hours-button" size="sm" variant="outline" onClick={() => { setMEmployeeId(state.employees[0]?.id ?? ''); setManualOpen(true); }} className="rounded-full text-xs">
            <Plus className="w-3.5 h-3.5 mr-1" /> Saisie manuelle
          </Button>
          <Button data-testid="pay-settings-button" size="sm" variant="outline" onClick={() => setSettingsOpen(true)} className="rounded-full text-xs">
            <Settings2 className="w-3.5 h-3.5 mr-1" /> Période de paie
          </Button>
        </div>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Seules les heures punchées (NIP à la borne ou depuis « Mon espace ») et les saisies manuelles de l'administration sont comptabilisées.
      </p>

      {period && (
        <div className="flex items-center gap-3 mb-4">
          <Button data-testid="period-prev-button" variant="outline" size="icon" className="rounded-full h-8 w-8" onClick={() => setOffset(offset - 1)}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <p className="text-sm font-semibold text-slate-700" data-testid="period-range-label">
            Période du {period.start} au {period.end}
            <span className="text-xs text-slate-400 font-normal ml-2">({settings?.period_type === 'weekly' ? 'hebdomadaire' : 'aux 2 semaines'})</span>
          </p>
          <Button data-testid="period-next-button" variant="outline" size="icon" className="rounded-full h-8 w-8" onClick={() => setOffset(offset + 1)}>
            <ChevronRight className="w-4 h-4" />
          </Button>
          {offset !== 0 && (
            <button data-testid="period-current-button" onClick={() => setOffset(0)} className="text-sm text-emerald-700 font-semibold hover:underline">
              Période courante
            </button>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.15em] text-slate-500">
              <th className="p-3">Employé</th>
              <th className="p-3 text-right">Punchées</th>
              <th className="p-3 text-right">Manuelles</th>
              <th className="p-3 text-right">Total</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.employee_id} data-testid={`punch-summary-row-${r.employee_id}`} className="border-b border-slate-100 last:border-0">
                <td className="p-3">
                  <p className="font-semibold text-slate-800">{r.employee_name}</p>
                  {r.open_entries > 0 && <p className="text-xs text-amber-700">{r.open_entries} punch en cours (non compté)</p>}
                </td>
                <td className="p-3 text-right text-slate-600">{r.punched_hours} h</td>
                <td className="p-3 text-right text-slate-600">{r.manual_hours} h</td>
                <td className="p-3 text-right font-bold text-emerald-700">{r.total_hours} h</td>
                <td className="p-3 text-right">
                  <div className="flex gap-2 justify-end">
                    <Button data-testid={`punch-detail-${r.employee_id}`} size="sm" variant="outline" onClick={() => void openDetail(r)} className="rounded-full text-xs">
                      Détails
                    </Button>
                    <Button data-testid={`create-payroll-${r.employee_id}`} size="sm" onClick={() => createPayrollEntry(r)} className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs">
                      <Wallet className="w-3.5 h-3.5 mr-1" /> Créer la paie
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="p-6 text-center text-slate-500">Aucune heure punchée dans cette période.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent data-testid="pay-settings-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Période de paie</DialogTitle>
          </DialogHeader>
          {settings && (
            <form onSubmit={(e) => void saveSettings(e)} className="space-y-4">
              <div className="space-y-2">
                <Label>Type de période</Label>
                <Select value={settings.period_type} onValueChange={(v) => setSettings({ ...settings, period_type: v as PaySettings['period_type'] })}>
                  <SelectTrigger data-testid="period-type-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Hebdomadaire (7 jours)</SelectItem>
                    <SelectItem value="biweekly">Aux 2 semaines (14 jours)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Date de début d'une période (ancrage)</Label>
                <Input data-testid="period-anchor-input" type="date" value={settings.anchor} onChange={(e) => setSettings({ ...settings, anchor: e.target.value })} required />
              </div>
              <Button data-testid="pay-settings-save-button" type="submit" className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">Enregistrer</Button>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={detailEmployee !== null} onOpenChange={(o) => !o && setDetailEmployee(null)}>
        <DialogContent data-testid="punch-detail-dialog" className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-heading">Entrées de {detailEmployee?.employee_name}</DialogTitle>
          </DialogHeader>
          <div className="max-h-80 overflow-y-auto space-y-2">
            {detailPunches.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    {p.date} · {fmtTime(p.punch_in)} → {p.punch_out ? fmtTime(p.punch_out) : 'en cours'}
                  </p>
                  <p className="text-xs text-slate-500">
                    {p.source === 'manual' ? `Saisie manuelle par ${p.created_by}` : 'Punch'}{p.note && ` — ${p.note}`}
                  </p>
                </div>
                <Button data-testid={`delete-punch-${p.id}`} size="sm" variant="outline" onClick={() => void deletePunch(p.id)} className="rounded-full text-xs text-red-600 border-red-200 hover:bg-red-50">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
            {detailPunches.length === 0 && <p className="text-sm text-slate-500 text-center py-4">Aucune entrée.</p>}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent data-testid="manual-hours-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Saisie manuelle d'heures</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => void submitManual(e)} className="space-y-4">
            <div className="space-y-2">
              <Label>Employé</Label>
              <Select value={mEmployeeId} onValueChange={setMEmployeeId}>
                <SelectTrigger data-testid="manual-employee-select"><SelectValue placeholder="Choisir un employé" /></SelectTrigger>
                <SelectContent>
                  {state.employees.map((e2) => (
                    <SelectItem key={e2.id} value={e2.id}>{e2.firstName} {e2.lastName} — {e2.position}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Date</Label>
              <Input data-testid="manual-date-input" type="date" value={mDate} onChange={(e) => setMDate(e.target.value)} required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Début</Label>
                <Input data-testid="manual-start-input" type="time" value={mStart} onChange={(e) => setMStart(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Fin</Label>
                <Input data-testid="manual-end-input" type="time" value={mEnd} onChange={(e) => setMEnd(e.target.value)} required />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Note (raison de la saisie manuelle)</Label>
              <Input data-testid="manual-note-input" value={mNote} onChange={(e) => setMNote(e.target.value)} placeholder="Ex. oubli de punch, formation externe…" />
            </div>
            <Button data-testid="manual-submit-button" type="submit" disabled={!mEmployeeId} className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              Ajouter les heures
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
