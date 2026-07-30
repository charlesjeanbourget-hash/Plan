import { useState, FormEvent } from 'react';
import { useHR } from '@/context/HRContext';
import { useAuth } from '@/context/AuthContext';
import { LeaveType } from '@/types';
import { ModuleHeader, StatusBadge } from '@/components/modules/shared';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarClock, Download, TreePalm, ArrowLeftRight, Plus } from 'lucide-react';
import { downloadPayStub } from '@/lib/paystub';
import { toast } from 'sonner';

const LEAVE_TYPES: LeaveType[] = ['Vacances', 'Maladie', 'Personnel', 'Formation'];

export default function MySpaceModule(): JSX.Element {
  const { state, getEmployee, addLeaveRequest, addShiftSwap } = useHR();
  const { currentUser } = useAuth();
  const me = state.employees.find((e) => e.id === currentUser?.employeeId);
  const pharmacy = state.pharmacies.find((p) => p.id === currentUser?.pharmacyId);

  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveType, setLeaveType] = useState<LeaveType>('Vacances');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [swapOpen, setSwapOpen] = useState(false);
  const [swapShiftId, setSwapShiftId] = useState('');
  const [swapTargetId, setSwapTargetId] = useState('');
  const [swapReason, setSwapReason] = useState('');

  if (!me) {
    return (
      <div data-testid="myspace-module" className="bg-white rounded-xl border border-slate-200 p-12 text-center">
        <p className="text-slate-600">Aucun dossier employé associé à votre compte.</p>
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const myShifts = state.shifts.filter((s) => s.employeeId === me.id && s.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const myPays = state.payrollEntries
    .filter((p) => p.employeeId === me.id)
    .sort((a, b) => b.periodStart.localeCompare(a.periodStart));
  const myLeaves = state.leaveRequests.filter((l) => l.employeeId === me.id);
  const mySwaps = state.shiftSwaps.filter((s) => s.requesterId === me.id);
  const colleagues = state.employees.filter((e) => e.id !== me.id && e.status === 'Actif');

  const submitLeave = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    addLeaveRequest({ employeeId: me.id, type: leaveType, startDate, endDate, reason, status: 'En attente' });
    toast.success('Demande de congé soumise à votre gestionnaire.');
    setLeaveOpen(false);
    setReason('');
  };

  const submitSwap = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!swapShiftId || !swapTargetId) return;
    addShiftSwap({ shiftId: swapShiftId, requesterId: me.id, targetEmployeeId: swapTargetId, reason: swapReason, status: 'En attente' });
    toast.success("Demande d'échange envoyée au gestionnaire.");
    setSwapOpen(false);
    setSwapReason('');
  };

  return (
    <div data-testid="myspace-module">
      <ModuleHeader
        title="Mon espace"
        subtitle={`${me.position} · ${state.branches.find((b) => b.id === me.branchId)?.name ?? ''}`}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 p-7" data-testid="myspace-shifts">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-heading text-base font-bold text-slate-900 inline-flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-emerald-600" /> Mes prochains quarts
            </h2>
            <Button data-testid="myspace-swap-button" size="sm" variant="outline" className="rounded-full text-xs" onClick={() => setSwapOpen(true)}>
              <ArrowLeftRight className="w-3.5 h-3.5 mr-1" /> Proposer un échange
            </Button>
          </div>
          <div className="space-y-2.5">
            {myShifts.map((s) => (
              <div key={s.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                <p className="text-sm font-semibold text-slate-800">{s.date === today ? "Aujourd'hui" : s.date}</p>
                <p className="text-sm text-slate-600">{s.startTime} – {s.endTime}</p>
              </div>
            ))}
            {myShifts.length === 0 && <p className="text-sm text-slate-500">Aucun quart à venir.</p>}
          </div>
          {mySwaps.length > 0 && (
            <div className="mt-5 pt-4 border-t border-slate-100">
              <p className="text-xs uppercase tracking-[0.15em] text-slate-500 font-semibold mb-3">Mes demandes d'échange</p>
              {mySwaps.map((sw) => {
                const shift = state.shifts.find((s) => s.id === sw.shiftId);
                const target = getEmployee(sw.targetEmployeeId);
                return (
                  <div key={sw.id} className="flex items-center justify-between py-1.5 text-sm">
                    <span className="text-slate-600">
                      {shift ? `${shift.date} (${shift.startTime}–${shift.endTime})` : 'Quart réassigné'} → {target?.firstName ?? '?'}
                    </span>
                    <StatusBadge status={sw.status} />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-7" data-testid="myspace-payroll">
          <h2 className="font-heading text-base font-bold text-slate-900 mb-5 inline-flex items-center gap-2">
            <Download className="w-4 h-4 text-emerald-600" /> Mes relevés de paie
          </h2>
          <div className="space-y-2.5">
            {myPays.map((p) => (
              <div key={p.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{p.period}</p>
                  <p className="text-xs text-slate-500">{p.hoursWorked} h · Net : {p.netPay.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' })}</p>
                </div>
                <Button
                  data-testid={`download-paystub-${p.id}`}
                  size="sm"
                  variant="outline"
                  className="rounded-full text-xs"
                  onClick={() => { downloadPayStub(me, p, pharmacy?.name ?? 'LuminaHR', state.payrollEntries); toast.success('Relevé PDF téléchargé (avec cumulatifs annuels).'); }}
                >
                  <Download className="w-3.5 h-3.5 mr-1" /> PDF
                </Button>
              </div>
            ))}
            {myPays.length === 0 && <p className="text-sm text-slate-500">Aucun relevé disponible.</p>}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-7 lg:col-span-2" data-testid="myspace-leaves">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-heading text-base font-bold text-slate-900 inline-flex items-center gap-2">
              <TreePalm className="w-4 h-4 text-emerald-600" /> Mes congés
            </h2>
            <Button data-testid="myspace-add-leave-button" size="sm" className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs" onClick={() => setLeaveOpen(true)}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Nouvelle demande
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {myLeaves.map((l) => (
              <div key={l.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{l.type}</p>
                  <p className="text-xs text-slate-500">Du {l.startDate} au {l.endDate}</p>
                </div>
                <StatusBadge status={l.status} />
              </div>
            ))}
            {myLeaves.length === 0 && <p className="text-sm text-slate-500">Aucune demande de congé.</p>}
          </div>
        </div>
      </div>

      <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <DialogContent data-testid="myspace-leave-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Nouvelle demande de congé</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitLeave} className="space-y-4">
            <div className="space-y-2">
              <Label>Type de congé</Label>
              <Select value={leaveType} onValueChange={(v) => setLeaveType(v as LeaveType)}>
                <SelectTrigger data-testid="myspace-leave-type-select"><SelectValue /></SelectTrigger>
                <SelectContent>{LEAVE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Du</Label>
                <Input data-testid="myspace-leave-start-input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Au</Label>
                <Input data-testid="myspace-leave-end-input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Raison</Label>
              <Input data-testid="myspace-leave-reason-input" value={reason} onChange={(e) => setReason(e.target.value)} required />
            </div>
            <Button data-testid="myspace-leave-submit-button" type="submit" className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              Soumettre
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={swapOpen} onOpenChange={setSwapOpen}>
        <DialogContent data-testid="myspace-swap-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Proposer un échange de quart</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitSwap} className="space-y-4">
            <div className="space-y-2">
              <Label>Mon quart à échanger</Label>
              <Select value={swapShiftId} onValueChange={setSwapShiftId}>
                <SelectTrigger data-testid="swap-shift-select"><SelectValue placeholder="Choisir un quart" /></SelectTrigger>
                <SelectContent>
                  {myShifts.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.date} · {s.startTime}–{s.endTime}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Collègue proposé(e)</Label>
              <Select value={swapTargetId} onValueChange={setSwapTargetId}>
                <SelectTrigger data-testid="swap-target-select"><SelectValue placeholder="Choisir un(e) collègue" /></SelectTrigger>
                <SelectContent>
                  {colleagues.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.firstName} {c.lastName} — {c.position}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Raison</Label>
              <Input data-testid="swap-reason-input" value={swapReason} onChange={(e) => setSwapReason(e.target.value)} required />
            </div>
            <Button data-testid="swap-submit-button" type="submit" className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              Envoyer la demande
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
