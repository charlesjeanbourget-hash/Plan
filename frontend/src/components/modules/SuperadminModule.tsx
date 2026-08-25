import { useState, useEffect, useCallback, useRef, FormEvent } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { PharmacyPlan, OverviewAccount } from '@/types';
import { ModuleHeader, StatCard, CollapsibleSection, openSection } from '@/components/modules/shared';
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
import { Building2, Users, ShieldCheck, Plus, LayoutDashboard, MessagesSquare, AlertTriangle, KeyRound, Handshake, Trash2, Mail } from 'lucide-react';
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
  plan: PharmacyPlan | string;
  active: boolean;
  accounts_count: number;
  plan_status?: string;
  trial_ends_at?: string;
}

interface LiveStats { pharmacies: number; accounts: number; employees: number; managers: number; suspended: number }

interface CreatedCredentials { pharmacyName: string; email: string; tempPassword: string; emailSent: boolean }

export default function SuperadminModule(): JSX.Element {
  const { currentUser, token } = useAuth();
  const headers = { Authorization: `Bearer ${token ?? ''}` };
  const [live, setLive] = useState<LiveStats | null>(null);
  const [pharmacies, setPharmacies] = useState<ServerPharmacy[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [plan, setPlan] = useState<PharmacyPlan>('Essentiel');
  const [created, setCreated] = useState<CreatedCredentials | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ServerPharmacy | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const pharmaciesTableRef = useRef<HTMLDivElement | null>(null);

  const refreshPharmacies = useCallback(async (): Promise<void> => {
    try {
      const res = await axios.get<ServerPharmacy[]>(`${API}/superadmin/pharmacies`, { headers });
      setPharmacies(res.data);
    } catch {
      /* silencieux */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshStats = useCallback(async (): Promise<void> => {
    try {
      const r = await axios.get<{ pharmacies: { pharmacy_id: string }[]; accounts?: OverviewAccount[] }>(
        `${API}/superadmin/overview`, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      const accounts = r.data.accounts ?? [];
      const clients = accounts.filter((a) => a.role !== 'superadmin');
      setLive({
        pharmacies: r.data.pharmacies.length,
        accounts: clients.length,
        employees: clients.filter((a) => a.role === 'employee').length,
        managers: clients.filter((a) => a.role === 'admin' || a.role === 'manager').length,
        suspended: clients.filter((a) => a.suspended).length,
      });
    } catch {
      /* silencieux */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (currentUser?.role !== 'superadmin' || !token) return;
    void refreshPharmacies();
    void refreshStats();
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
      const res = await axios.post<ServerPharmacy & { temporary_password: string; email_sent: boolean }>(
        `${API}/superadmin/pharmacies`,
        { name, city, owner_name: adminName, admin_name: adminName, admin_email: adminEmail, plan },
        { headers }
      );
      setDialogOpen(false);
      setCreated({ pharmacyName: name, email: adminEmail.trim().toLowerCase(), tempPassword: res.data.temporary_password, emailSent: res.data.email_sent });
      setName(''); setCity(''); setAdminName(''); setAdminEmail('');
      await Promise.all([refreshPharmacies(), refreshStats()]);
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: string }).detail : null;
      toast.error(detail ?? 'Impossible de créer la pharmacie.', { duration: 8000 });
    }
  };

  const toggleActive = async (p: ServerPharmacy, active: boolean): Promise<void> => {
    try {
      await axios.put(`${API}/superadmin/pharmacies/${p.id}`, { active }, { headers });
      toast.success(active ? 'Pharmacie activée.' : 'Pharmacie suspendue — la connexion de ses comptes est bloquée.');
      await refreshPharmacies();
    } catch {
      toast.error('Modification impossible.');
    }
  };

  const trialDaysLeft = (p: ServerPharmacy): number => {
    if (!p.trial_ends_at) return 0;
    return Math.max(0, Math.ceil((new Date(p.trial_ends_at).getTime() - Date.now()) / 86400000));
  };

  const grantFullAccess = async (p: ServerPharmacy): Promise<void> => {
    try {
      await axios.put(`${API}/superadmin/pharmacies/${p.id}`, { plan_status: 'full' }, { headers });
      toast.success(`« ${p.name} » a maintenant l'accès complet.`);
      await refreshPharmacies();
    } catch {
      toast.error('Modification impossible.');
    }
  };

  const confirmDelete = async (): Promise<void> => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await axios.delete<{ accounts_deleted: number }>(`${API}/superadmin/pharmacies/${deleteTarget.id}`, { headers });
      toast.success(`« ${deleteTarget.name} » supprimée définitivement (${res.data.accounts_deleted} compte(s) et toutes les données).`, { duration: 8000 });
      setDeleteTarget(null);
      setDeleteConfirmText('');
      await Promise.all([refreshPharmacies(), refreshStats()]);
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: string }).detail : null;
      toast.error(detail ?? 'Suppression impossible.');
    } finally {
      setDeleting(false);
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
        <StatCard
          label="Pharmacies clientes" value={String(pharmacies.length)} icon={Building2}
          hint="Voir la liste des pharmacies" testId="stat-pharmacies"
          onClick={() => pharmaciesTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        />
        <StatCard
          label="Comptes clients" value={live ? String(live.accounts) : '…'} icon={Users}
          hint={live ? `${live.employees} employé(s) · ${live.managers} gestionnaire(s) — gérer` : 'Chargement…'}
          testId="stat-accounts"
          onClick={() => openSection('sa-users')}
        />
        <StatCard
          label="Comptes actifs"
          value={live ? `${Math.round(((live.accounts - live.suspended) / Math.max(live.accounts, 1)) * 100)} %` : '…'}
          icon={ShieldCheck}
          hint={live ? (live.suspended > 0 ? `${live.suspended} compte(s) suspendu(s) — voir le journal` : 'Voir le journal des connexions') : 'Chargement…'}
          testId="stat-active-accounts"
          onClick={() => openSection('sa-logins')}
        />
      </div>

      <div ref={pharmaciesTableRef} className="bg-white rounded-xl border border-slate-200 overflow-x-auto mb-6 scroll-mt-4" data-testid="pharmacies-table">
        <table className="w-full text-sm min-w-[860px]">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.15em] text-slate-500">
              <th className="p-4">Pharmacie</th>
              <th className="p-4">Propriétaire</th>
              <th className="p-4">Ville</th>
              <th className="p-4 text-right">Comptes</th>
              <th className="p-4">Forfait</th>
              <th className="p-4">Accès</th>
              <th className="p-4">Statut</th>
              <th className="p-4 text-right">Actions</th>
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
                  <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${PLAN_STYLES[p.plan as PharmacyPlan] ?? PLAN_STYLES.Essentiel}`}>{p.plan}</span>
                </td>
                <td className="p-4">
                  {p.plan_status === 'trial' ? (
                    <div className="flex items-center gap-2">
                      <span
                        data-testid={`trial-badge-${p.id}`}
                        className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${trialDaysLeft(p) > 0 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-700'}`}
                      >
                        {trialDaysLeft(p) > 0 ? `Essai · ${trialDaysLeft(p)} j restants` : 'Essai expiré — bloqué'}
                      </span>
                      <Button
                        data-testid={`grant-full-access-${p.id}`}
                        size="sm" variant="outline"
                        className="rounded-full text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                        onClick={() => void grantFullAccess(p)}
                      >
                        Accès complet
                      </Button>
                    </div>
                  ) : (
                    <span data-testid={`full-access-badge-${p.id}`} className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                      Accès complet
                    </span>
                  )}
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
                <td className="p-4 text-right">
                  <Button
                    data-testid={`delete-pharmacy-${p.id}`}
                    size="sm" variant="outline"
                    className="rounded-full text-xs text-red-600 border-red-200 hover:bg-red-50"
                    onClick={() => { setDeleteTarget(p); setDeleteConfirmText(''); }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
            {pharmacies.length === 0 && (
              <tr><td colSpan={8} className="p-6 text-center text-sm text-slate-500">Aucune pharmacie cliente.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <CollapsibleSection id="sa-overview" title="Vue d'ensemble de la plateforme" icon={LayoutDashboard} defaultOpen className="mb-4">
        <SuperadminOverview pharmacies={pharmacies} />
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
              Chaque pharmacie possède son espace de données isolé. Un compte administrateur est créé en même temps — ses identifiants temporaires lui sont envoyés par courriel.
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
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-emerald-700">Compte administrateur (obligatoire)</p>
              <div className="space-y-2">
                <Label>Nom de l'administrateur</Label>
                <Input data-testid="pharmacy-admin-name-input" value={adminName} onChange={(e) => setAdminName(e.target.value)} placeholder="Prénom Nom" required />
              </div>
              <div className="space-y-2">
                <Label>Courriel de l'administrateur</Label>
                <Input data-testid="pharmacy-admin-email-input" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="admin@pharmacie.ca" required />
              </div>
            </div>
            <Button data-testid="pharmacy-submit-button" type="submit" className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              Créer la pharmacie et son compte admin
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!created} onOpenChange={(o) => !o && setCreated(null)}>
        <DialogContent data-testid="pharmacy-created-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Pharmacie « {created?.pharmacyName} » créée</DialogTitle>
            <DialogDescription>Identifiants temporaires du compte administrateur.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 space-y-1 text-sm">
              <p><span className="text-slate-500">Courriel :</span> <span className="font-semibold text-slate-800" data-testid="created-admin-email">{created?.email}</span></p>
              <p><span className="text-slate-500">Mot de passe temporaire :</span> <span className="font-mono font-semibold text-slate-800" data-testid="created-admin-password">{created?.tempPassword}</span></p>
            </div>
            {created?.emailSent ? (
              <p className="text-sm text-emerald-700 flex items-center gap-2" data-testid="credentials-email-sent">
                <Mail className="w-4 h-4" /> Identifiants envoyés automatiquement par courriel à {created.email}.
              </p>
            ) : (
              <p className="text-sm text-amber-700 flex items-center gap-2" data-testid="credentials-email-failed">
                <AlertTriangle className="w-4 h-4" /> L'envoi du courriel a échoué — transmettez ces identifiants manuellement.
              </p>
            )}
            <p className="text-xs text-slate-500">L'administrateur devra choisir un nouveau mot de passe à sa première connexion.</p>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) { setDeleteTarget(null); setDeleteConfirmText(''); } }}>
        <DialogContent data-testid="delete-pharmacy-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading flex items-center gap-2 text-red-700">
              <AlertTriangle className="w-5 h-5" /> Supprimer définitivement « {deleteTarget?.name} » ?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p className="font-semibold text-slate-800">Cette action supprimera de façon irréversible :</p>
            <ul className="list-disc pl-5 text-slate-600 space-y-1">
              <li>{deleteTarget?.accounts_count ?? 0} compte(s) utilisateur (connexion immédiatement impossible)</li>
              <li>Toutes les données RH : employés, horaires, punchs, congés, paie, documents, formations…</li>
            </ul>
          </div>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Pour confirmer, tapez le nom exact de la pharmacie : <span className="font-mono font-semibold">{deleteTarget?.name}</span></Label>
              <Input
                data-testid="delete-pharmacy-confirm-input"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={deleteTarget?.name}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" className="rounded-full" onClick={() => { setDeleteTarget(null); setDeleteConfirmText(''); }} data-testid="delete-pharmacy-cancel">
                Annuler
              </Button>
              <Button
                data-testid="delete-pharmacy-confirm"
                disabled={deleting || deleteConfirmText.trim() !== (deleteTarget?.name ?? '')}
                onClick={() => void confirmDelete()}
                className="rounded-full bg-red-600 hover:bg-red-700 text-white"
              >
                {deleting ? 'Suppression…' : 'Supprimer définitivement'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
