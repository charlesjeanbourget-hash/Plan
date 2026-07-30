import { useState, FormEvent } from 'react';
import { useHR } from '@/context/HRContext';
import { useAuth } from '@/context/AuthContext';
import { LeaveType } from '@/types';
import { ModuleHeader, StatusBadge, EmptyState } from '@/components/modules/shared';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Check, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';

const LEAVE_TYPES: LeaveType[] = ['Vacances', 'Maladie', 'Personnel', 'Formation'];

const MONTH_NAMES = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const DAY_HEADERS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

export default function VacationModule(): JSX.Element {
  const { state, addLeaveRequest, setLeaveStatus, getEmployee } = useHR();
  const { currentUser } = useAuth();
  const isAdmin = currentUser?.role !== 'employee';
  const [dialogOpen, setDialogOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState(currentUser?.employeeId ?? state.employees[0]?.id ?? '');
  const [type, setType] = useState<LeaveType>('Vacances');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [calDate, setCalDate] = useState<{ y: number; m: number }>(() => {
    const now = new Date();
    return { y: now.getFullYear(), m: now.getMonth() };
  });

  const changeMonth = (delta: number): void => {
    setCalDate(({ y, m }) => {
      const d = new Date(y, m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  };

  const firstDay = new Date(calDate.y, calDate.m, 1);
  const offset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(calDate.y, calDate.m + 1, 0).getDate();
  const cells: Array<number | null> = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const isoFor = (day: number): string =>
    `${calDate.y}-${String(calDate.m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const approvedLeaves = state.leaveRequests.filter((l) => l.status === 'Approuvée');
  const todayIso = new Date().toISOString().slice(0, 10);

  const requests = isAdmin
    ? state.leaveRequests
    : state.leaveRequests.filter((l) => l.employeeId === currentUser?.employeeId);

  const handleAdd = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    addLeaveRequest({ employeeId, type, startDate, endDate, reason, status: 'En attente' });
    toast.success('Demande de congé soumise.');
    setDialogOpen(false);
    setReason('');
  };

  return (
    <div data-testid="vacations-module">
      <ModuleHeader
        title="Vacances & Congés"
        subtitle={isAdmin ? 'Approuvez ou refusez les demandes de votre équipe.' : 'Vos demandes de congé.'}
        action={
          <Button data-testid="add-leave-button" onClick={() => setDialogOpen(true)} className="rounded-full bg-emerald-600 hover:bg-emerald-700">
            <Plus className="w-4 h-4 mr-1" /> Nouvelle demande
          </Button>
        }
      />
      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-8" data-testid="vacation-calendar">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-heading text-base font-bold text-slate-900">Calendrier des congés approuvés</h2>
          <div className="flex items-center gap-2">
            <Button data-testid="calendar-prev-button" variant="outline" size="icon" className="rounded-full h-8 w-8" onClick={() => changeMonth(-1)}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <p className="text-sm font-semibold text-slate-700 w-40 text-center capitalize" data-testid="calendar-month-label">
              {MONTH_NAMES[calDate.m]} {calDate.y}
            </p>
            <Button data-testid="calendar-next-button" variant="outline" size="icon" className="rounded-full h-8 w-8" onClick={() => changeMonth(1)}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-px bg-slate-200 rounded-lg overflow-hidden border border-slate-200">
          {DAY_HEADERS.map((d) => (
            <div key={d} className="bg-slate-50 py-2 text-center text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">{d}</div>
          ))}
          {cells.map((day, idx) => {
            if (day === null) return <div key={`empty-${idx}`} className="bg-white min-h-[72px]" />;
            const iso = isoFor(day);
            const onLeave = approvedLeaves.filter((l) => l.startDate <= iso && iso <= l.endDate);
            return (
              <div key={iso} className={`bg-white min-h-[72px] p-1.5 ${iso === todayIso ? 'bg-emerald-50' : ''}`}>
                <p className={`text-xs font-semibold mb-1 ${iso === todayIso ? 'text-emerald-700' : 'text-slate-500'}`}>{day}</p>
                <div className="space-y-0.5">
                  {onLeave.map((l) => {
                    const emp = getEmployee(l.employeeId);
                    return (
                      <div key={l.id} className={`${emp?.avatarColor ?? 'bg-slate-400'} text-white text-[10px] font-semibold rounded px-1 py-0.5 truncate`} title={`${emp?.firstName ?? ''} ${emp?.lastName ?? ''} — ${l.type}`}>
                        {emp ? `${emp.firstName} ${emp.lastName[0]}.` : '?'} · {l.type}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {requests.length === 0 ? (
        <EmptyState text="Aucune demande de congé." />
      ) : (
        <div className="space-y-4">
          {requests.map((l) => {
            const emp = getEmployee(l.employeeId);
            return (
              <div key={l.id} data-testid={`leave-card-${l.id}`} className="bg-white rounded-xl border border-slate-200 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3 mb-1.5">
                    <p className="font-heading font-bold text-slate-900">{emp ? `${emp.firstName} ${emp.lastName}` : 'Inconnu'}</p>
                    <StatusBadge status={l.status} />
                    <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{l.type}</span>
                  </div>
                  <p className="text-sm text-slate-600">Du {l.startDate} au {l.endDate}</p>
                  <p className="text-sm text-slate-500 mt-1">{l.reason}</p>
                </div>
                {isAdmin && l.status === 'En attente' && (
                  <div className="flex gap-2 shrink-0">
                    <Button
                      data-testid={`approve-leave-${l.id}`}
                      onClick={() => { setLeaveStatus(l.id, 'Approuvée'); toast.success('Demande approuvée.'); }}
                      className="rounded-full bg-emerald-600 hover:bg-emerald-700"
                    >
                      <Check className="w-4 h-4 mr-1" /> Approuver
                    </Button>
                    <Button
                      data-testid={`reject-leave-${l.id}`}
                      variant="outline"
                      onClick={() => { setLeaveStatus(l.id, 'Refusée'); toast.success('Demande refusée.'); }}
                      className="rounded-full text-red-600 border-red-200 hover:bg-red-50"
                    >
                      <X className="w-4 h-4 mr-1" /> Refuser
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="add-leave-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Nouvelle demande de congé</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4">
            {isAdmin && (
              <div className="space-y-2">
                <Label>Employé</Label>
                <Select value={employeeId} onValueChange={setEmployeeId}>
                  <SelectTrigger data-testid="leave-employee-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {state.employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.firstName} {e.lastName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Type de congé</Label>
              <Select value={type} onValueChange={(v) => setType(v as LeaveType)}>
                <SelectTrigger data-testid="leave-type-select"><SelectValue /></SelectTrigger>
                <SelectContent>{LEAVE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Du</Label>
                <Input data-testid="leave-start-input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Au</Label>
                <Input data-testid="leave-end-input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Raison</Label>
              <Input data-testid="leave-reason-input" value={reason} onChange={(e) => setReason(e.target.value)} required />
            </div>
            <Button data-testid="leave-submit-button" type="submit" className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              Soumettre la demande
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
