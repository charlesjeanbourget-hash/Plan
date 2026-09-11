import { AlertTriangle } from 'lucide-react';
import { Employee, Shift } from '@/types';
import { ScheduleWeekOps } from '@/components/ScheduleWeekOps';
import { ShiftSwapPanel } from '@/components/ShiftSwapPanel';
import { ScheduleDayHourView } from '@/components/ScheduleDayHourView';

export function ShiftConflictsBanner({
  conflicts,
  employees,
  reasonOf,
  weekStart,
}: {
  conflicts: Shift[];
  employees: Employee[];
  reasonOf: (s: Shift) => string | null;
  weekStart?: string;
}): JSX.Element {
  return (
    <>
      <ScheduleWeekOps weekStart={weekStart} />
      <ShiftSwapPanel />
      <ScheduleDayHourView />
      {conflicts.length > 0 && (
    <div data-testid="shift-conflicts-banner" className="mb-4 rounded-xl border-2 border-red-400 bg-red-50 p-4">
      <p className="text-sm font-bold text-red-800 inline-flex items-center gap-2">
        <AlertTriangle className="w-4 h-4" />
        {conflicts.length} conflit{conflicts.length > 1 ? 's' : ''} de quart cette semaine
      </p>
      <p className="text-[11px] text-red-600 mt-1">Double quart le même jour ou quart posé sur un congé approuvé. Les pastilles concernées sont cerclées de rouge.</p>
      <ul className="mt-2 space-y-1">
        {conflicts.slice(0, 10).map((s) => {
          const emp = employees.find((e) => e.id === s.employeeId);
          return (
            <li key={s.id} data-testid={`conflict-row-${s.id}`} className="text-xs text-red-700 font-semibold">
              {emp ? `${emp.firstName} ${emp.lastName}` : 'Employé'} · {s.date} · {s.startTime}–{s.endTime} — {reasonOf(s)}
            </li>
          );
        })}
      </ul>
    </div>
      )}
    </>
  );
}
