import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { useHR } from '@/context/HRContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Hash } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

interface Props {
  open: boolean;
  onClose: () => void;
}

interface ProfileDoc {
  employee_id: string;
  payroll_number?: string | null;
}

export const PayrollNumbersDialog = ({ open, onClose }: Props): JSX.Element => {
  const { token } = useAuth();
  const { state } = useHR();
  const [values, setValues] = useState<Record<string, string>>({});
  const [initial, setInitial] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await axios.get<ProfileDoc[]>(`${API}/profiles`, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      const map: Record<string, string> = {};
      res.data.forEach((p) => { map[p.employee_id] = p.payroll_number ?? ''; });
      setValues(map);
      setInitial(map);
    } catch {
      setValues({});
      setInitial({});
    }
  }, [token]);

  useEffect(() => { if (open) void load(); }, [open, load]);

  const saveAll = async (): Promise<void> => {
    const changed = state.employees.filter((e) => (values[e.id] ?? '') !== (initial[e.id] ?? ''));
    if (changed.length === 0) {
      toast.info('Aucun matricule modifié.');
      return;
    }
    setSaving(true);
    try {
      await Promise.all(changed.map((e) =>
        axios.put(`${API}/profiles/${e.id}`, {
          employee_name: `${e.firstName} ${e.lastName}`,
          payroll_number: (values[e.id] ?? '').trim(),
        }, { headers: { Authorization: `Bearer ${token ?? ''}` } })));
      toast.success(`${changed.length} matricule(s) enregistré(s).`);
      setInitial({ ...values });
      onClose();
    } catch {
      toast.error('Enregistrement impossible.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="payroll-numbers-dialog" className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading inline-flex items-center gap-2">
            <Hash className="w-4 h-4 text-emerald-600" /> Matricules paie
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-slate-500 -mt-2 mb-2">
          Le numéro d'employé de votre logiciel de paie — repris automatiquement dans les exports Employeur D, Nethris et ADP.
        </p>
        <div className="max-h-80 overflow-y-auto space-y-2">
          {state.employees.map((e) => (
            <div key={e.id} data-testid={`payroll-number-row-${e.id}`} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2">
              <div className={`w-8 h-8 rounded-full ${e.avatarColor} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                {e.firstName[0]}{e.lastName[0]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{e.firstName} {e.lastName}</p>
                <p className="text-xs text-slate-500">{e.position}</p>
              </div>
              <Input
                data-testid={`payroll-number-input-${e.id}`}
                value={values[e.id] ?? ''}
                onChange={(ev) => setValues((prev) => ({ ...prev, [e.id]: ev.target.value }))}
                placeholder="Ex. 000123"
                className="w-32 h-9"
              />
            </div>
          ))}
        </div>
        <Button
          data-testid="payroll-numbers-save"
          onClick={() => void saveAll()}
          disabled={saving}
          className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700"
        >
          {saving ? 'Enregistrement…' : 'Enregistrer tous les matricules'}
        </Button>
      </DialogContent>
    </Dialog>
  );
};
