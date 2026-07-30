import { useState, FormEvent } from 'react';
import { useHR } from '@/context/HRContext';
import { ModuleHeader } from '@/components/modules/shared';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { toast } from 'sonner';

const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

const getWeekStart = (offsetWeeks: number): Date => {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day + offsetWeeks * 7);
  d.setHours(0, 0, 0, 0);
  return d;
};

const iso = (d: Date): string => d.toISOString().slice(0, 10);

export default function SchedulingModule(): JSX.Element {
  const { state, addShift, deleteShift } = useHR();
  const [weekOffset, setWeekOffset] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState(state.employees[0]?.id ?? '');
  const [date, setDate] = useState(iso(new Date()));
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');

  const weekStart = getWeekStart(weekOffset);
  const days: string[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return iso(d);
  });
  const today = iso(new Date());

  const handleAdd = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!employeeId) return;
    addShift({ employeeId, date, startTime, endTime });
    toast.success('Quart de travail ajouté à l\'horaire.');
    setDialogOpen(false);
  };

  return (
    <div data-testid="scheduling-module">
      <ModuleHeader
        title="Horaires"
        subtitle="Planifiez les quarts de travail de la semaine."
        action={
          <Button data-testid="add-shift-button" onClick={() => setDialogOpen(true)} className="rounded-full bg-emerald-600 hover:bg-emerald-700">
            <Plus className="w-4 h-4 mr-1" /> Nouveau quart
          </Button>
        }
      />
      <div className="flex items-center gap-3 mb-6">
        <Button data-testid="week-prev-button" variant="outline" size="icon" className="rounded-full" onClick={() => setWeekOffset(weekOffset - 1)}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <p className="text-sm font-semibold text-slate-700" data-testid="week-range-label">
          Semaine du {days[0]} au {days[6]}
        </p>
        <Button data-testid="week-next-button" variant="outline" size="icon" className="rounded-full" onClick={() => setWeekOffset(weekOffset + 1)}>
          <ChevronRight className="w-4 h-4" />
        </Button>
        {weekOffset !== 0 && (
          <button data-testid="week-today-button" onClick={() => setWeekOffset(0)} className="text-sm text-emerald-700 font-semibold hover:underline">
            Cette semaine
          </button>
        )}
      </div>

      <div className="overflow-x-auto bg-white rounded-xl border border-slate-200">
        <table className="w-full text-sm border-collapse min-w-[900px]">
          <thead>
            <tr>
              <th className="text-left p-4 border-b border-r border-slate-200 text-xs uppercase tracking-[0.15em] text-slate-500 w-48">Employé</th>
              {days.map((d, i) => (
                <th key={d} className={`p-3 border-b border-r border-slate-200 last:border-r-0 text-xs font-semibold ${d === today ? 'bg-emerald-50 text-emerald-800' : 'text-slate-600'}`}>
                  {DAY_LABELS[i]} <span className="block text-[11px] font-normal text-slate-400">{d.slice(5)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {state.employees.map((emp) => (
              <tr key={emp.id}>
                <td className="p-4 border-b border-r border-slate-200 align-top">
                  <p className="font-semibold text-slate-800">{emp.firstName} {emp.lastName}</p>
                  <p className="text-xs text-slate-500">{emp.position}</p>
                </td>
                {days.map((d) => {
                  const shifts = state.shifts.filter((s) => s.employeeId === emp.id && s.date === d);
                  return (
                    <td key={d} className={`p-2 border-b border-r border-slate-200 last:border-r-0 align-top ${d === today ? 'bg-emerald-50/50' : ''}`}>
                      {shifts.map((s) => (
                        <div key={s.id} className="group relative bg-emerald-600 text-white rounded-lg px-2 py-1.5 mb-1 text-xs font-semibold text-center">
                          {s.startTime}–{s.endTime}
                          <button
                            data-testid={`delete-shift-${s.id}`}
                            onClick={() => { deleteShift(s.id); toast.success('Quart supprimé.'); }}
                            className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white hidden group-hover:flex items-center justify-center"
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      ))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="add-shift-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Nouveau quart de travail</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="space-y-2">
              <Label>Employé</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger data-testid="shift-employee-select"><SelectValue placeholder="Choisir un employé" /></SelectTrigger>
                <SelectContent>
                  {state.employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.firstName} {e.lastName} — {e.position}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Date</Label>
              <Input data-testid="shift-date-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Début</Label>
                <Input data-testid="shift-start-input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Fin</Label>
                <Input data-testid="shift-end-input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
              </div>
            </div>
            <Button data-testid="shift-submit-button" type="submit" className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              Ajouter le quart
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
