import { useState, useEffect, useCallback, FormEvent } from 'react';
import axios from 'axios';
import { useHR } from '@/context/HRContext';
import { useAuth } from '@/context/AuthContext';
import { ModuleHeader, StatusBadge, EmptyState, CollapsibleSection } from '@/components/modules/shared';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Check, X, ChevronLeft, ChevronRight, TreePalm, Lock, History, Wallet, Trash2, RefreshCcw, FileDown, Hourglass } from 'lucide-react';
import { TimeBankPanel } from '@/components/TimeBankPanel';
import { downloadLeaveSummary } from '@/lib/leavePdf';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const LEAVE_TYPES = ['Vacances', 'Maladie', 'Mobile'];
const MONTH_NAMES = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const DAY_HEADERS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

interface HistoryEntry { action: string; by: string; role: string; at: string; note?: string }
interface ServerLeave {
  id: string;
  employee_id: string;
  employee_name: string;
  type: string;
  start_date: string;
  end_date: string;
  days: number;
  reason?: string;
  status: string;
  history?: HistoryEntry[];
}
interface Absence { id: string; employee_id: string; employee_name: string; start_date: string; end_date: string; type: string }
interface Balance {
  employee_id: string;
  employee_name: string;
  allocations: Record<string, number>;
  carryover: Record<string, number>;
  used: Record<string, number>;
  remaining: Record<string, number>;
  year: number;
}

const ACTION_LABELS: Record<string, string> = {
  soumission: 'Soumission', approbation: 'Approbation', refus: 'Refus', annulation: 'Annulation', migration: 'Migration',
};

