import { useState, useEffect, useCallback, FormEvent } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { PharmacyPlan, OverviewAccount } from '@/types';
import { ModuleHeader, StatCard, CollapsibleSection } from '@/components/modules/shared';
import { SuperadminUsers } from '@/components/modules/SuperadminUsers';
import { SuperadminOverview } from '@/components/modules/SuperadminOverview';
import { SuperadminPartners } from '@/components/SuperadminPartners';
import { SuperadminDemoRequests } from '@/components/modules/SuperadminDemoRequests';
import { SuperadminIncidents } from '@/components/modules/SuperadminIncidents';
import { SuperadminSecurity } from '@/components/modules/SuperadminSecurity';
import { SuperadminLoginEvents } from '@/components/modules/SuperadminLoginEvents';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Building2, Users, ShieldCheck, Plus, LayoutDashboard, MessagesSquare, AlertTriangle, KeyRound, Handshake } from 'lucide-react';
import { toast } from 'sonner';

const PLAN_STYLES: Record<PharmacyPlan, string> = {
  'Essentiel': 'bg-slate-100 text-slate-700',
  'Pro': 'bg-emerald-100 text-emerald-800',
  'Entreprise': 'bg-violet-100 text-violet-800',
};

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export interface ServerPharmacy {
  id: string;
  name: string;
  address: string;
  city: string;
  owner_name: string;
  admin_email: string;
  plan: PharmacyPlan;
  active: boolean;
  accounts_count: number;
}

interface LiveStats { pharmacies: number; accounts: number; employees: number; managers: number; suspended: number }

