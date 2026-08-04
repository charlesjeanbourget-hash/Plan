import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useHR } from '@/context/HRContext';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

interface TimeBankData {
  balances?: { employee_id: string; name: string; balance: number }[];
  entries: { id: string; employee_name: string; hours: number; reason: string; created_at: string }[];
  balance?: number;
}

export const TimeBankPanel = (): JSX.Element => {
  const { state } = useHR();
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token ?? ''}` };
  const [data, setData] = useState<TimeBankData>({ entries: [] });
  const [employeeId, setEmployeeId] = useState('');
  const [hours, setHours] = useState('1');
  const [reason, setReason] = useState('');

  const refresh = useCallback(async (): Promise<void> => {
    if (!token) return;
    try {
      const r = await axios.get<TimeBankData>(`${API}/time-bank`, { headers: { Authorization: `Bearer ${token}` } });
      setData(r.data);
    } catch { /* hors ligne */ }
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh]);

  const submit = async (sign: 1 | -1): Promise<void> => {
    const h = Math.abs(Number(hours.replace(',', '.')) || 0) * sign;
    if (!employeeId || h === 0) {
      toast.error('Choisissez un employé et un nombre d\'heures.');
      return;
    }
    try {
      await axios.post(`${API}/time-bank`, { employee_id: employeeId, hours: h, reason }, { headers });
      toast.success(`${Math.abs(h)} h ${h > 0 ? 'créditées' : 'débitées'} — l'employé est notifié.`);
      setReason('');
      void refresh();
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
      toast.error(typeof detail === 'string' ? detail : 'Opération impossible.');
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6" data-testid="time-bank-panel">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_110px_1fr_auto_auto] gap-3 items-end mb-5">
        <div className="space-y-1.5">
          <Label>Employé</Label>
          <Select value={employeeId} onValueChange={setEmployeeId}>
            <SelectTrigger data-testid="timebank-employee-select"><SelectValue placeholder="Choisir…" /></SelectTrigger>
            <SelectContent>
              {state.employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.firstName} {e.lastName}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Heures</Label>
          <Input data-testid="timebank-hours-input" type="number" min={0.25} step={0.25} value={hours} onChange={(e) => setHours(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Motif (facultatif)</Label>
          <Input data-testid="timebank-reason-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Temps supplémentaire du 3 août" />
        </div>
        <Button data-testid="timebank-credit-button" onClick={() => void submit(1)} className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs">
          + Créditer
        </Button>
        <Button data-testid="timebank-debit-button" onClick={() => void submit(-1)} variant="outline" className="rounded-full text-xs text-red-600">
          − Débiter (reprise)
        </Button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5" data-testid="timebank-balances">
        {(data.balances ?? []).length === 0 && <p className="text-sm text-slate-500 col-span-full">Aucune heure en banque pour l'instant.</p>}
        {(data.balances ?? []).map((b) => (
          <div key={b.employee_id} data-testid={`timebank-balance-${b.employee_id}`} className={`rounded-xl border p-3 ${b.balance < 0 ? 'border-red-200 bg-red-50/60' : 'border-slate-200 bg-slate-50/60'}`}>
            <p className="text-xs font-semibold text-slate-700 truncate">{b.name}</p>
            <p className={`text-sm font-bold mt-0.5 ${b.balance < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{b.balance > 0 ? '+' : ''}{b.balance} h</p>
          </div>
        ))}
      </div>
    </div>
  );
};
