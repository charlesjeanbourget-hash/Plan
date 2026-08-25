import { useMemo, useState } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { useHR } from '@/context/HRContext';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Building2, MapPin, Users, Clock, ChevronLeft, ChevronRight, CheckCircle2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

type StepKey = 'address' | 'branchCount' | `branch-${number}` | 'employees' | 'hours' | 'summary';

interface BranchDraft { name: string; address: string }

const EMPLOYEE_RANGES = ['1 à 5', '6 à 15', '16 à 30', '31 et plus'];

export default function TrialOnboarding(): JSX.Element {
  const { currentUser, token, refreshUser } = useAuth();
  const { addBranch } = useHR();
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [branchCount, setBranchCount] = useState(1);
  const [branches, setBranches] = useState<BranchDraft[]>([{ name: '', address: '' }]);
  const [employeeCount, setEmployeeCount] = useState('');
  const [hours, setHours] = useState('');
  const [stepIndex, setStepIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const steps = useMemo<StepKey[]>(() => {
    const branchSteps: StepKey[] = Array.from({ length: branchCount }, (_, i) => `branch-${i}` as StepKey);
    return ['address', 'branchCount', ...branchSteps, 'employees', 'hours', 'summary'];
  }, [branchCount]);

  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const progress = Math.round(((stepIndex + 1) / steps.length) * 100);

  const chooseBranchCount = (n: number): void => {
    setBranchCount(n);
    setBranches((prev) =>
      Array.from({ length: n }, (_, i) => prev[i] ?? { name: '', address: '' })
    );
  };

  const patchBranch = (i: number, patch: Partial<BranchDraft>): void =>
    setBranches((prev) => prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));

  const branchSummary = (b: BranchDraft): string =>
    b.address.trim() ? `${b.name} (${b.address})` : b.name;

  const finalize = async (skipped: boolean): Promise<void> => {
    setSubmitting(true);
    try {
      if (!skipped) {
        const pid = currentUser?.pharmacyId ?? '';
        branches.forEach((b) => addBranch({ pharmacyId: pid, name: b.name.trim(), address: b.address.trim() }));
      }
      await axios.post(
        `${API}/onboarding`,
        skipped
          ? { skipped: true }
          : { address, city, employee_count: employeeCount, opening_hours: hours },
        { headers: { Authorization: `Bearer ${token ?? ''}` } }
      );
      if (!skipped) {
        toast.success('Votre pharmacie est configurée ! Bienvenue sur Arrière Plan.', { duration: 6000 });
      } else {
        toast.info('Vous pourrez configurer vos succursales à tout moment via Dossiers Employés → Succursales.', { duration: 8000 });
      }
      await refreshUser();
    } catch {
      toast.error('Enregistrement impossible pour le moment. Réessayez.');
    } finally {
      setSubmitting(false);
    }
  };

  const next = (): void => {
    if (step === 'summary') { void finalize(false); return; }
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  };
  const back = (): void => setStepIndex((i) => Math.max(i - 1, 0));

  const branchIdx = step.startsWith('branch-') ? Number(step.split('-')[1]) : -1;
  const branchStepIncomplete = branchIdx >= 0
    && !((branches[branchIdx]?.name ?? '').trim() && (branches[branchIdx]?.address ?? '').trim());

  return (
    <div data-testid="onboarding-page" className="min-h-screen bg-slate-50 flex flex-col">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <p className="font-heading font-bold text-slate-800 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-emerald-600" /> Arrière Plan
        </p>
        <button
          data-testid="onboarding-skip"
          onClick={() => void finalize(true)}
          disabled={submitting}
          className="text-sm text-slate-500 hover:text-slate-800 underline underline-offset-4 transition-colors"
        >
          Configurer plus tard →
        </button>
      </header>

      <div className="w-full max-w-xl mx-auto px-6 flex-1 flex flex-col justify-center pb-24">
        <div className="mb-8">
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-700 font-semibold mb-2" data-testid="onboarding-progress-label">
            Configuration de votre pharmacie — question {Math.min(stepIndex + 1, steps.length)} de {steps.length}
          </p>
          <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-600 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div key={step} className="animate-in fade-in slide-in-from-bottom-4 duration-300">
          {step === 'address' && (
            <div className="space-y-5">
              <MapPin className="w-9 h-9 text-emerald-600" />
              <h1 className="font-heading text-2xl sm:text-3xl font-bold text-slate-900">Où se situe votre pharmacie principale ?</h1>
              <div className="space-y-2">
                <Label>Adresse</Label>
                <Input data-testid="onboarding-address-input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Ex. 123 rue Principale" autoFocus />
              </div>
              <div className="space-y-2">
                <Label>Ville</Label>
                <Input data-testid="onboarding-city-input" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ex. Montréal" />
              </div>
            </div>
          )}

          {step === 'branchCount' && (
            <div className="space-y-5">
              <Building2 className="w-9 h-9 text-emerald-600" />
              <h1 className="font-heading text-2xl sm:text-3xl font-bold text-slate-900">Combien de succursales exploitez-vous ?</h1>
              <div className="flex flex-wrap gap-3">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <button
                    key={n}
                    data-testid={`branch-count-${n}`}
                    onClick={() => chooseBranchCount(n)}
                    className={`w-14 h-14 rounded-2xl border-2 text-lg font-bold transition-all ${
                      branchCount === n
                        ? 'border-emerald-600 bg-emerald-600 text-white shadow-lg shadow-emerald-600/25'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-emerald-300'
                    }`}
                  >
                    {n}{n === 6 ? '+' : ''}
                  </button>
                ))}
              </div>
              <p className="text-sm text-slate-500">Chaque succursale aura ses propres horaires et affectations d'employés.</p>
            </div>
          )}

          {branchIdx >= 0 && (
            <div className="space-y-5">
              <Building2 className="w-9 h-9 text-emerald-600" />
              <h1 className="font-heading text-2xl sm:text-3xl font-bold text-slate-900">
                {branchCount === 1 ? 'Nommez votre succursale et son adresse' : `Succursale ${branchIdx + 1} sur ${branchCount}`}
              </h1>
              <div className="space-y-2">
                <Label>Nom de la succursale <span className="text-red-500">*</span></Label>
                <Input
                  data-testid="onboarding-branch-name-input"
                  value={branches[branchIdx]?.name ?? ''}
                  onChange={(e) => patchBranch(branchIdx, { name: e.target.value })}
                  placeholder={`Ex. Pharmacie Centre-Ville`}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label>Adresse exacte <span className="text-red-500">*</span></Label>
                <Input
                  data-testid="onboarding-branch-address-input"
                  value={branches[branchIdx]?.address ?? ''}
                  onChange={(e) => patchBranch(branchIdx, { address: e.target.value })}
                  placeholder="Ex. 123 rue Principale, Montréal"
                />
              </div>
              <p className="text-sm text-slate-500">Le nom et l'adresse exacte apparaîtront partout où vous choisissez une succursale (employés, horaires, paie…).</p>
            </div>
          )}

          {step === 'employees' && (
            <div className="space-y-5">
              <Users className="w-9 h-9 text-emerald-600" />
              <h1 className="font-heading text-2xl sm:text-3xl font-bold text-slate-900">Combien d'employés avez-vous, environ ?</h1>
              <div className="grid grid-cols-2 gap-3">
                {EMPLOYEE_RANGES.map((r) => (
                  <button
                    key={r}
                    data-testid={`employee-count-${r.replace(/\s/g, '')}`}
                    onClick={() => setEmployeeCount(r)}
                    className={`rounded-2xl border-2 px-4 py-4 text-sm font-semibold transition-all ${
                      employeeCount === r
                        ? 'border-emerald-600 bg-emerald-600 text-white shadow-lg shadow-emerald-600/25'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-emerald-300'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 'hours' && (
            <div className="space-y-5">
              <Clock className="w-9 h-9 text-emerald-600" />
              <h1 className="font-heading text-2xl sm:text-3xl font-bold text-slate-900">Quelles sont vos heures d'ouverture habituelles ?</h1>
              <Input
                data-testid="onboarding-hours-input"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="Ex. Lun–Ven 8 h à 21 h · Sam–Dim 9 h à 17 h"
                autoFocus
              />
              <p className="text-sm text-slate-500">Utile pour la génération d'horaires par l'IA. Vous pourrez raffiner plus tard.</p>
            </div>
          )}

          {step === 'summary' && (
            <div className="space-y-5">
              <CheckCircle2 className="w-9 h-9 text-emerald-600" />
              <h1 className="font-heading text-2xl sm:text-3xl font-bold text-slate-900">Tout est prêt !</h1>
              <div data-testid="onboarding-summary" className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 text-sm">
                <div className="px-5 py-3 flex justify-between gap-4"><span className="text-slate-500">Adresse principale</span><span className="font-semibold text-slate-800 text-right">{[address, city].filter(Boolean).join(', ') || 'À compléter plus tard'}</span></div>
                <div className="px-5 py-3 flex justify-between gap-4"><span className="text-slate-500">Succursales</span><span className="font-semibold text-slate-800 text-right">{branches.map((b) => branchSummary(b)).join(' · ')}</span></div>
                <div className="px-5 py-3 flex justify-between gap-4"><span className="text-slate-500">Employés</span><span className="font-semibold text-slate-800">{employeeCount || 'Non précisé'}</span></div>
                <div className="px-5 py-3 flex justify-between gap-4"><span className="text-slate-500">Heures d'ouverture</span><span className="font-semibold text-slate-800 text-right">{hours || 'Non précisées'}</span></div>
              </div>
              <p className="text-sm text-slate-500">Vos succursales seront créées automatiquement. Prochaine étape : ajoutez vos employés !</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between mt-10">
          <Button
            data-testid="onboarding-back"
            variant="outline"
            onClick={back}
            disabled={stepIndex === 0 || submitting}
            className="rounded-full"
          >
            <ChevronLeft className="w-4 h-4 mr-1" /> Précédent
          </Button>
          <Button
            data-testid={step === 'summary' ? 'onboarding-finish' : 'onboarding-next'}
            onClick={next}
            disabled={submitting || branchStepIncomplete}
            className="rounded-full bg-emerald-600 hover:bg-emerald-700 px-8"
          >
            {step === 'summary' ? (submitting ? 'Enregistrement…' : 'Terminer la configuration') : 'Continuer'}
            {step !== 'summary' && <ChevronRight className="w-4 h-4 ml-1" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
