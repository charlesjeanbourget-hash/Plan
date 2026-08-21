import { useState, FormEvent } from 'react';
import { useHR } from '@/context/HRContext';
import { useAuth } from '@/context/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Plus, MapPin, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onClose: () => void;
}

export const BranchManagerDialog = ({ open, onClose }: Props): JSX.Element => {
  const { state, addBranch, deleteBranch } = useHR();
  const { currentUser } = useAuth();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');

  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!name.trim()) return;
    addBranch({ pharmacyId: currentUser?.pharmacyId ?? '', name: name.trim(), address: address.trim() });
    toast.success('Succursale ajoutée.');
    setName('');
    setAddress('');
  };

  const remove = (id: string): void => {
    const assigned = state.employees.filter((emp) => emp.branchId === id).length;
    if (assigned > 0) {
      toast.error(`Impossible : ${assigned} employé(s) rattaché(s) à cette succursale.`);
      return;
    }
    deleteBranch(id);
    toast.success('Succursale supprimée.');
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="branch-manager-dialog" className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading">Succursales de votre entreprise</DialogTitle>
          <DialogDescription>
            Gérez vos pharmacies / points de service. Chaque employé peut être rattaché à une succursale.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {state.branches.map((b) => {
            const assigned = state.employees.filter((emp) => emp.branchId === b.id).length;
            return (
              <div key={b.id} data-testid={`branch-item-${b.id}`} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 inline-flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> {b.name}
                  </p>
                  <p className="text-xs text-slate-500 truncate">{b.address || 'Adresse non renseignée'} · {assigned} employé(s)</p>
                </div>
                <Button
                  data-testid={`branch-delete-${b.id}`}
                  size="sm" variant="outline"
                  className="rounded-full text-xs text-red-600 border-red-200 hover:bg-red-50 shrink-0"
                  onClick={() => remove(b.id)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            );
          })}
          {state.branches.length === 0 && (
            <p className="text-sm text-slate-500" data-testid="branches-empty">Aucune succursale pour l'instant.</p>
          )}
        </div>
        <form onSubmit={submit} className="space-y-3 border-t border-slate-200 pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Nom de la succursale</Label>
              <Input data-testid="branch-manager-name-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Pharmacie Centre-Ville" required />
            </div>
            <div className="space-y-1.5">
              <Label>Adresse</Label>
              <Input data-testid="branch-manager-address-input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Adresse complète" />
            </div>
          </div>
          <Button data-testid="branch-manager-submit" type="submit" size="sm" className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs">
            <Plus className="w-3.5 h-3.5 mr-1" /> Ajouter la succursale
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};
