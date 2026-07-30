import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { Evaluation } from '@/types';
import { TrendingUp, ArrowRight } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const money = (v: number): string => v.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' });

interface Props {
  employeeId: string;
  currentRate: number;
}

export const SalaryHistory = ({ employeeId, currentRate }: Props): JSX.Element => {
  const { token } = useAuth();
  const [evals, setEvals] = useState<Evaluation[]>([]);

  useEffect(() => {
    axios.get<Evaluation[]>(`${API}/evaluations`, { headers: { Authorization: `Bearer ${token ?? ''}` } })
      .then((r) => setEvals(r.data))
      .catch(() => setEvals([]));
  }, [token]);

  const changes = evals
    .filter((e) => e.employee_id === employeeId && e.agreed_rate !== null)
    .sort((a, b) => (a.employee_decision?.at ?? a.created_at).localeCompare(b.employee_decision?.at ?? b.created_at));

  return (
    <div className="bg-white rounded-xl border border-slate-200 border-t-4 border-t-bronze-500 p-7" data-testid="salary-history-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <h2 className="font-heading text-base font-bold text-slate-900 inline-flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-bronze-600" /> Historique salarial
        </h2>
        <span className="inline-flex px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 text-xs font-bold" data-testid="salary-current-rate">
          Taux actuel : {money(currentRate)}/h
        </span>
      </div>
      {changes.length === 0 ? (
        <p className="text-sm text-slate-500" data-testid="salary-history-empty">
          Aucun changement de taux enregistré. Les augmentations issues des évaluations de performance apparaîtront ici automatiquement.
        </p>
      ) : (
        <div className="space-y-3">
          {changes.map((e) => {
            const at = (e.employee_decision?.at ?? e.created_at).slice(0, 10);
            const pct = e.agreed_rate !== null ? Math.round((e.agreed_rate / e.current_rate - 1) * 1000) / 10 : 0;
            return (
              <div key={e.id} data-testid={`salary-change-${e.id}`} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 px-4 py-3">
                <span className="text-xs font-semibold text-slate-400 w-20">{at}</span>
                <span className="inline-flex items-center gap-2 text-sm font-bold text-slate-800">
                  {money(e.current_rate)}/h <ArrowRight className="w-4 h-4 text-bronze-500" /> <span className="text-emerald-700">{e.agreed_rate !== null ? money(e.agreed_rate) : '—'}/h</span>
                </span>
                <span className="inline-flex px-2.5 py-0.5 rounded-full bg-bronze-100 text-bronze-800 text-xs font-semibold">+{pct} %</span>
                {e.suggestion && (
                  <span className="text-xs text-slate-500">Score de performance : {e.suggestion.performance_score} % (mult. ×{e.suggestion.multiplier})</span>
                )}
                <span className={`ml-auto inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${e.status === 'applique' ? 'bg-emerald-100 text-emerald-800' : 'bg-sky-100 text-sky-800'}`}>
                  {e.status === 'applique' ? 'Appliqué au dossier' : 'Accepté — à appliquer'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
