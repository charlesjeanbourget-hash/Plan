import { ArrowDownToLine } from 'lucide-react';
import { useHR } from '@/context/HRContext';
import { toast } from 'sonner';

const SOFTWARES = [
  { id: 'nethris', label: 'Nethris', dot: 'bg-sky-500' },
  { id: 'employeurd', label: 'EmployeurD', dot: 'bg-blue-700' },
  { id: 'quickbooks', label: 'QuickBooks', dot: 'bg-green-600' },
  { id: 'adp', label: 'ADP', dot: 'bg-red-600' },
  { id: 'sage', label: 'Sage', dot: 'bg-lime-600' },
  { id: 'desjardins', label: 'Desjardins', dot: 'bg-emerald-600' },
  { id: 'acomba', label: 'Acomba', dot: 'bg-cyan-500' },
  { id: 'payworks', label: 'Payworks', dot: 'bg-slate-800' },
];

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function PayrollSoftwareExport(): JSX.Element {
  const { state, getEmployee } = useHR();

  const download = (id: string, label: string): void => {
    const rows = state.payrollEntries;
    if (rows.length === 0) {
      toast.error('Aucune période de paie. Créez d’abord les entrées à partir des heures punchées.');
      return;
    }
    const header = ['logiciel', 'matricule', 'nom', 'prenom', 'poste', 'periode', 'debut', 'fin', 'heures', 'temps_supp', 'brut', 'deductions', 'net', 'statut'];
    const lines = [header.join(',')];
    rows.forEach((p) => {
      const e = getEmployee(p.employeeId);
      lines.push([
        label,
        csvEscape(e?.id ?? ''),
        csvEscape(e?.lastName ?? ''),
        csvEscape(e?.firstName ?? ''),
        csvEscape(e?.position ?? ''),
        csvEscape(p.period),
        p.periodStart,
        p.periodEnd,
        String(p.hoursWorked).replace('.', ','),
        String(p.overtimeHours).replace('.', ','),
        String(p.grossPay).replace('.', ','),
        String(p.deductions).replace('.', ','),
        String(p.netPay).replace('.', ','),
        p.status,
      ].join(','));
    });
    const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `paie_${id}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Export ${label} prêt — CSV universel à importer.`);
  };

  return (
    <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5" data-testid="payroll-software-export">
      <p className="text-sm font-bold text-slate-800 inline-flex items-center gap-2 mb-1">
        <ArrowDownToLine className="w-4 h-4 text-emerald-600" /> Export CSV — 1 clic
      </p>
      <p className="text-xs text-slate-500 mb-3">Même fichier universel, nommé pour votre logiciel. Les heures viennent des périodes de paie (punch + saisie manuelle).</p>
      <div className="flex flex-wrap gap-2">
        {SOFTWARES.map((s) => (
          <button
            key={s.id}
            type="button"
            data-testid={`payroll-export-${s.id}`}
            onClick={() => download(s.id, s.label)}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:border-emerald-400 hover:bg-emerald-50"
          >
            <span className={`w-2 h-2 rounded-full ${s.dot}`} />
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
