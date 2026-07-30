import { useState } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { useHR } from '@/context/HRContext';
import { Training, AttemptResult, TrainingAttempt } from '@/types';
import { downloadCertificate } from '@/lib/certificate';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { ArrowLeft, GraduationCap, CheckCircle2, XCircle, Award, RotateCcw, Download, CalendarClock } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

type Mode = 'read' | 'exam' | 'result';

interface Props {
  training: Training;
  onBack: () => void;
}

export default function TrainingViewer({ training, onBack }: Props): JSX.Element {
  const { token, currentUser } = useAuth();
  const { state, toggleOnboardingItem } = useHR();
  const [mode, setMode] = useState<Mode>('read');
  const [answers, setAnswers] = useState<number[]>([]);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const pharmacyName = state.pharmacies.find((p) => p.id === currentUser?.pharmacyId)?.name;

  const makeCertificate = (score: number, dateStr: string): void => {
    downloadCertificate({
      employeeName: currentUser?.name ?? '',
      trainingTitle: training.title,
      score,
      passingScore: training.passing_score,
      date: dateStr,
      pharmacyName,
    });
  };

  const downloadPastCertificate = async (): Promise<void> => {
    try {
      const res = await axios.get<TrainingAttempt[]>(`${API}/trainings/${training.id}/attempts`, {
        headers: { Authorization: `Bearer ${token ?? ''}` },
      });
      const best = res.data.filter((a) => a.passed).sort((a, b) => b.score - a.score)[0];
      if (!best) {
        toast.error('Aucune tentative réussie trouvée.');
        return;
      }
      makeCertificate(best.score, best.completed_at.slice(0, 10));
    } catch {
      toast.error('Impossible de générer le certificat.');
    }
  };

  const checkOnboarding = (): void => {
    if (!currentUser?.employeeId) return;
    const items = state.onboardingItems.filter(
      (o) => o.employeeId === currentUser.employeeId && o.category === 'Formation' && !o.done
    );
    items.forEach((o) => toggleOnboardingItem(o.id));
    if (items.length > 0) {
      toast.success(`Étape « Formation » cochée automatiquement dans votre onboarding (${items.length}).`);
    }
  };

  const startExam = (): void => {
    setAnswers(new Array(training.exam.length).fill(-1));
    setResult(null);
    setMode('exam');
  };

  const allAnswered = answers.length > 0 && answers.every((a) => a >= 0);

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    try {
      const res = await axios.post<AttemptResult>(
        `${API}/trainings/${training.id}/attempts`,
        { answers },
        { headers: { Authorization: `Bearer ${token ?? ''}` } }
      );
      setResult(res.data);
      setMode('result');
      if (res.data.passed) checkOnboarding();
    } catch {
      toast.error('Impossible de soumettre l\'examen.');
    } finally {
      setSubmitting(false);
    }
  };

  const backButton = (
    <button data-testid="training-back-button" onClick={onBack} className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900 mb-6 transition-colors">
      <ArrowLeft className="w-4 h-4" /> Retour aux formations
    </button>
  );

  if (mode === 'exam') {
    return (
      <div data-testid="training-exam" className="max-w-3xl">
        {backButton}
        <h1 className="font-heading text-2xl font-extrabold text-slate-900 mb-1">Examen final — {training.title}</h1>
        <p className="text-sm text-slate-500 mb-8">Note de passage : {training.passing_score} %. Vous pouvez reprendre l'examen autant de fois que nécessaire.</p>
        <div className="space-y-6">
          {training.exam.map((q, qi) => (
            <div key={q.id} data-testid={`exam-question-${qi}`} className="bg-white rounded-xl border border-slate-200 p-6">
              <p className="font-semibold text-slate-800 mb-4">
                <span className="text-emerald-600 mr-2">{qi + 1}.</span>{q.question}
              </p>
              <div className="space-y-2">
                {q.options.map((opt, oi) => (
                  <button
                    key={oi}
                    data-testid={`exam-q${qi}-option-${oi}`}
                    onClick={() => setAnswers((prev) => prev.map((a, i) => (i === qi ? oi : a)))}
                    className={`w-full text-left px-4 py-2.5 rounded-lg border text-sm transition-colors ${
                      answers[qi] === oi
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-900 font-semibold'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <Button
          data-testid="submit-exam-button"
          disabled={!allAnswered || submitting}
          onClick={() => void submit()}
          className="w-full mt-8 rounded-full bg-emerald-600 hover:bg-emerald-700"
        >
          {submitting ? 'Correction…' : allAnswered ? 'Soumettre mes réponses' : `Répondez à toutes les questions (${answers.filter((a) => a >= 0).length}/${training.exam.length})`}
        </Button>
      </div>
    );
  }

  if (mode === 'result' && result) {
    return (
      <div data-testid="training-result" className="max-w-3xl">
        {backButton}
        <div className={`rounded-xl border p-8 text-center mb-8 ${result.passed ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
          <Award className={`w-10 h-10 mx-auto mb-3 ${result.passed ? 'text-emerald-600' : 'text-red-500'}`} />
          <p data-testid="exam-score" className="font-heading text-5xl font-extrabold text-slate-900 mb-2">{result.score} %</p>
          <p data-testid="exam-verdict" className={`font-semibold ${result.passed ? 'text-emerald-700' : 'text-red-700'}`}>
            {result.passed ? 'Examen réussi — félicitations !' : `Échec — note de passage : ${result.passing_score} %`}
          </p>
          <p className="text-sm text-slate-500 mt-1">{result.correct_count} bonne(s) réponse(s) sur {result.total}</p>
        </div>
        <h2 className="font-heading text-lg font-bold text-slate-900 mb-4">Corrigé</h2>
        <div className="space-y-4 mb-8">
          {training.exam.map((q, qi) => {
            const r = result.results[qi];
            return (
              <div key={q.id} className={`bg-white rounded-xl border p-5 ${r.correct ? 'border-emerald-200' : 'border-red-200'}`}>
                <p className="font-semibold text-slate-800 mb-2 flex items-start gap-2">
                  {r.correct
                    ? <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                    : <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />}
                  {q.question}
                </p>
                {!r.correct && (
                  <p className="text-sm text-red-600 ml-6">Votre réponse : {q.options[r.your_answer] ?? '—'}</p>
                )}
                <p className="text-sm text-emerald-700 ml-6">Bonne réponse : {q.options[r.correct_index]}</p>
                {r.explanation && <p className="text-xs text-slate-500 ml-6 mt-1">{r.explanation}</p>}
              </div>
            );
          })}
        </div>
        <div className="flex gap-3">
          {result.passed && (
            <Button
              data-testid="download-certificate-button"
              onClick={() => makeCertificate(result.score, new Date().toISOString().slice(0, 10))}
              className="rounded-full bg-emerald-600 hover:bg-emerald-700"
            >
              <Download className="w-4 h-4 mr-1" /> Télécharger mon certificat
            </Button>
          )}
          {!result.passed && (
            <Button data-testid="retake-exam-button" onClick={startExam} className="rounded-full bg-emerald-600 hover:bg-emerald-700">
              <RotateCcw className="w-4 h-4 mr-1" /> Reprendre l'examen
            </Button>
          )}
          <Button variant="outline" className="rounded-full" onClick={onBack}>Retour aux formations</Button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="training-viewer" className="max-w-3xl">
      {backButton}
      <div className="flex items-start gap-3 mb-2">
        <span className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
          <GraduationCap className="w-5 h-5 text-emerald-600" />
        </span>
        <div>
          <h1 className="font-heading text-2xl font-extrabold text-slate-900">{training.title}</h1>
          <p className="text-sm text-slate-500">
            {training.sections.length} section(s) par secteur · examen final de {training.exam.length} questions · note de passage {training.passing_score} %
          </p>
        </div>
      </div>
      {training.my_assignment && !training.my_passed && (
        <p data-testid="assignment-due-banner" className={`text-sm rounded-lg px-4 py-2.5 mt-4 inline-flex items-center gap-2 border ${
          training.my_assignment.due_date < new Date().toISOString().slice(0, 10)
            ? 'text-red-700 bg-red-50 border-red-200'
            : 'text-amber-700 bg-amber-50 border-amber-200'
        }`}>
          <CalendarClock className="w-4 h-4" /> À compléter avant le {training.my_assignment.due_date}
        </p>
      )}
      {training.my_passed && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p data-testid="already-passed-banner" className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5 inline-flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" /> Vous avez déjà réussi cet examen ({training.my_best_score} %).
          </p>
          <Button
            data-testid="download-past-certificate-button"
            size="sm" variant="outline"
            onClick={() => void downloadPastCertificate()}
            className="rounded-full text-xs"
          >
            <Download className="w-3.5 h-3.5 mr-1" /> Télécharger mon certificat
          </Button>
        </div>
      )}
      <Accordion type="single" collapsible className="mt-6 space-y-3">
        {training.sections.map((s, i) => (
          <AccordionItem key={s.id} value={s.id} className="bg-white rounded-xl border border-slate-200 px-5">
            <AccordionTrigger data-testid={`section-trigger-${i}`} className="hover:no-underline">
              <span className="flex items-center gap-3 text-left">
                <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 shrink-0">{s.sector}</span>
                <span className="font-semibold text-slate-800">{s.title}</span>
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">{s.content}</div>
              {s.key_points.length > 0 && (
                <div className="mt-4 rounded-lg bg-slate-50 border border-slate-200 p-4">
                  <p className="text-xs uppercase tracking-[0.15em] text-slate-500 font-semibold mb-2">Points clés</p>
                  <ul className="space-y-1">
                    {s.key_points.map((k, ki) => (
                      <li key={ki} className="text-sm text-slate-700 flex items-start gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" /> {k}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
      <Button data-testid="start-exam-button" onClick={startExam} className="w-full mt-8 rounded-full bg-emerald-600 hover:bg-emerald-700">
        <Award className="w-4 h-4 mr-2" /> {training.my_passed ? 'Refaire l\'examen final' : 'Passer l\'examen final'}
      </Button>
    </div>
  );
}
