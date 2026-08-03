import { useState } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { Shift, WorkStation, RushPeriod } from '@/types';
import { Button } from '@/components/ui/button';
import { Grid3X3, Settings2, Wand2, ChevronDown, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const DAY_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

interface Props {
  stations: WorkStation[];
  rushPeriods: RushPeriod[];
  days: string[];
  shifts: Shift[];
  onConfigure: () => void;
  onAssigned: () => void;
}

export const WorkStationsPanel = ({ stations, rushPeriods, days, shifts, onConfigure, onAssigned }: Props): JSX.Element | null => {
  const { token } = useAuth();
  const [open, setOpen] = useState(true);
  const [assigning, setAssigning] = useState(false);
  const active = stations.filter((s) => s.active);
  const byDept = active.reduce<Record<string, WorkStation[]>>((acc, s) => {
    (acc[s.department] = acc[s.department] ?? []).push(s);
    return acc;
  }, {});

  const weekShifts = shifts.filter((s) => s.date >= days[0] && s.date <= days[6]);
  const isRushDay = (d: string): boolean => {
    const wd = (new Date(`${d}T00:00:00`).getDay() + 6) % 7;
    return rushPeriods.some((p) => p.days.includes(wd));
  };
  const countFor = (st: WorkStation, d: string): number =>
    weekShifts.filter((s) => s.date === d && (s.department || 'Général') === st.department && s.station === st.name).length;

  let missing = 0;
  Object.values(byDept).forEach((sts) => sts.forEach((st) => days.forEach((d) => {
    if (countFor(st, d) < st.normal_count) missing += 1;
  })));

  const runAssign = async (): Promise<void> => {
    setAssigning(true);
    try {
      const res = await axios.post<{ assigned: number }>(`${API}/work-stations/assign`, { week_start: days[0] },
        { headers: { Authorization: `Bearer ${token ?? ''}` } });
      toast.success(res.data.assigned > 0
        ? `${res.data.assigned} quart(s) ont reçu un poste automatiquement (compétences et besoins respectés).`
        : 'Aucun quart à assigner — tous les quarts de la semaine ont déjà un poste ou aucun quart ne correspond.');
      onAssigned();
    } catch {
      toast.error("Impossible d'attribuer les postes.");
    } finally {
      setAssigning(false);
    }
  };

  if (active.length === 0) {
    return (
      <div data-testid="work-stations-panel" className="mb-4 rounded-xl border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600 inline-flex items-center gap-2">
          <Grid3X3 className="w-4 h-4 text-emerald-600" /> Aucun poste de travail actif — configurez les rôles de chaque département avant de bâtir l'horaire.
        </p>
        <Button data-testid="configure-stations-button" size="sm" variant="outline" className="rounded-full text-xs" onClick={onConfigure}>
          <Settings2 className="w-3.5 h-3.5 mr-1" /> Configurer les postes
        </Button>
      </div>
    );
  }

  return (
    <div data-testid="work-stations-panel" className="mb-4 rounded-xl border border-slate-200 bg-white overflow-hidden">
      <button
        data-testid="work-stations-toggle"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex flex-wrap items-center gap-3 px-5 py-3.5 text-left hover:bg-slate-50 transition-colors"
      >
        <Grid3X3 className="w-4 h-4 text-emerald-600 shrink-0" />
        <span className="font-heading font-bold text-slate-900 text-sm">Postes par département — couverture de la semaine</span>
        {missing > 0 ? (
          <span data-testid="stations-missing-badge" className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-800 text-[10px] font-bold px-2 py-0.5">
            <AlertTriangle className="w-3 h-3" /> {missing} case(s) à combler
          </span>
        ) : (
          <span className="inline-flex rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5">Tous les postes comblés</span>
        )}
        <ChevronDown className={`w-4 h-4 text-slate-400 ml-auto transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-5 pb-5">
          <div className="flex flex-wrap gap-2 mb-4">
            <Button data-testid="assign-stations-button" size="sm" onClick={() => void runAssign()} disabled={assigning}
              className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs">
              <Wand2 className="w-3.5 h-3.5 mr-1" /> {assigning ? 'Attribution en cours…' : 'Attribution automatique (compétences + besoins)'}
            </Button>
            <Button data-testid="configure-stations-button" size="sm" variant="outline" className="rounded-full text-xs" onClick={onConfigure}>
              <Settings2 className="w-3.5 h-3.5 mr-1" /> Configurer les postes et périodes de rush
            </Button>
            {rushPeriods.length > 0 && (
              <span className="text-[11px] text-slate-400 self-center">
                Rush : {rushPeriods.map((p) => `${p.days.map((d) => DAY_SHORT[d]).join('·')} ${p.start}–${p.end}`).join(' | ')}
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[760px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-[0.15em] text-slate-400">
                  <th className="py-1.5 pr-3">Poste (normal → rush)</th>
                  {days.map((d, i) => (
                    <th key={d} className={`py-1.5 px-1 text-center ${isRushDay(d) ? 'text-bronze-700' : ''}`}>
                      {DAY_SHORT[i]}{isRushDay(d) ? ' •' : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(byDept).map(([dept, sts]) => (
                  <>
                    <tr key={`h-${dept}`}>
                      <td colSpan={8} className="pt-2.5 pb-1 text-[10px] uppercase tracking-[0.18em] font-bold text-bronze-700">{dept}</td>
                    </tr>
                    {sts.map((st) => (
                      <tr key={st.id} data-testid={`station-row-${st.id}`} className="border-t border-slate-100">
                        <td className="py-1.5 pr-3 font-semibold text-slate-700">
                          {st.name} <span className="text-slate-400 font-normal">({st.normal_count}→{st.rush_count})</span>
                        </td>
                        {days.map((d) => {
                          const n = countFor(st, d);
                          const rush = isRushDay(d);
                          const short = n < st.normal_count;
                          const rushShort = rush && n < st.rush_count;
                          const over = n > st.rush_count;
                          const cls = short ? 'bg-red-100 text-red-800' : over ? 'bg-orange-100 text-orange-800' : rushShort ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800';
                          return (
                            <td key={d} className="py-1 px-1 text-center">
                              <span data-testid={`station-cell-${st.id}-${d}`} className={`inline-flex min-w-[42px] justify-center rounded-md px-1.5 py-1 font-bold ${cls}`}
                                title={`${n} assigné(s) · besoin ${st.normal_count}${rush ? ` (rush : ${st.rush_count})` : ''}`}>
                                {n}/{rush ? st.rush_count : st.normal_count}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            Rouge : sous le minimum · Ambre : insuffisant pour le rush (jours marqués •) · Orange : au-delà du besoin. Chaque pharmacie configure ses propres postes et périodes.
          </p>
        </div>
      )}
    </div>
  );
};
