import { useMemo, useState } from 'react';
import { Clock } from 'lucide-react';
import { useHR } from '@/context/HRContext';
import { requestNavigate } from '@/lib/nav';
import { Input } from '@/components/ui/input';

const HOURS = Array.from({ length: 17 }, (_, i) => i + 6);

const toMin = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

export function ScheduleDayHourView(): JSX.Element {
  const { state, getEmployee } = useHR();
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const ofDay = useMemo(() => state.shifts.filter((s) => s.date === day), [state.shifts, day]);

  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4" data-testid="schedule-day-hour">
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <p className="text-sm font-bold text-slate-800 inline-flex items-center gap-2">
          <Clock className="w-4 h-4 text-emerald-600" /> Journée par heure
        </p>
        <Input data-testid="day-hour-date" type="date" value={day} onChange={(e) => setDay(e.target.value)} className="w-40 h-8 text-xs" />
        <span className="text-xs text-slate-500">{ofDay.length} quart(s)</span>
      </div>
      <div className="space-y-1 max-h-72 overflow-y-auto">
        {HOURS.map((h) => {
          const start = h * 60;
          const end = start + 60;
          const here = ofDay.filter((s) => toMin(s.startTime) < end && toMin(s.endTime) > start);
          return (
            <div key={h} className="grid grid-cols-[52px_1fr] gap-2 items-start">
              <span className="text-[11px] font-semibold text-slate-400 pt-1">{String(h).padStart(2, '0')}:00</span>
              <div className="min-h-[28px] rounded-md bg-slate-50 border border-slate-100 px-2 py-1 flex flex-wrap gap-1">
                {here.map((s) => {
                  const e = getEmployee(s.employeeId);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      data-testid={`day-hour-shift-${s.id}`}
                      onClick={() => requestNavigate('employees', { employeeId: s.employeeId })}
                      className="rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-semibold px-2 py-0.5 hover:bg-emerald-200"
                    >
                      {e ? `${e.firstName} ${e.lastName[0]}.` : '?'} {s.startTime}–{s.endTime} {s.department ? `· ${s.department}` : ''}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
