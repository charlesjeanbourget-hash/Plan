import { useState, useEffect, useCallback, FormEvent } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { useHR } from '@/context/HRContext';
import { ScheduleProposal, ProposalStatus, ProposalWarning, ProposalAlert } from '@/types';
import { requestNavigate } from '@/lib/nav';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sparkles, Loader2, Check, X, Trash2, CalendarPlus, AlertTriangle, ExternalLink, Wallet, Users, Layers, ListOrdered } from 'lucide-react';
import { toast } from 'sonner';
import { DEPARTMENTS } from '@/lib/pharmacy';

interface PrioritySet {
  id: string;
  name: string;
  priorities: { dept_order?: string[]; employee_type?: string; availability?: string; extra?: string[] };
}

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const normWarning = (w: string | ProposalWarning): ProposalWarning =>
  typeof w === 'string' ? { text: w, kind: 'profile' } : w;

const normAlert = (a: string | ProposalAlert): ProposalAlert =>
  typeof a === 'string' ? { text: a, kind: 'task' } : a;

const STATUS_META: Record<ProposalStatus, { label: string; cls: string }> = {
  generating: { label: 'Génération par l\'IA…', cls: 'bg-sky-100 text-sky-800' },
  error: { label: 'Erreur', cls: 'bg-red-100 text-red-800' },
  pending: { label: 'Au calendrier — envoi aux employés facultatif', cls: 'bg-violet-100 text-violet-800' },
  attention: { label: 'Refus d\'employé — à réviser', cls: 'bg-orange-100 text-orange-800' },
  approved: { label: 'Approuvé par les employés', cls: 'bg-emerald-100 text-emerald-800' },
  rejected: { label: 'Rejeté par l\'admin', cls: 'bg-red-100 text-red-800' },
  applied: { label: 'Confirmé à l\'horaire', cls: 'bg-slate-200 text-slate-700' },
};

const TRAFFIC_DAYS: [string, string][] = [
  ['mon', 'Lun'], ['tue', 'Mar'], ['wed', 'Mer'], ['thu', 'Jeu'], ['fri', 'Ven'], ['sat', 'Sam'], ['sun', 'Dim'],
];

const TRAFFIC_BLOCKS: [string, string][] = [
  ['matin', 'Matin'], ['apres_midi', 'Après-midi'], ['soir', 'Soir'],
];

type TrafficGrid = Record<string, Record<string, number>>;

interface TrafficPeriod {
  id: string;
  name: string;
  start_md: string;
  end_md: string;
  traffic: TrafficGrid;
}

const mdOf = (dateStr: string): string => dateStr.slice(5);

const fmtMd = (md: string): string => `${Number(md.slice(3))}/${Number(md.slice(0, 2))}`;

const periodMatches = (p: TrafficPeriod, md: string): boolean =>
  p.start_md <= p.end_md ? (p.start_md <= md && md <= p.end_md) : (md >= p.start_md || md <= p.end_md);

const cad = (n: number): string => n.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' });

const nextMonday = (): string => {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day + 7);
  return d.toISOString().slice(0, 10);
};

const AUTO_KEY = 'ap_auto_added_proposals_v1';

const loadAutoAdded = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(AUTO_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
};

const saveAutoAdded = (s: Set<string>): void => localStorage.setItem(AUTO_KEY, JSON.stringify([...s]));

