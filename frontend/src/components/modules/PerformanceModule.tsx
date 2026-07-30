import { useState, useEffect, useCallback, FormEvent } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { useHR } from '@/context/HRContext';
import { Evaluation } from '@/types';
import { EVAL_STATUS_META } from '@/lib/evaluations';
import { ModuleHeader, EmptyState } from '@/components/modules/shared';
import EvaluationDetail from '@/components/EvaluationDetail';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const money = (v: number): string => v.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' });

export default function PerformanceModule(): JSX.Element {
  const { token } = useAuth();
  const { state } = useHR();
  const headers = { Authorization: `Bearer ${token ?? ''}` };
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  const [rate, setRate] = useState('');
  const [baiia, setBaiia] = useState('');

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await axios.get<Evaluation[]>(`${API}/evaluations`, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      setEvaluations(res.data);
    } catch {
      toast.error('Impossible de charger les évaluations.');
    }
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh]);

  const selected = evaluations.find((e) => e.id === selectedId) ?? null;
  if (selected) {
    return <EvaluationDetail evaluation={selected} onChanged={refresh} onBack={() => { setSelectedId(null); void refresh(); }} />;
  }

  const pickEmployee = (id: string): void => {
    setEmployeeId(id);
    const emp = state.employees.find((e) => e.id === id);
    if (emp) setRate(String(emp.hourlyRate));
  };

  const submitCreate = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const emp = state.employees.find((e2) => e2.id === employeeId);
    if (!emp) return;
    try {
      await axios.post(`${API}/evaluations`, {
        employee_id: emp.id,
        employee_name: `${emp.firstName} ${emp.lastName}`,
        current_rate: Number(rate),
        baiia_increase_pct: Number(baiia),
      }, { headers });
      toast.success(`Évaluation lancée pour ${emp.firstName} ${emp.lastName}. L'employé peut compléter son auto-évaluation.`);
      setCreateOpen(false);
      setEmployeeId('');
      setBaiia('');
      await refresh();
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
      toast.error(typeof detail === 'string' ? detail : 'Création impossible.');
    }
  };

  return (
    <div data-testid="performance-module">
      <ModuleHeader
        title="Performance"
        subtitle="Évaluations annuelles avec suggestion salariale automatique basée sur le BAIIA."
        action={
          <Button data-testid="add-evaluation-button" onClick={() => setCreateOpen(true)} className="rounded-full bg-emerald-600 hover:bg-emerald-700">
            <Plus className="w-4 h-4 mr-1" /> Nouvelle évaluation
          </Button>
        }
      />

      {evaluations.length === 0 ? (
        <EmptyState text="Aucune évaluation. Lancez-en une : vous remplissez le questionnaire employeur, l'employé complète son auto-évaluation, puis Arrière Plan suggère l'augmentation selon le BAIIA." />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {evaluations.map((ev) => {
            const meta = EVAL_STATUS_META[ev.status];
            return (
              <button
                key={ev.id}
                data-testid={`evaluation-card-${ev.id}`}
                onClick={() => setSelectedId(ev.id)}
                className="text-left bg-white rounded-xl border border-slate-200 p-6 hover:border-emerald-300 hover:-translate-y-0.5 transition-all"
              >
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-heading font-bold text-slate-900">{ev.employee_name}</h3>
                  <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${meta.cls}`}>{meta.label}</span>
                </div>
                <p className="text-xs text-slate-500 mb-3">
                  Lancée le {ev.created_at.slice(0, 10)} · Taux actuel {money(ev.current_rate)}/h · BAIIA +{ev.baiia_increase_pct} %
                </p>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className={`px-2.5 py-1 rounded-full ${ev.admin_eval ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}>
                    Employeur : {ev.admin_eval ? `${ev.admin_eval.score} %` : 'à faire'}
                  </span>
                  <span className={`px-2.5 py-1 rounded-full ${ev.self_eval ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}>
                    Auto-évaluation : {ev.self_eval ? `${ev.self_eval.score} %` : 'en attente'}
                  </span>
                  {ev.suggestion && (
                    <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 inline-flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" /> +{ev.suggestion.suggested_increase_pct} % → {money(ev.suggestion.suggested_rate)}/h
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent data-testid="create-evaluation-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Nouvelle évaluation de performance</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => void submitCreate(e)} className="space-y-4">
            <div className="space-y-2">
              <Label>Employé(e)</Label>
              <Select value={employeeId} onValueChange={pickEmployee}>
                <SelectTrigger data-testid="evaluation-employee-select"><SelectValue placeholder="Choisir un employé" /></SelectTrigger>
                <SelectContent>
                  {state.employees.map((e2) => (
                    <SelectItem key={e2.id} value={e2.id}>{e2.firstName} {e2.lastName} — {e2.position}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Taux horaire actuel ($/h)</Label>
                <Input data-testid="evaluation-rate-input" type="number" min="1" step="0.05" value={rate} onChange={(e) => setRate(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Augmentation liée au BAIIA (%)</Label>
                <Input data-testid="evaluation-baiia-input" type="number" min="0" step="0.1" value={baiia} onChange={(e) => setBaiia(e.target.value)} placeholder="Ex. 3" required />
              </div>
            </div>
            <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">
              Formule : <strong>Augmentation suggérée = % BAIIA × multiplicateur de performance</strong>.
              Score ≥ 90 % → ×1,2 · 75–89 % → ×1,0 · 60–74 % → ×0,7 · 45–59 % → ×0,4 · &lt; 45 % → 0 %.
              Le score global combine 70 % évaluation employeur + 30 % auto-évaluation.
            </p>
            <Button data-testid="evaluation-create-submit" type="submit" disabled={!employeeId || !rate || baiia === ''} className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              Lancer l'évaluation
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
