import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { useHR } from '@/context/HRContext';
import { PlannedShift, addDaysIso, computeOvertimeWarnings } from '@/lib/schedule';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CopyPlus, CalendarCheck, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const WEEKS_AHEAD = 16;

export const DuplicateWeekDialog = ({ open, onClose, days }: {
  open: boolean;
  onClose: () => void;
  days: string[];
}): JSX.Element => {
  const { token } = useAuth();
  const { state, addShift } = useHR();
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [maxByEmp, setMaxByEmp] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!open || !token) return;
    axios.get<{ employee_id: string; max_hours_week?: number }[]>(`${API}/profiles`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        const m: Record<string, number> = {};
        r.data.forEach((p) => { if (p.max_hours_week) m[p.employee_id] = p.max_hours_week; });
        setMaxByEmp(m);
      })
      .catch(() => undefined);
  }, [open, token]);

  const sourceShifts = state.shifts.filter((s) => s.date >= days[0] && s.date <= days[6]);

  const targetWeeks = useMemo(() => Array.from({ length: WEEKS_AHEAD }, (_, i) => {
    const offset = i + 1;
    const monday = addDaysIso(days[0], offset * 7);
    const sunday = addDaysIso(monday, 6);
    const existing = state.shifts.filter((s) => s.date >= monday && s.date <= sunday).length;
    return { offset, monday, sunday, existing };
  }), [days, state.shifts]);

  const plan = useMemo(() => {
    const additions: PlannedShift[] = [];
    let skippedExisting = 0;
    let skippedAbsence = 0;
    selected.forEach((offset) => {
      sourceShifts.forEach((s) => {
        const targetDate = addDaysIso(s.date, offset * 7);
        const identical = state.shifts.some((x) =>
          x.employeeId === s.employeeId && x.date === targetDate && x.startTime === s.startTime && x.endTime === s.endTime);
        if (identical) {
          skippedExisting += 1;
          return;
        }
        const absent = state.leaveRequests.some((l) =>
          l.status === 'Approuvée' && l.employeeId === s.employeeId && l.startDate <= targetDate && targetDate <= l.endDate);
        if (absent) {
          skippedAbsence += 1;
          return;
        }
        additions.push({ employeeId: s.employeeId, date: targetDate, startTime: s.startTime, endTime: s.endTime });
      });
    });
    return { additions, skippedExisting, skippedAbsence };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, state.shifts, state.leaveRequests, days]);

  const nameByEmp = useMemo(() =>
    Object.fromEntries(state.employees.map((e) => [e.id, `${e.firstName} ${e.lastName}`])), [state.employees]);

  const overtime = useMemo(() =>
    computeOvertimeWarnings(state.shifts, plan.additions, maxByEmp, nameByEmp),
  [state.shifts, plan.additions, maxByEmp, nameByEmp]);

  const toggle = (offset: number): void =>
    setSelected((sel) => sel.includes(offset) ? sel.filter((o) => o !== offset) : [...sel, offset]);

  const allChecked = selected.length === WEEKS_AHEAD;

  const duplicate = (): void => {
    setBusy(true);
    plan.additions.forEach((a) => addShift(a));
    const parts = [`${plan.additions.length} quart(s) copié(s) sur ${selected.length} semaine(s)`];
    if (plan.skippedExisting > 0) parts.push(`${plan.skippedExisting} ignoré(s) — déjà présents`);
    if (plan.skippedAbsence > 0) parts.push(`${plan.skippedAbsence} ignoré(s) — absence approuvée`);
    toast.success(parts.join(' · '), { duration: 6000 });
    setBusy(false);
    setSelected([]);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="duplicate-week-dialog" className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading inline-flex items-center gap-2">
            <CopyPlus className="w-4 h-4 text-bronze-600" /> Dupliquer la semaine du {days[0]}
          </DialogTitle>
          <DialogDescription>
            Les {sourceShifts.length} quart(s) de cette semaine seront copiés vers les semaines cochées.
            Les quarts identiques déjà présents et ceux tombant sur une absence approuvée seront ignorés.
          </DialogDescription>
        </DialogHeader>
        {sourceShifts.length === 0 ? (
          <p data-testid="duplicate-empty" className="text-sm text-slate-500 py-2">
            Aucun quart dans la semaine affichée — rien à dupliquer.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.15em] text-slate-500 font-semibold">Semaines cibles</p>
              <button
                type="button"
                data-testid="duplicate-toggle-all"
                onClick={() => setSelected(allChecked ? [] : targetWeeks.map((w) => w.offset))}
                className="text-xs font-semibold text-emerald-700 hover:text-emerald-900"
              >
                {allChecked ? 'Tout décocher' : 'Tout cocher'}
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
              {targetWeeks.map((w) => (
                <label
                  key={w.offset}
                  data-testid={`duplicate-week-row-${w.offset}`}
                  className="flex items-center gap-3 px-3.5 py-2.5 cursor-pointer hover:bg-slate-50 transition-colors"
                >
                  <Checkbox
                    data-testid={`duplicate-week-checkbox-${w.offset}`}
                    checked={selected.includes(w.offset)}
                    onCheckedChange={() => toggle(w.offset)}
                  />
                  <span className="text-sm font-semibold text-slate-800 flex-1">Semaine du {w.monday}</span>
                  {w.existing > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-bronze-100 text-bronze-800">
                      <CalendarCheck className="w-2.5 h-2.5" /> {w.existing} quart(s) déjà présents
                    </span>
                  )}
                </label>
              ))}
            </div>
            {overtime.length > 0 && (
              <div data-testid="duplicate-overtime-warning" className="rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="text-xs font-bold text-red-700 inline-flex items-center gap-1.5 mb-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" /> Dépassement du maximum d'heures hebdomadaires
                </p>
                <ul className="space-y-1">
                  {overtime.map((w) => (
                    <li key={`${w.employeeId}-${w.weekMonday}`} className="text-xs text-red-700 font-semibold">
                      — {w.employeeName} : {w.projected} h &gt; max {w.max} h — semaine du {w.weekMonday}
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-red-600/80 mt-1.5">Vous pouvez confirmer malgré tout, en connaissance de cause.</p>
              </div>
            )}
            <Button
              data-testid="duplicate-confirm-button"
              onClick={duplicate}
              disabled={busy || selected.length === 0}
              className={`w-full rounded-full ${overtime.length > 0 ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
            >
              {selected.length === 0
                ? 'Cochez au moins une semaine'
                : overtime.length > 0
                  ? `Dupliquer quand même vers ${selected.length} semaine(s)`
                  : `Dupliquer vers ${selected.length} semaine(s)`}
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
