import { useHR } from '@/context/HRContext';
import { ModuleHeader, EmptyState } from '@/components/modules/shared';
import { Button } from '@/components/ui/button';
import { FileText, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

export default function ContractsModule(): JSX.Element {
  const { state, updateContract, getEmployee } = useHR();

  return (
    <div data-testid="contracts-module">
      <ModuleHeader title="Contrats" subtitle="Suivi des contrats de travail de votre équipe." />
      {state.contracts.length === 0 ? (
        <EmptyState text="Aucun contrat enregistré." />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.15em] text-slate-500">
                <th className="p-4">Employé</th>
                <th className="p-4">Type</th>
                <th className="p-4">Début</th>
                <th className="p-4">Fin</th>
                <th className="p-4">Salaire</th>
                <th className="p-4">Signature</th>
                <th className="p-4"></th>
              </tr>
            </thead>
            <tbody>
              {state.contracts.map((c) => {
                const emp = getEmployee(c.employeeId);
                return (
                  <tr key={c.id} data-testid={`contract-row-${c.id}`} className="border-b border-slate-100 last:border-0">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <FileText className="w-4 h-4 text-slate-400" />
                        <div>
                          <p className="font-semibold text-slate-800">{emp ? `${emp.firstName} ${emp.lastName}` : 'Inconnu'}</p>
                          <p className="text-xs text-slate-500">{emp?.position}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4 text-slate-600">{c.type}</td>
                    <td className="p-4 text-slate-600">{c.startDate}</td>
                    <td className="p-4 text-slate-600">{c.endDate ?? 'Indéterminée'}</td>
                    <td className="p-4 font-semibold text-slate-800">{c.salary}</td>
                    <td className="p-4">
                      {c.signed ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-700 text-xs font-semibold">
                          <CheckCircle2 className="w-4 h-4" /> Signé
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-orange-600 text-xs font-semibold">
                          <AlertCircle className="w-4 h-4" /> En attente
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-right">
                      {!c.signed && (
                        <Button
                          data-testid={`sign-contract-${c.id}`}
                          size="sm"
                          onClick={() => { updateContract(c.id, { signed: true }); toast.success('Contrat marqué comme signé.'); }}
                          className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs"
                        >
                          Marquer signé
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
