import { FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { useHR } from '@/context/HRContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function NewPayrollEntryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }): JSX.Element {
  const { state, addPayrollEntry } = useHR();
  const [employeeId, setEmployeeId] = useState(state.employees[0]?.id ?? '');
  const [period, setPeriod] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [hoursWorked, setHoursWorked] = useState('35');
  const [overtimeHours, setOvertimeHours] = useState('0');
  const [grossPay, setGrossPay] = useState('');
  const [deductions, setDeductions] = useState('');
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const gross = Number(grossPay) || 0;
    const ded = Number(deductions) || 0;
    addPayrollEntry({
      employeeId,
      period: period || `${periodStart} → ${periodEnd}`,
      periodStart, periodEnd,
      hoursWorked: Number(hoursWorked) || 0,
      overtimeHours: Number(overtimeHours) || 0,
      grossPay: gross, deductions: ded, netPay: gross - ded,
      status: 'En préparation',
    });
    toast.success('Entrée de paie créée.');
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="new-payroll-dialog">
        <DialogHeader><DialogTitle>Nouvelle entrée de paie</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label>Employé</Label>
            <select className="w-full h-10 rounded-md border px-3 text-sm" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              {state.employees.filter((e) => !e.anonymized).map((e) => (
                <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>
              ))}
            </select>
          </div>
          <div><Label>Libellé de période</Label><Input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="Ex. 1–14 sept. 2026" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Du</Label><Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} required /></div>
            <div><Label>Au</Label><Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} required /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Heures</Label><Input type="number" step="0.25" value={hoursWorked} onChange={(e) => setHoursWorked(e.target.value)} /></div>
            <div><Label>Temps supp.</Label><Input type="number" step="0.25" value={overtimeHours} onChange={(e) => setOvertimeHours(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Brut ($)</Label><Input type="number" step="0.01" value={grossPay} onChange={(e) => setGrossPay(e.target.value)} required /></div>
            <div><Label>Déductions ($)</Label><Input type="number" step="0.01" value={deductions} onChange={(e) => setDeductions(e.target.value)} required /></div>
          </div>
          <Button type="submit" className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">Créer la fiche de paie</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
