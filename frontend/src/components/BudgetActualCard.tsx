import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { addDaysIso, mondayOf } from '@/lib/schedule';
import { ChevronLeft, ChevronRight, Scale, ChevronDown, ChevronUp } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

interface CostEmployee {
  employee_id: string;
  employee_name: string;
  hours: number;
  rate: number | null;
  cost: number | null;
}

interface CostData {
  weekly_budget: number;
  total_hours: number;
  real_cost: number;
  employees: CostEmployee[];
  missing_rates: string[];
}

const cad = (n: number): string => n.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' });

const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const BudgetActualCard = (): JSX.Element => {
  const { token } = useAuth();
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<CostData | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const start = addDaysIso(mondayOf(todayIso()), offset * 7);
  const end = addDaysIso(start, 6);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await axios.get<CostData>(`${API}/punch/cost?start=${start}&end=${end}`, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      setData(res.data);
    } catch {
      setData(null);
    }
  }, [start, end, token]);

  useEffect(() => { void refresh(); }, [refresh]);

  const budget = data?.weekly_budget ?? 0;
  const real = data?.real_cost ?? 0;
  const gap = budget - real;
  const overBudget = budget > 0 && real > budget;

  return (
    <div data-testid="budget-actual-card" className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="font-heading text-base font-bold text-slate-900 inline-flex items-center gap-2">
          <Scale className="w-4 h-4 text-bronze-600" /> Budget prévu vs heures punchées
        </h2>
        <div className="flex items-center gap-1.5">
          <button data-testid="budget-week-prev" onClick={() => setOffset((o) => o - 1)} className="w-8 h-8 rounded-full border border-slate-200 flex items-center justify-center text-slate-500 hover:border-emerald-300 hover:text-emerald-700 transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span data-testid="budget-week-label" className="text-xs font-semibold text-slate-700 px-1 whitespace-nowrap">Semaine du {start} au {end}</span>
          <button data-testid="budget-week-next" onClick={() => setOffset((o) => o + 1)} className="w-8 h-8 rounded-full border border-slate-200 flex items-center justify-center text-slate-500 hover:border-emerald-300 hover:text-emerald-700 transition-colors">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-lg bg-slate-50 border border-slate-200 p-4">
          <p className="text-xs text-slate-500 font-semibold mb-1">Budget prévu</p>
          <p data-testid="budget-planned" className="font-heading text-lg font-extrabold text-slate-900">
            {budget > 0 ? cad(budget) : '—'}
          </p>
          {budget <= 0 && <p className="text-[10px] text-slate-400">Aucun budget défini (dialogue de génération IA)</p>}
        </div>
        <div className="rounded-lg bg-slate-50 border border-slate-200 p-4">
          <p className="text-xs text-slate-500 font-semibold mb-1">Coût réel punché</p>
          <p data-testid="budget-real" className="font-heading text-lg font-extrabold text-slate-900">{cad(real)}</p>
        </div>
        <div className={`rounded-lg border p-4 ${overBudget ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}>
          <p className={`text-xs font-semibold mb-1 ${overBudget ? 'text-red-700' : 'text-emerald-700'}`}>Écart</p>
          <p data-testid="budget-gap" className={`font-heading text-lg font-extrabold ${overBudget ? 'text-red-700' : 'text-emerald-700'}`}>
            {budget > 0 ? `${gap >= 0 ? '+' : ''}${cad(gap)}` : '—'}
          </p>
        </div>
        <div className="rounded-lg bg-slate-50 border border-slate-200 p-4">
          <p className="text-xs text-slate-500 font-semibold mb-1">Heures punchées</p>
          <p data-testid="budget-hours" className="font-heading text-lg font-extrabold text-slate-900">{(data?.total_hours ?? 0).toLocaleString('fr-CA')} h</p>
        </div>
      </div>

      {(data?.missing_rates ?? []).length > 0 && (
        <p data-testid="budget-missing-rates" className="text-[11px] text-amber-700 mt-2">
          Taux horaire manquant pour : {(data?.missing_rates ?? []).join(', ')} — le coût réel est sous-évalué.
        </p>
      )}

      {(data?.employees ?? []).length > 0 && (
        <>
          <button
            data-testid="budget-detail-toggle"
            onClick={() => setDetailOpen((v) => !v)}
            className="mt-3 text-xs font-semibold text-emerald-700 hover:text-emerald-900 inline-flex items-center gap-1"
          >
            {detailOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            Détail par employé ({(data?.employees ?? []).length})
          </button>
          {detailOpen && (
            <div className="mt-2 rounded-lg border border-slate-200 divide-y divide-slate-100">
              {(data?.employees ?? []).map((e) => (
                <div key={e.employee_id} data-testid={`budget-emp-${e.employee_id}`} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span className="font-semibold text-slate-800">{e.employee_name || e.employee_id}</span>
                  <span className="text-slate-600">
                    {e.hours.toLocaleString('fr-CA')} h
                    {e.rate ? ` × ${e.rate.toLocaleString('fr-CA')} $/h = ` : ' · taux inconnu'}
                    {e.cost != null && <strong className="text-slate-900">{cad(e.cost)}</strong>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};
