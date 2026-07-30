import { useState, FormEvent } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { useHR } from '@/context/HRContext';
import { Evaluation } from '@/types';
import { EMPLOYER_QUESTIONS, EVAL_STATUS_META, MULTIPLIER_GRID } from '@/lib/evaluations';
import { RatingScale } from '@/components/RatingScale';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Trash2, Send, CheckCircle2, Sparkles, Hourglass } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const apiError = (err: unknown): string => {
  if (axios.isAxiosError(err) && err.response) {
    const detail = (err.response.data as { detail?: unknown }).detail;
    if (typeof detail === 'string') return detail;
  }
  return 'Une erreur est survenue.';
};

const money = (v: number): string => v.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' });

interface Props {
  evaluation: Evaluation;
  onBack: () => void;
  onChanged: () => Promise<void> | void;
}

export default function EvaluationDetail({ evaluation: ev, onBack, onChanged }: Props): JSX.Element {
  const { token } = useAuth();
  const { updateEmployee } = useHR();
  const headers = { Authorization: `Bearer ${token ?? ''}` };
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [strengths, setStrengths] = useState('');
  const [improvements, setImprovements] = useState('');
  const [objectives, setObjectives] = useState('');
  const [proposedRate, setProposedRate] = useState('');
  const [busy, setBusy] = useState(false);

  const meta = EVAL_STATUS_META[ev.status];
  const allAnswered = EMPLOYER_QUESTIONS.every((q) => answers[q.id] !== undefined);
  const rateValue = proposedRate !== '' ? proposedRate : ev.suggestion ? String(ev.suggestion.suggested_rate) : '';

  const submitEmployer = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!allAnswered) {
      toast.error('Veuillez noter les 10 critères.');
      return;
    }
    setBusy(true);
    try {
      await axios.put(`${API}/evaluations/${ev.id}/employer`, { answers, strengths, improvements, objectives }, { headers });
      toast.success('Évaluation employeur enregistrée.');
      await onChanged();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const propose = async (): Promise<void> => {
    const rate = Number(rateValue);
    if (!rate || rate <= 0) {
      toast.error('Entrez un taux horaire valide.');
      return;
    }
    setBusy(true);
    try {
      await axios.post(`${API}/evaluations/${ev.id}/propose`, { proposed_rate: rate }, { headers });
      toast.success(`Proposition de ${money(rate)}/h envoyée à ${ev.employee_name}.`);
      await onChanged();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const markApplied = async (): Promise<void> => {
    setBusy(true);
    try {
      await axios.post(`${API}/evaluations/${ev.id}/applied`, {}, { headers });
      if (ev.agreed_rate !== null) updateEmployee(ev.employee_id, { hourlyRate: ev.agreed_rate });
      toast.success(`Nouveau taux appliqué au dossier de ${ev.employee_name}.`);
      await onChanged();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    try {
      await axios.delete(`${API}/evaluations/${ev.id}`, { headers });
      toast.success('Évaluation supprimée.');
      await onChanged();
      onBack();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  return (
    <div data-testid="evaluation-detail" className="max-w-4xl">
      <button data-testid="eval-back-button" onClick={onBack} className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900 mb-6 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Retour aux évaluations
      </button>

      <div className="flex flex-wrap items-center gap-3 mb-8">
        <h1 className="font-heading text-2xl font-extrabold text-slate-900">{ev.employee_name}</h1>
        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${meta.cls}`}>{meta.label}</span>
        <span className="text-sm text-slate-500">Taux actuel : <strong className="text-slate-800">{money(ev.current_rate)}/h</strong></span>
        <span className="text-sm text-slate-500">BAIIA : <strong className="text-slate-800">+{ev.baiia_increase_pct} %</strong></span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 p-7" data-testid="employer-eval-card">
          <h2 className="font-heading text-base font-bold text-slate-900 mb-1">Évaluation employeur</h2>
          {ev.admin_eval ? (
            <div className="space-y-4">
              <p className="text-sm text-emerald-700 font-semibold inline-flex items-center gap-1.5" data-testid="employer-eval-score">
                <CheckCircle2 className="w-4 h-4" /> Complétée — score {ev.admin_eval.score} %
              </p>
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-emerald-700 font-semibold mb-1">Points forts</p>
                <p className="text-sm text-slate-600">{ev.admin_eval.strengths || '—'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-orange-600 font-semibold mb-1">À améliorer</p>
                <p className="text-sm text-slate-600">{ev.admin_eval.improvements || '—'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-sky-700 font-semibold mb-1">Objectifs</p>
                <p className="text-sm text-slate-600">{ev.admin_eval.objectives || '—'}</p>
              </div>
            </div>
          ) : (
            <form onSubmit={(e) => void submitEmployer(e)} className="space-y-5">
              <p className="text-xs text-slate-500">Notez chaque critère de 1 (insuffisant) à 5 (exceptionnel).</p>
              {EMPLOYER_QUESTIONS.map((q, i) => (
                <div key={q.id} className="space-y-1.5">
                  <p className="text-sm font-semibold text-slate-800">{i + 1}. {q.label}</p>
                  <RatingScale value={answers[q.id]} onChange={(v) => setAnswers((prev) => ({ ...prev, [q.id]: v }))} testId={`employer-rating-${q.id}`} />
                </div>
              ))}
              <div className="space-y-2">
                <Label>Points forts</Label>
                <Textarea data-testid="employer-strengths-input" rows={2} value={strengths} onChange={(e) => setStrengths(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>À améliorer</Label>
                <Textarea data-testid="employer-improvements-input" rows={2} value={improvements} onChange={(e) => setImprovements(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Objectifs pour la prochaine période</Label>
                <Textarea data-testid="employer-objectives-input" rows={2} value={objectives} onChange={(e) => setObjectives(e.target.value)} />
              </div>
              <Button data-testid="employer-eval-submit" type="submit" disabled={!allAnswered || busy} className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
                Enregistrer l'évaluation employeur
              </Button>
            </form>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-7" data-testid="self-eval-card">
          <h2 className="font-heading text-base font-bold text-slate-900 mb-1">Auto-évaluation de l'employé</h2>
          {ev.self_eval ? (
            <div className="space-y-4">
              <p className="text-sm text-emerald-700 font-semibold inline-flex items-center gap-1.5" data-testid="self-eval-score">
                <CheckCircle2 className="w-4 h-4" /> Complétée — score {ev.self_eval.score} %
              </p>
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-emerald-700 font-semibold mb-1">Réalisations</p>
                <p className="text-sm text-slate-600">{ev.self_eval.accomplishments || '—'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-orange-600 font-semibold mb-1">Besoins exprimés</p>
                <p className="text-sm text-slate-600">{ev.self_eval.needs || '—'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-sky-700 font-semibold mb-1">Objectifs personnels</p>
                <p className="text-sm text-slate-600">{ev.self_eval.goals || '—'}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500 inline-flex items-center gap-2 mt-3" data-testid="self-eval-pending">
              <Hourglass className="w-4 h-4 text-amber-500" /> En attente — l'employé complète son auto-évaluation depuis « Mon espace ».
            </p>
          )}
        </div>
      </div>

      {ev.suggestion && (
        <div className="bg-emerald-950 rounded-xl p-7 mb-6 text-white" data-testid="suggestion-card">
          <h2 className="font-heading text-base font-bold inline-flex items-center gap-2 mb-4">
            <Sparkles className="w-4 h-4 text-amber-400" /> Suggestion salariale (basée sur le BAIIA)
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div>
              <p className="text-xs uppercase tracking-[0.15em] text-emerald-300 font-semibold">Score global</p>
              <p className="font-heading text-2xl font-extrabold" data-testid="suggestion-score">{ev.suggestion.performance_score} %</p>
              <p className="text-[11px] text-emerald-200/70">70 % employeur + 30 % auto</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.15em] text-emerald-300 font-semibold">Multiplicateur</p>
              <p className="font-heading text-2xl font-extrabold" data-testid="suggestion-multiplier">× {ev.suggestion.multiplier}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.15em] text-emerald-300 font-semibold">Augmentation</p>
              <p className="font-heading text-2xl font-extrabold text-amber-400" data-testid="suggestion-increase">+{ev.suggestion.suggested_increase_pct} %</p>
              <p className="text-[11px] text-emerald-200/70">{ev.baiia_increase_pct} % BAIIA × {ev.suggestion.multiplier}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.15em] text-emerald-300 font-semibold">Taux suggéré</p>
              <p className="font-heading text-2xl font-extrabold text-amber-400" data-testid="suggestion-rate">{money(ev.suggestion.suggested_rate)}/h</p>
              <p className="text-[11px] text-emerald-200/70">actuel : {money(ev.current_rate)}/h</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {MULTIPLIER_GRID.map((g) => (
              <span key={g.range} className="text-[11px] px-2.5 py-1 rounded-full bg-white/10 text-emerald-100">
                {g.range} → {g.mult}
              </span>
            ))}
          </div>
        </div>
      )}

      {(ev.status === 'a_proposer' || ev.status === 'refuse') && ev.suggestion && (
        <div className="bg-white rounded-xl border border-slate-200 p-7 mb-6" data-testid="propose-card">
          <h2 className="font-heading text-base font-bold text-slate-900 mb-2">Proposer le nouveau taux à l'employé</h2>
          {ev.status === 'refuse' && ev.employee_decision && (
            <p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg p-3 mb-4" data-testid="refusal-comment">
              {ev.employee_name} a refusé la proposition de {ev.proposed_rate !== null ? money(ev.proposed_rate) : ''}/h
              {ev.employee_decision.comment && <> — « {ev.employee_decision.comment} »</>}. Vous pouvez soumettre une nouvelle offre.
            </p>
          )}
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="space-y-2">
              <Label>Taux horaire proposé ($/h)</Label>
              <Input data-testid="propose-rate-input" type="number" min="1" step="0.05" value={rateValue} onChange={(e) => setProposedRate(e.target.value)} className="w-40" />
            </div>
            <Button data-testid="propose-submit-button" disabled={busy} onClick={() => void propose()} className="rounded-full bg-emerald-600 hover:bg-emerald-700">
              <Send className="w-4 h-4 mr-1" /> Envoyer la proposition
            </Button>
          </div>
          <p className="text-xs text-slate-500 mt-3">L'employé recevra la proposition dans « Mon espace » et pourra l'accepter ou la refuser avec commentaire.</p>
        </div>
      )}

      {ev.status === 'propose' && ev.proposed_rate !== null && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 mb-6" data-testid="waiting-card">
          <p className="text-sm font-semibold text-amber-900 inline-flex items-center gap-2">
            <Hourglass className="w-4 h-4" /> Proposition de {money(ev.proposed_rate)}/h envoyée — en attente de la réponse de {ev.employee_name}.
          </p>
        </div>
      )}

      {ev.status === 'accepte' && ev.agreed_rate !== null && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 mb-6" data-testid="accepted-card">
          <p className="text-sm font-semibold text-emerald-900 inline-flex items-center gap-2 mb-1">
            <CheckCircle2 className="w-4 h-4" /> {ev.employee_name} a accepté le taux de {money(ev.agreed_rate)}/h.
          </p>
          {ev.employee_decision?.comment && <p className="text-sm text-emerald-800 mb-3">« {ev.employee_decision.comment} »</p>}
          <Button data-testid="apply-rate-button" disabled={busy} onClick={() => void markApplied()} className="rounded-full bg-emerald-600 hover:bg-emerald-700 mt-2">
            Appliquer au dossier employé
          </Button>
        </div>
      )}

      {ev.status === 'applique' && ev.agreed_rate !== null && (
        <div className="rounded-xl border border-slate-200 bg-slate-100 p-6 mb-6" data-testid="applied-card">
          <p className="text-sm font-semibold text-slate-700 inline-flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Évaluation terminée — nouveau taux de {money(ev.agreed_rate)}/h appliqué au dossier.
          </p>
        </div>
      )}

      <Button data-testid="delete-evaluation-button" variant="outline" onClick={() => void remove()} className="rounded-full text-red-600 border-red-200 hover:bg-red-50">
        <Trash2 className="w-4 h-4 mr-1" /> Supprimer cette évaluation
      </Button>
    </div>
  );
}
