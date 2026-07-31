import { useState, useEffect, useCallback, FormEvent } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { useHR } from '@/context/HRContext';
import { ScheduleProposal, ProposalStatus, ProposalWarning, ProposalAlert } from '@/types';
import { requestNavigate } from '@/lib/nav';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sparkles, Loader2, Check, X, Trash2, CalendarPlus, AlertTriangle, ExternalLink, Wallet, Users } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const normWarning = (w: string | ProposalWarning): ProposalWarning =>
  typeof w === 'string' ? { text: w, kind: 'profile' } : w;

const normAlert = (a: string | ProposalAlert): ProposalAlert =>
  typeof a === 'string' ? { text: a, kind: 'task' } : a;

const STATUS_META: Record<ProposalStatus, { label: string; cls: string }> = {
  generating: { label: 'Génération par l\'IA…', cls: 'bg-sky-100 text-sky-800' },
  error: { label: 'Erreur', cls: 'bg-red-100 text-red-800' },
  pending: { label: 'En attente d\'approbations', cls: 'bg-amber-100 text-amber-800' },
  attention: { label: 'Refus d\'employé — à réviser', cls: 'bg-orange-100 text-orange-800' },
  approved: { label: 'Approuvé — prêt à appliquer', cls: 'bg-emerald-100 text-emerald-800' },
  rejected: { label: 'Rejeté par l\'admin', cls: 'bg-red-100 text-red-800' },
  applied: { label: 'Appliqué à l\'horaire', cls: 'bg-slate-200 text-slate-700' },
};

const TRAFFIC_DAYS: [string, string][] = [
  ['mon', 'Lun'], ['tue', 'Mar'], ['wed', 'Mer'], ['thu', 'Jeu'], ['fri', 'Ven'], ['sat', 'Sam'], ['sun', 'Dim'],
];

const TRAFFIC_BLOCKS: [string, string][] = [
  ['matin', 'Matin'], ['apres_midi', 'Après-midi'], ['soir', 'Soir'],
];

type TrafficGrid = Record<string, Record<string, number>>;

const cad = (n: number): string => n.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' });

const nextMonday = (): string => {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day + 7);
  return d.toISOString().slice(0, 10);
};

export const ScheduleProposals = (): JSX.Element => {
  const { token } = useAuth();
  const { state, addShift } = useHR();
  const headers = { Authorization: `Bearer ${token ?? ''}` };
  const [proposals, setProposals] = useState<ScheduleProposal[]>([]);
  const [genOpen, setGenOpen] = useState(false);
  const [weekStart, setWeekStart] = useState(nextMonday());
  const [instructions, setInstructions] = useState('');
  const [deadlineHours, setDeadlineHours] = useState('48');
  const [budget, setBudget] = useState('');
  const [traffic, setTraffic] = useState<TrafficGrid>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    axios.get<{ weekly_budget: number; traffic: TrafficGrid }>(`${API}/schedule/settings`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        setBudget(r.data.weekly_budget > 0 ? String(r.data.weekly_budget) : '');
        setTraffic(r.data.traffic ?? {});
      })
      .catch(() => undefined);
  }, [genOpen, token]);

  useEffect(() => {
    if (!proposals.some((p) => p.effective_status === 'generating')) return undefined;
    const id = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(id);
  }, [proposals, refresh]);

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
      await axios.put(`${API}/schedule/settings`, { weekly_budget: budgetNum, traffic }, { headers });
      await axios.post(`${API}/schedule/generate`, {
        week_start: weekStart,
        instructions,
        approval_deadline_hours: Number(deadlineHours),
        weekly_budget: budgetNum,
        absences,
        employees: state.employees.filter((emp) => emp.status === 'Actif').map((emp) => ({
          id: emp.id, name: `${emp.firstName} ${emp.lastName}`, position: emp.position,
        })),
      }, { headers });
      toast.success(budgetNum > 0
        ? `L'IA prépare l'horaire en respectant le budget de ${cad(budgetNum)}, l'achalandage, les tâches et les profils…`
        : 'L\'IA prépare l\'horaire en respectant l\'achalandage, les tâches et les profils…');
      setGenOpen(false);
      await refresh();
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
      toast.error(typeof detail === 'string' ? detail : 'Génération impossible.');
    } finally {
      setBusy(false);
    }
  };

  const decide = async (id: string, status: 'approved' | 'rejected'): Promise<void> => {
    try {
      await axios.post(`${API}/schedule/proposals/${id}/decision`, { status }, { headers });
      toast.success(status === 'approved'
        ? 'Approuvé. L\'horaire sera final quand les employés auront répondu (ou au délai écoulé).'
        : 'Proposition rejetée.');
      await refresh();
    } catch {
      toast.error('Action impossible.');
    }
  };

  const apply = async (p: ScheduleProposal): Promise<void> => {
    try {
      await axios.post(`${API}/schedule/proposals/${p.id}/apply`, {}, { headers });
      p.shifts.forEach((s) => addShift({ employeeId: s.employee_id, date: s.date, startTime: s.start, endTime: s.end }));
      toast.success(`${p.shifts.length} quart(s) ajoutés à l'horaire de la semaine du ${p.week_start}.`);
      await refresh();
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
      toast.error(typeof detail === 'string' ? detail : 'Application impossible.');
    }
  };

  const remove = async (id: string): Promise<void> => {
    try {
      await axios.delete(`${API}/schedule/proposals/${id}`, { headers });
      toast.success('Proposition supprimée.');
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
        L'IA respecte le budget salarial hebdomadaire, l'achalandage (clients/heure par plage), les profils (disponibilités, rôles, restrictions,
        heures min/max, taux horaire), les absences approuvées et les tâches de la semaine. Les points douteux (budget dépassé, plage achalandée
        sans couverture, qualification manquante, conflit d'absence) sont signalés — approuvez ou rejetez en connaissance de cause,
        puis chaque employé approuve dans le délai fixé (sans réponse, l'approbation est tacite).
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
                        <Check className="w-3.5 h-3.5 mr-1" /> Approuver (admin)
                      </Button>
                      <Button data-testid={`admin-reject-${p.id}`} size="sm" variant="outline" onClick={() => void decide(p.id, 'rejected')} className="rounded-full text-xs text-red-600 border-red-200 hover:bg-red-50">
                        <X className="w-3.5 h-3.5 mr-1" /> Rejeter
                      </Button>
                    </>
                  )}
                  {p.effective_status === 'approved' && (
                    <Button data-testid={`apply-proposal-${p.id}`} size="sm" onClick={() => void apply(p)} className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs">
                      <CalendarPlus className="w-3.5 h-3.5 mr-1" /> Appliquer à l'horaire
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
            <p className="text-xs text-slate-500">Les absences approuvées, les tâches planifiées et les taux horaires des profils sont transmis automatiquement à l'IA. Le coût estimé de l'horaire sera comparé au budget.</p>
            <div className="space-y-2">
              <Label className="inline-flex items-center gap-1.5"><Users className="w-3.5 h-3.5 text-bronze-600" /> Achalandage estimé (clients à l'heure)</Label>
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
