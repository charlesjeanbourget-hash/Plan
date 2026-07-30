import { useState, useEffect, useCallback, FormEvent } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { Evaluation, EvaluationStatus } from '@/types';
import { SELF_QUESTIONS } from '@/lib/evaluations';
import { RatingScale } from '@/components/RatingScale';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { ClipboardCheck, CheckCircle2, HandCoins } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const money = (v: number): string => v.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' });

const MY_STATUS: Record<EvaluationStatus, { label: string; cls: string }> = {
  en_cours: { label: 'En cours', cls: 'bg-sky-100 text-sky-800' },
  a_proposer: { label: 'En analyse par votre gestionnaire', cls: 'bg-bronze-100 text-bronze-800' },
  propose: { label: 'Proposition salariale reçue', cls: 'bg-bronze-100 text-bronze-800' },
  accepte: { label: 'Proposition acceptée', cls: 'bg-emerald-100 text-emerald-800' },
  refuse: { label: 'Proposition refusée', cls: 'bg-red-100 text-red-800' },
  applique: { label: 'Terminée — taux appliqué', cls: 'bg-emerald-100 text-emerald-800' },
};

export const MyEvaluationsPanel = (): JSX.Element | null => {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token ?? ''}` };
  const [evals, setEvals] = useState<Evaluation[]>([]);
  const [selfTarget, setSelfTarget] = useState<Evaluation | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [accomplishments, setAccomplishments] = useState('');
  const [needs, setNeeds] = useState('');
  const [goals, setGoals] = useState('');
  const [respondTarget, setRespondTarget] = useState<Evaluation | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await axios.get<Evaluation[]>(`${API}/evaluations`, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      setEvals(res.data);
    } catch {
      setEvals([]);
    }
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (evals.length === 0) return null;

  const allAnswered = SELF_QUESTIONS.every((q) => answers[q.id] !== undefined);

  const submitSelf = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!selfTarget || !allAnswered) return;
    setBusy(true);
    try {
      await axios.put(`${API}/evaluations/${selfTarget.id}/self`, { answers, accomplishments, needs, goals }, { headers });
      toast.success('Auto-évaluation transmise à votre gestionnaire. Merci !');
      setSelfTarget(null);
      setAnswers({});
      setAccomplishments(''); setNeeds(''); setGoals('');
      await refresh();
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
      toast.error(typeof detail === 'string' ? detail : 'Envoi impossible.');
    } finally {
      setBusy(false);
    }
  };

  const respond = async (accepted: boolean): Promise<void> => {
    if (!respondTarget) return;
    setBusy(true);
    try {
      await axios.post(`${API}/evaluations/${respondTarget.id}/respond`, { accepted, comment }, { headers });
      toast.success(accepted ? 'Nouveau taux accepté — félicitations !' : 'Réponse transmise à votre gestionnaire.');
      setRespondTarget(null);
      setComment('');
      await refresh();
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
      toast.error(typeof detail === 'string' ? detail : 'Réponse impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-7 lg:col-span-2" data-testid="my-evaluations-panel">
      <h2 className="font-heading text-base font-bold text-slate-900 mb-5 inline-flex items-center gap-2">
        <ClipboardCheck className="w-4 h-4 text-emerald-600" /> Mes évaluations de performance
      </h2>
      <div className="space-y-4">
        {evals.map((ev) => {
          const meta = MY_STATUS[ev.status];
          return (
            <div key={ev.id} data-testid={`my-evaluation-${ev.id}`} className="rounded-lg border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                <div>
                  <p className="text-sm font-semibold text-slate-800">Évaluation du {ev.created_at.slice(0, 10)}</p>
                  <p className="text-xs text-slate-500">
                    {ev.self_eval ? `Auto-évaluation complétée — ${ev.self_eval.score} %` : 'Auto-évaluation à compléter'}
                  </p>
                </div>
                <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${meta.cls}`}>{meta.label}</span>
              </div>

              {!ev.self_eval && (
                <Button
                  data-testid={`start-self-eval-${ev.id}`}
                  size="sm"
                  onClick={() => { setSelfTarget(ev); setAnswers({}); }}
                  className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs"
                >
                  Compléter mon auto-évaluation
                </Button>
              )}

              {ev.status === 'propose' && ev.proposed_rate !== null && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 mt-2" data-testid={`proposal-box-${ev.id}`}>
                  <p className="text-sm font-semibold text-amber-900 inline-flex items-center gap-2 mb-1">
                    <HandCoins className="w-4 h-4" /> Votre employeur vous propose un nouveau taux
                  </p>
                  <p className="text-sm text-amber-900 mb-3">
                    {money(ev.current_rate)}/h → <strong>{money(ev.proposed_rate)}/h</strong>
                  </p>
                  <Button
                    data-testid={`respond-proposal-${ev.id}`}
                    size="sm"
                    onClick={() => { setRespondTarget(ev); setComment(''); }}
                    className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs"
                  >
                    Répondre à la proposition
                  </Button>
                </div>
              )}

              {(ev.status === 'accepte' || ev.status === 'applique') && ev.agreed_rate !== null && (
                <p className="text-sm text-emerald-800 inline-flex items-center gap-2 mt-1" data-testid={`accepted-note-${ev.id}`}>
                  <CheckCircle2 className="w-4 h-4" /> Nouveau taux accepté : {money(ev.agreed_rate)}/h
                  {ev.status === 'applique' && ' — appliqué à votre dossier.'}
                </p>
              )}

              {ev.status === 'refuse' && (
                <p className="text-sm text-red-700 mt-1" data-testid={`refused-note-${ev.id}`}>
                  Vous avez refusé la proposition — votre gestionnaire pourra vous en soumettre une nouvelle.
                </p>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={selfTarget !== null} onOpenChange={(o) => !o && setSelfTarget(null)}>
        <DialogContent data-testid="self-eval-dialog" className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading">Mon auto-évaluation</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => void submitSelf(e)} className="space-y-5">
            <p className="text-xs text-slate-500">Notez chaque énoncé de 1 (pas du tout d'accord) à 5 (tout à fait d'accord). Vos réponses comptent pour 30 % du score global.</p>
            {SELF_QUESTIONS.map((q, i) => (
              <div key={q.id} className="space-y-1.5">
                <p className="text-sm font-semibold text-slate-800">{i + 1}. {q.label}</p>
                <RatingScale value={answers[q.id]} onChange={(v) => setAnswers((prev) => ({ ...prev, [q.id]: v }))} testId={`self-rating-${q.id}`} />
              </div>
            ))}
            <div className="space-y-2">
              <Label>Mes réalisations dont je suis fier(ère)</Label>
              <Textarea data-testid="self-accomplishments-input" rows={2} value={accomplishments} onChange={(e) => setAccomplishments(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Mes besoins (formation, outils, soutien…)</Label>
              <Textarea data-testid="self-needs-input" rows={2} value={needs} onChange={(e) => setNeeds(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Mes objectifs pour la prochaine année</Label>
              <Textarea data-testid="self-goals-input" rows={2} value={goals} onChange={(e) => setGoals(e.target.value)} />
            </div>
            <Button data-testid="self-eval-submit" type="submit" disabled={!allAnswered || busy} className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              Transmettre mon auto-évaluation
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={respondTarget !== null} onOpenChange={(o) => !o && setRespondTarget(null)}>
        <DialogContent data-testid="respond-proposal-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Proposition salariale</DialogTitle>
          </DialogHeader>
          {respondTarget && respondTarget.proposed_rate !== null && (
            <div className="space-y-4">
              <p className="text-sm text-slate-700">
                Nouveau taux proposé : <strong className="text-emerald-700">{money(respondTarget.proposed_rate)}/h</strong>{' '}
                (actuellement {money(respondTarget.current_rate)}/h).
              </p>
              <div className="space-y-2">
                <Label>Commentaire (facultatif)</Label>
                <Textarea data-testid="respond-comment-input" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Ex. merci, ou raison du refus…" />
              </div>
              <div className="flex gap-2">
                <Button data-testid="accept-proposal-button" disabled={busy} onClick={() => void respond(true)} className="flex-1 rounded-full bg-emerald-600 hover:bg-emerald-700">
                  Accepter le nouveau taux
                </Button>
                <Button data-testid="refuse-proposal-button" disabled={busy} variant="outline" onClick={() => void respond(false)} className="flex-1 rounded-full text-red-600 border-red-200 hover:bg-red-50">
                  Refuser
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
