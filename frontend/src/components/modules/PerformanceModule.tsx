import { useState, FormEvent } from 'react';
import { useHR } from '@/context/HRContext';
import { ModuleHeader, EmptyState } from '@/components/modules/shared';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Star } from 'lucide-react';
import { toast } from 'sonner';

const ScoreStars = ({ score }: { score: number }): JSX.Element => (
  <div className="flex items-center gap-1">
    {[1, 2, 3, 4, 5].map((i) => (
      <Star key={i} className={`w-4 h-4 ${i <= Math.round(score) ? 'text-amber-400 fill-amber-400' : 'text-slate-200'}`} />
    ))}
    <span className="ml-1.5 text-sm font-bold text-slate-800">{score.toFixed(1)}</span>
  </div>
);

export default function PerformanceModule(): JSX.Element {
  const { state, addReview, getEmployee } = useHR();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState(state.employees[0]?.id ?? '');
  const [score, setScore] = useState('4');
  const [strengths, setStrengths] = useState('');
  const [improvements, setImprovements] = useState('');
  const [goals, setGoals] = useState('');

  const handleAdd = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    addReview({
      employeeId,
      date: new Date().toISOString().slice(0, 10),
      reviewer: 'Dr. Sophie Lavoie',
      score: Number(score),
      strengths, improvements, goals,
    });
    toast.success('Évaluation enregistrée.');
    setDialogOpen(false);
    setStrengths(''); setImprovements(''); setGoals('');
  };

  return (
    <div data-testid="performance-module">
      <ModuleHeader
        title="Performance"
        subtitle="Évaluations et suivis d'objectifs de votre équipe."
        action={
          <Button data-testid="add-review-button" onClick={() => setDialogOpen(true)} className="rounded-full bg-emerald-600 hover:bg-emerald-700">
            <Plus className="w-4 h-4 mr-1" /> Nouvelle évaluation
          </Button>
        }
      />
      {state.performanceReviews.length === 0 ? (
        <EmptyState text="Aucune évaluation enregistrée." />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {state.performanceReviews.map((r) => {
            const emp = getEmployee(r.employeeId);
            return (
              <div key={r.id} data-testid={`review-card-${r.id}`} className="bg-white rounded-xl border border-slate-200 p-7">
                <div className="flex items-start justify-between mb-5">
                  <div>
                    <h3 className="font-heading font-bold text-slate-900">{emp ? `${emp.firstName} ${emp.lastName}` : 'Inconnu'}</h3>
                    <p className="text-xs text-slate-500">{r.date} · évalué(e) par {r.reviewer}</p>
                  </div>
                  <ScoreStars score={r.score} />
                </div>
                <div className="space-y-4 text-sm">
                  <div>
                    <p className="text-xs uppercase tracking-[0.15em] text-emerald-700 font-semibold mb-1">Points forts</p>
                    <p className="text-slate-600">{r.strengths}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.15em] text-orange-600 font-semibold mb-1">À améliorer</p>
                    <p className="text-slate-600">{r.improvements}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.15em] text-sky-700 font-semibold mb-1">Objectifs</p>
                    <p className="text-slate-600">{r.goals}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="add-review-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Nouvelle évaluation</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Employé</Label>
                <Select value={employeeId} onValueChange={setEmployeeId}>
                  <SelectTrigger data-testid="review-employee-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {state.employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.firstName} {e.lastName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Note (1 à 5)</Label>
                <Input data-testid="review-score-input" type="number" min="1" max="5" step="0.1" value={score} onChange={(e) => setScore(e.target.value)} required />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Points forts</Label>
              <Textarea data-testid="review-strengths-input" value={strengths} onChange={(e) => setStrengths(e.target.value)} rows={2} required />
            </div>
            <div className="space-y-2">
              <Label>À améliorer</Label>
              <Textarea data-testid="review-improvements-input" value={improvements} onChange={(e) => setImprovements(e.target.value)} rows={2} required />
            </div>
            <div className="space-y-2">
              <Label>Objectifs</Label>
              <Textarea data-testid="review-goals-input" value={goals} onChange={(e) => setGoals(e.target.value)} rows={2} required />
            </div>
            <Button data-testid="review-submit-button" type="submit" className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              Enregistrer l'évaluation
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
