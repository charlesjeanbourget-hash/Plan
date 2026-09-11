import { useEffect, useRef } from 'react';
import { FileText, CheckCircle2, AlertCircle } from 'lucide-react';
import { useHR } from '@/context/HRContext';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export function EmployeeContractsPanel({ employeeId }: { employeeId: string }): JSX.Element {
  const { state, addContract } = useHR();
  const emp = state.employees.find((e) => e.id === employeeId);
  const contracts = state.contracts.filter((c) => c.employeeId === employeeId);
  const seeded = useRef(false);

  useEffect(() => {
    if (!emp || seeded.current) return;
    if (contracts.length > 0) return;
    seeded.current = true;
    addContract({
      employeeId,
      type: (emp.weeklyHours ?? 0) >= 30 ? 'Temps plein' : 'Temps partiel',
      startDate: emp.hireDate,
      salary: `${(emp.hourlyRate ?? 0).toFixed(2)} $/h`,
      signed: false,
    });
  }, [emp, employeeId, contracts.length, addContract]);

  const addAnother = (): void => {
    if (!emp) return;
    addContract({
      employeeId,
      type: (emp.weeklyHours ?? 0) >= 30 ? 'Temps plein' : 'Temps partiel',
      startDate: new Date().toISOString().slice(0, 10),
      salary: `${(emp.hourlyRate ?? 0).toFixed(2)} $/h`,
      signed: false,
    });
    toast.success('Nouveau contrat ajouté au dossier.');
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-7" data-testid="employee-contracts-panel">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="font-heading text-base font-bold text-slate-900 inline-flex items-center gap-2">
          <FileText className="w-4 h-4 text-emerald-600" /> Contrats
        </h2>
        <Button data-testid="add-profile-contract" size="sm" variant="outline" className="rounded-full text-xs" onClick={addAnother}>
          Ajouter un contrat
        </Button>
      </div>
      {contracts.length === 0 ? (
        <p className="text-sm text-slate-500">Un contrat type est créé automatiquement à partir du taux et de la date d’embauche.</p>
      ) : (
        <ul className="space-y-2">
          {contracts.map((c) => (
            <li key={c.id} data-testid={`profile-contract-${c.id}`} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 px-4 py-3 text-sm">
              <FileText className="w-4 h-4 text-slate-400" />
              <span className="font-semibold text-slate-800">{c.type}</span>
              <span className="text-slate-500">depuis {c.startDate}{c.endDate ? ` → ${c.endDate}` : ''}</span>
              <span className="font-semibold text-slate-800">{c.salary}</span>
              {c.signed ? (
                <span className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Signé
                </span>
              ) : (
                <span className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
                  <AlertCircle className="w-3.5 h-3.5" /> À signer
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
