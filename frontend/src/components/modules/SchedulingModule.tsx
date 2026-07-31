import { useState, useEffect, useCallback, FormEvent } from 'react';
import axios from 'axios';
import { useHR } from '@/context/HRContext';
import { useAuth } from '@/context/AuthContext';
import { ReplacementRequestDoc, Appointment } from '@/types';
import { ModuleHeader } from '@/components/modules/shared';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronLeft, ChevronRight, Plus, X, ArrowLeftRight, Check, Stethoscope } from 'lucide-react';
import { ScheduleProposals } from '@/components/ScheduleProposals';
import { AppointmentDialog } from '@/components/AppointmentDialog';
import { toast } from 'sonner';

const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const getWeekStart = (offsetWeeks: number): Date => {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day + offsetWeeks * 7);
  d.setHours(0, 0, 0, 0);
  return d;
};

const iso = (d: Date): string => d.toISOString().slice(0, 10);

export default function SchedulingModule(): JSX.Element {
  const { state, addShift, deleteShift, updateShift, setShiftSwapStatus, getEmployee } = useHR();
  const { currentUser, token } = useAuth();
  const isAdmin = currentUser?.role !== 'employee';
  const [weekOffset, setWeekOffset] = useState(0);
  const [branchFilter, setBranchFilter] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState(state.employees[0]?.id ?? '');
  const [date, setDate] = useState(iso(new Date()));
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [replacements, setReplacements] = useState<ReplacementRequestDoc[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [apptOpen, setApptOpen] = useState(false);

  useEffect(() => {
    if (!isAdmin || !token) return;
    axios.get<ReplacementRequestDoc[]>(`${API}/replacements/requests`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => setReplacements(r.data.filter((q) => q.status === 'filled' && !!q.chosen_offer)))
      .catch(() => undefined);
  }, [isAdmin, token]);

  const weekStart = getWeekStart(weekOffset);
  const days: string[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return iso(d);
  });
  const today = iso(new Date());

  const refreshAppointments = useCallback(async (): Promise<void> => {
    try {
      const res = await axios.get<Appointment[]>(`${API}/appointments?start=${days[0]}&end=${days[6]}`, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      setAppointments(res.data);
    } catch {
      setAppointments([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, days[0], days[6]]);

  useEffect(() => { void refreshAppointments(); }, [refreshAppointments]);

  const removeAppointment = async (id: string): Promise<void> => {
    try {
      await axios.delete(`${API}/appointments/${id}`, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      toast.success('Rendez-vous supprimé.');
      await refreshAppointments();
    } catch {
      toast.error('Suppression impossible.');
    }
  };

  const myEmp = state.employees.find((e) => e.id === currentUser?.employeeId);
  const isNurse = myEmp?.position === 'Infirmier(ère)';

  const handleAdd = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!employeeId) return;
    addShift({ employeeId, date, startTime, endTime });
    toast.success('Quart de travail ajouté à l\'horaire.');
    setDialogOpen(false);
  };

  const pendingSwaps = state.shiftSwaps.filter((s) => s.status === 'En attente');

  const approveSwap = (swapId: string): void => {
    const swap = state.shiftSwaps.find((s) => s.id === swapId);
    if (!swap) return;
    updateShift(swap.shiftId, { employeeId: swap.targetEmployeeId });
    setShiftSwapStatus(swapId, 'Approuvée');
    toast.success('Échange approuvé — l\'horaire a été mis à jour automatiquement.');
  };

  return (
    <div data-testid="scheduling-module">
      <ModuleHeader
        title="Horaires"
        subtitle="Planifiez les quarts de travail de la semaine."
        action={
          <div className="flex flex-wrap gap-2">
            {(isNurse || isAdmin) && (
              <Button data-testid="add-appointment-button" variant="outline" onClick={() => setApptOpen(true)} className="rounded-full border-sky-300 text-sky-800 hover:bg-sky-50">
                <Stethoscope className="w-4 h-4 mr-1" /> Rendez-vous
              </Button>
            )}
            <Button data-testid="add-shift-button" onClick={() => setDialogOpen(true)} className="rounded-full bg-emerald-600 hover:bg-emerald-700">
              <Plus className="w-4 h-4 mr-1" /> Nouveau quart
            </Button>
          </div>
        }
      />
      {isAdmin && <ScheduleProposals />}
      {isAdmin && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6" data-testid="swap-requests-panel">
          <h2 className="font-heading text-base font-bold text-slate-900 mb-4 inline-flex items-center gap-2">
            <ArrowLeftRight className="w-4 h-4 text-emerald-600" /> Demandes d'échange de quarts
          </h2>
          {pendingSwaps.length === 0 ? (
            <p className="text-sm text-slate-500">Aucune demande d'échange en attente.</p>
          ) : (
            <div className="space-y-3">
              {pendingSwaps.map((swap) => {
                const shift = state.shifts.find((s) => s.id === swap.shiftId);
                const requester = getEmployee(swap.requesterId);
                const target = getEmployee(swap.targetEmployeeId);
                return (
                  <div key={swap.id} data-testid={`swap-request-${swap.id}`} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">
                        {requester ? `${requester.firstName} ${requester.lastName}` : '?'} → {target ? `${target.firstName} ${target.lastName}` : '?'}
                      </p>
                      <p className="text-xs text-slate-500">
                        {shift ? `${shift.date} · ${shift.startTime}–${shift.endTime}` : 'Quart introuvable'} · {swap.reason}
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button data-testid={`approve-swap-${swap.id}`} size="sm" onClick={() => approveSwap(swap.id)} className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs">
                        <Check className="w-3.5 h-3.5 mr-1" /> Approuver
                      </Button>
                      <Button data-testid={`reject-swap-${swap.id}`} size="sm" variant="outline" onClick={() => { setShiftSwapStatus(swap.id, 'Refusée'); toast.success('Échange refusé.'); }} className="rounded-full text-xs text-red-600 border-red-200 hover:bg-red-50">
                        <X className="w-3.5 h-3.5 mr-1" /> Refuser
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-6">
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
        <div className="ml-auto w-full sm:w-auto">
          <Select value={branchFilter} onValueChange={setBranchFilter}>
            <SelectTrigger data-testid="scheduling-branch-filter" className="w-full sm:w-56">
              <SelectValue placeholder="Toutes les succursales" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les succursales</SelectItem>
              {state.branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
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
            {state.employees.filter((e) => branchFilter === 'all' || e.branchId === branchFilter).map((emp) => (
              <tr key={emp.id}>
                <td className="p-4 border-b border-r border-slate-200 align-top">
                  <p className="font-semibold text-slate-800">{emp.firstName} {emp.lastName}</p>
                  <p className="text-xs text-slate-500">{emp.position}</p>
                </td>
                {days.map((d) => {
                  const shifts = state.shifts.filter((s) => s.employeeId === emp.id && s.date === d);
                  const appts = appointments.filter((a) => a.employee_id === emp.id && a.date === d);
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
                      {appts.map((a) => (
                        <div
                          key={a.id}
                          data-testid={`appointment-chip-${a.id}`}
                          className="group relative bg-sky-100 border border-sky-300 text-sky-900 rounded-lg px-2 py-1 mb-1 text-[11px] font-semibold"
                          title={`${a.client_name}${a.reason ? ` — ${a.reason}` : ''}${a.notes ? ` · ${a.notes}` : ''}`}
                        >
                          <span className="inline-flex items-center gap-1"><Stethoscope className="w-3 h-3" /> {a.start}–{a.end}</span>
                          <span className="block text-[10px] font-normal truncate">{a.client_name}{a.reason ? ` · ${a.reason}` : ''}</span>
                          {(isAdmin || currentUser?.employeeId === a.employee_id) && (
                            <button
                              data-testid={`delete-appointment-${a.id}`}
                              onClick={() => void removeAppointment(a.id)}
                              className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white hidden group-hover:flex items-center justify-center"
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </td>
                  );
                })}
              </tr>
            ))}
            {isAdmin && (() => {
              const weekSlots = replacements.flatMap((q) =>
                q.slots
                  .filter((s) => days.includes(s.date))
                  .map((s) => ({ ...s, candidate: q.chosen_offer?.candidate_name ?? '', agency: q.chosen_offer?.agency_name ?? '', role: q.role })));
              if (weekSlots.length === 0) return null;
              return (
                <tr data-testid="replacements-schedule-row" className="bg-bronze-50/40 border-t-2 border-bronze-200">
                  <td className="p-4 border-r border-slate-200 align-top">
                    <p className="font-semibold text-bronze-800">Remplaçants (agence)</p>
                    <p className="text-xs text-bronze-700/70">Retenus via le module Remplacements</p>
                  </td>
                  {days.map((d) => (
                    <td key={d} className="p-2 border-r border-slate-200 last:border-r-0 align-top">
                      {weekSlots.filter((s) => s.date === d).map((s, i) => (
                        <div
                          key={`${s.date}-${i}`}
                          data-testid={`replacement-chip-${s.date}-${i}`}
                          className="bg-bronze-100 border border-bronze-300 text-bronze-900 rounded-lg px-2 py-1.5 mb-1 text-xs font-semibold text-center"
                          title={`${s.candidate} (${s.agency}) — ${s.role}`}
                        >
                          {s.start}–{s.end}
                          <span className="block text-[10px] font-normal truncate">{s.candidate} · {s.role}</span>
                        </div>
                      ))}
                    </td>
                  ))}
                </tr>
              );
            })()}
          </tbody>
        </table>
      </div>

      <AppointmentDialog open={apptOpen} onOpenChange={setApptOpen} onCreated={() => void refreshAppointments()} />

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
