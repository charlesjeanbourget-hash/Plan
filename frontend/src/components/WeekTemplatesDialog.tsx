import { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { useHR } from '@/context/HRContext';
import { PlannedShift, computeOvertimeWarnings, OvertimeWarning } from '@/lib/schedule';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { LayoutTemplate, Save, Trash2, CalendarPlus, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

interface TemplateEntry {
  employee_id: string;
  employee_name: string;
  weekday: number;
  start: string;
  end: string;
}

interface TemplateDoc {
  id: string;
  name: string;
  entries: TemplateEntry[];
  created_by: string;
  created_at: string;
}

interface ApplyPlan {
  templateId: string;
  additions: PlannedShift[];
  skippedExisting: number;
  skippedAbsence: number;
  overtime: OvertimeWarning[];
}

export const WeekTemplatesDialog = ({ open, onClose, days }: {
  open: boolean;
  onClose: () => void;
  days: string[];
}): JSX.Element => {
  const { token } = useAuth();
  const { state, addShift } = useHR();
  const headers = { Authorization: `Bearer ${token ?? ''}` };
  const [templates, setTemplates] = useState<TemplateDoc[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [maxByEmp, setMaxByEmp] = useState<Record<string, number>>({});
  const [pending, setPending] = useState<ApplyPlan | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await axios.get<TemplateDoc[]>(`${API}/schedule/templates`, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      setTemplates(res.data);
    } catch {
      setTemplates([]);
    } finally {
      setLoaded(true);
    }
  }, [token]);

  useEffect(() => {
    if (!open || !token) return;
    setPending(null);
    void refresh();
    axios.get<{ employee_id: string; max_hours_week?: number }[]>(`${API}/profiles`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        const m: Record<string, number> = {};
        r.data.forEach((p) => { if (p.max_hours_week) m[p.employee_id] = p.max_hours_week; });
        setMaxByEmp(m);
      })
      .catch(() => undefined);
  }, [open, token, refresh]);

  const weekShifts = state.shifts.filter((s) => s.date >= days[0] && s.date <= days[6]);

  const nameByEmp = useMemo(() =>
    Object.fromEntries(state.employees.map((e) => [e.id, `${e.firstName} ${e.lastName}`])), [state.employees]);

  const saveTemplate = async (): Promise<void> => {
    if (!name.trim() || weekShifts.length === 0) return;
    setSaving(true);
    try {
      await axios.post(`${API}/schedule/templates`, {
        name: name.trim(),
        entries: weekShifts.map((s) => ({
          employee_id: s.employeeId,
          employee_name: nameByEmp[s.employeeId] ?? '',
          weekday: days.indexOf(s.date),
          start: s.startTime,
          end: s.endTime,
        })),
      }, { headers });
      toast.success(`Modèle « ${name.trim()} » sauvegardé (${weekShifts.length} quart(s)).`);
      setName('');
      await refresh();
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
      toast.error(typeof detail === 'string' ? detail : 'Sauvegarde impossible.');
    } finally {
      setSaving(false);
    }
  };

  const buildPlan = (t: TemplateDoc): ApplyPlan => {
    const additions: PlannedShift[] = [];
    let skippedExisting = 0;
    let skippedAbsence = 0;
    t.entries.forEach((e) => {
      const targetDate = days[e.weekday];
      if (!targetDate) return;
      const identical = state.shifts.some((x) =>
        x.employeeId === e.employee_id && x.date === targetDate && x.startTime === e.start && x.endTime === e.end);
      if (identical) {
        skippedExisting += 1;
        return;
      }
      const absent = state.leaveRequests.some((l) =>
        l.status === 'Approuvée' && l.employeeId === e.employee_id && l.startDate <= targetDate && targetDate <= l.endDate);
      if (absent) {
        skippedAbsence += 1;
        return;
      }
      additions.push({ employeeId: e.employee_id, date: targetDate, startTime: e.start, endTime: e.end });
    });
    const overtime = computeOvertimeWarnings(state.shifts, additions, maxByEmp, nameByEmp);
    return { templateId: t.id, additions, skippedExisting, skippedAbsence, overtime };
  };

  const performApply = (plan: ApplyPlan, tplName: string): void => {
    plan.additions.forEach((a) => addShift(a));
    const parts = [`Modèle « ${tplName} » appliqué : ${plan.additions.length} quart(s) ajouté(s) à la semaine du ${days[0]}`];
    if (plan.skippedExisting > 0) parts.push(`${plan.skippedExisting} ignoré(s) — déjà présents`);
    if (plan.skippedAbsence > 0) parts.push(`${plan.skippedAbsence} ignoré(s) — absence approuvée`);
    toast.success(parts.join(' · '), { duration: 6000 });
    setPending(null);
    onClose();
  };

  const applyTemplate = (t: TemplateDoc): void => {
    const plan = buildPlan(t);
    if (plan.overtime.length > 0 && pending?.templateId !== t.id) {
      setPending(plan);
      return;
    }
    performApply(plan, t.name);
  };

  const removeTemplate = async (t: TemplateDoc): Promise<void> => {
    try {
      await axios.delete(`${API}/schedule/templates/${t.id}`, { headers });
      toast.success(`Modèle « ${t.name} » supprimé.`);
      if (pending?.templateId === t.id) setPending(null);
      await refresh();
    } catch {
      toast.error('Suppression impossible.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="week-templates-dialog" className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading inline-flex items-center gap-2">
            <LayoutTemplate className="w-4 h-4 text-bronze-600" /> Modèles de semaine
          </DialogTitle>
          <DialogDescription>
            Sauvegardez une semaine type (Été, Fêtes…) et réappliquez-la en un clic à la semaine affichée
            (du {days[0]}). Les doublons et les absences approuvées sont ignorés.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
          <p className="text-xs uppercase tracking-[0.15em] text-slate-500 font-semibold mb-2">
            Sauvegarder la semaine affichée ({weekShifts.length} quart(s))
          </p>
          <div className="flex gap-2">
            <Input
              data-testid="template-name-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex. Horaire d'été, Semaine des Fêtes…"
              className="bg-white"
            />
            <Button
              data-testid="template-save-button"
              onClick={() => void saveTemplate()}
              disabled={saving || !name.trim() || weekShifts.length === 0}
              className="rounded-full bg-emerald-600 hover:bg-emerald-700 shrink-0"
            >
              <Save className="w-3.5 h-3.5 mr-1" /> Sauvegarder
            </Button>
          </div>
          {weekShifts.length === 0 && (
            <p className="text-[11px] text-amber-700 mt-1.5">La semaine affichée ne contient aucun quart — ajoutez des quarts avant de la sauvegarder.</p>
          )}
        </div>

        <p className="text-xs uppercase tracking-[0.15em] text-slate-500 font-semibold">Mes modèles</p>
        {!loaded ? (
          <p className="text-sm text-slate-400">Chargement…</p>
        ) : templates.length === 0 ? (
          <p data-testid="templates-empty" className="text-sm text-slate-500">Aucun modèle sauvegardé pour l'instant.</p>
        ) : (
          <div className="space-y-2">
            {templates.map((t) => (
              <div key={t.id} data-testid={`template-row-${t.id}`} className="rounded-lg border border-slate-200 p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-800 truncate">{t.name}</p>
                    <p className="text-xs text-slate-500">{t.entries.length} quart(s) · créé le {t.created_at.slice(0, 10)}</p>
                  </div>
                  <Button
                    data-testid={`template-apply-${t.id}`}
                    size="sm"
                    onClick={() => applyTemplate(t)}
                    className={`rounded-full text-xs ${pending?.templateId === t.id ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
                  >
                    <CalendarPlus className="w-3.5 h-3.5 mr-1" />
                    {pending?.templateId === t.id ? 'Appliquer quand même' : 'Appliquer'}
                  </Button>
                  <Button
                    data-testid={`template-delete-${t.id}`}
                    size="sm"
                    variant="outline"
                    onClick={() => void removeTemplate(t)}
                    className="rounded-full text-xs text-red-600 border-red-200 hover:bg-red-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
                {pending?.templateId === t.id && (
                  <div data-testid={`template-overtime-warning-${t.id}`} className="rounded-lg border border-red-200 bg-red-50 p-3 mt-3">
                    <p className="text-xs font-bold text-red-700 inline-flex items-center gap-1.5 mb-1.5">
                      <AlertTriangle className="w-3.5 h-3.5" /> Dépassement du maximum d'heures hebdomadaires
                    </p>
                    <ul className="space-y-1">
                      {pending.overtime.map((w) => (
                        <li key={`${w.employeeId}-${w.weekMonday}`} className="text-xs text-red-700 font-semibold">
                          — {w.employeeName} : {w.projected} h &gt; max {w.max} h — semaine du {w.weekMonday}
                        </li>
                      ))}
                    </ul>
                    <p className="text-[11px] text-red-600/80 mt-1.5">Cliquez « Appliquer quand même » pour confirmer en connaissance de cause.</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
