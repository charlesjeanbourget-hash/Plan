import { useState } from 'react';
import { Shift, Branch, Employee } from '@/types';
import { AlertTriangle, CheckCircle2, Building2 } from 'lucide-react';
import { FillGapDialog, CoverageGap } from '@/components/FillGapDialog';

interface Props {
  days: string[];
  branches: Branch[];
  shifts: Shift[];
  getEmployee: (id: string) => Employee | undefined;
  weather: Record<string, { icon: string; tmax: number }>;
  canManage: boolean;
}

const toMin = (t: string): number => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const fmtMin = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const findGaps = (intervals: [number, number][], open: number, close: number): [number, number][] => {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let cur = open;
  for (const [s, e] of sorted) {
    if (s > cur) out.push([cur, Math.min(s, close)]);
    cur = Math.max(cur, e);
    if (cur >= close) break;
  }
  if (cur < close) out.push([cur, close]);
  return out.filter(([s, e]) => e - s >= 15);
};

const HOURS_KEY = 'ap_branch_view_hours';

export const MultiBranchView = ({ days, branches, shifts, getEmployee, weather, canManage }: Props): JSX.Element => {
  const [gapToFill, setGapToFill] = useState<CoverageGap | null>(null);
  const saved = ((): { open: string; close: string } => {
    try {
      return { open: '08:00', close: '21:00', ...(JSON.parse(localStorage.getItem(HOURS_KEY) ?? '{}') as object) };
    } catch {
      return { open: '08:00', close: '21:00' };
    }
  })();
  const [openTime, setOpenTime] = useState(saved.open);
  const [closeTime, setCloseTime] = useState(saved.close);
  const setHours = (open: string, close: string): void => {
    setOpenTime(open);
    setCloseTime(close);
    localStorage.setItem(HOURS_KEY, JSON.stringify({ open, close }));
  };

  const branchOfShift = (s: Shift): string => s.branchId || (getEmployee(s.employeeId)?.branchId ?? '');
  const hasUnassigned = shifts.some((s) => !branchOfShift(s));
  const columns: { id: string; name: string; address?: string }[] = [
    ...branches.map((b) => ({ id: b.id, name: b.name, address: b.address })),
    ...(hasUnassigned ? [{ id: '', name: 'Sans succursale' }] : []),
  ];

  const cellShifts = (bid: string, date: string): Shift[] =>
    shifts.filter((s) => s.date === date && branchOfShift(s) === bid)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));

  const weekHours = (bid: string): number =>
    days.reduce((acc, d) => acc + cellShifts(bid, d).reduce((h, s) => h + Math.max(0, toMin(s.endTime) - toMin(s.startTime)) / 60, 0), 0);

  const totalGaps = (bid: string): number =>
    days.reduce((acc, d) => {
      const list = cellShifts(bid, d);
      if (list.length === 0) return acc + 1;
      return acc + (findGaps(list.map((s) => [toMin(s.startTime), toMin(s.endTime)]), toMin(openTime), toMin(closeTime)).length > 0 ? 1 : 0);
    }, 0);

  return (
    <div data-testid="multi-branch-view" className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-slate-100 bg-slate-50/60">
        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400 font-semibold inline-flex items-center gap-1.5">
          <Building2 className="w-3.5 h-3.5 text-emerald-600" /> Toutes les succursales — couverture de la semaine
        </p>
        <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
          <span>Heures d'ouverture :</span>
          <input data-testid="branch-view-open" type="time" value={openTime} onChange={(e) => setHours(e.target.value, closeTime)}
            className="h-7 rounded-md border border-slate-200 px-1.5 text-xs" />
          <span>à</span>
          <input data-testid="branch-view-close" type="time" value={closeTime} onChange={(e) => setHours(openTime, e.target.value)}
            className="h-7 rounded-md border border-slate-200 px-1.5 text-xs" />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs" data-testid="branch-view-table">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left px-4 py-3 text-slate-400 font-semibold uppercase tracking-wider text-[10px] w-28 sticky left-0 bg-white">Jour</th>
              {columns.map((c) => {
                const gapDays = totalGaps(c.id);
                return (
                  <th key={c.id} data-testid={`branch-col-${c.id || 'none'}`} className="text-left px-4 py-3 min-w-[190px]">
                    <p className="font-bold text-slate-800 text-xs">{c.name}</p>
                    {c.address && c.address.trim() && (
                      <p className="text-[11px] font-normal text-slate-500 truncate max-w-[190px]" title={c.address}>{c.address}</p>
                    )}
                    <p className="text-[10px] font-normal text-slate-400 mt-0.5">
                      {weekHours(c.id).toFixed(1).replace('.', ',')} h planifiées ·{' '}
                      {gapDays > 0
                        ? <span className="text-red-600 font-semibold">{gapDays} jour{gapDays > 1 ? 's' : ''} avec trou</span>
                        : <span className="text-emerald-600 font-semibold">couverture complète</span>}
                    </p>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d} className="border-b border-slate-50 align-top hover:bg-slate-50/40">
                <td className="px-4 py-3 sticky left-0 bg-white">
                  <p className="font-bold text-slate-700 capitalize">
                    {new Date(`${d}T12:00:00`).toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric' })}
                  </p>
                  {weather[d] && <p className="text-[10px] text-slate-400">{weather[d].icon} {weather[d].tmax}°</p>}
                </td>
                {columns.map((c) => {
                  const list = cellShifts(c.id, d);
                  const dayGaps = list.length > 0
                    ? findGaps(list.map((s) => [toMin(s.startTime), toMin(s.endTime)]), toMin(openTime), toMin(closeTime))
                    : [];
                  return (
                    <td key={c.id} data-testid={`branch-cell-${c.id || 'none'}-${d}`} className="px-4 py-3">
                      {list.length === 0 ? (
                        <button
                          type="button"
                          data-testid={`gap-fill-empty-${c.id || 'none'}-${d}`}
                          disabled={!canManage}
                          onClick={() => setGapToFill({ date: d, start: openTime, end: closeTime, branchId: c.id, branchName: c.name })}
                          className={`inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 text-red-700 px-2 py-0.5 text-[10px] font-bold ${canManage ? 'hover:bg-red-100 hover:border-red-300 cursor-pointer' : 'cursor-default'}`}
                          title={canManage ? 'Cliquez pour combler ce trou' : undefined}
                        >
                          <AlertTriangle className="w-3 h-3" /> Aucune couverture{canManage && <span className="text-red-400 font-semibold">· combler</span>}
                        </button>
                      ) : (
                        <div className="space-y-1">
                          {list.map((s) => {
                            const emp = getEmployee(s.employeeId);
                            const volatile = !!s.branchId && emp?.branchId !== s.branchId;
                            return (
                              <p key={s.id} className="text-slate-600">
                                <span className="font-semibold text-slate-800">{s.startTime}–{s.endTime}</span>{' '}
                                {emp ? `${emp.firstName} ${emp.lastName.charAt(0)}.` : '—'}
                                {volatile && <span className="ml-1 rounded bg-sky-50 text-sky-700 border border-sky-200 px-1 text-[9px] font-bold align-middle">volatil</span>}
                                {s.training && <span className="ml-1 rounded bg-amber-50 text-amber-700 border border-amber-200 px-1 text-[9px] font-bold align-middle">formation</span>}
                              </p>
                            );
                          })}
                          {dayGaps.length > 0 ? dayGaps.map(([s, e]) => (
                            <button
                              key={`${s}-${e}`}
                              type="button"
                              data-testid={`gap-fill-${c.id || 'none'}-${d}-${s}`}
                              disabled={!canManage}
                              onClick={() => setGapToFill({ date: d, start: fmtMin(s), end: fmtMin(e), branchId: c.id, branchName: c.name })}
                              className={`inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 text-red-700 px-2 py-0.5 text-[10px] font-bold mr-1 ${canManage ? 'hover:bg-red-100 hover:border-red-300 cursor-pointer' : 'cursor-default'}`}
                              title={canManage ? 'Cliquez pour combler ce trou' : undefined}
                            >
                              <AlertTriangle className="w-3 h-3" /> Trou {fmtMin(s)}–{fmtMin(e)}{canManage && <span className="text-red-400 font-semibold">· combler</span>}
                            </button>
                          )) : (
                            <span className="inline-flex items-center gap-1 text-emerald-600 text-[10px] font-semibold">
                              <CheckCircle2 className="w-3 h-3" /> Couvert
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-5 py-2.5 text-[10px] text-slate-400 border-t border-slate-100">
        Un « trou » est une plage sans aucun employé planifié entre les heures d'ouverture choisies.
        {canManage ? ' Cliquez sur un trou pour publier un quart ouvert ou demander un remplaçant d\u2019agence.' : ' Les quarts « volatil » sont ceux effectués hors de la succursale d\u2019origine de l\u2019employé.'}
      </p>
      <FillGapDialog gap={gapToFill} onClose={() => setGapToFill(null)} />
    </div>
  );
};
