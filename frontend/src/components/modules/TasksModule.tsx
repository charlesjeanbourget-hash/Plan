import { useState, useEffect, useCallback, FormEvent } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { useHR } from '@/context/HRContext';
import { ShiftTask } from '@/types';
import { ModuleHeader } from '@/components/modules/shared';
import { TaskStatsPanel } from '@/components/TaskStatsPanel';
import { TaskTemplatesDialog } from '@/components/TaskTemplatesDialog';
import { TeamGoalBar } from '@/components/TeamGoalBar';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TASK_CATALOG } from '@/lib/taskCatalog';
import { Plus, ChevronLeft, ChevronRight, Trash2, CopyPlus, Sunrise, Sun, Moon, Repeat, LayoutTemplate, BarChart3, CalendarDays, AlertTriangle, LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { consumeNavPayload } from '@/lib/nav';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const SHIFTS = ['Matin', 'Après-midi', 'Soir'];
const SHIFT_ICONS: Record<string, LucideIcon> = { 'Matin': Sunrise, 'Après-midi': Sun, 'Soir': Moon };
const DAY_LABELS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

const isoLocal = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const mondayOf = (offset: number): Date => {
  const now = new Date();
  const d = new Date(now);
  d.setDate(now.getDate() - ((now.getDay() + 6) % 7) + offset * 7);
  return d;
};

const weekOffsetFor = (iso: string): number => {
  const target = new Date(`${iso}T00:00:00`);
  target.setDate(target.getDate() - ((target.getDay() + 6) % 7));
  const cur = mondayOf(0);
  cur.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - cur.getTime()) / 604800000);
};

const apiError = (err: unknown): string => {
  if (axios.isAxiosError(err) && err.response) {
    const detail = (err.response.data as { detail?: unknown }).detail;
    if (typeof detail === 'string') return detail;
  }
  return 'Une erreur est survenue.';
};

const QUALIF_STOP = new Set(['gestion', 'verification', 'verifier', 'faire', 'avant', 'apres', 'pour', 'dans',
  'avec', 'sans', 'sous', 'tous', 'tout', 'toute', 'toutes', 'cette', 'chaque', 'pharmacie', 'responsable',
  'service', 'prise', 'mise']);

const normWords = (s: string): string[] => {
  const txt = s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return (txt.match(/[a-z]{4,}/g) ?? []).filter((w) => !QUALIF_STOP.has(w));
};

const isQualified = (title: string, caps: string[]): boolean => {
  const tw = normWords(title);
  if (tw.length === 0 || caps.length === 0) return true;
  return caps.some((c) => normWords(c).some((w) => tw.includes(w)));
};

