import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { Trophy, Medal, Award } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

interface HonorEntry {
  name: string;
  total: number;
  done: number;
  rate: number;
  team_checks: number;
}

const RANK_META = [
  { icon: Trophy, cls: 'bg-bronze-100 text-bronze-700 border-bronze-300' },
  { icon: Medal, cls: 'bg-slate-100 text-slate-500 border-slate-300' },
  { icon: Award, cls: 'bg-amber-50 text-amber-700 border-amber-200' },
];

export const HonorRoll = (): JSX.Element => {
  const { token } = useAuth();
  const [entries, setEntries] = useState<HonorEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    axios.get<{ entries: HonorEntry[] }>(`${API}/tasks/honor-roll`, { headers: { Authorization: `Bearer ${token ?? ''}` } })
      .then((r) => setEntries(r.data.entries))
      .catch(() => setEntries([]))
      .finally(() => setLoaded(true));
  }, [token]);

  const monthLabel = new Date().toLocaleDateString('fr-CA', { month: 'long', year: 'numeric' });

  return (
    <div data-testid="honor-roll-panel" className="bg-white rounded-xl border border-slate-200 p-6">
      <h2 className="font-heading text-base font-bold text-slate-900 mb-1 inline-flex items-center gap-2">
        <Trophy className="w-4 h-4 text-bronze-600" /> Tableau d'honneur — {monthLabel}
      </h2>
      <p className="text-xs text-slate-500 mb-5">Les employé(e)s les plus constants sur les tâches ce mois-ci.</p>
      {!loaded ? (
        <p className="text-sm text-slate-400">Chargement…</p>
      ) : entries.length === 0 ? (
        <p data-testid="honor-roll-empty" className="text-sm text-slate-400">
          Aucune tâche assignée complétée ce mois-ci — le classement apparaîtra dès les premières tâches cochées.
        </p>
      ) : (
        <div className="space-y-3">
          {entries.slice(0, 5).map((e, i) => {
            const meta = RANK_META[i];
            return (
              <div key={e.name} data-testid={`honor-roll-entry-${i + 1}`} className="flex items-center gap-3">
                {meta ? (
                  <span className={`w-8 h-8 rounded-full border flex items-center justify-center shrink-0 ${meta.cls}`}>
                    <meta.icon className="w-4 h-4" />
                  </span>
                ) : (
                  <span className="w-8 h-8 rounded-full border border-slate-200 text-slate-400 text-xs font-bold flex items-center justify-center shrink-0">
                    {i + 1}
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{e.name}</p>
                  <p className="text-xs text-slate-500">
                    {e.done}/{e.total} tâches{e.team_checks > 0 ? ` · ${e.team_checks} coup(s) de main d'équipe` : ''}
                  </p>
                </div>
                <span className={`text-sm font-extrabold ${e.rate >= 85 ? 'text-emerald-700' : e.rate >= 60 ? 'text-bronze-700' : 'text-red-600'}`}>
                  {e.rate} %
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
