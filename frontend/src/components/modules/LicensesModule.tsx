import { useState, useEffect, useCallback, FormEvent, ChangeEvent } from 'react';
import axios from 'axios';
import { useHR } from '@/context/HRContext';
import { useAuth } from '@/context/AuthContext';
import { Employee, License, LicenseReportItem, AuditLog, ReportSettings } from '@/types';
import { ModuleHeader, StatusBadge } from '@/components/modules/shared';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { ShieldCheck, FileUp, Eye, Trash2, Mail, Send, ScrollText } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const licenseStatus = (lic: License | undefined): string => {
  if (!lic) return 'Aucune licence';
  const days = Math.floor((new Date(lic.expiry_date).getTime() - Date.now()) / 86400000);
  if (days < 0) return 'Expirée';
  if (days <= 60) return 'Expire bientôt';
  return 'Valide';
};

const STATUS_STYLE: Record<string, string> = {
  'Valide': 'bg-emerald-100 text-emerald-800',
  'Expire bientôt': 'bg-amber-100 text-amber-800',
  'Expirée': 'bg-red-100 text-red-800',
  'Aucune licence': 'bg-slate-100 text-slate-500',
};

export default function LicensesModule(): JSX.Element {
  const { state, deleteEmployee } = useHR();
  const { currentUser, token } = useAuth();
  const isSuperadmin = currentUser?.role === 'superadmin';
  const pharmacyId = currentUser?.pharmacyId ?? (isSuperadmin ? 'ph1' : '');
  const pharmacy = state.pharmacies.find((p) => p.id === pharmacyId);

  const headers = { Authorization: `Bearer ${token ?? ''}` };

  const [licenses, setLicenses] = useState<License[]>([]);
  const [reportItems, setReportItems] = useState<LicenseReportItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [settings, setSettings] = useState<ReportSettings>({ pharmacy_id: pharmacyId, pharmacy_name: '', admin_email: '', enabled: false });
  const [branchFilter, setBranchFilter] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Employee | null>(null);
  const [licenseNumber, setLicenseNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [eraseTarget, setEraseTarget] = useState<Employee | null>(null);
  const [eraseAlsoLocal, setEraseAlsoLocal] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const params = isSuperadmin && pharmacyId ? { pharmacy_id: pharmacyId } : {};
      const [licRes, repRes, setRes] = await Promise.all([
        axios.get<License[]>(`${API}/licenses`, { headers, params }),
        axios.get<{ items: LicenseReportItem[] }>(`${API}/licenses/report`, { headers, params }),
        axios.get<ReportSettings>(`${API}/report-settings`, { headers, params }),
      ]);
      setLicenses(licRes.data);
      setReportItems(repRes.data.items);
      setSettings({ ...setRes.data, pharmacy_id: setRes.data.pharmacy_id || pharmacyId });
      if (isSuperadmin) {
        const auditRes = await axios.get<AuditLog[]>(`${API}/audit-logs`, { headers });
        setAuditLogs(auditRes.data);
      }
    } catch {
      toast.error('Impossible de charger les licences.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (currentUser?.role === 'employee') {
    return (
      <div data-testid="licenses-access-denied" className="bg-white rounded-xl border border-slate-200 p-12 text-center">
        <ShieldCheck className="w-10 h-10 text-slate-300 mx-auto mb-4" />
        <p className="text-slate-600 font-semibold">Accès réservé aux administrateurs (Loi 25).</p>
      </div>
    );
  }

  const visibleEmployees = state.employees.filter((e) => branchFilter === 'all' || e.branchId === branchFilter);
  const licenseFor = (empId: string): License | undefined => licenses.find((l) => l.employee_id === empId);

  const openDialog = (emp: Employee): void => {
    const lic = licenseFor(emp.id);
    setEditTarget(emp);
    setLicenseNumber(lic?.license_number ?? '');
    setExpiryDate(lic?.expiry_date ?? '');
    setFile(null);
    setDialogOpen(true);
  };

  const submitLicense = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!editTarget) return;
    setSaving(true);
    try {
      const existing = licenseFor(editTarget.id);
      const form = new FormData();
      form.append('license_number', licenseNumber);
      form.append('expiry_date', expiryDate);
      form.append('branch_id', editTarget.branchId);
      if (file) form.append('file', file);
      if (existing) {
        await axios.put(`${API}/licenses/${existing.id}`, form, { headers });
        toast.success('Licence mise à jour.');
      } else {
        form.append('employee_id', editTarget.id);
        form.append('employee_name', `${editTarget.firstName} ${editTarget.lastName}`);
        form.append('position', editTarget.position);
        form.append('pharmacy_id', pharmacyId);
        await axios.post(`${API}/licenses`, form, { headers });
        toast.success('Licence enregistrée de façon sécurisée.');
      }
      setDialogOpen(false);
      await refresh();
    } catch (err) {
      const detail = axios.isAxiosError(err) ? (err.response?.data as { detail?: string })?.detail : undefined;
      toast.error(detail ?? "Erreur lors de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  };

  const viewCertificate = async (lic: License): Promise<void> => {
    try {
      const res = await axios.get(`${API}/licenses/${lic.id}/certificate`, { headers, responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      toast.error('Impossible de consulter le certificat.');
    }
  };

  const confirmErase = async (): Promise<void> => {
    if (!eraseTarget) return;
    try {
      const res = await axios.delete<{ deleted: number }>(`${API}/licenses/employee/${eraseTarget.id}`, { headers });
      if (eraseAlsoLocal) deleteEmployee(eraseTarget.id);
      toast.success(`Droit à l'oubli appliqué : ${res.data.deleted} document(s) détruit(s) définitivement.`);
      setEraseTarget(null);
      await refresh();
    } catch {
      toast.error('Échec de la destruction des données.');
    }
  };

  const saveSettings = async (): Promise<void> => {
    try {
      await axios.post(`${API}/report-settings`, {
        pharmacy_id: pharmacyId,
        pharmacy_name: pharmacy?.name ?? '',
        admin_email: settings.admin_email,
        enabled: settings.enabled,
      }, { headers });
      toast.success('Paramètres du rapport mensuel enregistrés.');
    } catch {
      toast.error("Impossible d'enregistrer les paramètres.");
    }
  };

  const sendNow = async (): Promise<void> => {
    setSending(true);
    try {
      const res = await axios.post<{ recipient: string }>(`${API}/licenses/report/send`, { pharmacy_id: pharmacyId }, { headers });
      toast.success(`Rapport envoyé à ${res.data.recipient}.`);
    } catch (err) {
      const detail = axios.isAxiosError(err) ? (err.response?.data as { detail?: string })?.detail : undefined;
      toast.error(detail ?? "Échec de l'envoi du rapport.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div data-testid="licenses-module">
      <ModuleHeader
        title="Licences professionnelles"
        subtitle="Gestion sécurisée et conforme à la Loi 25 — accès réservé aux administrateurs, chaque consultation est journalisée."
      />

      <div className="flex items-center gap-3 mb-6">
        <Select value={branchFilter} onValueChange={setBranchFilter}>
          <SelectTrigger data-testid="license-branch-filter" className="w-64">
            <SelectValue placeholder="Toutes les succursales" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes les succursales</SelectItem>
            {state.branches.map((b) => (
              <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 font-semibold bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1">
          <ShieldCheck className="w-3.5 h-3.5" /> Stockage chiffré · Audit actif
        </span>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto mb-10">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.15em] text-slate-500">
              <th className="p-4">Employé</th>
              <th className="p-4">Succursale</th>
              <th className="p-4">No de licence</th>
              <th className="p-4">Expiration</th>
              <th className="p-4">Statut</th>
              <th className="p-4">Certificat</th>
              <th className="p-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleEmployees.map((emp) => {
              const lic = licenseFor(emp.id);
              const status = licenseStatus(lic);
              const branch = state.branches.find((b) => b.id === emp.branchId);
              return (
                <tr key={emp.id} data-testid={`license-row-${emp.id}`} className="border-b border-slate-100 last:border-0">
                  <td className="p-4">
                    <p className="font-semibold text-slate-800">{emp.firstName} {emp.lastName}</p>
                    <p className="text-xs text-slate-500">{emp.position}</p>
                  </td>
                  <td className="p-4 text-slate-600">{branch?.name ?? '—'}</td>
                  <td className="p-4 font-mono text-slate-700">{lic?.license_number ?? '—'}</td>
                  <td className="p-4 text-slate-600">{lic?.expiry_date ?? '—'}</td>
                  <td className="p-4">
                    <span data-testid={`license-status-${emp.id}`} className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_STYLE[status]}`}>
                      {status}
                    </span>
                  </td>
                  <td className="p-4">
                    {lic?.certificate_filename ? (
                      <button
                        data-testid={`view-certificate-${emp.id}`}
                        onClick={() => void viewCertificate(lic)}
                        className="inline-flex items-center gap-1.5 text-emerald-700 text-xs font-semibold hover:underline"
                      >
                        <Eye className="w-3.5 h-3.5" /> Consulter
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400">Aucun document</span>
                    )}
                  </td>
                  <td className="p-4 text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        data-testid={`edit-license-${emp.id}`}
                        size="sm"
                        variant="outline"
                        className="rounded-full text-xs"
                        onClick={() => openDialog(emp)}
                      >
                        <FileUp className="w-3.5 h-3.5 mr-1" /> {lic ? 'Modifier' : 'Ajouter'}
                      </Button>
                      <Button
                        data-testid={`erase-employee-${emp.id}`}
                        size="sm"
                        variant="outline"
                        className="rounded-full text-xs text-red-600 border-red-200 hover:bg-red-50"
                        onClick={() => { setEraseTarget(emp); setEraseAlsoLocal(true); }}
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1" /> Droit à l'oubli
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
        <div className="bg-white rounded-xl border border-slate-200 p-7" data-testid="license-report-panel">
          <h2 className="font-heading text-base font-bold text-slate-900 mb-1">Échéances à 60 jours</h2>
          <p className="text-xs text-slate-500 mb-5">Contenu du rapport mensuel automatique.</p>
          {reportItems.length === 0 ? (
            <p className="text-sm text-slate-500">Aucune licence n'arrive à échéance. Tout est en règle.</p>
          ) : (
            <div className="space-y-2.5">
              {reportItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{item.employee_name}</p>
                    <p className="text-xs text-slate-500 font-mono">{item.license_number} · exp. {item.expiry_date}</p>
                  </div>
                  <span className={`text-xs font-bold ${item.days_remaining < 0 ? 'text-red-600' : 'text-amber-600'}`}>
                    {item.days_remaining < 0 ? 'Expirée' : `${item.days_remaining} jours`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-7" data-testid="report-settings-panel">
          <h2 className="font-heading text-base font-bold text-slate-900 mb-1">Rapport mensuel automatique</h2>
          <p className="text-xs text-slate-500 mb-5">Envoyé par courriel le 1er de chaque mois à 8 h (heure de Montréal).</p>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Courriel destinataire</Label>
              <Input
                data-testid="report-email-input"
                type="email"
                value={settings.admin_email}
                onChange={(e) => setSettings({ ...settings, admin_email: e.target.value })}
                placeholder="proprietaire@pharmacie.ca"
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Switch
                  data-testid="report-enabled-switch"
                  checked={settings.enabled}
                  onCheckedChange={(checked) => setSettings({ ...settings, enabled: checked })}
                />
                <span className="text-sm text-slate-600">Envoi automatique {settings.enabled ? 'activé' : 'désactivé'}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button data-testid="save-report-settings-button" onClick={() => void saveSettings()} className="rounded-full bg-emerald-600 hover:bg-emerald-700">
                <Mail className="w-4 h-4 mr-1" /> Enregistrer
              </Button>
              <Button data-testid="send-report-now-button" variant="outline" className="rounded-full" disabled={sending} onClick={() => void sendNow()}>
                <Send className="w-4 h-4 mr-1" /> {sending ? 'Envoi…' : 'Envoyer maintenant'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {isSuperadmin && (
        <div className="bg-white rounded-xl border border-slate-200 p-7" data-testid="audit-trail-panel">
          <div className="flex items-center gap-2 mb-5">
            <ScrollText className="w-4 h-4 text-emerald-600" />
            <h2 className="font-heading text-base font-bold text-slate-900">Journal d'audit (Loi 25)</h2>
            <span className="text-xs text-slate-400">— visible uniquement par le superadmin</span>
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-xs min-w-[800px]">
              <thead>
                <tr className="border-b border-slate-200 text-left uppercase tracking-[0.15em] text-slate-500">
                  <th className="p-3">Date (UTC)</th>
                  <th className="p-3">Acteur</th>
                  <th className="p-3">Action</th>
                  <th className="p-3">Détails</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((log) => (
                  <tr key={log.id} className="border-b border-slate-100 last:border-0">
                    <td className="p-3 text-slate-500 whitespace-nowrap">{log.created_at.slice(0, 19).replace('T', ' ')}</td>
                    <td className="p-3 text-slate-700">{log.actor_email}</td>
                    <td className="p-3"><StatusBadge status={log.action} /></td>
                    <td className="p-3 text-slate-600">{log.details}</td>
                  </tr>
                ))}
                {auditLogs.length === 0 && (
                  <tr><td colSpan={4} className="p-6 text-center text-slate-400">Aucune entrée d'audit.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="license-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">
              Licence — {editTarget?.firstName} {editTarget?.lastName}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => void submitLicense(e)} className="space-y-4">
            <div className="space-y-2">
              <Label>Numéro de licence</Label>
              <Input data-testid="license-number-input" value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} placeholder="Ex. : OPQ-204581" required />
            </div>
            <div className="space-y-2">
              <Label>Date d'expiration</Label>
              <Input data-testid="license-expiry-input" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Certificat (PDF ou image, max 10 Mo)</Label>
              <Input
                data-testid="license-file-input"
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp"
                onChange={(e: ChangeEvent<HTMLInputElement>) => setFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-slate-400">Stocké de manière sécurisée dans le coffre-fort numérique — jamais accessible publiquement.</p>
            </div>
            <Button data-testid="license-submit-button" type="submit" disabled={saving} className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              {saving ? 'Enregistrement…' : 'Enregistrer la licence'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={eraseTarget !== null} onOpenChange={(o) => !o && setEraseTarget(null)}>
        <DialogContent data-testid="erase-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading text-red-600">Droit à l'oubli — destruction définitive</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600">
            Vous êtes sur le point de détruire <strong>définitivement</strong> toutes les licences et documents de{' '}
            <strong>{eraseTarget?.firstName} {eraseTarget?.lastName}</strong>, conformément aux obligations de destruction
            des données de la Loi 25. Cette action est irréversible et sera consignée au journal d'audit.
          </p>
          <label className="flex items-center gap-3 text-sm text-slate-700 cursor-pointer">
            <Checkbox
              data-testid="erase-local-checkbox"
              checked={eraseAlsoLocal}
              onCheckedChange={(c) => setEraseAlsoLocal(c === true)}
            />
            Retirer aussi l'employé des dossiers RH (départ de la pharmacie)
          </label>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" className="rounded-full" onClick={() => setEraseTarget(null)}>Annuler</Button>
            <Button data-testid="confirm-erase-button" onClick={() => void confirmErase()} className="rounded-full bg-red-600 hover:bg-red-700 text-white">
              Détruire définitivement
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
