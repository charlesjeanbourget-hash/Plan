import { useState, FormEvent } from 'react';
import { useHR } from '@/context/HRContext';
import { useAuth } from '@/context/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Plus, MapPin, Trash2, AlertTriangle } from 'lucide-react';
import { Branch } from '@/types';
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
  const [toDelete, setToDelete] = useState<Branch | null>(null);

  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!name.trim()) return;
    addBranch({ pharmacyId: currentUser?.pharmacyId ?? '', name: name.trim(), address: address.trim() });
    toast.success('Succursale ajoutée.');
    setName('');
    setAddress('');
  };

  const assignedCount = (id: string): number =>
    state.employees.filter((emp) => emp.branchId === id || emp.branchIds?.includes(id)).length;
  const shiftsCount = (id: string): number => state.shifts.filter((s) => s.branchId === id).length;

  const confirmDelete = (): void => {
    if (!toDelete) return;
    deleteBranch(toDelete.id);
    toast.success(`Succursale « ${toDelete.name} » supprimée définitivement.`);
    setToDelete(null);
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
            const assigned = assignedCount(b.id);
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
                  onClick={() => setToDelete(b)}
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

        <Dialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
          <DialogContent data-testid="branch-delete-confirm-dialog">
            <DialogHeader>
              <DialogTitle className="font-heading flex items-center gap-2 text-red-700">
                <AlertTriangle className="w-5 h-5" /> Supprimer la succursale « {toDelete?.name} » ?
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-2 text-sm">
              <p className="font-semibold text-slate-800">
                Vous êtes sur le point de perdre toutes les données associées à cette succursale :
              </p>
              <ul className="list-disc pl-5 text-slate-600 space-y-1">
                <li>{toDelete ? assignedCount(toDelete.id) : 0} employé(s) rattaché(s) seront détachés de la succursale</li>
                <li>{toDelete ? shiftsCount(toDelete.id) : 0} quart(s) de travail planifiés seront supprimés</li>
              </ul>
              <p className="text-red-600 font-semibold">Cette action est irréversible.</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" className="rounded-full" data-testid="branch-delete-cancel" onClick={() => setToDelete(null)}>
                Annuler
              </Button>
              <Button
                data-testid="branch-delete-confirm"
                onClick={confirmDelete}
                className="rounded-full bg-red-600 hover:bg-red-700 text-white"
              >
                Supprimer définitivement
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
};