export const ScheduleProposals = (): JSX.Element => {
  const { token } = useAuth();
  const { state, addShift, deleteShift } = useHR();
  const headers = { Authorization: `Bearer ${token ?? ''}` };
  const [proposals, setProposals] = useState<ScheduleProposal[]>([]);
  const [genOpen, setGenOpen] = useState(false);
  const [weekStart, setWeekStart] = useState(nextMonday());
  const [instructions, setInstructions] = useState('');
  const [deadlineHours, setDeadlineHours] = useState('48');
  const [budget, setBudget] = useState('');
  const [traffic, setTraffic] = useState<TrafficGrid>({});
  const [defaultTraffic, setDefaultTraffic] = useState<TrafficGrid>({});
  const [periods, setPeriods] = useState<TrafficPeriod[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [savingPeriod, setSavingPeriod] = useState(false);
  const [periodName, setPeriodName] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [genMode, setGenMode] = useState<'adjust' | 'overwrite'>('adjust');
  const [genDept, setGenDept] = useState('all');
  const [deptBudgets, setDeptBudgets] = useState<Record<string, string>>({});
  const [branchBudgets, setBranchBudgets] = useState<Record<string, string>>({});
  const [prioDeptOrder, setPrioDeptOrder] = useState<string[]>([]);
  const [prioEmpType, setPrioEmpType] = useState('none');
  const [prioAvail, setPrioAvail] = useState('none');
  const [prioExtra, setPrioExtra] = useState<string[]>([]);
  const [prioSets, setPrioSets] = useState<PrioritySet[]>([]);
  const [prioSetName, setPrioSetName] = useState('');
  const [selectedPrioSet, setSelectedPrioSet] = useState('');

  const fillTraffic = (): void => {
    const first = traffic[TRAFFIC_DAYS[0][0]] ?? {};
    const t: TrafficGrid = {};
    TRAFFIC_DAYS.forEach(([day]) => {
      t[day] = {};
      TRAFFIC_BLOCKS.forEach(([block]) => { t[day][block] = first[block] ?? 0; });
    });
    setTraffic(t);
    toast.success('Ligne Lun recopiée sur toute la semaine : chaque colonne (Matin, Après-midi, Soir) suit sa première case.');
  };

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await axios.get<ScheduleProposal[]>(`${API}/schedule/proposals`, { headers });
      setProposals(res.data);
    } catch {
      setProposals([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!genOpen || !token) return;
    axios.get<{ weekly_budget: number; traffic: TrafficGrid; traffic_periods?: TrafficPeriod[]; dept_budgets?: Record<string, number>; branch_budgets?: { branch_id: string; budget: number }[]; priorities?: { dept_order?: string[]; employee_type?: string; availability?: string; extra?: string[] }; priority_sets?: PrioritySet[] }>(`${API}/schedule/settings`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        setBudget(r.data.weekly_budget > 0 ? String(r.data.weekly_budget) : '');
        setTraffic(r.data.traffic ?? {});
        setDefaultTraffic(r.data.traffic ?? {});
        setPeriods(r.data.traffic_periods ?? []);
        const db2: Record<string, string> = {};
        Object.entries(r.data.dept_budgets ?? {}).forEach(([k, v]) => { db2[k] = String(v); });
        setDeptBudgets(db2);
        const bb: Record<string, string> = {};
        (r.data.branch_budgets ?? []).forEach((b) => { bb[b.branch_id] = String(b.budget); });
        setBranchBudgets(bb);
        const pr = r.data.priorities ?? {};
        setPrioDeptOrder(pr.dept_order ?? []);
        setPrioEmpType(pr.employee_type || 'none');
        setPrioAvail(pr.availability || 'none');
        setPrioExtra(pr.extra ?? []);
        setPrioSets(r.data.priority_sets ?? []);
      })
      .catch(() => undefined);
  }, [genOpen, token]);

  useEffect(() => {
    if (!genOpen || periods.length === 0 || !weekStart) return;
    const match = periods.find((p) => periodMatches(p, mdOf(weekStart)));
    if (match) {
      setSelectedPeriod(match.id);
      setTraffic(match.traffic);
      toast.success(`Période « ${match.name} » appliquée automatiquement pour la semaine du ${weekStart}.`);
    } else {
      setSelectedPeriod('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genOpen, weekStart, periods]);

  const persistPeriods = async (next: TrafficPeriod[]): Promise<TrafficPeriod[] | null> => {
    try {
      const res = await axios.put<{ traffic_periods?: TrafficPeriod[] }>(`${API}/schedule/settings`, {
        weekly_budget: Math.max(0, Number(budget.replace(',', '.')) || 0),
        traffic,
        traffic_periods: next,
      }, { headers });
      return res.data.traffic_periods ?? next;
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
      toast.error(typeof detail === 'string' ? detail : 'Enregistrement des périodes impossible.');
      return null;
    }
  };

  const savePeriod = async (): Promise<void> => {
    const name = periodName.trim();
    if (!name || !periodStart || !periodEnd) {
      toast.error('Nom, date de début et date de fin requis.');
      return;
    }
    const next = [...periods, { id: crypto.randomUUID(), name, start_md: mdOf(periodStart), end_md: mdOf(periodEnd), traffic }];
    const saved = await persistPeriods(next);
    if (!saved) return;
    setPeriods(saved);
    setSavingPeriod(false);
    setPeriodName('');
    setPeriodStart('');
    setPeriodEnd('');
    toast.success(`Période « ${name} » enregistrée (${fmtMd(mdOf(periodStart))} → ${fmtMd(mdOf(periodEnd))}) avec la grille actuelle.`);
  };

  const deletePeriod = async (): Promise<void> => {
    const p = periods.find((x) => x.id === selectedPeriod);
    if (!p) return;
    const saved = await persistPeriods(periods.filter((x) => x.id !== selectedPeriod));
    if (!saved) return;
    setPeriods(saved);
    setSelectedPeriod('');
    setTraffic(defaultTraffic);
    toast.success(`Période « ${p.name} » supprimée.`);
  };

  const persistPrioSets = async (next: PrioritySet[]): Promise<PrioritySet[] | null> => {
    try {
      const res = await axios.put<{ priority_sets?: PrioritySet[] }>(`${API}/schedule/settings`, {
        weekly_budget: Math.max(0, Number(budget.replace(',', '.')) || 0),
        traffic,
        priority_sets: next,
      }, { headers });
      return res.data.priority_sets ?? next;
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
      toast.error(typeof detail === 'string' ? detail : 'Enregistrement des jeux de priorités impossible.');
      return null;
    }
  };

  const applyPrioSet = (id: string): void => {
    const ps = prioSets.find((x) => x.id === id);
    if (!ps) return;
    setPrioDeptOrder(ps.priorities.dept_order ?? []);
    setPrioEmpType(ps.priorities.employee_type || 'none');
    setPrioAvail(ps.priorities.availability || 'none');
    setPrioExtra(ps.priorities.extra ?? []);
    toast.success(`Jeu de priorités « ${ps.name} » appliqué.`);
  };

  const savePrioSet = async (): Promise<void> => {
    const name = prioSetName.trim();
    if (!name) {
      toast.error('Nommez le jeu de priorités (ex. Été, Fêtes).');
      return;
    }
    const next = [...prioSets, {
      id: crypto.randomUUID(),
      name,
      priorities: {
        dept_order: prioDeptOrder,
        employee_type: prioEmpType === 'none' ? '' : prioEmpType,
        availability: prioAvail === 'none' ? '' : prioAvail,
        extra: prioExtra,
      },
    }];
    const saved = await persistPrioSets(next);
    if (!saved) return;
    setPrioSets(saved);
    setPrioSetName('');
    toast.success(`Jeu de priorités « ${name} » enregistré — réutilisable en un clic.`);
  };

  const deletePrioSet = async (): Promise<void> => {
    const ps = prioSets.find((x) => x.id === selectedPrioSet);
    if (!ps) return;
    const saved = await persistPrioSets(prioSets.filter((x) => x.id !== selectedPrioSet));
    if (!saved) return;
    setPrioSets(saved);
    setSelectedPrioSet('');
    toast.success(`Jeu « ${ps.name} » supprimé.`);
  };

  useEffect(() => {
    if (!proposals.some((p) => p.effective_status === 'generating')) return undefined;
    const id = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(id);
  }, [proposals, refresh]);

  useEffect(() => {
    if (proposals.length === 0) return;
    if (localStorage.getItem(AUTO_KEY) === null) {
      saveAutoAdded(new Set(proposals.filter((p) => p.effective_status !== 'generating').map((p) => p.id)));
      return;
    }
    const added = loadAutoAdded();
    let changed = false;
    proposals.forEach((p) => {
      if (added.has(p.id) || p.effective_status === 'generating') return;
      added.add(p.id);
      changed = true;
      if (!['pending', 'attention', 'approved'].includes(p.effective_status) || p.shifts.length === 0) return;
      let removed = 0;
      if (p.existing_mode === 'overwrite') {
        const end = new Date(`${p.week_start}T00:00:00`);
        end.setDate(end.getDate() + 6);
        const wEnd = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
        state.shifts
          .filter((s) => s.date >= p.week_start && s.date <= wEnd && s.proposalId !== p.id
            && (!p.department || (s.department ?? 'Général') === p.department))
          .forEach((s) => { deleteShift(s.id); removed += 1; });
      }
      p.shifts.forEach((s) => addShift({
        id: s.id, employeeId: s.employee_id, date: s.date, startTime: s.start, endTime: s.end,
        aiGenerated: true, proposalId: p.id, department: s.department || p.department || 'Général',
      }));
      toast.success(`Horaire IA de la semaine du ${p.week_start} ajouté au calendrier (${p.shifts.length} quarts${removed > 0 ? ` — ${removed} ancien(s) quart(s) retirés, mode Écraser` : ''}) — ajustez-le par glisser-déposer.`);
    });
    if (changed) saveAutoAdded(added);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposals]);

  const setTrafficVal = (day: string, block: string, value: string): void => {
    const n = Math.max(0, Math.min(500, Number(value) || 0));
    setTraffic((t) => ({ ...t, [day]: { ...(t[day] ?? {}), [block]: n } }));
  };

  const generate = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    const budgetNum = Math.max(0, Number(budget.replace(',', '.')) || 0);
    const endDate = new Date(`${weekStart}T00:00:00`);
    endDate.setDate(endDate.getDate() + 6);
    const weekEnd = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
    const absences = state.leaveRequests
      .filter((l) => l.status === 'Approuvée' && l.startDate <= weekEnd && l.endDate >= weekStart)
      .map((l) => {
        const emp = state.employees.find((e2) => e2.id === l.employeeId);
        return {
          employee_id: l.employeeId,
          employee_name: emp ? `${emp.firstName} ${emp.lastName}` : '',
          start: l.startDate,
          end: l.endDate,
          type: l.type,
        };
      });
    try {
      const deptB: Record<string, number> = {};
      DEPARTMENTS.forEach((d) => {
        const n = Math.max(0, Number((deptBudgets[d] ?? '').replace(',', '.')) || 0);
        if (n > 0) deptB[d] = n;
      });
      const branchB = state.branches
        .map((b) => ({ branch_id: b.id, branch_name: b.name, budget: Math.max(0, Number((branchBudgets[b.id] ?? '').replace(',', '.')) || 0) }))
        .filter((b) => b.budget > 0);
      const priorities = {
        dept_order: prioDeptOrder,
        employee_type: prioEmpType === 'none' ? '' : prioEmpType,
        availability: prioAvail === 'none' ? '' : prioAvail,
        extra: prioExtra,
      };
      await axios.put(`${API}/schedule/settings`, { weekly_budget: budgetNum, traffic, dept_budgets: deptB, branch_budgets: branchB, priorities }, { headers });
      await axios.post(`${API}/schedule/generate`, {
        week_start: weekStart,
        instructions,
        approval_deadline_hours: Number(deadlineHours),
        weekly_budget: budgetNum,
        absences,
        department: genDept === 'all' ? '' : genDept,
        existing_mode: genMode,
        existing_shifts: genMode === 'adjust'
          ? state.shifts.filter((s) => s.date >= weekStart && s.date <= weekEnd).map((s) => {
            const emp = state.employees.find((e2) => e2.id === s.employeeId);
            return {
              employee_id: s.employeeId,
              employee_name: emp ? `${emp.firstName} ${emp.lastName}` : '',
              date: s.date, start: s.startTime, end: s.endTime,
            };
          })
          : [],
        employees: state.employees.filter((emp) => emp.status === 'Actif').map((emp) => ({
          id: emp.id, name: `${emp.firstName} ${emp.lastName}`, position: emp.position,
          branch_id: emp.branchId ?? '',
          branch_name: state.branches.find((b) => b.id === emp.branchId)?.name ?? '',
          hire_date: emp.hireDate ?? '',
        })),
      }, { headers });
      toast.success(budgetNum > 0
        ? `L'IA prépare l'horaire (budget ${cad(budgetNum)}) — les quarts apparaîtront automatiquement dans le calendrier.`
        : 'L\'IA prépare l\'horaire — les quarts apparaîtront automatiquement dans le calendrier.');
      setGenOpen(false);
      await refresh();
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
      toast.error(typeof detail === 'string' ? detail : 'Génération impossible.');
    } finally {
      setBusy(false);
    }
  };

  const removeAiShifts = (proposalId: string): number => {
    const linked = state.shifts.filter((s) => s.proposalId === proposalId);
    linked.forEach((s) => deleteShift(s.id));
    return linked.length;
  };

  const decide = async (id: string, status: 'approved' | 'rejected'): Promise<void> => {
    try {
      await axios.post(`${API}/schedule/proposals/${id}/decision`, { status }, { headers });
      if (status === 'rejected') {
        const n = removeAiShifts(id);
        toast.success(n > 0 ? `Proposition rejetée — ${n} quart(s) IA retirés du calendrier.` : 'Proposition rejetée.');
      } else {
        toast.success('Envoyé aux employés pour approbation (sans réponse au délai, l\'approbation est tacite).');
      }
      await refresh();
    } catch {
      toast.error('Action impossible.');
    }
  };

  const apply = async (p: ScheduleProposal): Promise<void> => {
    try {
      await axios.post(`${API}/schedule/proposals/${p.id}/apply`, {}, { headers });
      const missing = p.shifts.filter((s) => !state.shifts.some((x) =>
        x.employeeId === s.employee_id && x.date === s.date && x.startTime === s.start && x.endTime === s.end));
      missing.forEach((s) => addShift({
        id: s.id, employeeId: s.employee_id, date: s.date, startTime: s.start, endTime: s.end,
        aiGenerated: true, proposalId: p.id, department: s.department || p.department || 'Général',
      }));
      toast.success(missing.length === 0
        ? `Horaire de la semaine du ${p.week_start} confirmé — tous les quarts étaient déjà au calendrier.`
        : `Horaire confirmé — ${missing.length} quart(s) ajoutés, ${p.shifts.length - missing.length} déjà au calendrier.`);
      await refresh();
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
      toast.error(typeof detail === 'string' ? detail : 'Application impossible.');
    }
  };

  const remove = async (id: string): Promise<void> => {
    try {
      await axios.delete(`${API}/schedule/proposals/${id}`, { headers });
      const n = removeAiShifts(id);
      toast.success(n > 0 ? `Proposition supprimée — ${n} quart(s) IA retirés du calendrier.` : 'Proposition supprimée.');
      await refresh();
    } catch {
      toast.error('Suppression impossible.');
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6" data-testid="schedule-proposals-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="font-heading text-base font-bold text-slate-900 inline-flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-emerald-600" /> Horaires générés par IA
        </h2>
        <Button data-testid="generate-schedule-button" size="sm" onClick={() => setGenOpen(true)} className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs">
          <Sparkles className="w-3.5 h-3.5 mr-1" /> Générer l'horaire par IA
        </Button>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Dès la génération terminée, les quarts apparaissent <strong>directement dans le calendrier</strong> (pastille violette « IA ») —
        ajustez-les librement par glisser-déposer ou par clic. L'IA respecte le budget, l'achalandage, les profils (disponibilités, rôles, restrictions,
        heures min/max, taux horaire), les absences approuvées, les <strong>remplaçants d'agence confirmés (plages et taux horaires inclus au budget)</strong> et
        les tâches de la semaine ; les points douteux sont signalés.
        Facultatif : « Envoyer aux employés » lance l'approbation par chacun dans le délai fixé (sans réponse, l'approbation est tacite).
        Rejeter ou supprimer une proposition retire ses quarts IA du calendrier.
      </p>

      {proposals.length === 0 && <p className="text-sm text-slate-500">Aucune proposition. Générez votre premier horaire par IA.</p>}

      <div className="space-y-4">
        {proposals.map((p) => {
          const meta = STATUS_META[p.effective_status];
          const days = Array.from(new Set(p.shifts.map((s) => s.date))).sort();
          const isOpen = expanded === p.id;
          const overBudget = (p.weekly_budget ?? 0) > 0 && (p.estimated_cost ?? 0) > (p.weekly_budget ?? 0);
          return (
            <div key={p.id} data-testid={`proposal-card-${p.id}`} className="rounded-lg border border-slate-200 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  {p.effective_status === 'generating' && <Loader2 className="w-4 h-4 text-sky-600 animate-spin" />}
                  <p className="text-sm font-bold text-slate-800">Semaine du {p.week_start}</p>
                  <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${meta.cls}`}>{meta.label}</span>
                  {p.department && (
                    <span data-testid={`proposal-dept-${p.id}`} className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                      <Layers className="w-3 h-3" /> {p.department}
                    </span>
                  )}
                  {p.existing_mode === 'overwrite' && (
                    <span data-testid={`proposal-mode-${p.id}`} className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-50 text-red-700 border border-red-200">Mode Écraser</span>
                  )}
                  {(() => {
                    const pr = p.priorities;
                    const n = pr ? (pr.dept_order?.length ?? 0) + (pr.employee_type ? 1 : 0) + (pr.availability ? 1 : 0) + (pr.extra?.length ?? 0) : 0;
                    if (n === 0) return null;
                    const parts = [
                      ...(pr?.dept_order?.length ? [`Départements : ${pr.dept_order.join(' > ')}`] : []),
                      ...(pr?.employee_type === 'full_time' ? ['Temps pleins d\'abord'] : pr?.employee_type === 'part_time' ? ['Temps partiels d\'abord'] : []),
                      ...(pr?.availability === 'most' ? ['Grandes disponibilités d\'abord'] : pr?.availability === 'least' ? ['Disponibilités restreintes casées d\'abord'] : []),
                      ...(pr?.extra?.includes('seniority') ? ['Ancienneté'] : []),
                      ...(pr?.extra?.includes('low_cost') ? ['Taux les plus bas'] : []),
                      ...(pr?.extra?.includes('min_hours_equity') ? ['Équité des minimums'] : []),
                    ];
                    return (
                      <span data-testid={`proposal-priorities-${p.id}`} title={parts.join(' · ')} className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-bronze-50 text-bronze-800 border border-bronze-200 cursor-help">
                        <ListOrdered className="w-3 h-3" /> {n} priorité(s)
                      </span>
                    );
                  })()}
                  {p.estimated_cost != null && p.effective_status !== 'generating' && (
                    <span
                      data-testid={`proposal-cost-${p.id}`}
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${overBudget ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'}`}
                    >
                      <Wallet className="w-3 h-3" /> Coût estimé : {cad(p.estimated_cost)}
                      {(p.weekly_budget ?? 0) > 0 && ` / Budget : ${cad(p.weekly_budget ?? 0)}`}
                    </span>
                  )}
                  {(p.warnings_count ?? 0) > 0 && p.effective_status !== 'applied' && (
                    <span data-testid={`proposal-warnings-badge-${p.id}`} className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
                      <AlertTriangle className="w-3 h-3" /> {p.warnings_count} point(s) à vérifier
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {p.effective_status !== 'generating' && (
                    <Button size="sm" variant="outline" data-testid={`proposal-toggle-${p.id}`} onClick={() => setExpanded(isOpen ? null : p.id)} className="rounded-full text-xs">
                      {isOpen ? 'Réduire' : `Détails (${p.shifts.length} quarts)`}
                    </Button>
                  )}
                  {p.admin_status === 'pending' && p.effective_status !== 'generating' && p.effective_status !== 'error' && (
                    <>
                      <Button data-testid={`admin-approve-${p.id}`} size="sm" onClick={() => void decide(p.id, 'approved')} className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs">
                        <Check className="w-3.5 h-3.5 mr-1" /> Envoyer aux employés
                      </Button>
                      <Button data-testid={`admin-reject-${p.id}`} size="sm" variant="outline" onClick={() => void decide(p.id, 'rejected')} className="rounded-full text-xs text-red-600 border-red-200 hover:bg-red-50">
                        <X className="w-3.5 h-3.5 mr-1" /> Rejeter
                      </Button>
                    </>
                  )}
                  {p.effective_status === 'approved' && (
                    <Button data-testid={`apply-proposal-${p.id}`} size="sm" onClick={() => void apply(p)} className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs">
                      <CalendarPlus className="w-3.5 h-3.5 mr-1" /> Confirmer à l'horaire
                    </Button>
                  )}
                  <Button data-testid={`delete-proposal-${p.id}`} size="sm" variant="outline" onClick={() => void remove(p.id)} className="rounded-full text-xs text-red-600 border-red-200 hover:bg-red-50">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              {p.effective_status === 'error' && <p className="text-xs text-red-600 mt-2">{p.error}</p>}

              {p.effective_status !== 'generating' && Object.keys(p.employee_approvals).length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {Object.entries(p.employee_approvals).map(([eid, slot]) => {
                    const emp = state.employees.find((e2) => e2.id === eid);
                    const name = emp ? `${emp.firstName} ${emp.lastName[0]}.` : eid;
                    const cls = slot.status === 'approved'
                      ? 'bg-emerald-100 text-emerald-800'
                      : slot.status === 'rejected'
                        ? 'bg-red-100 text-red-800'
                        : p.deadline_passed ? 'bg-slate-200 text-slate-600' : 'bg-amber-100 text-amber-800';
                    const label = slot.status === 'approved' ? '✓' : slot.status === 'rejected' ? '✕' : p.deadline_passed ? 'tacite' : '…';
                    return (
                      <span key={eid} title={slot.comment} className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>
                        {name} {label}
                      </span>
                    );
                  })}
                  <span className="text-xs text-slate-400 ml-1">Délai : {new Date(p.approval_deadline).toLocaleString('fr-CA', { dateStyle: 'short', timeStyle: 'short' })}</span>
                </div>
              )}

              {isOpen && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                  {p.summary && <p className="text-xs text-slate-500 italic mb-4">{p.summary}</p>}
                  {(p.alerts ?? []).length > 0 && (
                    <div data-testid={`proposal-alerts-${p.id}`} className="rounded-lg border border-amber-200 bg-amber-50 p-3 mb-4">
                      <p className="text-xs font-bold text-amber-800 mb-1.5 inline-flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" /> Points à vérifier avant d'approuver
                      </p>
                      <ul className="space-y-1.5">
                        {(p.alerts ?? []).map((raw, i) => {
                          const a = normAlert(raw);
                          const clickable = a.kind === 'task' || a.kind === 'profile';
                          if (!clickable) {
                            return (
                              <li key={i} data-testid={`alert-static-${p.id}-${i}`} className={`text-xs ${a.kind === 'budget' ? 'text-red-700 font-semibold' : 'text-amber-800'}`}>
                                — {a.text}
                              </li>
                            );
                          }
                          return (
                            <li key={i}>
                              <button
                                type="button"
                                data-testid={`alert-link-${p.id}-${i}`}
                                onClick={() => a.kind === 'profile'
                                  ? requestNavigate('employees', { employeeId: a.employee_id })
                                  : requestNavigate('tasks', { taskDate: a.task_date, taskId: a.task_id })}
                                className="group text-left text-xs text-amber-800 hover:text-amber-950 inline-flex items-start gap-1.5"
                              >
                                <span className="group-hover:underline">— {a.text}</span>
                                <ExternalLink className="w-3 h-3 mt-0.5 shrink-0 opacity-50 group-hover:opacity-100 transition-opacity" />
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                      <p className="text-[11px] text-amber-700/80 mt-2">Cliquez sur un point pour ouvrir directement la tâche ou le profil concerné.</p>
                    </div>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {days.map((d) => (
                      <div key={d} className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                        <p className="text-xs font-bold text-slate-700 mb-2">{d}</p>
                        {p.shifts.filter((s) => s.date === d).sort((a, b) => a.start.localeCompare(b.start)).map((s) => (
                          <div key={s.id} className="mb-1.5 last:mb-0">
                            <p className="text-xs text-slate-600">
                              <span className="font-semibold text-slate-800">{s.start}–{s.end}</span> {s.employee_name}
                              {s.role && <span className="text-slate-400"> · {s.role}</span>}
                              {(s.warnings ?? []).length > 0 && <AlertTriangle data-testid={`shift-warning-icon-${s.id}`} className="w-3 h-3 text-amber-600 inline ml-1.5 align-[-1px]" />}
                            </p>
                            {(s.warnings ?? []).map((raw, i) => {
                              const w = normWarning(raw);
                              return (
                                <button
                                  key={i}
                                  type="button"
                                  data-testid={`shift-warning-link-${s.id}-${i}`}
                                  onClick={() => w.kind === 'absence'
                                    ? requestNavigate('vacations')
                                    : requestNavigate('employees', { employeeId: s.employee_id })}
                                  className="block text-left text-[11px] text-amber-700 font-semibold pl-2 hover:underline"
                                >
                                  {w.text}
                                </button>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={genOpen} onOpenChange={setGenOpen}>
        <DialogContent data-testid="generate-schedule-dialog" className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="font-heading">Générer l'horaire par IA</DialogTitle>
            <DialogDescription>
              L'IA compose l'horaire selon le budget, l'achalandage, les tâches, les absences et les profils des employés.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void generate(e)} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Semaine (lundi)</Label>
                <Input data-testid="gen-week-start-input" type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label className="inline-flex items-center gap-1.5"><Wallet className="w-3.5 h-3.5 text-bronze-600" /> Budget salarial de la semaine ($)</Label>
                <Input data-testid="gen-budget-input" value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" placeholder="Ex. 8500 — vide = sans limite" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Quarts déjà au calendrier</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    data-testid="gen-mode-adjust"
                    onClick={() => setGenMode('adjust')}
                    className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${genMode === 'adjust' ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}`}
                  >
                    S'ajuster
                    <span className="block font-normal text-[10px] mt-0.5">l'IA complète autour des quarts existants</span>
                  </button>
                  <button
                    type="button"
                    data-testid="gen-mode-overwrite"
                    onClick={() => setGenMode('overwrite')}
                    className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${genMode === 'overwrite' ? 'border-red-400 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}`}
                  >
                    Écraser
                    <span className="block font-normal text-[10px] mt-0.5">l'IA repart à zéro pour la semaine</span>
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="inline-flex items-center gap-1.5"><Layers className="w-3.5 h-3.5 text-bronze-600" /> Département</Label>
                <Select value={genDept} onValueChange={setGenDept}>
                  <SelectTrigger data-testid="gen-dept-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les départements</SelectItem>
                    {DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-slate-400">Les quarts générés porteront ce département (filtrable dans le calendrier).</p>
              </div>
            </div>
            {genMode === 'overwrite' && (
              <div data-testid="gen-overwrite-warning" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                <span className="font-bold">Attention — mode Écraser :</span> dès que l'horaire IA sera prêt, les quarts existants de la semaine
                {genDept === 'all' ? ' de TOUS les départements' : ` du département « ${genDept} »`} seront retirés du calendrier et remplacés par les quarts générés.
              </div>
            )}
            <details data-testid="gen-detail-budgets" className="rounded-lg border border-slate-200 p-3">
              <summary className="text-xs font-semibold text-slate-600 cursor-pointer select-none">
                Budgets par département et par succursale (facultatif)
              </summary>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
                {DEPARTMENTS.map((d) => (
                  <div key={d} className="space-y-1">
                    <Label className="text-[11px] text-slate-500">{d}</Label>
                    <Input
                      data-testid={`gen-dept-budget-${d}`}
                      value={deptBudgets[d] ?? ''}
                      onChange={(e) => setDeptBudgets((m) => ({ ...m, [d]: e.target.value }))}
                      inputMode="decimal"
                      placeholder="$ max"
                      className="h-8 text-xs"
                    />
                  </div>
                ))}
              </div>
              {state.branches.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3 pt-3 border-t border-slate-100">
                  {state.branches.map((b) => (
                    <div key={b.id} className="space-y-1">
                      <Label className="text-[11px] text-slate-500">Succursale {b.name}</Label>
                      <Input
                        data-testid={`gen-branch-budget-${b.id}`}
                        value={branchBudgets[b.id] ?? ''}
                        onChange={(e) => setBranchBudgets((m) => ({ ...m, [b.id]: e.target.value }))}
                        inputMode="decimal"
                        placeholder="$ max"
                        className="h-8 text-xs"
                      />
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-slate-400 mt-2">
                Vide = sans limite. L'IA respecte ces plafonds en plus du budget global de la semaine ; tout dépassement est signalé dans les points à vérifier.
              </p>
            </details>
            <details data-testid="gen-detail-priorities" className="rounded-lg border border-slate-200 p-3" open={prioDeptOrder.length > 0 || prioEmpType !== 'none' || prioAvail !== 'none' || prioExtra.length > 0}>
              <summary className="text-xs font-semibold text-slate-600 cursor-pointer select-none">
                Priorités de planification (facultatif) — vos règles priment sur celles de l'IA
              </summary>
              <div className="space-y-3 mt-3">
                <div className="flex flex-wrap items-center gap-2 pb-2 border-b border-slate-100">
                  <Select value={selectedPrioSet} onValueChange={(v) => { setSelectedPrioSet(v); applyPrioSet(v); }}>
                    <SelectTrigger data-testid="gen-prio-set-select" className="h-8 w-56 text-xs">
                      <SelectValue placeholder="Appliquer un jeu enregistré (Été, Fêtes…)" />
                    </SelectTrigger>
                    <SelectContent>
                      {prioSets.length === 0
                        ? <SelectItem value="__none" disabled>Aucun jeu enregistré</SelectItem>
                        : prioSets.map((ps) => <SelectItem key={ps.id} value={ps.id}>{ps.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {selectedPrioSet && (
                    <Button type="button" data-testid="gen-prio-set-delete" variant="outline" onClick={() => void deletePrioSet()} className="h-8 rounded-full text-xs text-red-600 border-red-200 hover:bg-red-50">
                      <Trash2 className="w-3.5 h-3.5 mr-1" /> Supprimer
                    </Button>
                  )}
                  <div className="flex items-center gap-1.5 ml-auto">
                    <Input
                      data-testid="gen-prio-set-name"
                      value={prioSetName}
                      onChange={(e) => setPrioSetName(e.target.value)}
                      placeholder="Nom (Été, Fêtes…)"
                      className="h-8 w-36 text-xs"
                    />
                    <Button type="button" data-testid="gen-prio-set-save" variant="outline" onClick={() => void savePrioSet()} className="h-8 rounded-full text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-50">
                      Enregistrer le jeu
                    </Button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-slate-500">Départements à couvrir en premier (cliquez dans l'ordre de priorité)</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {DEPARTMENTS.map((d) => {
                      const idx = prioDeptOrder.indexOf(d);
                      return (
                        <button
                          key={d}
                          type="button"
                          data-testid={`gen-prio-dept-${d}`}
                          onClick={() => setPrioDeptOrder((o) => (o.includes(d) ? o.filter((x) => x !== d) : [...o, d]))}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${idx >= 0 ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-emerald-300'}`}
                        >
                          {idx >= 0 && <span className="inline-flex w-4 h-4 items-center justify-center rounded-full bg-white/25 text-[10px] font-bold">{idx + 1}</span>}
                          {d}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-[11px] text-slate-500">Type d'employés à prioriser</Label>
                    <Select value={prioEmpType} onValueChange={setPrioEmpType}>
                      <SelectTrigger data-testid="gen-prio-emptype" className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Aucune préférence</SelectItem>
                        <SelectItem value="full_time">Temps pleins d'abord (≈30 h+/sem)</SelectItem>
                        <SelectItem value="part_time">Temps partiels d'abord</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] text-slate-500">Disponibilités</Label>
                    <Select value={prioAvail} onValueChange={setPrioAvail}>
                      <SelectTrigger data-testid="gen-prio-avail" className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Aucune préférence</SelectItem>
                        <SelectItem value="most">Grandes disponibilités d'abord</SelectItem>
                        <SelectItem value="least">Caser d'abord les disponibilités restreintes</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {([
                    ['seniority', 'Ancienneté d\'abord'],
                    ['low_cost', 'Taux horaires les plus bas d\'abord'],
                    ['min_hours_equity', 'Équité : minimums d\'heures d\'abord'],
                  ] as [string, string][]).map(([key, label]) => (
                    <label key={key} data-testid={`gen-prio-extra-${key}`} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={prioExtra.includes(key)}
                        onChange={() => setPrioExtra((l) => (l.includes(key) ? l.filter((x) => x !== key) : [...l, key]))}
                        className="accent-emerald-600 w-3.5 h-3.5"
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400">
                  Sans priorité, l'IA applique les règles par défaut (priorité Laboratoire et caisse). Vos choix sont mémorisés pour les prochaines générations.
                </p>
              </div>
            </details>
            <p className="text-xs text-slate-500">Les absences approuvées, les tâches planifiées et les taux horaires des profils sont transmis automatiquement à l'IA. Le coût estimé de l'horaire sera comparé au budget.</p>
            <div className="space-y-2">
              <Label className="inline-flex items-center gap-1.5"><Users className="w-3.5 h-3.5 text-bronze-600" /> Achalandage estimé (clients à l'heure)</Label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  data-testid="gen-traffic-fill-button"
                  size="sm"
                  variant="outline"
                  onClick={fillTraffic}
                  className="rounded-full text-xs border-bronze-300 text-bronze-800 hover:bg-bronze-50"
                >
                  Appliquer partout
                </Button>
                <span className="text-[11px] text-slate-400">la 1re case de chaque colonne (ligne Lun) est recopiée sur toute sa colonne</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={selectedPeriod || 'none'}
                  onValueChange={(v) => {
                    if (v === 'none') {
                      setSelectedPeriod('');
                      setTraffic(defaultTraffic);
                      return;
                    }
                    const p = periods.find((x) => x.id === v);
                    if (p) {
                      setSelectedPeriod(v);
                      setTraffic(p.traffic);
                      toast.success(`Grille de la période « ${p.name} » chargée.`);
                    }
                  }}
                >
                  <SelectTrigger data-testid="gen-period-select" className="h-8 w-56 text-xs">
                    <SelectValue placeholder="Période de l'année" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Grille par défaut (aucune période)</SelectItem>
                    {periods.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name} ({fmtMd(p.start_md)} → {fmtMd(p.end_md)})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedPeriod && (
                  <Button
                    type="button"
                    data-testid="gen-period-delete"
                    size="sm"
                    variant="ghost"
                    onClick={() => void deletePeriod()}
                    className="rounded-full text-xs text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1" /> Supprimer
                  </Button>
                )}
                <Button
                  type="button"
                  data-testid="gen-period-save-toggle"
                  size="sm"
                  variant="outline"
                  onClick={() => setSavingPeriod((v) => !v)}
                  className="rounded-full text-xs"
                >
                  Enregistrer la grille comme période…
                </Button>
              </div>
              {savingPeriod && (
                <div data-testid="gen-period-form" className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  <Input
                    data-testid="gen-period-name"
                    value={periodName}
                    onChange={(e) => setPeriodName(e.target.value)}
                    placeholder="Ex. Été / Fêtes / Saison grippe"
                    className="h-8 w-44 text-xs"
                  />
                  <span className="text-xs text-slate-500">du</span>
                  <Input data-testid="gen-period-start" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="h-8 w-36 text-xs" />
                  <span className="text-xs text-slate-500">au</span>
                  <Input data-testid="gen-period-end" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="h-8 w-36 text-xs" />
                  <Button type="button" data-testid="gen-period-save" size="sm" onClick={() => void savePeriod()} className="rounded-full text-xs bg-emerald-600 hover:bg-emerald-700">
                    Enregistrer
                  </Button>
                  <span className="w-full text-[11px] text-slate-400">
                    La grille d'achalandage actuelle sera associée à cette période (seuls le jour et le mois comptent — elle se réapplique chaque année, ex. Fêtes 15/12 → 05/01).
                  </span>
                </div>
              )}
              <div data-testid="gen-traffic-grid" className="rounded-lg border border-slate-200 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500">
                      <th className="px-2 py-1.5 text-left font-semibold">Jour</th>
                      {TRAFFIC_BLOCKS.map(([, label]) => (
                        <th key={label} className="px-2 py-1.5 text-left font-semibold">{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {TRAFFIC_DAYS.map(([day, label]) => (
                      <tr key={day} className="border-t border-slate-100">
                        <td className="px-2 py-1 font-semibold text-slate-700">{label}</td>
                        {TRAFFIC_BLOCKS.map(([block]) => (
                          <td key={block} className="px-1.5 py-1">
                            <Input
                              data-testid={`gen-traffic-${day}-${block}`}
                              value={String(traffic[day]?.[block] ?? 0)}
                              onChange={(e) => setTrafficVal(day, block, e.target.value)}
                              inputMode="numeric"
                              className="h-7 w-full text-xs px-2"
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-500">Plus de clients/heure = plus de personnel planifié sur la plage. Sauvegardé pour les prochaines générations (Matin 8h-12h · Après-midi 12h-17h · Soir 17h-21h30).</p>
            </div>
            <div className="space-y-2">
              <Label>Consignes pour l'IA (besoins, heures d'ouverture, événements…)</Label>
              <Textarea data-testid="gen-instructions-input" rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Ex. 2 personnes au labo en tout temps, vaccination jeudi PM, ouverture 8h-21h en semaine…" />
            </div>
            <div className="space-y-2">
              <Label>Délai maximal d'approbation par les employés</Label>
              <Select value={deadlineHours} onValueChange={setDeadlineHours}>
                <SelectTrigger data-testid="gen-deadline-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="24">24 heures</SelectItem>
                  <SelectItem value="48">48 heures</SelectItem>
                  <SelectItem value="72">72 heures</SelectItem>
                  <SelectItem value="168">7 jours</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">Sans réponse au délai, l'approbation de l'employé est considérée tacite.</p>
            </div>
            <Button data-testid="gen-submit-button" type="submit" disabled={busy} className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              {busy ? 'Lancement…' : 'Lancer la génération'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