export default function VacationModule(): JSX.Element {
  const { state, getEmployee } = useHR();
  const { currentUser, token } = useAuth();
  const isAdmin = currentUser?.role !== 'employee';
  const headers = { Authorization: `Bearer ${token ?? ''}` };

  const [requests, setRequests] = useState<ServerLeave[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [balLoaded, setBalLoaded] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState<string | null>(null);
  const [allocTarget, setAllocTarget] = useState<string | null>(null);
  const [allocForm, setAllocForm] = useState<Record<string, string>>({ Vacances: '0', Maladie: '0', Mobile: '0' });
  const [applyAll, setApplyAll] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [policy, setPolicy] = useState<{ carryover_enabled: boolean; carryover_max_days: number; types: string[] }>({ carryover_enabled: false, carryover_max_days: 0, types: ['Vacances'] });
  const [carryRunning, setCarryRunning] = useState(false);
  const [employeeId, setEmployeeId] = useState(currentUser?.employeeId ?? state.employees[0]?.id ?? '');
  const [type, setType] = useState('Vacances');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [selStart, setSelStart] = useState('');
  const [selEnd, setSelEnd] = useState('');
  const [calDate, setCalDate] = useState<{ y: number; m: number }>(() => {
    const now = new Date();
    return { y: now.getFullYear(), m: now.getMonth() };
  });

  const refresh = useCallback(async (): Promise<void> => {
    if (!token) return;
    try {
      const [reqRes, absRes, balRes] = await Promise.all([
        axios.get<ServerLeave[]>(`${API}/leave/requests`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.get<{ items: Absence[] }>(`${API}/leave/absences`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.get<Balance[]>(`${API}/leave/balances`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      setRequests(reqRes.data);
      setAbsences(absRes.data.items);
      setBalances(balRes.data);
      setBalLoaded(true);
    } catch {
      toast.error('Chargement des congés impossible.');
    }
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh]);

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
  const todayIso = new Date().toISOString().slice(0, 10);

  const clickDay = (iso: string): void => {
    if (!selStart || (selStart && selEnd)) {
      setSelStart(iso);
      setSelEnd('');
      return;
    }
    if (iso < selStart) {
      setSelStart(iso);
      return;
    }
    setSelEnd(iso);
    setStartDate(selStart);
    setEndDate(iso);
    setDialogOpen(true);
  };

  const myBalance = balances.find((b) => b.employee_id === (currentUser?.employeeId ?? ''));

  const submit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const empId = isAdmin ? employeeId : (currentUser?.employeeId ?? '');
    const emp = getEmployee(empId);
    try {
      await axios.post(`${API}/leave/requests`, {
        employee_id: empId,
        employee_name: emp ? `${emp.firstName} ${emp.lastName}` : (currentUser?.name ?? ''),
        type, start_date: startDate, end_date: endDate, reason,
      }, { headers });
      toast.success('Demande soumise — l\'administration a été notifiée.');
      setDialogOpen(false);
      setReason('');
      setSelStart('');
      setSelEnd('');
      void refresh();
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
      toast.error(typeof detail === 'string' ? detail : 'Soumission impossible.');
    }
  };

  const decide = async (id: string, action: 'approve' | 'reject'): Promise<void> => {
    try {
      const res = await axios.post<{ status: string; remaining: number | null }>(`${API}/leave/requests/${id}/decide`, { action }, { headers });
      const req = requests.find((r) => r.id === id);
      toast.success(`Demande ${res.data.status.toLowerCase()}.${res.data.remaining !== null && req ? ` Solde ${req.type} restant : ${res.data.remaining} j.` : ''}`);
      void refresh();
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
      toast.error(typeof detail === 'string' ? detail : 'Action impossible.');
    }
  };

  const cancel = async (id: string): Promise<void> => {
    try {
      await axios.delete(`${API}/leave/requests/${id}`, { headers });
      toast.success('Demande annulée.');
      void refresh();
    } catch {
      toast.error('Annulation impossible.');
    }
  };

  const openAlloc = (b: Balance | null, empId: string, empName: string): void => {
    setAllocForm({
      Vacances: String(b?.allocations.Vacances ?? 0),
      Maladie: String(b?.allocations.Maladie ?? 0),
      Mobile: String(b?.allocations.Mobile ?? 0),
    });
    setApplyAll(false);
    setAllocTarget(JSON.stringify({ id: empId, name: empName }));
  };

  const saveAlloc = async (): Promise<void> => {
    if (!allocTarget) return;
    const target = JSON.parse(allocTarget) as { id: string; name: string };
    const allocations: Record<string, number> = {};
    LEAVE_TYPES.forEach((t) => { allocations[t] = Math.max(0, Number((allocForm[t] ?? '0').replace(',', '.')) || 0); });
    try {
      if (applyAll) {
        await Promise.all(state.employees.filter((e) => e.status === 'Actif' && !e.anonymized).map((e) =>
          axios.put(`${API}/leave/allocations/${e.id}`, { employee_name: `${e.firstName} ${e.lastName}`, allocations }, { headers })));
        toast.success('Allocations appliquées à tous les employés actifs.');
      } else {
        await axios.put(`${API}/leave/allocations/${target.id}`, { employee_name: target.name, allocations }, { headers });
        toast.success(`Allocations mises à jour pour ${target.name}.`);
      }
      setAllocTarget(null);
      void refresh();
    } catch {
      toast.error('Enregistrement des allocations impossible.');
    }
  };

  const openPolicy = async (): Promise<void> => {
    setPolicyOpen(true);
    try {
      const res = await axios.get<{ carryover_enabled: boolean; carryover_max_days: number; types: string[] }>(`${API}/leave/policy`, { headers });
      setPolicy(res.data);
    } catch {
      /* défauts conservés */
    }
  };

  const savePolicy = async (): Promise<void> => {
    try {
      await axios.put(`${API}/leave/policy`, policy, { headers });
      toast.success('Politique de report enregistrée.');
      setPolicyOpen(false);
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
      toast.error(typeof detail === 'string' ? detail : 'Enregistrement impossible.');
    }
  };

  const runCarryover = async (): Promise<void> => {
    setCarryRunning(true);
    try {
      await axios.put(`${API}/leave/policy`, policy, { headers });
      const res = await axios.post<{ processed: number; details: { carried: Record<string, number> }[]; skipped?: string }>(`${API}/leave/carryover/run`, {}, { headers });
      if (res.data.skipped) {
        toast.error('Report désactivé — activez d\'abord la politique.');
      } else {
        const total = res.data.details.reduce((n, d) => n + Object.values(d.carried).reduce((a, b) => a + b, 0), 0);
        toast.success(`Report effectué : ${res.data.processed} employé(s) traités · ${Math.round(total * 10) / 10} j reportés au total.`);
        setPolicyOpen(false);
      }
      void refresh();
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
      toast.error(typeof detail === 'string' ? detail : 'Report impossible.');
    }
    setCarryRunning(false);
  };

  const pharmacyName = state.pharmacies.find((p) => p.id === currentUser?.pharmacyId)?.name ?? 'Arrière Plan';

  const exportLeavePdf = async (empId: string, empName: string): Promise<void> => {
    const year = new Date().getFullYear();
    const b = balances.find((x) => x.employee_id === empId);
    const bals = LEAVE_TYPES.map((t) => ({
      type: t,
      alloc: b?.allocations[t] ?? 0,
      carry: b?.carryover?.[t] ?? 0,
      used: b?.used[t] ?? 0,
      remaining: b?.remaining[t] ?? 0,
    }));
    const reqs = requests
      .filter((r) => r.employee_id === empId && r.start_date.startsWith(String(year)) && r.status !== 'Annulée')
      .map((r) => ({ type: r.type, start: r.start_date, end: r.end_date, days: r.days, status: r.status }));
    await downloadLeaveSummary(empName, year, bals, reqs, pharmacyName);
    toast.success('Relevé annuel téléchargé.');
  };

  const visibleRequests = requests.filter((r) => r.status !== 'Annulée' || !isAdmin);

  return (
    <div data-testid="vacations-module">
      <ModuleHeader
        title="Vacances & Congés"
        subtitle={isAdmin ? 'Approuvez les demandes, allouez les soldes — motifs confidentiels (Loi 25).' : 'Sélectionnez vos dates au calendrier et suivez vos soldes.'}
        action={
          <div className="flex flex-wrap gap-2">
            {isAdmin && (
              <Button data-testid="carryover-button" variant="outline" onClick={() => void openPolicy()} className="rounded-full border-bronze-300 text-bronze-800 hover:bg-bronze-50">
                <RefreshCcw className="w-4 h-4 mr-1" /> Report de soldes
              </Button>
            )}
            {!isAdmin && (
              <Button
                data-testid="my-leave-pdf-button"
                variant="outline"
                onClick={() => {
                  const meEmp = getEmployee(currentUser?.employeeId ?? '');
                  void exportLeavePdf(currentUser?.employeeId ?? '', meEmp ? `${meEmp.firstName} ${meEmp.lastName}` : 'Employé');
                }}
                className="rounded-full border-bronze-300 text-bronze-800 hover:bg-bronze-50"
              >
                <FileDown className="w-4 h-4 mr-1" /> Relevé annuel (PDF)
              </Button>
            )}
            <Button data-testid="add-leave-button" onClick={() => { setStartDate(selStart); setEndDate(selEnd || selStart); setDialogOpen(true); }} className="rounded-full bg-emerald-600 hover:bg-emerald-700">
              <Plus className="w-4 h-4 mr-1" /> Nouvelle demande
            </Button>
          </div>
        }
      />

      {!isAdmin && (
        <div data-testid="leave-balances" className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          {LEAVE_TYPES.map((t) => {
            const alloc = myBalance?.allocations[t] ?? 0;
            const remaining = myBalance?.remaining[t] ?? 0;
            const used = myBalance?.used[t] ?? 0;
            return (
              <div key={t} data-testid={`balance-card-${t}`} className="bg-white rounded-xl border border-slate-200 p-5">
                <p className="text-[11px] uppercase tracking-[0.15em] text-slate-400 font-semibold">{t}</p>
                <p className={`font-heading text-2xl font-bold mt-1 ${remaining < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                  {!balLoaded ? '…' : alloc > 0 || used > 0 ? `${remaining} j` : '—'}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">{!balLoaded ? 'Chargement…' : alloc > 0 || used > 0 ? `restants sur ${alloc} j alloués · ${used} j utilisés` : 'Aucune allocation définie'}</p>
                {(myBalance?.carryover?.[t] ?? 0) > 0 && (
                  <p data-testid={`balance-carry-${t}`} className="text-[11px] text-bronze-700 font-semibold mt-0.5">dont +{myBalance?.carryover?.[t]} j reportés de {new Date().getFullYear() - 1}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-8" data-testid="vacation-calendar">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <h2 className="font-heading text-base font-bold text-slate-900">Calendrier des absences</h2>
            <p className="text-xs text-slate-500">Cliquez une date de début puis une date de fin pour préparer une demande.{!isAdmin && ' Les motifs et types de congé des collègues restent confidentiels.'}</p>
          </div>
          <div className="flex items-center gap-2">
            {selStart && (
              <span data-testid="calendar-selection" className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1">
                {selStart}{selEnd ? ` → ${selEnd}` : ' → …'}
                <button data-testid="calendar-selection-clear" onClick={() => { setSelStart(''); setSelEnd(''); }} className="ml-1.5 text-emerald-600 hover:text-red-600">✕</button>
              </span>
            )}
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
            const onLeave = absences.filter((a) => a.start_date <= iso && iso <= a.end_date);
            const inSel = selStart && ((selEnd && selStart <= iso && iso <= selEnd) || (!selEnd && iso === selStart));
            return (
              <div
                key={iso}
                data-testid={`cal-day-${iso}`}
                role="button"
                tabIndex={0}
                onClick={() => clickDay(iso)}
                onKeyDown={(e) => { if (e.key === 'Enter') clickDay(iso); }}
                className={`min-h-[72px] p-1.5 cursor-pointer transition-colors ${inSel ? 'bg-emerald-100 ring-2 ring-inset ring-emerald-400' : iso === todayIso ? 'bg-emerald-50' : 'bg-white hover:bg-slate-50'}`}
              >
                <p className={`text-xs font-semibold mb-1 ${iso === todayIso ? 'text-emerald-700' : 'text-slate-500'}`}>{day}</p>
                <div className="space-y-0.5">
                  {onLeave.map((a) => {
                    const emp = getEmployee(a.employee_id);
                    const label = a.type === 'Absence' ? 'Absent(e)' : a.type;
                    return (
                      <div key={a.id} data-testid={`cal-absence-${a.id}-${iso}`} className={`${emp?.avatarColor ?? 'bg-slate-400'} text-white text-[10px] font-semibold rounded px-1 py-0.5 truncate`} title={`${a.employee_name || (emp ? `${emp.firstName} ${emp.lastName}` : '?')} — ${label}`}>
                        {emp ? `${emp.firstName} ${emp.lastName[0]}.` : a.employee_name || '?'} · {label}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {isAdmin && (
        <CollapsibleSection id="vac-balances" title={`Soldes de congés par employé (${new Date().getFullYear()})`} icon={Wallet} className="mb-8">
        <div data-testid="admin-balances-panel" className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-[0.1em] text-slate-400">
                  <th className="py-2 pr-4">Employé</th>
                  {LEAVE_TYPES.map((t) => <th key={t} className="py-2 pr-4">{t} (restant / alloué)</th>)}
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {state.employees.filter((e) => e.status === 'Actif' && !e.anonymized).map((e) => {
                  const b = balances.find((x) => x.employee_id === e.id) ?? null;
                  return (
                    <tr key={e.id} data-testid={`balance-row-${e.id}`} className="border-t border-slate-100">
                      <td className="py-2.5 pr-4 font-semibold text-slate-700">{e.firstName} {e.lastName}</td>
                      {LEAVE_TYPES.map((t) => {
                        const rem = b?.remaining[t] ?? 0;
                        const alloc = b?.allocations[t] ?? 0;
                        return (
                          <td key={t} className={`py-2.5 pr-4 font-semibold ${rem < 0 ? 'text-red-600' : 'text-slate-600'}`}>
                            {alloc > 0 || (b?.used[t] ?? 0) > 0 ? `${rem} / ${alloc} j` : '—'}
                            {(b?.carryover?.[t] ?? 0) > 0 && (
                              <span className="block text-[10px] text-bronze-600 font-medium">dont +{b?.carryover?.[t]} reportés</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="py-2.5 text-right whitespace-nowrap">
                        <Button data-testid={`alloc-button-${e.id}`} size="sm" variant="outline" className="rounded-full text-xs border-bronze-300 text-bronze-800 hover:bg-bronze-50" onClick={() => openAlloc(b, e.id, `${e.firstName} ${e.lastName}`)}>
                          Allouer des jours
                        </Button>
                        <Button data-testid={`leave-pdf-${e.id}`} size="sm" variant="outline" className="rounded-full text-xs ml-1.5" onClick={() => void exportLeavePdf(e.id, `${e.firstName} ${e.lastName}`)}>
                          <FileDown className="w-3 h-3 mr-1" /> Relevé
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        </CollapsibleSection>
      )}

      {isAdmin && (
        <CollapsibleSection id="vac-timebank" title="Banque d'heures (reprise de temps)" icon={Hourglass} className="mb-8">
          <TimeBankPanel />
        </CollapsibleSection>
      )}

      <CollapsibleSection
        id="vac-requests"
        title={isAdmin ? 'Toutes les demandes' : 'Mes demandes'}
        icon={TreePalm}
        badge={visibleRequests.some((l) => l.status === 'En attente')
          ? `${visibleRequests.filter((l) => l.status === 'En attente').length} en attente`
          : (visibleRequests.length > 0 ? `${visibleRequests.length} au total` : undefined)}
        badgeTone={visibleRequests.some((l) => l.status === 'En attente') ? 'amber' : 'slate'}
        defaultOpen={visibleRequests.some((l) => l.status === 'En attente')}
        className="mb-8"
      >
      {visibleRequests.length === 0 ? (
        <EmptyState text="Aucune demande de congé." />
      ) : (
        <div className="space-y-4">
          {visibleRequests.map((l) => {
            const emp = getEmployee(l.employee_id);
            return (
              <div key={l.id} data-testid={`leave-card-${l.id}`} className="bg-white rounded-xl border border-slate-200 p-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-3 mb-1.5">
                      <p className="font-heading font-bold text-slate-900">{l.employee_name || (emp ? `${emp.firstName} ${emp.lastName}` : 'Inconnu')}</p>
                      <StatusBadge status={l.status} />
                      <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{l.type}</span>
                      <span className="text-xs text-slate-400">{l.days} j</span>
                    </div>
                    <p className="text-sm text-slate-600">Du {l.start_date} au {l.end_date}</p>
                    {l.reason && (
                      <p data-testid={`leave-reason-${l.id}`} className="text-sm text-slate-500 mt-1 inline-flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5 text-bronze-500" /> {l.reason}
                        {isAdmin && <span className="text-[10px] text-bronze-600 font-semibold">(confidentiel — visible admin seulement)</span>}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0 items-center">
                    {isAdmin && l.status === 'En attente' && (
                      <>
                        <Button data-testid={`approve-leave-${l.id}`} onClick={() => void decide(l.id, 'approve')} className="rounded-full bg-emerald-600 hover:bg-emerald-700">
                          <Check className="w-4 h-4 mr-1" /> Approuver
                        </Button>
                        <Button data-testid={`reject-leave-${l.id}`} variant="outline" onClick={() => void decide(l.id, 'reject')} className="rounded-full text-red-600 border-red-200 hover:bg-red-50">
                          <X className="w-4 h-4 mr-1" /> Refuser
                        </Button>
                      </>
                    )}
                    {!isAdmin && l.status === 'En attente' && (
                      <Button data-testid={`cancel-leave-${l.id}`} variant="outline" onClick={() => void cancel(l.id)} className="rounded-full text-red-600 border-red-200 hover:bg-red-50">
                        <Trash2 className="w-4 h-4 mr-1" /> Annuler
                      </Button>
                    )}
                    {isAdmin && (
                      <Button data-testid={`history-leave-${l.id}`} variant="outline" size="icon" className="rounded-full h-9 w-9" onClick={() => setHistoryOpen(historyOpen === l.id ? null : l.id)} title="Historique (admin)">
                        <History className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
                {isAdmin && historyOpen === l.id && (
                  <div data-testid={`leave-history-${l.id}`} className="mt-4 pt-3 border-t border-slate-100 space-y-1.5">
                    <p className="text-[11px] uppercase tracking-[0.15em] text-slate-400 font-semibold">Journal des changements (admin seulement)</p>
                    {(l.history ?? []).map((h, i) => (
                      <p key={i} className="text-xs text-slate-600">
                        <span className="font-semibold">{ACTION_LABELS[h.action] ?? h.action}</span> par {h.by} ({h.role}) — {new Date(h.at).toLocaleString('fr-CA')}{h.note ? ` · Note : ${h.note}` : ''}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      </CollapsibleSection>

      <Dialog open={dialogOpen} onOpenChange={(v) => { setDialogOpen(v); if (!v) { setSelStart(''); setSelEnd(''); } }}>
        <DialogContent data-testid="add-leave-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading inline-flex items-center gap-2"><TreePalm className="w-4 h-4 text-emerald-600" /> Nouvelle demande de congé</DialogTitle>
            <DialogDescription>Le motif détaillé est facultatif et visible uniquement par l'administration (Loi 25).</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void submit(e)} className="space-y-4">
            {isAdmin && (
              <div className="space-y-2">
                <Label>Employé</Label>
                <Select value={employeeId} onValueChange={setEmployeeId}>
                  <SelectTrigger data-testid="leave-employee-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {state.employees.filter((e) => !e.anonymized).map((e) => <SelectItem key={e.id} value={e.id}>{e.firstName} {e.lastName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Type de congé</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger data-testid="leave-type-select"><SelectValue /></SelectTrigger>
                <SelectContent>{LEAVE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
              {!isAdmin && myBalance && (myBalance.allocations[type] ?? 0) > 0 && (
                <p data-testid="dialog-balance-hint" className="text-[11px] text-slate-500">Solde {type} : {myBalance.remaining[type]} j restants sur {myBalance.allocations[type]} j.</p>
              )}
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
              <Label className="inline-flex items-center gap-1.5"><Lock className="w-3.5 h-3.5 text-bronze-500" /> Motif détaillé (facultatif — visible uniquement par l'administration)</Label>
              <Textarea data-testid="leave-reason-input" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Vos collègues verront seulement que vous êtes absent(e), jamais le motif." />
            </div>
            <Button data-testid="leave-submit-button" type="submit" className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              Soumettre la demande
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={allocTarget !== null} onOpenChange={(v) => { if (!v) setAllocTarget(null); }}>
        <DialogContent data-testid="alloc-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Allouer des jours de congé</DialogTitle>
            <DialogDescription>
              {allocTarget ? `Jours alloués par type pour ${(JSON.parse(allocTarget) as { name: string }).name} (année ${new Date().getFullYear()}). Les jours approuvés sont déduits automatiquement.` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-3">
            {LEAVE_TYPES.map((t) => (
              <div key={t} className="space-y-1.5">
                <Label className="text-xs">{t}</Label>
                <Input data-testid={`alloc-input-${t}`} type="number" min="0" max="365" step="0.5" value={allocForm[t] ?? '0'} onChange={(e) => setAllocForm((f) => ({ ...f, [t]: e.target.value }))} />
              </div>
            ))}
          </div>
          <label data-testid="alloc-apply-all" className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input type="checkbox" checked={applyAll} onChange={() => setApplyAll((v) => !v)} className="accent-emerald-600 w-4 h-4" />
            Appliquer ces allocations par défaut à TOUS les employés actifs
          </label>
          <Button data-testid="alloc-save-button" onClick={() => void saveAlloc()} className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
            Enregistrer les allocations
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={policyOpen} onOpenChange={setPolicyOpen}>
        <DialogContent data-testid="carryover-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading inline-flex items-center gap-2">
              <RefreshCcw className="w-4 h-4 text-bronze-600" /> Report de soldes à la nouvelle année
            </DialogTitle>
            <DialogDescription>
              Les jours non utilisés de l'année précédente s'ajoutent automatiquement aux soldes chaque 1ᵉʳ janvier, selon votre politique de pharmacie.
            </DialogDescription>
          </DialogHeader>
          <label data-testid="carryover-enabled-checkbox" className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input type="checkbox" checked={policy.carryover_enabled} onChange={() => setPolicy((p) => ({ ...p, carryover_enabled: !p.carryover_enabled }))} className="accent-emerald-600 w-4 h-4" />
            Activer le report automatique (1ᵉʳ janvier)
          </label>
          <div className="space-y-1.5">
            <Label className="text-xs">Plafond de jours reportés par type (0 = sans plafond)</Label>
            <Input data-testid="carryover-max-input" type="number" min="0" max="365" step="0.5" value={String(policy.carryover_max_days)} onChange={(e) => setPolicy((p) => ({ ...p, carryover_max_days: Math.max(0, Number(e.target.value) || 0) }))} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Types de congés reportables</Label>
            <div className="flex flex-wrap gap-3">
              {LEAVE_TYPES.map((t) => (
                <label key={t} data-testid={`carryover-type-${t}`} className="flex items-center gap-1.5 text-sm text-slate-700 cursor-pointer">
                  <input type="checkbox" checked={policy.types.includes(t)} onChange={() => setPolicy((p) => ({ ...p, types: p.types.includes(t) ? p.types.filter((x) => x !== t) : [...p.types, t] }))} className="accent-emerald-600 w-4 h-4" />
                  {t}
                </label>
              ))}
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button data-testid="carryover-save-button" onClick={() => void savePolicy()} className="flex-1 rounded-full bg-emerald-600 hover:bg-emerald-700">
              Enregistrer la politique
            </Button>
            <Button data-testid="carryover-run-button" variant="outline" disabled={carryRunning || !policy.carryover_enabled} onClick={() => void runCarryover()} className="flex-1 rounded-full border-bronze-300 text-bronze-800 hover:bg-bronze-50">
              {carryRunning ? 'Report en cours…' : 'Exécuter le report maintenant'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