export default function TasksModule(): JSX.Element {
  const { token, currentUser } = useAuth();
  const { state } = useHR();
  const isAdmin = currentUser?.role !== 'employee';
  const headers = { Authorization: `Bearer ${token ?? ''}` };
  const [navPayload] = useState(() => consumeNavPayload());
  const [weekOffset, setWeekOffset] = useState(navPayload?.taskDate ? weekOffsetFor(navPayload.taskDate) : 0);
  const highlightId = navPayload?.taskId ?? '';
  const [tasks, setTasks] = useState<ShiftTask[]>([]);
  const [view, setView] = useState<'week' | 'stats'>('week');
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [caps, setCaps] = useState<Record<string, string[]>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [tDate, setTDate] = useState('');
  const [tShift, setTShift] = useState('Matin');
  const [tTitle, setTTitle] = useState('');
  const [tDescription, setTDescription] = useState('');
  const [tAssignee, setTAssignee] = useState('team');
  const [tRecurring, setTRecurring] = useState(false);
  const [tDomain, setTDomain] = useState('manuel');
  const [tCatalog, setTCatalog] = useState('');
  const [tCompetences, setTCompetences] = useState<string[]>([]);

  const pickCatalogTask = (title: string): void => {
    const domain = TASK_CATALOG.find((d) => d.key === tDomain);
    const task = domain?.sections.flatMap((s) => s.tasks).find((t) => t.title === title);
    if (!task) return;
    setTCatalog(title);
    setTTitle(task.title);
    setTDescription(task.description);
    setTCompetences(task.competences);
  };

  const matchesCompetences = (empId: string): boolean => {
    const c = caps[empId] ?? [];
    if (c.length === 0) return true;
    if (tCompetences.length > 0) return tCompetences.some((k) => isQualified(k, c));
    return isQualified(tTitle, c);
  };

  const monday = mondayOf(weekOffset);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return isoLocal(d);
  });

  const refresh = useCallback(async (): Promise<void> => {
    const m = mondayOf(weekOffset);
    const e = new Date(m);
    e.setDate(m.getDate() + 6);
    try {
      const res = await axios.get<ShiftTask[]>(`${API}/tasks?start=${isoLocal(m)}&end=${isoLocal(e)}`, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      setTasks(res.data);
    } catch {
      toast.error('Impossible de charger les tâches.');
    }
  }, [token, weekOffset]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!isAdmin) return;
    axios.get<{ employee_id: string; capacities?: string[] }[]>(`${API}/profiles`, { headers: { Authorization: `Bearer ${token ?? ''}` } })
      .then((r) => {
        const m: Record<string, string[]> = {};
        r.data.forEach((p) => { m[p.employee_id] = p.capacities ?? []; });
        setCaps(m);
      })
      .catch(() => undefined);
  }, [token, isAdmin]);

  const doneCount = tasks.filter((t) => t.done).length;
  const progress = tasks.length > 0 ? Math.round((doneCount / tasks.length) * 100) : 0;

  const toggle = async (t: ShiftTask): Promise<void> => {
    try {
      const res = await axios.post<ShiftTask>(`${API}/tasks/${t.id}/toggle`, {}, { headers });
      setTasks((prev) => prev.map((x) => (x.id === t.id ? res.data : x)));
      if (res.data.done) toast.success(`Tâche « ${t.title} » complétée !`);
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const remove = async (t: ShiftTask): Promise<void> => {
    try {
      const res = await axios.delete<{ status: string; series_stopped: boolean }>(`${API}/tasks/${t.id}`, { headers });
      setTasks((prev) => prev.filter((x) => x.id !== t.id));
      toast.success(res.data.series_stopped ? 'Tâche supprimée — la répétition hebdomadaire de cette série est arrêtée.' : 'Tâche supprimée.');
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const toggleRecurring = async (t: ShiftTask): Promise<void> => {
    try {
      await axios.put(`${API}/tasks/${t.id}/recurring`, { recurring: !t.recurring }, { headers });
      toast.success(!t.recurring
        ? `« ${t.title} » reviendra automatiquement chaque semaine.`
        : `« ${t.title} » ne se répétera plus.`);
      await refresh();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const copyPreviousWeek = async (): Promise<void> => {
    try {
      const res = await axios.post<{ created: number }>(`${API}/tasks/copy-week`, {
        from_start: isoLocal(mondayOf(weekOffset - 1)),
        to_start: days[0],
      }, { headers });
      toast.success(`${res.data.created} tâche(s) copiée(s) depuis la semaine précédente.`);
      await refresh();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const openCreate = (date?: string): void => {
    setTDate(date ?? days[0]);
    setTTitle('');
    setTDescription('');
    setTAssignee('team');
    setTRecurring(false);
    setTDomain('manuel');
    setTCatalog('');
    setTCompetences([]);
    setCreateOpen(true);
  };

  const submitCreate = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const emp = state.employees.find((x) => x.id === tAssignee);
    try {
      const res = await axios.post<ShiftTask>(`${API}/tasks`, {
        date: tDate,
        shift: tShift,
        title: tTitle,
        description: tDescription,
        assignee_employee_id: emp ? emp.id : '',
        assignee_name: emp ? `${emp.firstName} ${emp.lastName}` : '',
        recurring: tRecurring,
        competences: tCompetences,
      }, { headers });
      toast.success(tRecurring ? 'Tâche ajoutée — elle reviendra automatiquement chaque semaine.' : 'Tâche ajoutée au quart.');
      if (res.data.qualification_warning && emp) {
        toast.warning(`Cette tâche ne figure pas dans les capacités du profil de ${emp.firstName} ${emp.lastName} — qualification à vérifier.`);
      }
      setCreateOpen(false);
      await refresh();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const createQualifWarning = tAssignee !== 'team' && tTitle.trim().length > 0
    && (caps[tAssignee] ?? []).length > 0 && !matchesCompetences(tAssignee);

  const fmtDay = (dateIso: string, i: number): string =>
    `${DAY_LABELS[i]} ${dateIso.slice(8, 10)}/${dateIso.slice(5, 7)}`;

  return (
    <div data-testid="tasks-module">
      <ModuleHeader
        title="Tâches par quart"
        subtitle={isAdmin
          ? 'Distribuez les tâches de la semaine par quart — l\'équipe les coche au fur et à mesure. Un courriel récapitulatif des tâches non faites vous est envoyé à la fin de chaque quart (12 h, 17 h, 21 h 30).'
          : 'Vos tâches de la semaine, quart par quart. Cochez-les dès qu\'elles sont faites.'}
        action={isAdmin ? (
          <div className="flex flex-wrap gap-2">
            <Button data-testid="copy-week-button" variant="outline" onClick={() => void copyPreviousWeek()} className="rounded-full">
              <CopyPlus className="w-4 h-4 mr-1" /> Dupliquer la semaine préc.
            </Button>
            <Button data-testid="open-templates-button" variant="outline" onClick={() => setTemplatesOpen(true)} className="rounded-full border-bronze-300 text-bronze-800 hover:bg-bronze-50">
              <LayoutTemplate className="w-4 h-4 mr-1" /> Modèles
            </Button>
            <Button data-testid="add-task-button" onClick={() => openCreate()} className="rounded-full bg-emerald-600 hover:bg-emerald-700">
              <Plus className="w-4 h-4 mr-1" /> Nouvelle tâche
            </Button>
          </div>
        ) : undefined}
      />

      <div className="inline-flex rounded-full border border-slate-200 bg-white p-1 mb-6">
        <button
          data-testid="tasks-view-week"
          onClick={() => setView('week')}
          className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${view === 'week' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:text-emerald-700'}`}
        >
          <CalendarDays className="w-3.5 h-3.5" /> Semaine
        </button>
        <button
          data-testid="tasks-view-stats"
          onClick={() => setView('stats')}
          className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${view === 'stats' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:text-emerald-700'}`}
        >
          <BarChart3 className="w-3.5 h-3.5" /> Statistiques
        </button>
      </div>

      {view === 'stats' ? (
        <TaskStatsPanel isAdmin={isAdmin} />
      ) : (
        <>
      <TeamGoalBar key={`${days[0]}-${tasks.filter((t) => t.done).length}`} weekStart={days[0]} isManager={isAdmin} />
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <Button data-testid="tasks-week-prev" variant="outline" size="icon" className="rounded-full" onClick={() => setWeekOffset(weekOffset - 1)}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <p data-testid="tasks-week-label" className="text-sm font-semibold text-slate-700">
          Semaine du {days[0]} au {days[6]}
        </p>
        <Button data-testid="tasks-week-next" variant="outline" size="icon" className="rounded-full" onClick={() => setWeekOffset(weekOffset + 1)}>
          <ChevronRight className="w-4 h-4" />
        </Button>
        <div className="flex items-center gap-3 ml-auto w-full sm:w-64">
          <Progress value={progress} className="h-2" />
          <span data-testid="tasks-progress-label" className="text-xs font-bold text-emerald-700 whitespace-nowrap">
            {doneCount}/{tasks.length} faites
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {days.map((d, i) => {
          const dayTasks = tasks.filter((t) => t.date === d);
          return (
            <div key={d} data-testid={`tasks-day-${d}`} className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-heading font-bold text-slate-900">{fmtDay(d, i)}</h3>
                {isAdmin && (
                  <button data-testid={`add-task-day-${d}`} onClick={() => openCreate(d)} className="w-7 h-7 rounded-full border border-slate-200 text-slate-400 hover:text-emerald-700 hover:border-emerald-300 flex items-center justify-center transition-colors" aria-label="Ajouter une tâche ce jour">
                    <Plus className="w-4 h-4" />
                  </button>
                )}
              </div>
              {dayTasks.length === 0 ? (
                <p className="text-xs text-slate-400">Aucune tâche prévue.</p>
              ) : (
                SHIFTS.filter((s) => dayTasks.some((t) => t.shift === s)).map((s) => {
                  const ShiftIcon = SHIFT_ICONS[s] ?? Sun;
                  const sTasks = dayTasks.filter((t) => t.shift === s);
                  const sDone = sTasks.filter((t) => t.done).length;
                  return (
                    <div key={s} className="mb-3 last:mb-0">
                      <div className="flex items-center justify-between mb-1.5 gap-2">
                        <p className="text-[11px] uppercase tracking-[0.15em] text-bronze-700 font-bold inline-flex items-center gap-1.5">
                          <ShiftIcon className="w-3.5 h-3.5" /> {s}
                        </p>
                        <span
                          data-testid={`shift-progress-${d}-${s}`}
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${sDone === sTasks.length ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}
                        >
                          {sDone}/{sTasks.length} faites{sDone < sTasks.length ? ` · ${sTasks.length - sDone} à faire` : ' ✓'}
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {dayTasks.filter((t) => t.shift === s).map((t) => (
                          <div key={t.id} data-testid={`task-item-${t.id}`} className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors ${t.done ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200'} ${t.id === highlightId ? 'ring-2 ring-bronze-400' : ''}`}>
                            <Checkbox
                              data-testid={`task-checkbox-${t.id}`}
                              checked={t.done}
                              onCheckedChange={() => void toggle(t)}
                              className="mt-0.5"
                            />
                            <div className="min-w-0 flex-1">
                              <p className={`text-sm font-semibold ${t.done ? 'text-emerald-800 line-through' : 'text-slate-800'}`}>{t.title}</p>
                              {t.description && <p className="text-xs text-slate-500">{t.description}</p>}
                              <p className="text-[11px] text-slate-400 mt-0.5">
                                {t.assignee_name ? t.assignee_name : 'Toute l\'équipe'}
                                {t.recurring && <> · chaque semaine</>}
                                {t.done && t.done_by && <> · fait par {t.done_by}</>}
                              </p>
                              {isAdmin && t.qualification_warning && (
                                <p data-testid={`task-qualif-warning-${t.id}`} className="text-[11px] text-amber-700 font-semibold mt-0.5 inline-flex items-center gap-1">
                                  <AlertTriangle className="w-3 h-3" /> Qualification à vérifier
                                </p>
                              )}
                            </div>
                            {isAdmin && (t.recurring || t.series_id) ? (
                              <button
                                data-testid={`task-recurring-toggle-${t.id}`}
                                onClick={() => void toggleRecurring(t)}
                                title={t.recurring ? 'Se répète chaque semaine — cliquer pour arrêter' : 'Récurrence arrêtée — cliquer pour réactiver'}
                                className={`transition-colors ${t.recurring ? 'text-bronze-600 hover:text-bronze-800' : 'text-slate-300 hover:text-bronze-600'}`}
                                aria-label="Récurrence hebdomadaire"
                              >
                                <Repeat className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              t.recurring && <Repeat className="w-3.5 h-3.5 text-bronze-600 shrink-0" data-testid={`task-recurring-badge-${t.id}`} />
                            )}
                            {isAdmin && (
                              <button data-testid={`task-delete-${t.id}`} onClick={() => void remove(t)} className="text-slate-300 hover:text-red-500 transition-colors" aria-label="Supprimer">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          );
        })}
      </div>
        </>
      )}

      {isAdmin && (
        <TaskTemplatesDialog open={templatesOpen} onOpenChange={setTemplatesOpen} days={days} onCreated={refresh} />
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent data-testid="create-task-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Nouvelle tâche</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => void submitCreate(e)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Jour</Label>
                <Select value={tDate} onValueChange={setTDate}>
                  <SelectTrigger data-testid="task-date-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {days.map((d, i) => <SelectItem key={d} value={d}>{fmtDay(d, i)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Quart</Label>
                <Select value={tShift} onValueChange={setTShift}>
                  <SelectTrigger data-testid="task-shift-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SHIFTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Catalogue de tâches (Commerce, Laboratoire, Entrepôt, Caisse, Livraison, Administration)</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Select value={tDomain} onValueChange={(v) => { setTDomain(v); setTCatalog(''); }}>
                  <SelectTrigger data-testid="task-domain-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manuel">Tâche manuelle (saisie libre)</SelectItem>
                    {TASK_CATALOG.map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                {tDomain !== 'manuel' && (
                  <Select value={tCatalog} onValueChange={pickCatalogTask}>
                    <SelectTrigger data-testid="task-catalog-select"><SelectValue placeholder="Choisir une tâche…" /></SelectTrigger>
                    <SelectContent className="max-h-72">
                      {TASK_CATALOG.find((d) => d.key === tDomain)?.sections.map((sec) => (
                        <SelectGroup key={sec.key}>
                          <SelectLabel className="text-bronze-700">{sec.label}</SelectLabel>
                          {sec.tasks.map((t) => <SelectItem key={t.title} value={t.title}>{t.title}</SelectItem>)}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Tâche</Label>
              <Input data-testid="task-title-input" value={tTitle} onChange={(e) => { setTTitle(e.target.value); if (tCatalog && e.target.value !== tCatalog) { setTCatalog(''); setTCompetences([]); } }} placeholder="Ex. Vérifier les frigos et noter les températures" required />
              {tCompetences.length > 0 && (
                <div data-testid="task-competences" className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-slate-400">Compétences associées :</span>
                  {tCompetences.map((c) => (
                    <span key={c} className="text-[10px] font-semibold bg-violet-50 text-violet-700 border border-violet-200 rounded-full px-2 py-0.5">{c}</span>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label>Précisions (facultatif)</Label>
              <Input data-testid="task-description-input" value={tDescription} onChange={(e) => setTDescription(e.target.value)} placeholder="Ex. registre dans le tiroir du comptoir 2" />
            </div>
            <div className="space-y-2">
              <Label>Assignée à</Label>
              <Select value={tAssignee} onValueChange={setTAssignee}>
                <SelectTrigger data-testid="task-assignee-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="team">Toute l'équipe</SelectItem>
                  {state.employees.map((emp) => {
                    const c = caps[emp.id] ?? [];
                    const known = c.length > 0 && (tCompetences.length > 0 || tTitle.trim().length > 0);
                    const ok = known && matchesCompetences(emp.id);
                    return (
                      <SelectItem key={emp.id} value={emp.id}>
                        {emp.firstName} {emp.lastName} — {emp.position}{known ? (ok ? ' · ✓ qualifié(e)' : ' · ⚠ hors compétences') : ''}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {createQualifWarning && (
                <p data-testid="create-qualif-warning" className="text-xs text-amber-700 font-semibold inline-flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  Cette tâche ne figure pas dans les capacités du profil de cet employé — vérifiez sa qualification avant d'assigner.
                </p>
              )}
            </div>
            <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5 cursor-pointer hover:border-bronze-300 transition-colors">
              <Checkbox data-testid="task-recurring-checkbox" checked={tRecurring} onCheckedChange={(v) => setTRecurring(v === true)} className="mt-0.5" />
              <span className="text-sm text-slate-700">
                <span className="font-semibold inline-flex items-center gap-1.5"><Repeat className="w-3.5 h-3.5 text-bronze-600" /> Se répète chaque semaine</span>
                <span className="block text-xs text-slate-500">La tâche reviendra automatiquement le même jour et le même quart, sans duplication manuelle.</span>
              </span>
            </label>
            <Button data-testid="task-submit-button" type="submit" disabled={!tTitle.trim()} className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              Ajouter la tâche
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
