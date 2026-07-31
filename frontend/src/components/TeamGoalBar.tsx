import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Target, Pencil, PartyPopper } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

interface GoalData {
  target: number;
  week_start: string;
  total: number;
  done: number;
  rate: number;
}

export const TeamGoalBar = ({ weekStart, isManager }: { weekStart: string; isManager: boolean }): JSX.Element | null => {
  const { token } = useAuth();
  const [goal, setGoal] = useState<GoalData | null>(null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('80');

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await axios.get<GoalData>(`${API}/tasks/goal?start=${weekStart}`, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      setGoal(res.data);
      setValue(String(res.data.target || 80));
    } catch {
      setGoal(null);
    }
  }, [token, weekStart]);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = async (): Promise<void> => {
    const target = Number(value);
    if (!Number.isInteger(target) || target < 50 || target > 100) {
      toast.error('Objectif entre 50 et 100 %.');
      return;
    }
    try {
      await axios.post(`${API}/tasks/goal`, { target }, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      toast.success(`Objectif d'équipe fixé à ${target} % — visible par toute l'équipe.`);
      setEditing(false);
      await refresh();
    } catch {
      toast.error('Enregistrement impossible.');
    }
  };

  if (!goal || (!goal.target && !isManager)) return null;

  const reached = goal.total > 0 && goal.rate >= goal.target && goal.target > 0;

  return (
    <div data-testid="team-goal-bar" className={`rounded-xl border p-4 mb-6 ${reached ? 'border-emerald-300 bg-emerald-50/60' : 'border-slate-200 bg-white'}`}>
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <p className="text-sm font-bold text-slate-900 inline-flex items-center gap-2">
          {reached ? <PartyPopper className="w-4 h-4 text-emerald-600" /> : <Target className="w-4 h-4 text-bronze-600" />}
          Objectif d'équipe : {goal.target > 0 ? `${goal.target} %` : 'non défini'}
        </p>
        {goal.total > 0 && (
          <span data-testid="team-goal-rate" className={`text-sm font-extrabold ${reached ? 'text-emerald-700' : 'text-slate-700'}`}>
            {goal.rate} % actuellement ({goal.done}/{goal.total})
          </span>
        )}
        {reached && <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-600 text-white">Objectif atteint !</span>}
        {isManager && !editing && (
          <button data-testid="team-goal-edit" onClick={() => setEditing(true)} className="ml-auto text-slate-400 hover:text-bronze-700 transition-colors inline-flex items-center gap-1 text-xs font-semibold">
            <Pencil className="w-3.5 h-3.5" /> Modifier
          </button>
        )}
        {isManager && editing && (
          <div className="ml-auto flex items-center gap-2">
            <Input data-testid="team-goal-input" type="number" min={50} max={100} value={value} onChange={(e) => setValue(e.target.value)} className="w-20 h-8 text-sm" />
            <span className="text-xs text-slate-500">%</span>
            <Button data-testid="team-goal-save" size="sm" onClick={() => void save()} className="rounded-full h-8 bg-emerald-600 hover:bg-emerald-700 text-xs">Enregistrer</Button>
          </div>
        )}
      </div>
      {goal.target > 0 && (
        <div className="relative h-2.5 rounded-full bg-slate-100 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${reached ? 'bg-emerald-500' : 'bg-bronze-500'}`}
            style={{ width: `${Math.min(goal.rate, 100)}%` }}
          />
          <div className="absolute top-0 bottom-0 w-0.5 bg-slate-700/60" style={{ left: `${goal.target}%` }} title={`Objectif ${goal.target} %`} />
        </div>
      )}
    </div>
  );
};
