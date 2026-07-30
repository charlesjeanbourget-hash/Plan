import { useHR } from '@/context/HRContext';
import { OnboardingCategory } from '@/types';
import { ModuleHeader, EmptyState } from '@/components/modules/shared';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';

const CATEGORIES: OnboardingCategory[] = ['Documents', 'Formation', 'Équipement', 'Intégration'];

export default function OnboardingModule(): JSX.Element {
  const { state, toggleOnboardingItem, getEmployee } = useHR();

  const employeeIds = Array.from(new Set(state.onboardingItems.map((o) => o.employeeId)));

  return (
    <div data-testid="onboarding-module">
      <ModuleHeader title="Onboarding" subtitle="Suivez l'intégration de vos nouvelles recrues." />
      {employeeIds.length === 0 ? (
        <EmptyState text="Aucun onboarding en cours." />
      ) : (
        <div className="space-y-8">
          {employeeIds.map((empId) => {
            const emp = getEmployee(empId);
            const items = state.onboardingItems.filter((o) => o.employeeId === empId);
            const done = items.filter((i) => i.done).length;
            const percent = items.length ? Math.round((done / items.length) * 100) : 0;
            return (
              <div key={empId} data-testid={`onboarding-card-${empId}`} className="bg-white rounded-xl border border-slate-200 p-8">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
                  <div>
                    <h2 className="font-heading text-lg font-bold text-slate-900">
                      {emp ? `${emp.firstName} ${emp.lastName}` : 'Employé inconnu'}
                    </h2>
                    <p className="text-sm text-slate-500">{emp?.position} · embauché(e) le {emp?.hireDate}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-heading text-2xl font-extrabold text-emerald-700" data-testid={`onboarding-percent-${empId}`}>{percent} %</p>
                    <p className="text-xs text-slate-500">{done} / {items.length} étapes complétées</p>
                  </div>
                </div>
                <Progress value={percent} className="h-2 mb-8" />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {CATEGORIES.map((cat) => {
                    const catItems = items.filter((i) => i.category === cat);
                    if (catItems.length === 0) return null;
                    return (
                      <div key={cat}>
                        <p className="text-xs uppercase tracking-[0.15em] text-slate-500 font-semibold mb-3">{cat}</p>
                        <div className="space-y-2.5">
                          {catItems.map((item) => (
                            <label key={item.id} className="flex items-center gap-3 cursor-pointer group">
                              <Checkbox
                                data-testid={`onboarding-item-${item.id}`}
                                checked={item.done}
                                onCheckedChange={() => {
                                  toggleOnboardingItem(item.id);
                                  toast.success(item.done ? 'Étape réouverte.' : 'Étape complétée !');
                                }}
                              />
                              <span className={`text-sm transition-colors ${item.done ? 'text-slate-400 line-through' : 'text-slate-700 group-hover:text-slate-900'}`}>
                                {item.label}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
