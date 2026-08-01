import { useState, useEffect, useCallback, FormEvent } from 'react';
import axios from 'axios';
import { useHR } from '@/context/HRContext';
import { useAuth } from '@/context/AuthContext';
import { ReplacementRequestDoc, Appointment, Shift } from '@/types';
import { ModuleHeader } from '@/components/modules/shared';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronLeft, ChevronRight, Plus, X, ArrowLeftRight, Check, Stethoscope, CopyPlus, LayoutTemplate, FileDown, Megaphone, Hourglass, BookOpenCheck, MapPin, Wrench, Hand, Sparkles, AlertTriangle } from 'lucide-react';
import { ScheduleProposals } from '@/components/ScheduleProposals';
import { AppointmentDialog } from '@/components/AppointmentDialog';
import { DuplicateWeekDialog } from '@/components/DuplicateWeekDialog';
import { WeekTemplatesDialog } from '@/components/WeekTemplatesDialog';
import { BudgetActualCard } from '@/components/BudgetActualCard';
import { ReadReceiptsDialog } from '@/components/ReadReceiptsDialog';
import { downloadSchedulePdf } from '@/lib/schedulePdf';
import { hoursBetween } from '@/lib/schedule';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const getWeekStart = (offsetWeeks: number): Date => {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day + offsetWeeks * 7);
  d.setHours(0, 0, 0, 0);
  return d;
};

const iso = (d: Date): string => d.toISOString().slice(0, 10);

const FULL_DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

const dayPart = (start: string): { bar: string; bg: string } => {
  const h = Number(start.slice(0, 2));
  if (h < 12) return { bar: 'bg-emerald-500', bg: 'bg-emerald-50' };
  if (h < 17) return { bar: 'bg-sky-500', bg: 'bg-sky-50' };
  return { bar: 'bg-bronze-500', bg: 'bg-bronze-50' };
};

const fmtHours = (n: number): string => `${(Math.round(n * 10) / 10).toLocaleString('fr-CA')} h`;

const fmtCad = (n: number): string => n.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });

const dayDate = (d: string): string => new Date(`${d}T00:00:00`).toLocaleDateString('fr-CA', { day: '2-digit', month: 'short' });

const monthLabel = (d: Date): string => d.toLocaleDateString('fr-CA', { month: 'long', year: 'numeric' });

