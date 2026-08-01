import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts';
import { TrendingUp } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const DEPT_COLORS: Record<string, string> = {
  'Général': '#cbd5e1',
  'Plancher': '#10b981',
  'Laboratoire': '#0ea5e9',
  'Entrepôt': '#f59e0b',
  'Livraison': '#ef4444',
  'Administration': '#334155',
};

interface HistoryData {
  months: { month: string; depts: Record<string, number>; total: number }[];
  departments: string[];
}

const monthLabel = (m: string): string =>
  new Date(`${m}-01T12:00:00`).toLocaleDateString('fr-CA', { month: 'short', year: '2-digit' });

const cad = (n: number): string => n.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' });

export const BudgetHistoryChart = (): JSX.Element | null => {
  const { token } = useAuth();
  const [data, setData] = useState<HistoryData | null>(null);

  useEffect(() => {
    if (!token) return;
    axios.get<HistoryData>(`${API}/reports/budget-history?months=6`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => setData(r.data))
      .catch(() => setData(null));
  }, [token]);

  if (!data) return null;
  const hasData = data.months.some((m) => m.total > 0);

  const rows = data.months.map((m) => ({
    label: monthLabel(m.month),
    ...Object.fromEntries(data.departments.map((d) => [d, m.depts[d] ?? 0])),
  }));

  return (
    <div data-testid="budget-history-chart" className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
      <h2 className="font-heading text-base font-bold text-slate-900 inline-flex items-center gap-2 mb-1">
        <TrendingUp className="w-4 h-4 text-bronze-600" /> Évolution des coûts par département
      </h2>
      <p className="text-xs text-slate-500 mb-4">
        Coûts planifiés des 6 derniers mois (quarts du calendrier × taux horaires des profils) — rapport détaillé envoyé par courriel chaque 1<sup>er</sup> du mois.
      </p>
      {!hasData ? (
        <p data-testid="budget-history-empty" className="text-sm text-slate-500 py-8 text-center">
          Aucun coût planifié sur les 6 derniers mois — ajoutez des quarts et des taux horaires aux profils.
        </p>
      ) : (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v} $`} width={64} />
              <Tooltip formatter={(v, name) => [cad(Number(v ?? 0)), String(name)]} labelStyle={{ fontWeight: 700 }} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {data.departments.map((d) => (
                <Bar key={d} dataKey={d} stackId="cost" fill={DEPT_COLORS[d] ?? '#94a3b8'} radius={[0, 0, 0, 0]} maxBarSize={56} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};
