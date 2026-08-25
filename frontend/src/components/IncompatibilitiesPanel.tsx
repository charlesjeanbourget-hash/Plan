import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useHR } from '@/context/HRContext';
import { useAuth } from '@/context/AuthContext';
import { Input } from '@/components/ui/input';
import { UserX, Search, CheckCircle2, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export const IncompatibilitiesPanel = ({ employeeId }: { employeeId: string }): JSX.Element => {
  const { state } = useHR();
  const { token } = useAuth();
  const [list, setList] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoaded(false);
    axios.get<{ incompatible_with?: string[] }>(`${API}/profiles/${employeeId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => { setList(r.data.incompatible_with ?? []); setLoaded(true); })
      .catch(() => setLoaded(true));
    return () => { if (savedTimer.current) clearTimeout(savedTimer.current); };
  }, [employeeId, token]);

  const others = state.employees.filter((e) => e.id !== employeeId && !e.anonymized);
  const selected = others.filter((e) => list.includes(e.id));
  const norm = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const available = others.filter((e) =>
    !list.includes(e.id) && (!search.trim() || norm(`${e.firstName} ${e.lastName}`).includes(norm(search))));

  const toggle = async (otherId: string): Promise<void> => {
    const next = list.includes(otherId) ? list.filter((x) => x !== otherId) : [...list, otherId];
    const prev = list;
    setList(next);
    setSaveState('saving');
    if (savedTimer.current) clearTimeout(savedTimer.current);
    try {
      await axios.put(`${API}/profiles/${employeeId}`, { incompatible_with: next }, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      setSaveState('saved');
      savedTimer.current = setTimeout(() => setSaveState('idle'), 4000);
    } catch {
      setList(prev);
      setSaveState('error');
      toast.error('Enregistrement impossible pour le moment.');
    }
  };

  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5" data-testid="incompat-panel">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm font-bold text-slate-900 inline-flex items-center gap-2">
          <UserX className="w-4 h-4 text-red-500" /> Incompatibilités de travail
          {list.length > 0 && <span className="rounded-full bg-red-100 text-red-700 text-[10px] font-bold px-2 py-0.5" data-testid="incompat-count">{list.length}</span>}
        </p>
        {saveState === 'saving' && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500" data-testid="incompat-saving">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Enregistrement…
          </span>
        )}
        {saveState === 'saved' && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1" data-testid="incompat-saved">
            <CheckCircle2 className="w-3.5 h-3.5" /> Enregistré — appliqué aux deux employés
          </span>
        )}
      </div>
      <p className="text-xs text-slate-500 mt-1">
        Ces employés ne seront jamais planifiés ensemble par l&apos;IA (quarts qui se chevauchent, même succursale).
        La réciprocité est automatique.
      </p>

      {loaded && (
        <>
          <div className={`mt-4 rounded-lg border p-3 ${selected.length > 0 ? 'border-red-200 bg-red-50/60' : 'border-slate-200 bg-slate-50'}`} data-testid="incompat-selected-box">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-red-700 mb-2">
              Sélectionnés ({selected.length})
            </p>
            {selected.length === 0 ? (
              <p className="text-xs text-slate-500" data-testid="incompat-selected-empty">Aucune incompatibilité — cliquez sur un employé ci-dessous pour l&apos;ajouter.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {selected.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    data-testid={`incompat-selected-${e.id}`}
                    onClick={() => void toggle(e.id)}
                    title="Retirer cette incompatibilité"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors"
                  >
                    {e.firstName} {e.lastName} <X className="w-3 h-3" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative mt-4">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              data-testid="incompat-search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un employé par nom…"
              className="pl-9 h-9"
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-2 max-h-56 overflow-y-auto">
            {available.map((e) => (
              <button
                key={e.id}
                type="button"
                data-testid={`incompat-toggle-${e.id}`}
                onClick={() => void toggle(e.id)}
                className="px-3 py-1.5 rounded-full text-xs font-semibold border bg-slate-50 border-slate-200 text-slate-600 hover:border-red-300 hover:text-red-700 transition-colors"
              >
                {e.firstName} {e.lastName}
              </button>
            ))}
            {available.length === 0 && others.length > 0 && (
              <p className="text-xs text-slate-400" data-testid="incompat-no-results">Aucun employé ne correspond à « {search} ».</p>
            )}
            {others.length === 0 && <p className="text-xs text-slate-400">Aucun autre employé au dossier.</p>}
          </div>
        </>
      )}
      {!loaded && <p className="mt-3 text-xs text-slate-400">Chargement…</p>}
    </div>
  );
};