const monthGridDays = (anchor: Date): string[] => {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const end = new Date(last);
  end.setDate(last.getDate() + (6 - ((last.getDay() + 6) % 7)));
  const out: string[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) out.push(iso(d));
  return out;
};

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
  const [dupOpen, setDupOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [receiptsOpen, setReceiptsOpen] = useState(false);
  const [selectedResources, setSelectedResources] = useState<string[]>([]);
  const [dragShiftId, setDragShiftId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin || !token) return;
    axios.get<ReplacementRequestDoc[]>(`${API}/replacements/requests`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => setReplacements(r.data.filter((q) => q.status === 'filled' && !!q.chosen_offer)))
      .catch(() => undefined);
  }, [isAdmin, token]);

  const [rates, setRates] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!isAdmin || !token) return;
    axios.get<{ employee_id: string; hourly_rate?: number }[]>(`${API}/profiles`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        const m: Record<string, number> = {};
        r.data.forEach((p) => { m[p.employee_id] = p.hourly_rate ?? 0; });
        setRates(m);
      })
      .catch(() => undefined);
  }, [isAdmin, token]);

  const quickAdd = (empId: string, d: string): void => {
    setEmployeeId(empId);
    setDate(d);
    setDialogOpen(true);
  };

  const [viewMode, setViewMode] = useState<'week' | 'month'>('week');
  const [monthAnchor, setMonthAnchor] = useState(() => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), 1);
  });
  const [moveShiftId, setMoveShiftId] = useState<string | null>(null);

  useEffect(() => {
    if (!moveShiftId) return undefined;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setMoveShiftId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moveShiftId]);

  const conflictOf = (s: Shift): string | null => {
    const overlap = state.shifts.some((x) => x.id !== s.id && x.employeeId === s.employeeId && x.date === s.date
      && x.startTime < s.endTime && s.startTime < x.endTime);
    if (overlap) return 'Conflit : chevauche un autre quart du même employé';
    const leave = state.leaveRequests.find((l) => l.employeeId === s.employeeId && l.status === 'Approuvée'
      && l.startDate <= s.date && s.date <= l.endDate);
    if (leave) return `Conflit : absence approuvée (${leave.type}) du ${leave.startDate} au ${leave.endDate}`;
    return null;
  };

  const moveTo = (empId: string | null, d: string): void => {
    if (!moveShiftId) return;
    const s = state.shifts.find((x) => x.id === moveShiftId);
    setMoveShiftId(null);
    if (!s) return;
    if ((empId ?? s.employeeId) === s.employeeId && d === s.date) return;
    updateShift(s.id, { ...(empId ? { employeeId: empId } : {}), date: d });
    const emp = state.employees.find((e) => e.id === (empId ?? s.employeeId));
    toast.success(`Quart ${s.startTime}–${s.endTime} déplacé${emp ? ` vers ${emp.firstName} ${emp.lastName}` : ''} le ${d}.`);
  };

  const selectForMove = (s: Shift, empId: string, d: string): void => {
    if (!isAdmin) return;
    if (moveShiftId && moveShiftId !== s.id) {
      moveTo(empId, d);
      return;
    }
    setMoveShiftId(moveShiftId === s.id ? null : s.id);
  };

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
    addShift({ employeeId, date, startTime, endTime, resourceIds: selectedResources });
    toast.success('Quart de travail ajouté à l\'horaire.');
    setSelectedResources([]);
    setDialogOpen(false);
  };

  const toggleResource = (id: string): void => {
    setSelectedResources((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleDrop = (empId: string, d: string, copy: boolean): void => {
    if (!isAdmin || !dragShiftId) return;
    const shift = state.shifts.find((s) => s.id === dragShiftId);
    setDragShiftId(null);
    setDropTarget(null);
    if (!shift) return;
    const emp = getEmployee(empId);
    const empName = emp ? `${emp.firstName} ${emp.lastName}` : 'l\'employé';
    if (copy) {
      addShift({ employeeId: empId, date: d, startTime: shift.startTime, endTime: shift.endTime, resourceIds: [...(shift.resourceIds ?? [])] });
      toast.success(`Quart ${shift.startTime}–${shift.endTime} dupliqué pour ${empName} le ${d}.`);
      return;
    }
    if (shift.employeeId === empId && shift.date === d) return;
    updateShift(shift.id, { employeeId: empId, date: d });
    toast.success(`Quart ${shift.startTime}–${shift.endTime} déplacé vers ${empName} le ${d}.`);
  };

  const pendingSwaps = state.shiftSwaps.filter(
    (s) => s.status === 'En attente' && (s.peerStatus ?? 'Approuvée') === 'Approuvée');
  const awaitingPeerSwaps = state.shiftSwaps.filter(
    (s) => s.status === 'En attente' && s.peerStatus === 'En attente');

  const approveSwap = (swapId: string): void => {
    const swap = state.shiftSwaps.find((s) => s.id === swapId);
    if (!swap) return;
    updateShift(swap.shiftId, { employeeId: swap.targetEmployeeId });
    setShiftSwapStatus(swapId, 'Approuvée');
    toast.success('Échange approuvé — l\'horaire a été mis à jour automatiquement.');
  };

  useEffect(() => {
    if (currentUser?.role !== 'employee' || !currentUser.employeeId || !token) return;
    axios.post(`${API}/schedule/seen`, { week_start: days[0] }, { headers: { Authorization: `Bearer ${token}` } })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days[0], currentUser?.employeeId, token]);

  const publishWeek = async (): Promise<void> => {
    const byEmp = new Map<string, { shift_count: number; hours: number }>();
    state.shifts
      .filter((s) => s.date >= days[0] && s.date <= days[6])
      .forEach((s) => {
        const e = byEmp.get(s.employeeId) ?? { shift_count: 0, hours: 0 };
        e.shift_count += 1;
        e.hours += hoursBetween(s.startTime, s.endTime);
        byEmp.set(s.employeeId, e);
      });
    if (byEmp.size === 0) {
      toast.error('Aucun quart dans la semaine affichée — rien à publier.');
      return;
    }
    setPublishing(true);
    try {
      const res = await axios.post<{ notified: number; emailed: number; updated: boolean }>(`${API}/schedule/publish`, {
        week_start: days[0],
        recipients: Array.from(byEmp.entries()).map(([eid, v]) => {
          const emp = state.employees.find((x) => x.id === eid);
          return {
            employee_id: eid,
            employee_name: emp ? `${emp.firstName} ${emp.lastName}` : '',
            shift_count: v.shift_count,
            hours: Math.round(v.hours * 10) / 10,
          };
        }),
      }, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      toast.success(
        `Horaire ${res.data.updated ? 'republié (modifié)' : 'publié'} : ${res.data.notified} employé(s) notifié(s), ${res.data.emailed} courriel(s) envoyé(s).`,
        { duration: 6000 });
    } catch {
      toast.error('Publication impossible.');
    } finally {
      setPublishing(false);
    }
  };

  const exportPdf = (): void => {
    void downloadSchedulePdf(days, state.shifts, state.employees, state.pharmacies[0]?.name ?? 'Arrière Plan');
    toast.success('PDF de la semaine téléchargé — prêt pour la salle du personnel.');
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
            {isAdmin && (
              <>
                <Button data-testid="week-templates-button" variant="outline" onClick={() => setTplOpen(true)} className="rounded-full border-bronze-300 text-bronze-800 hover:bg-bronze-50">
                  <LayoutTemplate className="w-4 h-4 mr-1" /> Modèles
                </Button>
                <Button data-testid="duplicate-week-button" variant="outline" onClick={() => setDupOpen(true)} className="rounded-full border-bronze-300 text-bronze-800 hover:bg-bronze-50">
                  <CopyPlus className="w-4 h-4 mr-1" /> Dupliquer la semaine
                </Button>
                <Button data-testid="schedule-pdf-button" variant="outline" onClick={exportPdf} className="rounded-full">
                  <FileDown className="w-4 h-4 mr-1" /> PDF
                </Button>
                <Button data-testid="publish-week-button" onClick={() => void publishWeek()} disabled={publishing} className="rounded-full bg-bronze-600 hover:bg-bronze-700 text-white">
                  <Megaphone className="w-4 h-4 mr-1" /> {publishing ? 'Publication…' : 'Publier la semaine'}
                </Button>
                <Button data-testid="read-receipts-button" variant="outline" onClick={() => setReceiptsOpen(true)} className="rounded-full">
                  <BookOpenCheck className="w-4 h-4 mr-1" /> Accusés
                </Button>
                <Button data-testid="add-shift-button" onClick={() => setDialogOpen(true)} className="rounded-full bg-emerald-600 hover:bg-emerald-700">
                  <Plus className="w-4 h-4 mr-1" /> Nouveau quart
                </Button>
              </>
            )}
          </div>
        }
      />
      {isAdmin && <ScheduleProposals />}
      {isAdmin && <BudgetActualCard />}
      {isAdmin && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6" data-testid="swap-requests-panel">
          <h2 className="font-heading text-base font-bold text-slate-900 mb-4 inline-flex items-center gap-2">
            <ArrowLeftRight className="w-4 h-4 text-emerald-600" /> Demandes d'échange de quarts
          </h2>
          {pendingSwaps.length === 0 && awaitingPeerSwaps.length === 0 ? (
            <p className="text-sm text-slate-500">Aucune demande d'échange en attente.</p>
          ) : (
            <div className="space-y-3">
              {awaitingPeerSwaps.map((swap) => {
                const shift = state.shifts.find((s) => s.id === swap.shiftId);
                const requester = getEmployee(swap.requesterId);
                const target = getEmployee(swap.targetEmployeeId);
                return (
                  <div key={swap.id} data-testid={`swap-awaiting-${swap.id}`} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-600">
                        {requester ? `${requester.firstName} ${requester.lastName}` : '?'} → {target ? `${target.firstName} ${target.lastName}` : '?'}
                      </p>
                      <p className="text-xs text-slate-500">
                        {shift ? `${shift.date} · ${shift.startTime}–${shift.endTime}` : 'Quart introuvable'} · {swap.reason}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-bronze-100 text-bronze-800 text-xs font-semibold shrink-0">
                      <Hourglass className="w-3 h-3" /> En attente du collègue
                    </span>
                  </div>
                );
              })}
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
        <div className="inline-flex rounded-full border border-slate-200 bg-white p-0.5 shadow-sm" data-testid="view-mode-toggle">
          <button
            data-testid="view-week-button"
            onClick={() => setViewMode('week')}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${viewMode === 'week' ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:text-slate-800'}`}
          >
            Semaine
          </button>
          <button
            data-testid="view-month-button"
            onClick={() => setViewMode('month')}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${viewMode === 'month' ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:text-slate-800'}`}
          >
            Mois
          </button>
        </div>
        {viewMode === 'week' ? (
          <>
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
          </>
        ) : (
          <>
            <Button data-testid="month-prev-button" variant="outline" size="icon" className="rounded-full" onClick={() => setMonthAnchor(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() - 1, 1))}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <p className="text-sm font-semibold text-slate-700 capitalize" data-testid="month-range-label">
              {monthLabel(monthAnchor)}
            </p>
            <Button data-testid="month-next-button" variant="outline" size="icon" className="rounded-full" onClick={() => setMonthAnchor(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 1))}>
              <ChevronRight className="w-4 h-4" />
            </Button>
            {monthAnchor.getTime() !== new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() && (
              <button data-testid="month-today-button" onClick={() => { const t = new Date(); setMonthAnchor(new Date(t.getFullYear(), t.getMonth(), 1)); }} className="text-sm text-emerald-700 font-semibold hover:underline">
                Ce mois-ci
              </button>
            )}
          </>
        )}
        {isAdmin && (
          <span data-testid="dnd-hint" className="hidden lg:inline-flex items-center gap-1.5 text-xs text-slate-400">
            <Hand className="w-3.5 h-3.5" /> Glissez-déposez ou cliquez un quart puis sa nouvelle case · <kbd className="px-1 py-0.5 rounded border border-slate-300 bg-slate-50 text-[10px] font-semibold text-slate-600">Alt</kbd>+glisser pour dupliquer
          </span>
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

      {moveShiftId && (
        <div data-testid="move-mode-banner" className="mb-4 flex items-center gap-2 rounded-xl bg-bronze-50 border border-bronze-300 px-4 py-2.5 text-sm text-bronze-900">
          <Hand className="w-4 h-4 shrink-0" />
          <span>Mode déplacement : cliquez sur la case (ou le jour) où déplacer le quart sélectionné.</span>
          <button data-testid="move-cancel-button" onClick={() => setMoveShiftId(null)} className="ml-auto text-xs font-semibold underline shrink-0">
            Annuler (Échap)
          </button>
        </div>
      )}

      <div className="hidden sm:flex flex-wrap items-center gap-4 mb-3 text-xs text-slate-500" data-testid="schedule-legend">
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Matin</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-sky-500" /> Après-midi</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-bronze-500" /> Soir</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-600 text-white text-[9px] font-bold px-1.5 py-px"><Sparkles className="w-2 h-2" /> IA</span>
          généré par l'IA
        </span>
        <span className="inline-flex items-center gap-1.5"><AlertTriangle className="w-3 h-3 text-red-500" /> Conflit (double quart ou absence approuvée)</span>
      </div>

      {viewMode === 'week' && (
      <div className="overflow-x-auto bg-white rounded-2xl border border-slate-200 shadow-sm">
        <table className="w-full text-sm border-collapse min-w-[1100px]">
          <thead>
            <tr className="bg-slate-50/80">
              <th className="text-left px-5 py-4 border-b border-r border-slate-200 text-[11px] uppercase tracking-[0.18em] text-slate-400 font-semibold w-52">Employé</th>
              {days.map((d, i) => (
                <th key={d} className={`px-3 py-3 border-b border-r border-slate-200 text-center ${d === today ? 'bg-emerald-600 text-white' : 'text-slate-700'}`}>
                  <span className="block text-sm font-bold font-heading">{FULL_DAYS[i]}</span>
                  <span className={`block text-[11px] font-normal mt-0.5 ${d === today ? 'text-emerald-100' : 'text-slate-400'}`}>{dayDate(d)}</span>
                </th>
              ))}
              <th className="px-4 py-3 border-b border-slate-200 text-right text-[11px] uppercase tracking-[0.18em] text-slate-400 font-semibold w-32 bg-slate-100/60">Total</th>
            </tr>
          </thead>
          <tbody>
            {state.employees.filter((e) => branchFilter === 'all' || e.branchId === branchFilter).map((emp) => {
              const rowHours = state.shifts
                .filter((s) => s.employeeId === emp.id && s.date >= days[0] && s.date <= days[6])
                .reduce((sum, s) => sum + hoursBetween(s.startTime, s.endTime), 0);
              const rate = rates[emp.id] ?? 0;
              return (
              <tr key={emp.id}>
                <td className="px-5 py-4 border-b border-r border-slate-200 align-top">
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-full ${emp.avatarColor} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                      {emp.firstName[0]}{emp.lastName[0]}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-800 truncate">{emp.firstName} {emp.lastName}</p>
                      <p className="text-xs text-slate-500 truncate">{emp.position}</p>
                    </div>
                  </div>
                </td>
                {days.map((d) => {
                  const shifts = state.shifts.filter((s) => s.employeeId === emp.id && s.date === d);
                  const appts = appointments.filter((a) => a.employee_id === emp.id && a.date === d);
                  const cellKey = `${emp.id}|${d}`;
                  return (
                    <td
                      key={d}
                      data-testid={`schedule-cell-${emp.id}-${d}`}
                      onDragOver={(e) => { if (isAdmin && dragShiftId) { e.preventDefault(); e.dataTransfer.dropEffect = e.altKey ? 'copy' : 'move'; setDropTarget(cellKey); } }}
                      onDragLeave={() => setDropTarget((t) => (t === cellKey ? null : t))}
                      onDrop={(e) => { e.preventDefault(); handleDrop(emp.id, d, e.altKey); }}
                      onClick={() => { if (isAdmin && moveShiftId) moveTo(emp.id, d); }}
                      className={`group/cell p-2 border-b border-r border-slate-200 align-top transition-colors ${d === today ? 'bg-emerald-50/40' : ''} ${dropTarget === cellKey && dragShiftId ? 'bg-bronze-50 ring-2 ring-inset ring-bronze-400' : ''} ${moveShiftId ? 'cursor-pointer hover:bg-bronze-50/60' : ''}`}
                    >
                      <div className="min-h-[76px] space-y-1.5">
                      {shifts.map((s) => {
                        const part = dayPart(s.startTime);
                        const conflict = conflictOf(s);
                        return (
                        <div
                          key={s.id}
                          data-testid={`shift-chip-${s.id}`}
                          draggable={isAdmin}
                          onDragStart={(e) => { setDragShiftId(s.id); e.dataTransfer.effectAllowed = 'copyMove'; }}
                          onDragEnd={() => { setDragShiftId(null); setDropTarget(null); }}
                          onClick={(e) => { e.stopPropagation(); selectForMove(s, emp.id, d); }}
                          title={conflict ?? (isAdmin ? 'Cliquez pour sélectionner, puis cliquez sur la case de destination' : undefined)}
                          className={`group relative overflow-hidden rounded-lg border ${conflict ? 'border-red-300' : 'border-slate-200/80'} ${part.bg} pl-3.5 pr-2 py-2 shadow-sm transition-shadow hover:shadow-md ${isAdmin ? 'cursor-grab active:cursor-grabbing' : ''} ${dragShiftId === s.id ? 'opacity-40' : ''} ${moveShiftId === s.id ? 'ring-2 ring-bronze-500 shadow-md' : conflict ? 'ring-2 ring-red-400' : ''}`}
                        >
                          <span className={`absolute inset-y-0 left-0 w-1.5 ${conflict ? 'bg-red-500' : part.bar}`} />
                          <div className="flex items-center justify-between gap-1.5">
                            <p className="text-xs font-bold text-slate-900 whitespace-nowrap flex items-center gap-1">
                              {conflict && <AlertTriangle data-testid={`shift-conflict-${s.id}`} className="w-3 h-3 text-red-600 shrink-0" />}
                              {s.startTime}–{s.endTime}
                            </p>
                            {s.aiGenerated && (
                              <span data-testid={`ai-shift-badge-${s.id}`} className="inline-flex items-center gap-0.5 rounded-full bg-violet-600 text-white text-[8px] font-bold px-1.5 py-px shrink-0" title="Quart généré par l'IA">
                                <Sparkles className="w-2 h-2" /> IA
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-500 mt-0.5">{fmtHours(hoursBetween(s.startTime, s.endTime))}</p>
                          {(s.resourceIds ?? []).length > 0 && (
                            <span className="mt-1 flex flex-wrap gap-1">
                              {(s.resourceIds ?? []).map((rid) => {
                                const r = (state.resources ?? []).find((x) => x.id === rid);
                                if (!r) return null;
                                return (
                                  <span key={rid} data-testid={`shift-resource-chip-${s.id}-${rid}`} className="inline-flex items-center gap-0.5 bg-white/80 border border-slate-200 text-slate-600 rounded px-1 py-px text-[9px] font-medium max-w-full truncate">
                                    {r.type === 'lieu' ? <MapPin className="w-2.5 h-2.5 shrink-0 text-emerald-600" /> : <Wrench className="w-2.5 h-2.5 shrink-0 text-bronze-600" />}
                                    <span className="truncate">{r.name}</span>
                                  </span>
                                );
                              })}
                            </span>
                          )}
                          {isAdmin && (
                            <button
                              data-testid={`delete-shift-${s.id}`}
                              onClick={(e) => { e.stopPropagation(); deleteShift(s.id); toast.success('Quart supprimé.'); }}
                              className="absolute bottom-1 right-1 w-5 h-5 rounded-full text-slate-300 hover:text-red-600 hover:bg-red-100 flex md:hidden md:group-hover:flex items-center justify-center transition-colors"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                        );
                      })}
                      {appts.map((a) => (
                        <div
                          key={a.id}
                          data-testid={`appointment-chip-${a.id}`}
                          className="group relative overflow-hidden rounded-lg border border-sky-200 bg-sky-50 pl-3.5 pr-2 py-2 text-sky-900 shadow-sm"
                          title={`${a.client_name}${a.reason ? ` — ${a.reason}` : ''}${a.notes ? ` · ${a.notes}` : ''}`}
                        >
                          <span className="absolute inset-y-0 left-0 w-1.5 bg-sky-400" />
                          <span className="inline-flex items-center gap-1 text-xs font-bold"><Stethoscope className="w-3 h-3" /> {a.start}–{a.end}</span>
                          <span className="block text-[10px] text-sky-700 truncate mt-0.5">{a.client_name}{a.reason ? ` · ${a.reason}` : ''}</span>
                          {(isAdmin || currentUser?.employeeId === a.employee_id) && (
                            <button
                              data-testid={`delete-appointment-${a.id}`}
                              onClick={() => void removeAppointment(a.id)}
                              className="absolute bottom-1 right-1 w-5 h-5 rounded-full text-sky-300 hover:text-red-600 hover:bg-red-100 flex md:hidden md:group-hover:flex items-center justify-center transition-colors"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      ))}
                      {isAdmin && (
                        <button
                          data-testid={`quick-add-${emp.id}-${d}`}
                          onClick={(e) => { e.stopPropagation(); if (moveShiftId) moveTo(emp.id, d); else quickAdd(emp.id, d); }}
                          title="Ajouter un quart"
                          className="w-full rounded-lg border border-dashed border-slate-200 text-slate-300 hover:text-emerald-600 hover:border-emerald-300 hover:bg-emerald-50/60 py-1 flex items-center justify-center opacity-0 group-hover/cell:opacity-100 focus:opacity-100 transition-opacity"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      )}
                      </div>
                    </td>
                  );
                })}
                <td data-testid={`row-total-${emp.id}`} className="px-4 py-4 border-b border-slate-200 align-top text-right bg-slate-50/60">
                  <p className="text-sm font-bold text-slate-900">{rowHours > 0 ? fmtHours(rowHours) : '—'}</p>
                  {isAdmin && rate > 0 && rowHours > 0 && (
                    <p data-testid={`row-cost-${emp.id}`} className="text-xs font-semibold text-emerald-700 mt-0.5">{fmtCad(rowHours * rate)}</p>
                  )}
                  {isAdmin && rate === 0 && rowHours > 0 && (
                    <p className="text-[10px] text-slate-400 mt-0.5">taux manquant</p>
                  )}
                </td>
              </tr>
              );
            })}
            <tr data-testid="schedule-totals-row" className="bg-slate-50/80 border-t-2 border-slate-200">
              <td className="px-5 py-3 border-r border-slate-200 text-[11px] uppercase tracking-[0.18em] text-slate-400 font-semibold">Totaux</td>
              {days.map((d) => {
                const filteredIds = new Set(state.employees.filter((e) => branchFilter === 'all' || e.branchId === branchFilter).map((e) => e.id));
                const dh = state.shifts
                  .filter((s) => s.date === d && filteredIds.has(s.employeeId))
                  .reduce((sum, s) => sum + hoursBetween(s.startTime, s.endTime), 0);
                return (
                  <td key={d} data-testid={`day-total-${d}`} className="px-3 py-3 border-r border-slate-200 text-center text-xs font-bold text-slate-700">
                    {dh > 0 ? fmtHours(dh) : <span className="text-slate-300">—</span>}
                  </td>
                );
              })}
              {(() => {
                const filtered = state.employees.filter((e) => branchFilter === 'all' || e.branchId === branchFilter);
                let gh = 0;
                let gc = 0;
                filtered.forEach((e) => {
                  const h = state.shifts
                    .filter((s) => s.employeeId === e.id && s.date >= days[0] && s.date <= days[6])
                    .reduce((sum, s) => sum + hoursBetween(s.startTime, s.endTime), 0);
                  gh += h;
                  gc += h * (rates[e.id] ?? 0);
                });
                return (
                  <td className="px-4 py-3 text-right bg-slate-100/60">
                    <p data-testid="week-total-hours" className="text-sm font-bold text-slate-900">{fmtHours(gh)}</p>
                    {isAdmin && gc > 0 && <p data-testid="week-total-cost" className="text-xs font-semibold text-emerald-700 mt-0.5">{fmtCad(gc)}</p>}
                  </td>
                );
              })()}
            </tr>
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
                    <td key={d} className="p-2 border-r border-slate-200 align-top">
                      {weekSlots.filter((s) => s.date === d).map((s, i) => (
                        <div
                          key={`${s.date}-${i}`}
                          data-testid={`replacement-chip-${s.date}-${i}`}
                          className="relative overflow-hidden rounded-lg border border-bronze-200 bg-bronze-50 pl-3.5 pr-2 py-2 mb-1.5 text-bronze-900 shadow-sm"
                          title={`${s.candidate} (${s.agency}) — ${s.role}`}
                        >
                          <span className="absolute inset-y-0 left-0 w-1.5 bg-bronze-400" />
                          <p className="text-xs font-bold">{s.start}–{s.end}</p>
                          <p className="text-[10px] text-bronze-700 truncate mt-0.5">{s.candidate} · {s.role}</p>
                        </div>
                      ))}
                    </td>
                  ))}
                  <td className="bg-slate-50/60" />
                </tr>
              );
            })()}
          </tbody>
        </table>
      </div>
      )}

      {viewMode === 'month' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden" data-testid="month-grid">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50/80">
            {FULL_DAYS.map((n) => (
              <div key={n} className="px-2 py-2.5 text-center text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                <span className="hidden md:inline">{n}</span>
                <span className="md:hidden">{n.slice(0, 3)}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {monthGridDays(monthAnchor).map((d) => {
              const inMonth = Number(d.slice(5, 7)) === monthAnchor.getMonth() + 1;
              const filteredIds = new Set(state.employees.filter((e) => branchFilter === 'all' || e.branchId === branchFilter).map((e) => e.id));
              const dayShifts = state.shifts
                .filter((s) => s.date === d && filteredIds.has(s.employeeId))
                .sort((a, b) => a.startTime.localeCompare(b.startTime));
              return (
                <div
                  key={d}
                  data-testid={`month-cell-${d}`}
                  onClick={() => { if (isAdmin && moveShiftId) moveTo(null, d); }}
                  className={`group/mcell min-h-[110px] border-b border-r border-slate-100 p-1.5 align-top ${inMonth ? '' : 'bg-slate-50/70'} ${d === today ? 'bg-emerald-50/50' : ''} ${moveShiftId ? 'cursor-pointer hover:bg-bronze-50/70' : ''}`}
                >
                  <div className="flex items-center justify-between px-0.5">
                    <span className={`text-xs font-semibold ${d === today ? 'inline-flex w-6 h-6 items-center justify-center rounded-full bg-emerald-600 text-white' : inMonth ? 'text-slate-700' : 'text-slate-300'}`}>
                      {Number(d.slice(8, 10))}
                    </span>
                    {isAdmin && !moveShiftId && (
                      <button
                        data-testid={`month-add-${d}`}
                        onClick={(e) => { e.stopPropagation(); setDate(d); setDialogOpen(true); }}
                        title="Ajouter un quart"
                        className="text-slate-300 hover:text-emerald-600 opacity-0 group-hover/mcell:opacity-100 transition-opacity"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="mt-1 space-y-1">
                    {dayShifts.slice(0, 4).map((s) => {
                      const emp = state.employees.find((e) => e.id === s.employeeId);
                      const conflict = conflictOf(s);
                      const part = dayPart(s.startTime);
                      return (
                        <button
                          key={s.id}
                          data-testid={`month-shift-${s.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!isAdmin) return;
                            if (moveShiftId && moveShiftId !== s.id) { moveTo(null, d); return; }
                            setMoveShiftId(moveShiftId === s.id ? null : s.id);
                          }}
                          title={`${emp ? `${emp.firstName} ${emp.lastName}` : '?'} · ${s.startTime}–${s.endTime}${conflict ? ` — ${conflict}` : ''}${isAdmin ? ' · Cliquez pour déplacer' : ''}`}
                          className={`w-full flex items-center gap-1 rounded px-1 py-0.5 text-left text-[10px] font-semibold border ${conflict ? 'border-red-300 bg-red-50 text-red-800' : `border-slate-200/70 ${part.bg} text-slate-700`} ${moveShiftId === s.id ? 'ring-2 ring-bronze-500' : conflict ? 'ring-1 ring-red-400' : ''}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${emp?.avatarColor ?? 'bg-slate-400'} shrink-0`} />
                          <span className="truncate">{s.startTime} {emp?.firstName ?? '?'}</span>
                          {s.aiGenerated && <Sparkles className="w-2.5 h-2.5 text-violet-600 shrink-0" />}
                          {conflict && <AlertTriangle data-testid={`month-conflict-${s.id}`} className="w-2.5 h-2.5 text-red-600 shrink-0" />}
                        </button>
                      );
                    })}
                    {dayShifts.length > 4 && (
                      <p className="text-[10px] text-slate-400 px-1">+{dayShifts.length - 4} autres</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <AppointmentDialog open={apptOpen} onOpenChange={setApptOpen} onCreated={() => void refreshAppointments()} />
      {isAdmin && <DuplicateWeekDialog open={dupOpen} onClose={() => setDupOpen(false)} days={days} />}
      {isAdmin && <WeekTemplatesDialog open={tplOpen} onClose={() => setTplOpen(false)} days={days} />}
      {isAdmin && <ReadReceiptsDialog open={receiptsOpen} onClose={() => setReceiptsOpen(false)} weekStart={days[0]} />}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="add-shift-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Nouveau quart de travail</DialogTitle>
            <DialogDescription>Choisissez l'employé, la date et les heures du quart.</DialogDescription>
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
            {(state.resources ?? []).length > 0 && (
              <div className="space-y-2">
                <Label>Ressources — lieu de travail, équipement (optionnel)</Label>
                <div className="max-h-36 overflow-y-auto space-y-1 rounded-lg border border-slate-200 p-2.5">
                  {(state.resources ?? []).map((r) => (
                    <label key={r.id} data-testid={`shift-resource-option-${r.id}`} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer rounded-md px-1.5 py-1 hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={selectedResources.includes(r.id)}
                        onChange={() => toggleResource(r.id)}
                        className="accent-emerald-600 w-4 h-4"
                      />
                      {r.type === 'lieu' ? <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> : <Wrench className="w-3.5 h-3.5 text-bronze-600 shrink-0" />}
                      <span className="truncate">{r.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <Button data-testid="shift-submit-button" type="submit" className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              Ajouter le quart
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
