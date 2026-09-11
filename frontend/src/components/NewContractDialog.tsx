import { FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { useHR } from '@/context/HRContext';
import { ContractType } from '@/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function NewContractDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }): JSX.Element {
  const { state, addContract } = useHR();
  const [employeeId, setEmployeeId] = useState(state.employees[0]?.id ?? '');
  const [type, setType] = useState<ContractType>('Temps plein');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState('');
  const [salary, setSalary] = useState('');
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (!employeeId) return;
    addContract({ employeeId, type, startDate, endDate: endDate || undefined, signed: false, salary });
    toast.success('Contrat créé — prêt à faire signer.');
    onOpenChange(false);
    setSalary('');
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="new-contract-dialog">
        <DialogHeader><DialogTitle>Nouveau contrat</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label>Employé</Label>
            <select className="w-full h-10 rounded-md border px-3 text-sm" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} data-testid="contract-employee">
              {state.employees.filter((e) => !e.anonymized).map((e) => (
                <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Type</Label>
            <select className="w-full h-10 rounded-md border px-3 text-sm" value={type} onChange={(e) => setType(e.target.value as ContractType)}>
              <option>Temps plein</option><option>Temps partiel</option><option>Contractuel</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Début</Label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required /></div>
            <div><Label>Fin (optionnel)</Label><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
          </div>
          <div><Label>Salaire / taux</Label><Input value={salary} onChange={(e) => setSalary(e.target.value)} placeholder="Ex. 28 $/h" required /></div>
          <Button type="submit" className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">Créer la fiche contrat</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
