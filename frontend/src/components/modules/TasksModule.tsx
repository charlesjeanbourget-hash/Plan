import { useState, useEffect, useCallback, FormEvent } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { useHR } from '@/context/HRContext';
import { ShiftTask } from '@/types';
import { ModuleHeader } from '@/components/modules/shared';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, ChevronLeft, ChevronRight, Trash2, CopyPlus, Sunrise, Sun, Moon, Repeat, LucideIcon } from 'lucide-react';
import { toast } from 'sonner';

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

const apiError = (err: unknown): string => {
  if (axios.isAxiosError(err) && err.response) {
    const detail = (err.response.data as { detail?: unknown }).detail;
    if (typeof detail === 'string') return detail;
  }
  return 'Une erreur est survenue.';
};

export default function TasksModule(): JSX.Element {
  const { token, currentUser } = useAuth();
  const { state } = useHR();
  const isAdmin = currentUser?.role !== 'employee';
  const headers = { Authorization: `Bearer ${token ?? ''}` };
  const [weekOffset, setWeekOffset] = useState(0);
  const [tasks, setTasks] = useState<ShiftTask[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [tDate, setTDate] = useState('');
  const [tShift, setTShift] = useState('Matin');
  const [tTitle, setTTitle] = useState('');
  const [tDescription, setTDescription] = useState('');
  const [tAssignee, setTAssignee] = useState('team');
  const [tRecurring, setTRecurring] = useState(false);

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
    setCreateOpen(true);
  };

  const submitCreate = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const emp = state.employees.find((x) => x.id === tAssignee);
    try {
      await axios.post(`${API}/tasks`, {
        date: tDate,
        shift: tShift,
        title: tTitle,
        description: tDescription,
        assignee_employee_id: emp ? emp.id : '',
        assignee_name: emp ? `${emp.firstName} ${emp.lastName}` : '',
        recurring: tRecurring,
      }, { headers });
      toast.success(tRecurring ? 'Tâche ajoutée — elle reviendra automatiquement chaque semaine.' : 'Tâche ajoutée au quart.');
      setCreateOpen(false);
      await refresh();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

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
            <Button data-testid="add-task-button" onClick={() => openCreate()} className="rounded-full bg-emerald-600 hover:bg-emerald-700">
              <Plus className="w-4 h-4 mr-1" /> Nouvelle tâche
            </Button>
          </div>
        ) : undefined}
      />

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
                  return (
                    <div key={s} className="mb-3 last:mb-0">
                      <p className="text-[11px] uppercase tracking-[0.15em] text-bronze-700 font-bold mb-1.5 inline-flex items-center gap-1.5">
                        <ShiftIcon className="w-3.5 h-3.5" /> {s}
                      </p>
                      <div className="space-y-1.5">
                        {dayTasks.filter((t) => t.shift === s).map((t) => (
                          <div key={t.id} data-testid={`task-item-${t.id}`} className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors ${t.done ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200'}`}>
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
              <Label>Tâche</Label>
              <Input data-testid="task-title-input" value={tTitle} onChange={(e) => setTTitle(e.target.value)} placeholder="Ex. Vérifier les frigos et noter les températures" required />
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
                  {state.employees.map((emp) => (
                    <SelectItem key={emp.id} value={emp.id}>{emp.firstName} {emp.lastName} — {emp.position}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
