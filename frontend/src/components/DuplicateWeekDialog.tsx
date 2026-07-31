import { useState, useMemo } from 'react';
import { useHR } from '@/context/HRContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CopyPlus, CalendarCheck } from 'lucide-react';
import { toast } from 'sonner';

const WEEKS_AHEAD = 16;

const addDays = (isoDate: string, n: number): string => {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const DuplicateWeekDialog = ({ open, onClose, days }: {
  open: boolean;
  onClose: () => void;
  days: string[];
}): JSX.Element => {
  const { state, addShift } = useHR();
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);

  const sourceShifts = state.shifts.filter((s) => s.date >= days[0] && s.date <= days[6]);

  const targetWeeks = useMemo(() => Array.from({ length: WEEKS_AHEAD }, (_, i) => {
    const offset = i + 1;
    const monday = addDays(days[0], offset * 7);
    const sunday = addDays(monday, 6);
    const existing = state.shifts.filter((s) => s.date >= monday && s.date <= sunday).length;
    return { offset, monday, sunday, existing };
  }), [days, state.shifts]);

  const toggle = (offset: number): void =>
    setSelected((sel) => sel.includes(offset) ? sel.filter((o) => o !== offset) : [...sel, offset]);

  const allChecked = selected.length === WEEKS_AHEAD;

  const duplicate = (): void => {
    setBusy(true);
    let copied = 0;
    let skippedExisting = 0;
    let skippedAbsence = 0;
    selected.forEach((offset) => {
      sourceShifts.forEach((s) => {
        const targetDate = addDays(s.date, offset * 7);
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
        addShift({ employeeId: s.employeeId, date: targetDate, startTime: s.startTime, endTime: s.endTime });
        copied += 1;
      });
    });
    const parts = [`${copied} quart(s) copié(s) sur ${selected.length} semaine(s)`];
    if (skippedExisting > 0) parts.push(`${skippedExisting} ignoré(s) — déjà présents`);
    if (skippedAbsence > 0) parts.push(`${skippedAbsence} ignoré(s) — absence approuvée`);
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
            <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
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
            <Button
              data-testid="duplicate-confirm-button"
              onClick={duplicate}
              disabled={busy || selected.length === 0}
              className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700"
            >
              {selected.length === 0
                ? 'Cochez au moins une semaine'
                : `Dupliquer vers ${selected.length} semaine(s)`}
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
