import { useState, FormEvent } from 'react';
import { useHR } from '@/context/HRContext';
import { useAuth } from '@/context/AuthContext';
import { PharmacyPlan } from '@/types';
import { ModuleHeader, StatCard } from '@/components/modules/shared';
import { SuperadminUsers } from '@/components/modules/SuperadminUsers';
import { SuperadminOverview } from '@/components/modules/SuperadminOverview';
import { SuperadminPartners } from '@/components/SuperadminPartners';
import { SuperadminDemoRequests } from '@/components/modules/SuperadminDemoRequests';
import { SuperadminIncidents } from '@/components/modules/SuperadminIncidents';
import { SuperadminLoginEvents } from '@/components/modules/SuperadminLoginEvents';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Building2, Users, ShieldCheck, Plus, RotateCcw, MapPin, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

const PLAN_STYLES: Record<PharmacyPlan, string> = {
  'Essentiel': 'bg-slate-100 text-slate-700',
  'Pro': 'bg-emerald-100 text-emerald-800',
  'Entreprise': 'bg-violet-100 text-violet-800',
};

export default function SuperadminModule(): JSX.Element {
  const { state, addPharmacy, updatePharmacy, resetData, addBranch, deleteBranch } = useHR();
  const { currentUser } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [plan, setPlan] = useState<PharmacyPlan>('Essentiel');
  const [branchOpen, setBranchOpen] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [branchAddress, setBranchAddress] = useState('');
  const [branchPharmacyId, setBranchPharmacyId] = useState(state.pharmacies[0]?.id ?? '');

  const activeCount = state.pharmacies.filter((p) => p.active).length;
  const totalEmployees = state.pharmacies.reduce((s, p) => s + p.employeeCount, 0);

  if (currentUser?.role !== 'superadmin') {
    return (
      <div data-testid="superadmin-access-denied" className="bg-white rounded-xl border border-slate-200 p-12 text-center">
        <ShieldCheck className="w-10 h-10 text-slate-300 mx-auto mb-4" />
        <p className="text-slate-600 font-semibold">Module réservé aux superadministrateurs.</p>
      </div>
    );
  }

  const handleAddBranch = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    addBranch({ pharmacyId: branchPharmacyId, name: branchName, address: branchAddress });
    toast.success('Succursale ajoutée.');
    setBranchOpen(false);
    setBranchName(''); setBranchAddress('');
  };

  const handleDeleteBranch = (id: string): void => {
    const assigned = state.employees.filter((e) => e.branchId === id).length;
    if (assigned > 0) {
      toast.error(`Impossible : ${assigned} employé(s) rattaché(s) à cette succursale.`);
      return;
    }
    deleteBranch(id);
    toast.success('Succursale supprimée.');
  };

  const handleAdd = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    addPharmacy({ name, address: '', city, ownerName, adminEmail: '', employeeCount: 0, plan, active: true });
    toast.success('Pharmacie ajoutée à la plateforme.');
    setDialogOpen(false);
    setName(''); setCity(''); setOwnerName('');
  };

  return (
    <div data-testid="superadmin-module">
      <ModuleHeader
        title="Superadmin"
        subtitle="Vue d'ensemble des pharmacies clientes d'Arrière Plan."
        action={
          <div className="flex gap-2">
            <Button
              data-testid="reset-data-button"
              variant="outline"
              className="rounded-full"
              onClick={() => { resetData(); toast.success('Données de démonstration réinitialisées.'); }}
            >
              <RotateCcw className="w-4 h-4 mr-1" /> Réinitialiser les données
            </Button>
            <Button data-testid="add-pharmacy-button" onClick={() => setDialogOpen(true)} className="rounded-full bg-emerald-600 hover:bg-emerald-700">
              <Plus className="w-4 h-4 mr-1" /> Nouvelle pharmacie
            </Button>
          </div>
        }
      />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
        <StatCard label="Pharmacies" value={String(state.pharmacies.length)} icon={Building2} hint={`${activeCount} actives`} />
        <StatCard label="Employés gérés" value={String(totalEmployees)} icon={Users} hint="Tous comptes confondus" />
        <StatCard label="Comptes actifs" value={`${Math.round((activeCount / Math.max(state.pharmacies.length, 1)) * 100)} %`} icon={ShieldCheck} />
      </div>

      <SuperadminOverview />

      <SuperadminDemoRequests />

      <SuperadminIncidents />

      <SuperadminLoginEvents />

      <SuperadminUsers />

      <SuperadminPartners />

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[800px]">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.15em] text-slate-500">
              <th className="p-4">Pharmacie</th>
              <th className="p-4">Propriétaire</th>
              <th className="p-4">Ville</th>
              <th className="p-4 text-right">Employés</th>
              <th className="p-4">Forfait</th>
              <th className="p-4">Statut</th>
            </tr>
          </thead>
          <tbody>
            {state.pharmacies.map((p) => (
              <tr key={p.id} data-testid={`pharmacy-row-${p.id}`} className="border-b border-slate-100 last:border-0">
                <td className="p-4 font-semibold text-slate-800">{p.name}</td>
                <td className="p-4 text-slate-600">{p.ownerName}</td>
                <td className="p-4 text-slate-600">{p.city}</td>
                <td className="p-4 text-right text-slate-600">{p.employeeCount}</td>
                <td className="p-4">
                  <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${PLAN_STYLES[p.plan]}`}>{p.plan}</span>
                </td>
                <td className="p-4">
                  <div className="flex items-center gap-2">
                    <Switch
                      data-testid={`pharmacy-toggle-${p.id}`}
                      checked={p.active}
                      onCheckedChange={(checked) => { updatePharmacy(p.id, { active: checked }); toast.success(checked ? 'Compte activé.' : 'Compte suspendu.'); }}
                    />
                    <span className="text-xs text-slate-500">{p.active ? 'Actif' : 'Suspendu'}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-7 mt-10" data-testid="branches-panel">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-heading text-base font-bold text-slate-900 inline-flex items-center gap-2">
            <MapPin className="w-4 h-4 text-emerald-600" /> Succursales
          </h2>
          <Button data-testid="add-branch-button" size="sm" onClick={() => setBranchOpen(true)} className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs">
            <Plus className="w-3.5 h-3.5 mr-1" /> Nouvelle succursale
          </Button>
        </div>
        <div className="space-y-3">
          {state.branches.map((b) => {
            const assigned = state.employees.filter((e) => e.branchId === b.id).length;
            return (
              <div key={b.id} data-testid={`branch-row-${b.id}`} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{b.name}</p>
                  <p className="text-xs text-slate-500">
                    {state.pharmacies.find((p) => p.id === b.pharmacyId)?.name ?? '—'} · {b.address || 'Adresse non renseignée'} · {assigned} employé(s)
                  </p>
                </div>
                <Button
                  data-testid={`delete-branch-${b.id}`}
                  size="sm" variant="outline"
                  className="rounded-full text-xs text-red-600 border-red-200 hover:bg-red-50 shrink-0"
                  onClick={() => handleDeleteBranch(b.id)}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" /> Supprimer
                </Button>
              </div>
            );
          })}
          {state.branches.length === 0 && <p className="text-sm text-slate-500">Aucune succursale.</p>}
        </div>
      </div>

      <Dialog open={branchOpen} onOpenChange={setBranchOpen}>
        <DialogContent data-testid="add-branch-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Nouvelle succursale</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddBranch} className="space-y-4">
            <div className="space-y-2">
              <Label>Pharmacie</Label>
              <Select value={branchPharmacyId} onValueChange={setBranchPharmacyId}>
                <SelectTrigger data-testid="branch-pharmacy-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {state.pharmacies.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Nom de la succursale</Label>
              <Input data-testid="branch-name-input" value={branchName} onChange={(e) => setBranchName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Adresse</Label>
              <Input data-testid="branch-address-input" value={branchAddress} onChange={(e) => setBranchAddress(e.target.value)} />
            </div>
            <Button data-testid="branch-submit-button" type="submit" className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              Ajouter la succursale
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="add-pharmacy-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Nouvelle pharmacie cliente</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="space-y-2">
              <Label>Nom de la pharmacie</Label>
              <Input data-testid="pharmacy-name-input" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Ville</Label>
                <Input data-testid="pharmacy-city-input" value={city} onChange={(e) => setCity(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Propriétaire</Label>
                <Input data-testid="pharmacy-owner-input" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} required />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Forfait</Label>
              <Select value={plan} onValueChange={(v) => setPlan(v as PharmacyPlan)}>
                <SelectTrigger data-testid="pharmacy-plan-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Essentiel">Essentiel</SelectItem>
                  <SelectItem value="Pro">Pro</SelectItem>
                  <SelectItem value="Entreprise">Entreprise</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button data-testid="pharmacy-submit-button" type="submit" className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              Ajouter la pharmacie
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