export default function SuperadminModule(): JSX.Element {
  const { currentUser, token } = useAuth();
  const headers = { Authorization: `Bearer ${token ?? ''}` };
  const [live, setLive] = useState<LiveStats | null>(null);
  const [pharmacies, setPharmacies] = useState<ServerPharmacy[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [plan, setPlan] = useState<PharmacyPlan>('Essentiel');

  const refreshPharmacies = useCallback(async (): Promise<void> => {
    try {
      const res = await axios.get<ServerPharmacy[]>(`${API}/superadmin/pharmacies`, { headers });
      setPharmacies(res.data);
    } catch {
      /* silencieux */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (currentUser?.role !== 'superadmin' || !token) return;
    void refreshPharmacies();
    axios.get<{ pharmacies: { pharmacy_id: string }[]; accounts?: OverviewAccount[] }>(`${API}/superadmin/overview`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        const accounts = r.data.accounts ?? [];
        const clients = accounts.filter((a) => a.role !== 'superadmin');
        setLive({
          pharmacies: r.data.pharmacies.length,
          accounts: clients.length,
          employees: clients.filter((a) => a.role === 'employee').length,
          managers: clients.filter((a) => a.role === 'admin' || a.role === 'manager').length,
          suspended: clients.filter((a) => a.suspended).length,
        });
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.role, token]);

  if (currentUser?.role !== 'superadmin') {
    return (
      <div data-testid="superadmin-access-denied" className="bg-white rounded-xl border border-slate-200 p-12 text-center">
        <ShieldCheck className="w-10 h-10 text-slate-300 mx-auto mb-4" />
        <p className="text-slate-600 font-semibold">Module réservé aux superadministrateurs.</p>
      </div>
    );
  }

  const handleAdd = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    try {
      await axios.post(`${API}/superadmin/pharmacies`, { name, city, owner_name: ownerName, plan }, { headers });
      toast.success('Pharmacie cliente créée. Vous pouvez maintenant lui créer des comptes.');
      setDialogOpen(false);
      setName(''); setCity(''); setOwnerName('');
      await refreshPharmacies();
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: string }).detail : null;
      toast.error(detail ?? 'Impossible de créer la pharmacie.');
    }
  };

  const toggleActive = async (p: ServerPharmacy, active: boolean): Promise<void> => {
    try {
      await axios.put(`${API}/superadmin/pharmacies/${p.id}`, { active }, { headers });
      toast.success(active ? 'Pharmacie activée.' : 'Pharmacie suspendue.');
      await refreshPharmacies();
    } catch {
      toast.error('Modification impossible.');
    }
  };

  return (
    <div data-testid="superadmin-module">
      <ModuleHeader
        title="Superadmin"
        subtitle="Gestion de la plateforme Arrière Plan — les données RH des pharmacies clientes sont strictement cloisonnées et inaccessibles."
        action={
          <Button data-testid="add-pharmacy-button" onClick={() => setDialogOpen(true)} className="rounded-full bg-emerald-600 hover:bg-emerald-700">
            <Plus className="w-4 h-4 mr-1" /> Nouvelle pharmacie
          </Button>
        }
      />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10" data-testid="superadmin-live-stats">
        <StatCard label="Pharmacies clientes" value={String(pharmacies.length)} icon={Building2} hint="Données réelles de la plateforme" />
        <StatCard label="Comptes clients" value={live ? String(live.accounts) : '…'} icon={Users} hint={live ? `${live.employees} employé(s) · ${live.managers} gestionnaire(s)` : 'Chargement…'} />
        <StatCard
          label="Comptes actifs"
          value={live ? `${Math.round(((live.accounts - live.suspended) / Math.max(live.accounts, 1)) * 100)} %` : '…'}
          icon={ShieldCheck}
          hint={live ? (live.suspended > 0 ? `${live.suspended} compte(s) suspendu(s)` : 'Aucun compte suspendu') : 'Chargement…'}
        />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto mb-6" data-testid="pharmacies-table">
        <table className="w-full text-sm min-w-[800px]">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.15em] text-slate-500">
              <th className="p-4">Pharmacie</th>
              <th className="p-4">Propriétaire</th>
              <th className="p-4">Ville</th>
              <th className="p-4 text-right">Comptes</th>
              <th className="p-4">Forfait</th>
              <th className="p-4">Statut</th>
            </tr>
          </thead>
          <tbody>
            {pharmacies.map((p) => (
              <tr key={p.id} data-testid={`pharmacy-row-${p.id}`} className="border-b border-slate-100 last:border-0">
                <td className="p-4">
                  <p className="font-semibold text-slate-800">{p.name}</p>
                  <p className="text-xs text-slate-400 font-mono">{p.id}</p>
                </td>
                <td className="p-4 text-slate-600">{p.owner_name || '—'}</td>
                <td className="p-4 text-slate-600">{p.city || '—'}</td>
                <td className="p-4 text-right text-slate-600">{p.accounts_count}</td>
                <td className="p-4">
                  <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${PLAN_STYLES[p.plan] ?? PLAN_STYLES.Essentiel}`}>{p.plan}</span>
                </td>
                <td className="p-4">
                  <div className="flex items-center gap-2">
                    <Switch
                      data-testid={`pharmacy-toggle-${p.id}`}
                      checked={p.active}
                      onCheckedChange={(checked) => void toggleActive(p, checked)}
                    />
                    <span className="text-xs text-slate-500">{p.active ? 'Actif' : 'Suspendu'}</span>
                  </div>
                </td>
              </tr>
            ))}
            {pharmacies.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-sm text-slate-500">Aucune pharmacie cliente.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <CollapsibleSection id="sa-overview" title="Vue d'ensemble de la plateforme" icon={LayoutDashboard} defaultOpen className="mb-4">
        <SuperadminOverview />
      </CollapsibleSection>

      <CollapsibleSection id="sa-security" title="Sécurité" icon={ShieldCheck} className="mb-4">
        <SuperadminSecurity />
      </CollapsibleSection>

      <CollapsibleSection id="sa-demos" title="Demandes de démonstration" icon={MessagesSquare} className="mb-4">
        <SuperadminDemoRequests />
      </CollapsibleSection>

      <CollapsibleSection id="sa-incidents" title="Incidents" icon={AlertTriangle} className="mb-4">
        <SuperadminIncidents />
      </CollapsibleSection>

      <CollapsibleSection id="sa-logins" title="Journal des connexions" icon={KeyRound} className="mb-4">
        <SuperadminLoginEvents />
      </CollapsibleSection>

      <CollapsibleSection id="sa-users" title="Comptes utilisateurs" icon={Users} className="mb-4">
        <SuperadminUsers pharmacies={pharmacies} />
      </CollapsibleSection>

      <CollapsibleSection id="sa-partners" title="Partenaires" icon={Handshake} className="mb-6">
        <SuperadminPartners />
      </CollapsibleSection>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="add-pharmacy-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Nouvelle pharmacie cliente</DialogTitle>
            <DialogDescription>
              Chaque pharmacie possède son propre espace de données, complètement isolé des autres.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void handleAdd(e)} className="space-y-4">
            <div className="space-y-2">
              <Label>Nom de la pharmacie / entreprise</Label>
              <Input data-testid="pharmacy-name-input" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Ville</Label>
                <Input data-testid="pharmacy-city-input" value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Propriétaire</Label>
                <Input data-testid="pharmacy-owner-input" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
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
              Créer la pharmacie
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
