import { useState, useEffect } from 'react';
import axios from 'axios';
import { useHR } from '@/context/HRContext';
import { useAuth } from '@/context/AuthContext';
import { UserX } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const IncompatibilitiesPanel = ({ employeeId }: { employeeId: string }): JSX.Element => {
  const { state } = useHR();
  const { token } = useAuth();
  const [list, setList] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!token) return;
    setLoaded(false);
    axios.get<{ incompatible_with?: string[] }>(`${API}/profiles/${employeeId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => { setList(r.data.incompatible_with ?? []); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, [employeeId, token]);

  const others = state.employees.filter((e) => e.id !== employeeId && !e.anonymized);

  const toggle = async (otherId: string): Promise<void> => {
    const next = list.includes(otherId) ? list.filter((x) => x !== otherId) : [...list, otherId];
    setList(next);
    try {
      await axios.put(`${API}/profiles/${employeeId}`, { incompatible_with: next }, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      toast.success('Incompatibilités mises à jour (appliquées aux deux employés).');
    } catch {
      setList(list);
      toast.error('Enregistrement impossible pour le moment.');
    }
  };

  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5" data-testid="incompat-panel">
      <p className="text-sm font-bold text-slate-900 inline-flex items-center gap-2">
        <UserX className="w-4 h-4 text-red-500" /> Incompatibilités de travail
        {list.length > 0 && <span className="rounded-full bg-red-100 text-red-700 text-[10px] font-bold px-2 py-0.5">{list.length}</span>}
      </p>
      <p className="text-xs text-slate-500 mt-1">
        Ces employés ne seront jamais planifiés ensemble par l&apos;IA (quarts qui se chevauchent, même succursale).
        La réciprocité est automatique.
      </p>
      {loaded && (
        <div className="mt-3 flex flex-wrap gap-2">
          {others.map((e) => {
            const active = list.includes(e.id);
            return (
              <button
                key={e.id}
                type="button"
                data-testid={`incompat-toggle-${e.id}`}
                onClick={() => void toggle(e.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  active
                    ? 'bg-red-50 border-red-300 text-red-700'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
              >
                {active ? '✕ ' : ''}{e.firstName} {e.lastName}
              </button>
            );
          })}
          {others.length === 0 && <p className="text-xs text-slate-400">Aucun autre employé au dossier.</p>}
        </div>
      )}
      {!loaded && <p className="mt-3 text-xs text-slate-400">Chargement…</p>}
    </div>
  );
};
