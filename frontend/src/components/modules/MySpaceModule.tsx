import { useState, useEffect, useCallback, FormEvent } from 'react';
import axios from 'axios';
import { useHR } from '@/context/HRContext';
import { useAuth } from '@/context/AuthContext';
import { LeaveType } from '@/types';
import { ModuleHeader, StatusBadge } from '@/components/modules/shared';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarClock, Download, TreePalm, ArrowLeftRight, Plus, ShieldCheck } from 'lucide-react';
import { downloadPayStub } from '@/lib/paystub';
import { MyPunchCard } from '@/components/MyPunchCard';
import { NurseDayPanel } from '@/components/NurseDayPanel';
import { MyProposalsPanel } from '@/components/MyProposalsPanel';
import { MyEvaluationsPanel } from '@/components/MyEvaluationsPanel';
import { ProfileEditor } from '@/components/ProfileEditor';
import { toast } from 'sonner';

const LEAVE_TYPES: LeaveType[] = ['Vacances', 'Maladie', 'Personnel', 'Formation'];
const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function MySpaceModule(): JSX.Element {
  const { state, getEmployee, addShiftSwap, updateShiftSwap, setShiftSwapStatus } = useHR();
  const { currentUser, token } = useAuth();
  const me = state.employees.find((e) => e.id === currentUser?.employeeId);
  const pharmacy = state.pharmacies.find((p) => p.id === currentUser?.pharmacyId);

  const exportMyData = async (): Promise<void> => {
    try {
      const res = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/me/data-export`, {
        headers: { Authorization: `Bearer ${token ?? ''}` },
      });
      if (!res.ok) throw new Error();
      const server = await res.json();
      const full = {
        ...server,
        dossier_local: me ?? null,
        conges: me ? state.leaveRequests.filter((l) => l.employeeId === me.id) : [],
        releves_de_paie: me ? state.payrollEntries.filter((p) => p.employeeId === me.id) : [],
        quarts: me ? state.shifts.filter((s) => s.employeeId === me.id) : [],
      };
      const blob = new Blob([JSON.stringify(full, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mes-donnees-arriere-plan-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Vos données personnelles ont été téléchargées.');
    } catch {
      toast.error('Export impossible pour le moment.');
    }
  };

  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveType, setLeaveType] = useState<LeaveType>('Vacances');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [swapOpen, setSwapOpen] = useState(false);
  const [swapShiftId, setSwapShiftId] = useState('');
  const [swapTargetId, setSwapTargetId] = useState('');
  const [swapReason, setSwapReason] = useState('');
  const [myLeaves, setMyLeaves] = useState<{ id: string; type: string; startDate: string; endDate: string; status: string }[]>([]);

  const loadLeaves = useCallback(async (): Promise<void> => {
    if (!token) return;
    try {
      const res = await axios.get<{ id: string; type: string; start_date: string; end_date: string; status: string }[]>(
        `${API}/leave/requests`, { headers: { Authorization: `Bearer ${token}` } });
      setMyLeaves(res.data.map((l) => ({ id: l.id, type: l.type, startDate: l.start_date, endDate: l.end_date, status: l.status })));
    } catch {
      /* hors ligne */
    }
  }, [token]);

  useEffect(() => { void loadLeaves(); }, [loadLeaves]);

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
  const mySwaps = state.shiftSwaps.filter((s) => s.requesterId === me.id);
  const colleagues = state.employees.filter((e) => e.id !== me.id && e.status === 'Actif');

  const submitLeave = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    try {
      await axios.post(`${API}/leave/requests`, {
        employee_id: me.id,
        employee_name: `${me.firstName} ${me.lastName}`,
        type: leaveType, start_date: startDate, end_date: endDate, reason,
      }, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      toast.success('Demande de congé soumise à votre gestionnaire.');
      setLeaveOpen(false);
      setReason('');
      void loadLeaves();
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
      toast.error(typeof detail === 'string' ? detail : 'Soumission impossible.');
    }
  };

  const submitSwap = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!swapShiftId || !swapTargetId) return;
    addShiftSwap({ shiftId: swapShiftId, requesterId: me.id, targetEmployeeId: swapTargetId, reason: swapReason, status: 'En attente', peerStatus: 'En attente' });
    toast.success("Demande d'échange envoyée au gestionnaire.");
    setSwapOpen(false);
    setSwapReason('');
  };

  return (
    <div data-testid="myspace-module">
      <ModuleHeader
        title="Mon espace"
        subtitle={`${me.position} · ${state.branches.find((b) => b.id === me.branchId)?.name ?? ''}`}
        action={
          <Button data-testid="export-my-data-button" variant="outline" onClick={() => void exportMyData()} className="rounded-full border-emerald-300 text-emerald-800 hover:bg-emerald-50">
            <ShieldCheck className="w-4 h-4 mr-1" /> Télécharger mes données
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="lg:col-span-2">
          <MyPunchCard />
        </div>
        {me.position === 'Infirmier(ère)' && (
          <div className="lg:col-span-2">
            <NurseDayPanel />
          </div>
        )}
        <MyProposalsPanel />
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
          {state.shiftSwaps.some((s) => s.targetEmployeeId === me.id && s.status === 'En attente' && s.peerStatus === 'En attente') && (
            <div className="mt-5 pt-4 border-t border-slate-100" data-testid="swaps-to-accept-panel">
              <p className="text-xs uppercase tracking-[0.15em] text-bronze-700 font-semibold mb-3">Échanges à accepter</p>
              {state.shiftSwaps
                .filter((s) => s.targetEmployeeId === me.id && s.status === 'En attente' && s.peerStatus === 'En attente')
                .map((sw) => {
                  const shift = state.shifts.find((s) => s.id === sw.shiftId);
                  const requester = getEmployee(sw.requesterId);
                  return (
                    <div key={sw.id} data-testid={`swap-to-accept-${sw.id}`} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border border-bronze-200 bg-bronze-50/50 px-3.5 py-2.5 mb-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">
                          {requester ? `${requester.firstName} ${requester.lastName}` : '?'} vous propose son quart
                        </p>
                        <p className="text-xs text-slate-500">
                          {shift ? `${shift.date} · ${shift.startTime}–${shift.endTime}` : 'Quart introuvable'}{sw.reason ? ` · ${sw.reason}` : ''}
                        </p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button data-testid={`accept-swap-${sw.id}`} size="sm" onClick={() => { updateShiftSwap(sw.id, { peerStatus: 'Approuvée' }); toast.success('Échange accepté — en attente de l\'approbation du gestionnaire.'); }} className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs">
                          Accepter
                        </Button>
                        <Button data-testid={`decline-swap-${sw.id}`} size="sm" variant="outline" onClick={() => { updateShiftSwap(sw.id, { peerStatus: 'Refusée' }); setShiftSwapStatus(sw.id, 'Refusée'); toast.success('Échange refusé.'); }} className="rounded-full text-xs text-red-600 border-red-200 hover:bg-red-50">
                          Refuser
                        </Button>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
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
                  onClick={() => { void downloadPayStub(me, p, pharmacy?.name ?? 'Arrière Plan', state.payrollEntries); toast.success('Relevé PDF téléchargé (avec cumulatifs annuels).'); }}
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

        <MyEvaluationsPanel />

        <div className="lg:col-span-2">
          <ProfileEditor employeeId={me.id} employeeName={`${me.firstName} ${me.lastName}`} canManageCode={false} />
        </div>
      </div>

      <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <DialogContent data-testid="myspace-leave-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Nouvelle demande de congé</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => void submitLeave(e)} className="space-y-4">
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
              <Label>Motif (facultatif — visible uniquement par l'administration)</Label>
              <Input data-testid="myspace-leave-reason-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Vos collègues ne verront jamais le motif." />
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
