import { useHR } from '@/context/HRContext';
import { useAuth } from '@/context/AuthContext';
import { ModuleHeader } from '@/components/modules/shared';
import { Button } from '@/components/ui/button';
import { HeartHandshake, Users } from 'lucide-react';
import { toast } from 'sonner';

export default function BenefitsModule(): JSX.Element {
  const { state, toggleBenefitEnrollment, getEmployee } = useHR();
  const { currentUser } = useAuth();
  const isAdmin = currentUser?.role !== 'employee';
  const myEmployeeId = currentUser?.employeeId;

  return (
    <div data-testid="benefits-module">
      <ModuleHeader title="Avantages sociaux" subtitle="Programmes offerts à votre équipe et adhésions." />
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {state.benefits.map((b) => {
          const enrolledMe = myEmployeeId ? b.enrolledEmployeeIds.includes(myEmployeeId) : false;
          return (
            <div key={b.id} data-testid={`benefit-card-${b.id}`} className="bg-white rounded-xl border border-slate-200 p-7 flex flex-col">
              <div className="w-11 h-11 rounded-xl bg-emerald-100 flex items-center justify-center mb-5">
                <HeartHandshake className="w-5 h-5 text-emerald-700" />
              </div>
              <h3 className="font-heading font-bold text-slate-900 mb-1">{b.name}</h3>
              <p className="text-xs text-slate-500 mb-3">{b.provider}</p>
              <p className="text-sm text-slate-600 flex-1">{b.description}</p>
              <div className="mt-5 pt-5 border-t border-slate-100">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm font-semibold text-slate-800">
                    {b.monthlyCost > 0 ? `${b.monthlyCost} $ / mois` : 'Sans frais'}
                  </p>
                  <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                    <Users className="w-3.5 h-3.5" /> {b.enrolledEmployeeIds.length} inscrit(s)
                  </span>
                </div>
                {isAdmin ? (
                  <div className="flex flex-wrap gap-1.5">
                    {state.employees.map((e) => {
                      const enrolled = b.enrolledEmployeeIds.includes(e.id);
                      return (
                        <button
                          key={e.id}
                          data-testid={`benefit-${b.id}-toggle-${e.id}`}
                          onClick={() => {
                            toggleBenefitEnrollment(b.id, e.id);
                            toast.success(enrolled ? `${e.firstName} désinscrit(e).` : `${e.firstName} inscrit(e).`);
                          }}
                          className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                            enrolled ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          {e.firstName} {getEmployee(e.id)?.lastName[0]}.
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  myEmployeeId && (
                    <Button
                      data-testid={`benefit-self-toggle-${b.id}`}
                      onClick={() => {
                        toggleBenefitEnrollment(b.id, myEmployeeId);
                        toast.success(enrolledMe ? 'Désinscription confirmée.' : 'Inscription confirmée !');
                      }}
                      variant={enrolledMe ? 'outline' : 'default'}
                      className={`w-full rounded-full ${enrolledMe ? '' : 'bg-emerald-600 hover:bg-emerald-700'}`}
                    >
                      {enrolledMe ? 'Me désinscrire' : "M'inscrire"}
                    </Button>
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
