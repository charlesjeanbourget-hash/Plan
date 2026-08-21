import { useState, useEffect, useCallback, FormEvent } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { ManagedUser, Role } from '@/types';
import type { ServerPharmacy } from '@/components/modules/SuperadminModule';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { UserPlus, KeyRound, Trash2, Copy, LifeBuoy, Settings2 } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const ROLE_LABELS: Record<Role, string> = {
  superadmin: 'Superadmin',
  admin: 'Admin (propriétaire)',
  manager: 'Gestionnaire',
  employee: 'Employé(e)',
};

const ROLE_STYLES: Record<Role, string> = {
  superadmin: 'bg-violet-100 text-violet-800',
  admin: 'bg-emerald-100 text-emerald-800',
  manager: 'bg-bronze-100 text-bronze-800',
  employee: 'bg-slate-100 text-slate-700',
};

const apiError = (err: unknown): string => {
  if (axios.isAxiosError(err) && err.response) {
    const detail = (err.response.data as { detail?: unknown }).detail;
    if (typeof detail === 'string') return detail;
  }
  return 'Une erreur est survenue.';
};

export const SuperadminUsers = ({ pharmacies }: { pharmacies: ServerPharmacy[] }): JSX.Element => {
  const { currentUser, token } = useAuth();
  const headers = { Authorization: `Bearer ${token ?? ''}` };

  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('admin');
  const [pharmacyId, setPharmacyId] = useState('');
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ManagedUser | null>(null);
  const [manageTarget, setManageTarget] = useState<ManagedUser | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState<Role>('admin');
  const [editPharmacy, setEditPharmacy] = useState('');
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await axios.get<ManagedUser[]>(`${API}/admin/users`, { headers });
      setUsers(res.data);
    } catch {
      toast.error('Impossible de charger les comptes.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pharmacyName = (id: string | null): string =>
    pharmacies.find((p) => p.id === id)?.name ?? '—';

  const assignPharmacy = async (user: ManagedUser, pid: string): Promise<void> => {
    try {
      await axios.put(`${API}/admin/users/${user.id}`, { pharmacy_id: pid }, { headers });
      toast.success(`${user.email} rattaché(e) à « ${pharmacyName(pid)} ».`);
      await refresh();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const openManage = (u: ManagedUser): void => {
    setManageTarget(u);
    setEditName(u.name);
    setEditEmail(u.email);
    setEditRole(u.role);
    setEditPharmacy(u.pharmacy_id ?? '');
  };

  const saveAccount = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!manageTarget) return;
    if (editRole !== 'superadmin' && !editPharmacy) {
      toast.error('Une pharmacie doit être assignée à ce compte (isolation des données).');
      return;
    }
    setSaving(true);
    try {
      await axios.put(`${API}/admin/users/${manageTarget.id}`, {
        name: editName,
        email: editEmail,
        role: editRole,
        pharmacy_id: editRole === 'superadmin' ? null : editPharmacy,
      }, { headers });
      toast.success('Compte mis à jour.');
      setManageTarget(null);
      await refresh();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const createUser = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (role !== 'superadmin' && !pharmacyId) {
      toast.error('Une pharmacie doit être assignée à ce compte (isolation des données).');
      return;
    }
    try {
      const res = await axios.post<{ user: ManagedUser; temporary_password: string }>(
        `${API}/admin/users`,
        { email, name, role, pharmacy_id: role === 'superadmin' ? null : pharmacyId },
        { headers }
      );
      setCreateOpen(false);
      setCredentials({ email: res.data.user.email, password: res.data.temporary_password });
      setEmail(''); setName('');
      await refresh();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const toggleSuspend = async (user: ManagedUser, suspended: boolean): Promise<void> => {
    try {
      await axios.put(`${API}/admin/users/${user.id}`, { suspended }, { headers });
      toast.success(suspended ? `Compte ${user.email} suspendu.` : `Compte ${user.email} réactivé.`);
      await refresh();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const resetPassword = async (user: ManagedUser): Promise<void> => {
    try {
      const res = await axios.post<{ temporary_password: string; email: string }>(
        `${API}/admin/users/${user.id}/reset-password`, {}, { headers }
      );
      setCredentials({ email: res.data.email, password: res.data.temporary_password });
      await refresh();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const deleteUser = async (): Promise<void> => {
    if (!deleteTarget) return;
    try {
      await axios.delete(`${API}/admin/users/${deleteTarget.id}`, { headers });
      toast.success(`Compte ${deleteTarget.email} supprimé.`);
      setDeleteTarget(null);
      await refresh();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const copyCredentials = (): void => {
    if (!credentials) return;
    void navigator.clipboard.writeText(`Courriel : ${credentials.email}\nMot de passe temporaire : ${credentials.password}`);
    toast.success('Identifiants copiés dans le presse-papiers.');
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-7 mb-10" data-testid="superadmin-users-panel">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
        <h2 className="font-heading text-base font-bold text-slate-900 inline-flex items-center gap-2">
          <LifeBuoy className="w-4 h-4 text-emerald-600" /> Comptes & support à distance
        </h2>
        <Button data-testid="create-user-button" size="sm" onClick={() => setCreateOpen(true)} className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs">
          <UserPlus className="w-3.5 h-3.5 mr-1" /> Nouveau compte
        </Button>
      </div>
      <p className="text-xs text-slate-500 mb-5">
        Créez, suspendez ou supprimez des comptes et réinitialisez les mots de passe pour dépanner les admins à distance. Chaque action est journalisée.
      </p>
      {/* Cartes mobiles */}
      <div className="sm:hidden space-y-3" data-testid="users-mobile-list">
        {users.map((u) => (
          <div key={u.id} data-testid={`user-card-${u.email}`} className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="min-w-0">
                <p className="font-semibold text-slate-800 truncate">{u.name}</p>
                <p className="text-xs text-slate-500 truncate">{u.email}</p>
              </div>
              <span className={`shrink-0 inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${ROLE_STYLES[u.role]}`}>
                {ROLE_LABELS[u.role]}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-slate-500 mb-3">
              <span className="truncate">{u.role === 'superadmin' ? 'Plateforme' : pharmacyName(u.pharmacy_id)}</span>
              <span className={u.suspended ? 'text-red-600 font-semibold' : 'text-emerald-700'}>
                {u.suspended ? 'Suspendu' : 'Actif'}
              </span>
            </div>
            <Button
              data-testid={`manage-user-mobile-${u.email}`}
              size="sm" variant="outline" className="w-full rounded-full text-xs"
              onClick={() => openManage(u)}
            >
              <Settings2 className="w-3.5 h-3.5 mr-1" /> Gérer le compte
            </Button>
          </div>
        ))}
      </div>

      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.15em] text-slate-500">
              <th className="p-3">Compte</th>
              <th className="p-3">Rôle</th>
              <th className="p-3">Pharmacie</th>
              <th className="p-3">Mot de passe</th>
              <th className="p-3">Statut</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} data-testid={`user-row-${u.email}`} className="border-b border-slate-100 last:border-0">
                <td className="p-3">
                  <p className="font-semibold text-slate-800">{u.name}</p>
                  <p className="text-xs text-slate-500">{u.email}</p>
                </td>
                <td className="p-3">
                  <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${ROLE_STYLES[u.role]}`}>
                    {ROLE_LABELS[u.role]}
                  </span>
                </td>
                <td className="p-3">
                  {u.role === 'superadmin' ? (
                    <span className="text-slate-600 text-xs">Plateforme</span>
                  ) : (
                    <Select value={u.pharmacy_id ?? ''} onValueChange={(v) => void assignPharmacy(u, v)}>
                      <SelectTrigger data-testid={`assign-pharmacy-${u.email}`} className="h-8 w-44 text-xs">
                        <SelectValue placeholder="⚠ Aucune — assigner" />
                      </SelectTrigger>
                      <SelectContent>
                        {pharmacies.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </td>
                <td className="p-3">
                  {u.is_temporary_password ? (
                    <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">Temporaire</span>
                  ) : (
                    <span className="text-xs text-slate-400">Personnel</span>
                  )}
                </td>
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <Switch
                      data-testid={`suspend-toggle-${u.email}`}
                      checked={!u.suspended}
                      disabled={u.id === currentUser?.id}
                      onCheckedChange={(checked) => void toggleSuspend(u, !checked)}
                    />
                    <span className={`text-xs ${u.suspended ? 'text-red-600 font-semibold' : 'text-slate-500'}`}>
                      {u.suspended ? 'Suspendu' : 'Actif'}
                    </span>
                  </div>
                </td>
                <td className="p-3 text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      data-testid={`manage-user-${u.email}`}
                      size="sm" variant="outline" className="rounded-full text-xs"
                      onClick={() => openManage(u)}
                    >
                      <Settings2 className="w-3.5 h-3.5 mr-1" /> Gérer
                    </Button>
                    <Button
                      data-testid={`reset-password-${u.email}`}
                      size="sm" variant="outline" className="rounded-full text-xs"
                      onClick={() => void resetPassword(u)}
                    >
                      <KeyRound className="w-3.5 h-3.5 mr-1" /> Réinitialiser
                    </Button>
                    <Button
                      data-testid={`delete-user-${u.email}`}
                      size="sm" variant="outline"
                      disabled={u.id === currentUser?.id}
                      className="rounded-full text-xs text-red-600 border-red-200 hover:bg-red-50"
                      onClick={() => setDeleteTarget(u)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent data-testid="create-user-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Nouveau compte</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => void createUser(e)} className="space-y-4">
            <div className="space-y-2">
              <Label>Nom complet</Label>
              <Input data-testid="user-name-input" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Courriel</Label>
              <Input data-testid="user-email-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Rôle</Label>
                <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                  <SelectTrigger data-testid="user-role-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin (propriétaire)</SelectItem>
                    <SelectItem value="manager">Gestionnaire</SelectItem>
                    <SelectItem value="employee">Employé(e)</SelectItem>
                    <SelectItem value="superadmin">Superadmin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {role !== 'superadmin' && (
                <div className="space-y-2">
                  <Label>Pharmacie <span className="text-red-500">*</span></Label>
                  <Select value={pharmacyId} onValueChange={setPharmacyId}>
                    <SelectTrigger data-testid="user-pharmacy-select"><SelectValue placeholder="Choisir (obligatoire)" /></SelectTrigger>
                    <SelectContent>
                      {pharmacies.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <p className="text-xs text-slate-500">Un mot de passe temporaire sera généré automatiquement et affiché une seule fois.</p>
            <Button data-testid="user-submit-button" type="submit" className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              Créer le compte
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={credentials !== null} onOpenChange={(o) => !o && setCredentials(null)}>
        <DialogContent data-testid="credentials-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Identifiants temporaires</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600">
            Transmettez ces identifiants de façon sécurisée. Le mot de passe est <strong>temporaire</strong> — l'utilisateur devra le changer via le bouton « Mot de passe » de la sidebar.
          </p>
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 space-y-1 font-mono text-sm">
            <p className="text-slate-700">{credentials?.email}</p>
            <p data-testid="temp-password-value" className="text-emerald-700 font-bold">{credentials?.password}</p>
          </div>
          <Button data-testid="copy-credentials-button" onClick={copyCredentials} variant="outline" className="rounded-full">
            <Copy className="w-4 h-4 mr-1" /> Copier les identifiants
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={manageTarget !== null} onOpenChange={(o) => !o && setManageTarget(null)}>
        <DialogContent data-testid="manage-user-dialog" className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading">Gérer le compte</DialogTitle>
          </DialogHeader>
          {manageTarget && (
            <div className="space-y-5">
              <form onSubmit={(e) => void saveAccount(e)} className="space-y-4">
                <div className="space-y-2">
                  <Label>Nom complet</Label>
                  <Input data-testid="edit-user-name-input" value={editName} onChange={(e) => setEditName(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label>Courriel</Label>
                  <Input data-testid="edit-user-email-input" type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} required />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Rôle</Label>
                    <Select value={editRole} onValueChange={(v) => setEditRole(v as Role)} disabled={manageTarget.id === currentUser?.id}>
                      <SelectTrigger data-testid="edit-user-role-select"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Admin (propriétaire)</SelectItem>
                        <SelectItem value="manager">Gestionnaire</SelectItem>
                        <SelectItem value="employee">Employé(e)</SelectItem>
                        <SelectItem value="superadmin">Superadmin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {editRole !== 'superadmin' && (
                    <div className="space-y-2">
                      <Label>Pharmacie <span className="text-red-500">*</span></Label>
                      <Select value={editPharmacy} onValueChange={setEditPharmacy}>
                        <SelectTrigger data-testid="edit-user-pharmacy-select"><SelectValue placeholder="Choisir" /></SelectTrigger>
                        <SelectContent>
                          {pharmacies.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
                <Button data-testid="save-user-button" type="submit" disabled={saving} className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
                  {saving ? 'Enregistrement…' : 'Enregistrer les modifications'}
                </Button>
              </form>

              <div className="border-t border-slate-200 pt-4 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Support à distance</p>
                <Button
                  data-testid="manage-reset-password-button"
                  variant="outline" className="w-full rounded-full text-sm"
                  onClick={() => { void resetPassword(manageTarget); setManageTarget(null); }}
                >
                  <KeyRound className="w-4 h-4 mr-1.5" /> Réinitialiser le mot de passe
                </Button>
                <div className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{manageTarget.suspended ? 'Compte suspendu' : 'Compte actif'}</p>
                    <p className="text-xs text-slate-500">La suspension bloque immédiatement la connexion.</p>
                  </div>
                  <Switch
                    data-testid="manage-suspend-toggle"
                    checked={!manageTarget.suspended}
                    disabled={manageTarget.id === currentUser?.id}
                    onCheckedChange={(checked) => {
                      void toggleSuspend(manageTarget, !checked);
                      setManageTarget({ ...manageTarget, suspended: !checked });
                    }}
                  />
                </div>
                <Button
                  data-testid="manage-delete-button"
                  variant="outline"
                  disabled={manageTarget.id === currentUser?.id}
                  className="w-full rounded-full text-sm text-red-600 border-red-200 hover:bg-red-50"
                  onClick={() => { setDeleteTarget(manageTarget); setManageTarget(null); }}
                >
                  <Trash2 className="w-4 h-4 mr-1.5" /> Supprimer ce compte
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent data-testid="delete-user-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading text-red-600">Supprimer le compte</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600">
            Supprimer définitivement le compte de <strong>{deleteTarget?.name}</strong> ({deleteTarget?.email}) ? Cette action est irréversible et sera journalisée.
          </p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" className="rounded-full" onClick={() => setDeleteTarget(null)}>Annuler</Button>
            <Button data-testid="confirm-delete-user-button" onClick={() => void deleteUser()} className="rounded-full bg-red-600 hover:bg-red-700 text-white">
              Supprimer définitivement
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
