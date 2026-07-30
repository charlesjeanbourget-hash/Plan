import { useHR } from '@/context/HRContext';
import { PayrollStatus } from '@/types';
import { ModuleHeader, StatCard, StatusBadge } from '@/components/modules/shared';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Wallet, TrendingDown, Banknote } from 'lucide-react';
import { toast } from 'sonner';

const PAYROLL_STATUSES: PayrollStatus[] = ['En préparation', 'Validée', 'Payée'];

const money = (n: number): string =>
  n.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' });

export default function PayrollModule(): JSX.Element {
  const { state, getEmployee, setPayrollStatus } = useHR();

  const totalGross = state.payrollEntries.reduce((s, p) => s + p.grossPay, 0);
  const totalDeductions = state.payrollEntries.reduce((s, p) => s + p.deductions, 0);
  const totalNet = state.payrollEntries.reduce((s, p) => s + p.netPay, 0);

  return (
    <div data-testid="payroll-module">
      <ModuleHeader title="Paie" subtitle="Suivi de la période de paie courante." />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
        <StatCard label="Salaire brut total" value={money(totalGross)} icon={Wallet} />
        <StatCard label="Déductions totales" value={money(totalDeductions)} icon={TrendingDown} hint="Impôts, RRQ, AE, RQAP" />
        <StatCard label="Net à verser" value={money(totalNet)} icon={Banknote} />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.15em] text-slate-500">
              <th className="p-4">Employé</th>
              <th className="p-4 text-right">Heures</th>
              <th className="p-4 text-right">Temps supp.</th>
              <th className="p-4 text-right">Brut</th>
              <th className="p-4 text-right">Déductions</th>
              <th className="p-4 text-right">Net</th>
              <th className="p-4">Statut</th>
            </tr>
          </thead>
          <tbody>
            {state.payrollEntries.map((p) => {
              const emp = getEmployee(p.employeeId);
              return (
                <tr key={p.id} data-testid={`payroll-row-${p.id}`} className="border-b border-slate-100 last:border-0">
                  <td className="p-4">
                    <p className="font-semibold text-slate-800">{emp ? `${emp.firstName} ${emp.lastName}` : 'Inconnu'}</p>
                    <p className="text-xs text-slate-500">{emp?.position}</p>
                  </td>
                  <td className="p-4 text-right text-slate-600">{p.hoursWorked} h</td>
                  <td className="p-4 text-right text-slate-600">{p.overtimeHours} h</td>
                  <td className="p-4 text-right font-semibold text-slate-800">{money(p.grossPay)}</td>
                  <td className="p-4 text-right text-red-600">−{money(p.deductions)}</td>
                  <td className="p-4 text-right font-bold text-emerald-700">{money(p.netPay)}</td>
                  <td className="p-4">
                    <Select value={p.status} onValueChange={(v) => { setPayrollStatus(p.id, v as PayrollStatus); toast.success('Statut de paie mis à jour.'); }}>
                      <SelectTrigger data-testid={`payroll-status-select-${p.id}`} className="w-40 h-8 text-xs">
                        <SelectValue><StatusBadge status={p.status} /></SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {PAYROLL_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
