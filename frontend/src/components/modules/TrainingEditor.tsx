import { useState, useEffect, FormEvent } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { useHR } from '@/context/HRContext';
import { Training, TrainingSection, ExamQuestion, TrainingAttempt, TrainingStatus, TrainingAssignment } from '@/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Plus, Trash2, Send, Save, CheckCircle2, BellRing } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const uid = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

const STATUS_LABEL: Record<TrainingStatus, string> = {
  processing: 'En préparation',
  draft: 'Brouillon',
  published: 'Publiée',
  error: 'Erreur',
};

interface Props {
  training: Training;
  onBack: () => void;
  onUpdated: () => Promise<void> | void;
}

type Tab = 'content' | 'exam' | 'assignments' | 'results';

export default function TrainingEditor({ training, onBack, onUpdated }: Props): JSX.Element {
  const { token } = useAuth();
  const { state } = useHR();
  const headers = { Authorization: `Bearer ${token ?? ''}` };
  const [title, setTitle] = useState(training.title);
  const [sections, setSections] = useState<TrainingSection[]>(training.sections);
  const [exam, setExam] = useState<ExamQuestion[]>(training.exam);
  const [passingScore, setPassingScore] = useState(training.passing_score);
  const [status, setStatus] = useState<TrainingStatus>(training.status);
  const [tab, setTab] = useState<Tab>('content');
  const [attempts, setAttempts] = useState<TrainingAttempt[]>([]);
  const [assignments, setAssignments] = useState<TrainingAssignment[]>([]);
  const [assignEmployeeId, setAssignEmployeeId] = useState('');
  const [assignDueDate, setAssignDueDate] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (tab === 'results') {
      axios.get<TrainingAttempt[]>(`${API}/trainings/${training.id}/attempts`, { headers })
        .then((r) => setAttempts(r.data))
        .catch(() => toast.error('Impossible de charger les résultats.'));
    }
    if (tab === 'assignments') {
      void refreshAssignments();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const refreshAssignments = async (): Promise<void> => {
    try {
      const r = await axios.get<TrainingAssignment[]>(`${API}/trainings/${training.id}/assignments`, { headers });
      setAssignments(r.data);
    } catch {
      toast.error('Impossible de charger les assignations.');
    }
  };

  const submitAssignment = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const emp = state.employees.find((emp2) => emp2.id === assignEmployeeId);
    if (!emp || !assignDueDate) return;
    try {
      await axios.post(`${API}/trainings/${training.id}/assignments`, {
        assignments: [{ employee_email: emp.email, employee_name: `${emp.firstName} ${emp.lastName}`, due_date: assignDueDate }],
      }, { headers });
      toast.success(`Formation assignée à ${emp.firstName} ${emp.lastName} (échéance ${assignDueDate}).`);
      setAssignEmployeeId('');
      setAssignDueDate('');
      await refreshAssignments();
    } catch {
      toast.error('Assignation impossible.');
    }
  };

  const removeAssignment = async (a: TrainingAssignment): Promise<void> => {
    try {
      await axios.delete(`${API}/trainings/${training.id}/assignments/${a.id}`, { headers });
      toast.success(`Assignation retirée pour ${a.employee_name}.`);
      await refreshAssignments();
    } catch {
      toast.error('Retrait impossible.');
    }
  };

  const sendReminders = async (): Promise<void> => {
    try {
      const r = await axios.post<{ sent: number }>(`${API}/trainings/assignments/reminders/run`, {}, { headers });
      toast.success(`${r.data.sent} relance(s) envoyée(s) par courriel.`);
    } catch {
      toast.error('Envoi des relances impossible.');
    }
  };

  const patchSection = (i: number, patch: Partial<TrainingSection>): void =>
    setSections((prev) => prev.map((s, si) => (si === i ? { ...s, ...patch } : s)));

  const patchQuestion = (i: number, patch: Partial<ExamQuestion>): void =>
    setExam((prev) => prev.map((q, qi) => (qi === i ? { ...q, ...patch } : q)));

  const save = async (publish: boolean): Promise<void> => {
    setSaving(true);
    try {
      const body = {
        title,
        passing_score: passingScore,
        sections: sections.map((s) => ({ ...s, key_points: s.key_points.filter((k) => k.trim() !== '') })),
        exam: exam.map((q) => ({ ...q, correct_index: q.correct_index ?? 0, explanation: q.explanation ?? '' })),
        ...(publish ? { status: 'published' } : {}),
      };
      await axios.put(`${API}/trainings/${training.id}`, body, { headers });
      if (publish) setStatus('published');
      toast.success(publish ? 'Formation publiée — visible par les employés !' : 'Modifications enregistrées.');
      void onUpdated();
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
      toast.error(typeof detail === 'string' ? detail : 'Enregistrement impossible.');
    } finally {
      setSaving(false);
    }
  };

  const unpublish = async (): Promise<void> => {
    try {
      await axios.put(`${API}/trainings/${training.id}`, { status: 'draft' }, { headers });
      setStatus('draft');
      toast.success('Formation repassée en brouillon.');
      void onUpdated();
    } catch {
      toast.error('Action impossible.');
    }
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: 'content', label: `Contenu (${sections.length})` },
    { key: 'exam', label: `Examen (${exam.length})` },
    { key: 'assignments', label: 'Assignations' },
    { key: 'results', label: 'Résultats' },
  ];

  return (
    <div data-testid="training-editor" className="max-w-4xl">
      <button data-testid="editor-back-button" onClick={onBack} className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900 mb-6 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Retour aux formations
      </button>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex-1 space-y-2">
          <Label>Titre de la formation</Label>
          <Input data-testid="editor-title-input" value={title} onChange={(e) => setTitle(e.target.value)} className="font-semibold" />
        </div>
        <div className="space-y-2 w-40">
          <Label>Note de passage (%)</Label>
          <Input data-testid="editor-passing-input" type="number" min={1} max={100} value={passingScore} onChange={(e) => setPassingScore(Number(e.target.value))} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-8">
        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${status === 'published' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
          {STATUS_LABEL[status]}
        </span>
        <Button data-testid="editor-save-button" size="sm" variant="outline" disabled={saving} onClick={() => void save(false)} className="rounded-full text-xs">
          <Save className="w-3.5 h-3.5 mr-1" /> Enregistrer
        </Button>
        {status !== 'published' ? (
          <Button data-testid="editor-publish-button" size="sm" disabled={saving} onClick={() => void save(true)} className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs">
            <Send className="w-3.5 h-3.5 mr-1" /> Publier aux employés
          </Button>
        ) : (
          <Button data-testid="editor-unpublish-button" size="sm" variant="outline" onClick={() => void unpublish()} className="rounded-full text-xs">
            Repasser en brouillon
          </Button>
        )}
      </div>

      <div className="flex gap-1 border-b border-slate-200 mb-6">
        {TABS.map((t) => (
          <button
            key={t.key}
            data-testid={`editor-tab-${t.key}`}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === t.key ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'content' && (
        <div className="space-y-5">
          {sections.map((s, i) => (
            <div key={s.id} data-testid={`editor-section-${i}`} className="bg-white rounded-xl border border-slate-200 p-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div className="space-y-2">
                  <Label>Secteur</Label>
                  <Input value={s.sector} onChange={(e) => patchSection(i, { sector: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Titre de la section</Label>
                  <Input value={s.title} onChange={(e) => patchSection(i, { title: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2 mb-4">
                <Label>Contenu pédagogique</Label>
                <Textarea rows={6} value={s.content} onChange={(e) => patchSection(i, { content: e.target.value })} />
              </div>
              <div className="space-y-2 mb-4">
                <Label>Points clés (un par ligne)</Label>
                <Textarea rows={3} value={s.key_points.join('\n')} onChange={(e) => patchSection(i, { key_points: e.target.value.split('\n') })} />
              </div>
              <Button size="sm" variant="outline" onClick={() => setSections((prev) => prev.filter((_, si) => si !== i))} className="rounded-full text-xs text-red-600 border-red-200 hover:bg-red-50">
                <Trash2 className="w-3.5 h-3.5 mr-1" /> Retirer la section
              </Button>
            </div>
          ))}
          <Button
            data-testid="add-section-button"
            variant="outline"
            onClick={() => setSections((prev) => [...prev, { id: uid(), sector: 'Général', title: '', content: '', key_points: [] }])}
            className="rounded-full"
          >
            <Plus className="w-4 h-4 mr-1" /> Ajouter une section
          </Button>
        </div>
      )}

      {tab === 'exam' && (
        <div className="space-y-5">
          {exam.map((q, i) => (
            <div key={q.id} data-testid={`editor-question-${i}`} className="bg-white rounded-xl border border-slate-200 p-6">
              <div className="space-y-2 mb-4">
                <Label>Question {i + 1}</Label>
                <Input value={q.question} onChange={(e) => patchQuestion(i, { question: e.target.value })} />
              </div>
              <div className="space-y-2 mb-4">
                <Label className="text-xs text-slate-500">Cochez la bonne réponse</Label>
                {q.options.map((opt, oi) => (
                  <div key={oi} className="flex items-center gap-2">
                    <button
                      type="button"
                      data-testid={`q${i}-correct-${oi}`}
                      onClick={() => patchQuestion(i, { correct_index: oi })}
                      className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                        (q.correct_index ?? 0) === oi ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300'
                      }`}
                      aria-label={`Bonne réponse : option ${oi + 1}`}
                    >
                      {(q.correct_index ?? 0) === oi && <CheckCircle2 className="w-3.5 h-3.5" />}
                    </button>
                    <Input
                      value={opt}
                      onChange={(e) => patchQuestion(i, { options: q.options.map((o, ooi) => (ooi === oi ? e.target.value : o)) })}
                    />
                  </div>
                ))}
              </div>
              <div className="space-y-2 mb-4">
                <Label>Explication de la bonne réponse</Label>
                <Input value={q.explanation ?? ''} onChange={(e) => patchQuestion(i, { explanation: e.target.value })} />
              </div>
              <Button size="sm" variant="outline" onClick={() => setExam((prev) => prev.filter((_, qi) => qi !== i))} className="rounded-full text-xs text-red-600 border-red-200 hover:bg-red-50">
                <Trash2 className="w-3.5 h-3.5 mr-1" /> Retirer la question
              </Button>
            </div>
          ))}
          <Button
            data-testid="add-question-button"
            variant="outline"
            onClick={() => setExam((prev) => [...prev, { id: uid(), question: '', options: ['', '', '', ''], correct_index: 0, explanation: '' }])}
            className="rounded-full"
          >
            <Plus className="w-4 h-4 mr-1" /> Ajouter une question
          </Button>
        </div>
      )}

      {tab === 'assignments' && (
        <div className="space-y-6" data-testid="editor-assignments-panel">
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-heading text-sm font-bold text-slate-900">Assigner cette formation</h3>
              <Button data-testid="send-reminders-button" size="sm" variant="outline" onClick={() => void sendReminders()} className="rounded-full text-xs">
                <BellRing className="w-3.5 h-3.5 mr-1" /> Envoyer les relances maintenant
              </Button>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              L'employé recevra une relance automatique par courriel à 7 jours de l'échéance (et en cas de retard), tant que l'examen n'est pas réussi.
              {status !== 'published' && <span className="text-amber-700 font-semibold"> Publiez la formation pour que les relances partent.</span>}
            </p>
            <form onSubmit={(e) => void submitAssignment(e)} className="flex flex-col sm:flex-row gap-3 sm:items-end">
              <div className="space-y-2 flex-1">
                <Label>Employé(e)</Label>
                <Select value={assignEmployeeId} onValueChange={setAssignEmployeeId}>
                  <SelectTrigger data-testid="assign-employee-select"><SelectValue placeholder="Choisir un employé" /></SelectTrigger>
                  <SelectContent>
                    {state.employees.map((emp) => (
                      <SelectItem key={emp.id} value={emp.id}>{emp.firstName} {emp.lastName} — {emp.position}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Date limite</Label>
                <Input data-testid="assign-due-date-input" type="date" value={assignDueDate} onChange={(e) => setAssignDueDate(e.target.value)} required />
              </div>
              <Button data-testid="assign-submit-button" type="submit" disabled={!assignEmployeeId || !assignDueDate} className="rounded-full bg-emerald-600 hover:bg-emerald-700">
                Assigner
              </Button>
            </form>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.15em] text-slate-500">
                  <th className="p-4">Employé</th>
                  <th className="p-4">Échéance</th>
                  <th className="p-4">Statut</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((a) => (
                  <tr key={a.id} data-testid={`assignment-row-${a.employee_email}`} className="border-b border-slate-100 last:border-0">
                    <td className="p-4">
                      <p className="font-semibold text-slate-800">{a.employee_name}</p>
                      <p className="text-xs text-slate-500">{a.employee_email}</p>
                    </td>
                    <td className="p-4 text-slate-600">{a.due_date}</td>
                    <td className="p-4">
                      {a.passed ? (
                        <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                          Réussie — {a.passed_score} %
                        </span>
                      ) : a.overdue ? (
                        <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800">En retard</span>
                      ) : (
                        <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">En attente</span>
                      )}
                    </td>
                    <td className="p-4 text-right">
                      <Button
                        data-testid={`remove-assignment-${a.employee_email}`}
                        size="sm" variant="outline"
                        onClick={() => void removeAssignment(a)}
                        className="rounded-full text-xs text-red-600 border-red-200 hover:bg-red-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {assignments.length === 0 && (
                  <tr><td colSpan={4} className="p-8 text-center text-slate-500">Aucune assignation pour le moment.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'results' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto" data-testid="editor-results-panel">
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.15em] text-slate-500">
                <th className="p-4">Employé</th>
                <th className="p-4 text-right">Résultat</th>
                <th className="p-4">Statut</th>
                <th className="p-4">Date</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((a) => (
                <tr key={a.id} className="border-b border-slate-100 last:border-0">
                  <td className="p-4">
                    <p className="font-semibold text-slate-800">{a.user_name}</p>
                    <p className="text-xs text-slate-500">{a.user_email}</p>
                  </td>
                  <td className="p-4 text-right font-semibold text-slate-800">{a.score} % <span className="text-xs text-slate-400 font-normal">({a.correct_count}/{a.total})</span></td>
                  <td className="p-4">
                    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${a.passed ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                      {a.passed ? 'Réussi' : 'Échoué'}
                    </span>
                  </td>
                  <td className="p-4 text-slate-500 text-xs">{a.completed_at.slice(0, 16).replace('T', ' ')}</td>
                </tr>
              ))}
              {attempts.length === 0 && (
                <tr><td colSpan={4} className="p-8 text-center text-slate-500">Aucune tentative pour le moment.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
