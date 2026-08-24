import { useState, useEffect, FormEvent } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { OverviewPharmacy, OverviewAccount, EmailSettings } from '@/types';
import type { ServerPharmacy } from '@/components/modules/SuperadminModule';
import { StatCard } from '@/components/modules/shared';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Globe2, BadgeCheck, AlertTriangle, GraduationCap, Mail, CalendarClock, Fingerprint, TreePalm, MessagesSquare, UsersRound } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const fmtDateTime = (iso: string): string =>
  iso ? new Date(iso).toLocaleString('fr-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin', manager: 'Gestionnaire', employee: 'Employé(e)', superadmin: 'Superadmin',
};

interface MetricDef {
  label: string;
  description: string;
  value: (p: OverviewPharmacy) => number;
  format?: (v: number) => string;
  extra?: (p: OverviewPharmacy) => string;
}

const METRICS: Record<string, MetricDef> = {
  employees: {
    label: 'Comptes employés', description: 'Comptes employés actifs par pharmacie (accès à l\'application).',
    value: (p) => p.accounts.employees,
    extra: (p) => `${p.accounts.total} compte(s) au total · ${p.accounts.admins} admin(s)`,
  },
  licenses: {
    label: 'Licences suivies', description: 'Licences professionnelles suivies par pharmacie.',
    value: (p) => p.licenses.total,
  },
  alerts: {
    label: 'Alertes licences', description: 'Licences expirant sous 30 jours ou déjà expirées.',
    value: (p) => p.licenses.expiring_30 + p.licenses.expired,
    extra: (p) => `${p.licenses.expiring_30} ≤ 30 j · ${p.licenses.expired} expirée(s)`,
  },
  trainings: {
    label: 'Formations publiées', description: 'Formations publiées par pharmacie.',
    value: (p) => p.trainings.published,
    extra: (p) => `${p.trainings.total} au total`,
  },
  shifts: {
    label: 'Quarts à venir', description: 'Quarts planifiés à partir d\'aujourd\'hui.',
    value: (p) => p.activity?.shifts_upcoming ?? 0,
    extra: (p) => `${p.activity?.shifts_total ?? 0} quart(s) au total`,
  },
  punch: {
    label: 'Heures punchées (30 j)', description: 'Heures pointées dans les 30 derniers jours.',
    value: (p) => p.activity?.punch_hours_30d ?? 0,
    format: (v) => `${v.toLocaleString('fr-CA')} h`,
    extra: (p) => `${p.activity?.punches_30d ?? 0} punch(s)`,
  },
  leave: {
    label: 'Congés en attente', description: 'Demandes de congé à approuver par pharmacie.',
    value: (p) => p.activity?.leave_pending ?? 0,
  },
  messages: {
    label: 'Messages d\'équipe (30 j)', description: 'Messages échangés dans les 30 derniers jours.',
    value: (p) => p.activity?.messages_30d ?? 0,
  },
};

export const SuperadminOverview = ({ pharmacies: clientPharmacies }: { pharmacies: ServerPharmacy[] }): JSX.Element => {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token ?? ''}` };
  const [pharmacies, setPharmacies] = useState<OverviewPharmacy[]>([]);
  const [accounts, setAccounts] = useState<OverviewAccount[]>([]);
  const [senderEmail, setSenderEmail] = useState('');
  const [senderName, setSenderName] = useState('Arrière Plan');
  const [defaultSender, setDefaultSender] = useState('');
  const [detailMetric, setDetailMetric] = useState<string | null>(null);
  const [testEmail, setTestEmail] = useState('');
  const [sendingTest, setSendingTest] = useState(false);

  const sendTest = async (): Promise<void> => {
    setSendingTest(true);
    try {
      const res = await axios.post<{ sender: string; recipient: string }>(`${API}/superadmin/email-test`, { to: testEmail }, { headers });
      toast.success(`Courriel de test envoyé à ${res.data.recipient} (expéditeur : ${res.data.sender}).`);
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: string }).detail : null;
      toast.error(detail ?? 'Échec de l\'envoi du courriel de test.', { duration: 12000 });
    } finally {
      setSendingTest(false);
    }
  };

  useEffect(() => {
    axios.get<{ pharmacies: OverviewPharmacy[]; accounts?: OverviewAccount[] }>(`${API}/superadmin/overview`, { headers })
      .then((r) => {
        setPharmacies(r.data.pharmacies);
        setAccounts(r.data.accounts ?? []);
      })
      .catch(() => toast.error("Impossible de charger la vue d'ensemble."));
    axios.get<EmailSettings>(`${API}/email-settings`, { headers })
      .then((r) => {
        setSenderEmail(r.data.sender_email);
        setSenderName(r.data.sender_name || 'Arrière Plan');
        setDefaultSender(r.data.default_sender ?? '');
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pharmacyName = (id: string): string => clientPharmacies.find((p) => p.id === id)?.name ?? (id || '—');

  const totalEmployees = pharmacies.reduce((s, p) => s + p.accounts.employees, 0);
  const totalLicenses = pharmacies.reduce((s, p) => s + p.licenses.total, 0);
  const totalAlerts = pharmacies.reduce((s, p) => s + p.licenses.expiring_30 + p.licenses.expired, 0);
  const totalPublished = pharmacies.reduce((s, p) => s + p.trainings.published, 0);
  const totalUpcomingShifts = pharmacies.reduce((s, p) => s + (p.activity?.shifts_upcoming ?? 0), 0);
  const totalPunchHours = pharmacies.reduce((s, p) => s + (p.activity?.punch_hours_30d ?? 0), 0);
  const totalLeavePending = pharmacies.reduce((s, p) => s + (p.activity?.leave_pending ?? 0), 0);
  const totalMessages = pharmacies.reduce((s, p) => s + (p.activity?.messages_30d ?? 0), 0);

  const saveEmail = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    try {
      await axios.post(`${API}/email-settings`, { sender_email: senderEmail, sender_name: senderName }, { headers });
      toast.success('Adresse d\'expéditeur enregistrée.');
    } catch {
      toast.error("Impossible d'enregistrer l'expéditeur.");
    }
  };

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-4" data-testid="overview-stats">
        <StatCard label="Employés gérés" value={String(totalEmployees)} icon={UsersRound} hint="Détail par pharmacie" testId="stat-employees" onClick={() => setDetailMetric('employees')} />
        <StatCard label="Licences suivies" value={String(totalLicenses)} icon={BadgeCheck} hint="Détail par pharmacie" testId="stat-licenses" onClick={() => setDetailMetric('licenses')} />
        <StatCard label="Alertes licences" value={String(totalAlerts)} icon={AlertTriangle} hint="≤ 30 jours ou expirées — détail" testId="stat-alerts" onClick={() => setDetailMetric('alerts')} />
        <StatCard label="Formations publiées" value={String(totalPublished)} icon={GraduationCap} hint="Détail par pharmacie" testId="stat-trainings" onClick={() => setDetailMetric('trainings')} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-10" data-testid="overview-activity-stats">
        <StatCard label="Quarts à venir" value={String(totalUpcomingShifts)} icon={CalendarClock} hint="Détail par pharmacie" testId="stat-shifts" onClick={() => setDetailMetric('shifts')} />
        <StatCard label="Heures punchées" value={`${totalPunchHours.toLocaleString('fr-CA')} h`} icon={Fingerprint} hint="30 derniers jours — détail" testId="stat-punch" onClick={() => setDetailMetric('punch')} />
        <StatCard label="Congés en attente" value={String(totalLeavePending)} icon={TreePalm} hint="À approuver — détail" testId="stat-leave" onClick={() => setDetailMetric('leave')} />
        <StatCard label="Messages d'équipe" value={String(totalMessages)} icon={MessagesSquare} hint="30 derniers jours — détail" testId="stat-messages" onClick={() => setDetailMetric('messages')} />
      </div>

      <Dialog open={detailMetric !== null} onOpenChange={(o) => !o && setDetailMetric(null)}>
        <DialogContent data-testid="metric-detail-dialog" className="max-w-md max-h-[85vh] overflow-y-auto">
          {detailMetric && METRICS[detailMetric] && (
            <>
              <DialogHeader>
                <DialogTitle className="font-heading">{METRICS[detailMetric].label}</DialogTitle>
                <DialogDescription>{METRICS[detailMetric].description}</DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                {[...pharmacies]
                  .sort((a, b) => METRICS[detailMetric].value(b) - METRICS[detailMetric].value(a))
                  .map((p) => {
                    const def = METRICS[detailMetric];
                    const v = def.value(p);
                    return (
                      <div key={p.pharmacy_id} data-testid={`metric-row-${p.pharmacy_id}`} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">{pharmacyName(p.pharmacy_id)}</p>
                          {def.extra && <p className="text-xs text-slate-500 truncate">{def.extra(p)}</p>}
                        </div>
                        <span className={`shrink-0 font-heading text-lg font-extrabold ${v > 0 ? 'text-slate-900' : 'text-slate-300'}`}>
                          {def.format ? def.format(v) : v}
                        </span>
                      </div>
                    );
                  })}
                {pharmacies.length === 0 && (
                  <p className="text-sm text-slate-500 text-center py-4">Aucune donnée pour le moment.</p>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <div className="bg-white rounded-xl border border-slate-200 p-7 mb-10" data-testid="superadmin-overview-panel">
        <h2 className="font-heading text-base font-bold text-slate-900 inline-flex items-center gap-2 mb-5">
          <Globe2 className="w-4 h-4 text-emerald-600" /> Vue globale par pharmacie
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1250px]">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.15em] text-slate-500">
                <th className="p-3">Pharmacie</th>
                <th className="p-3 text-right">Comptes</th>
                <th className="p-3 text-right">Suspendus</th>
                <th className="p-3 text-right">Licences</th>
                <th className="p-3 text-right">Alertes</th>
                <th className="p-3 text-right">Formations</th>
                <th className="p-3 text-right">Quarts à venir</th>
                <th className="p-3 text-right">Punchs 30 j</th>
                <th className="p-3 text-right">Congés att.</th>
                <th className="p-3 text-right">Messages 30 j</th>
                <th className="p-3">Dernière activité</th>
                <th className="p-3">Rapport</th>
              </tr>
            </thead>
            <tbody>
              {pharmacies.map((p) => (
                <tr key={p.pharmacy_id} data-testid={`overview-row-${p.pharmacy_id}`} className="border-b border-slate-100 last:border-0">
                  <td className="p-3 font-semibold text-slate-800">{pharmacyName(p.pharmacy_id)}</td>
                  <td className="p-3 text-right text-slate-600">
                    {p.accounts.total}
                    <span className="text-xs text-slate-400 ml-1">({p.accounts.admins} adm. / {p.accounts.employees} emp.)</span>
                  </td>
                  <td className="p-3 text-right">
                    {p.accounts.suspended > 0 ? (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800">{p.accounts.suspended}</span>
                    ) : (
                      <span className="text-slate-400">0</span>
                    )}
                  </td>
                  <td className="p-3 text-right text-slate-600">{p.licenses.total}</td>
                  <td className="p-3 text-right">
                    {(p.licenses.expiring_30 + p.licenses.expired) > 0 ? (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">{p.licenses.expiring_30 + p.licenses.expired}</span>
                    ) : (
                      <span className="text-slate-400">0</span>
                    )}
                  </td>
                  <td className="p-3 text-right text-slate-600">{p.trainings.published}/{p.trainings.total}</td>
                  <td className="p-3 text-right text-slate-600" data-testid={`overview-shifts-${p.pharmacy_id}`}>
                    {p.activity?.shifts_upcoming ?? 0}
                    <span className="text-xs text-slate-400 ml-1">/ {p.activity?.shifts_total ?? 0}</span>
                  </td>
                  <td className="p-3 text-right text-slate-600" data-testid={`overview-punches-${p.pharmacy_id}`}>
                    {p.activity?.punches_30d ?? 0}
                    <span className="text-xs text-slate-400 ml-1">({(p.activity?.punch_hours_30d ?? 0).toLocaleString('fr-CA')} h)</span>
                  </td>
                  <td className="p-3 text-right">
                    {(p.activity?.leave_pending ?? 0) > 0 ? (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-sky-100 text-sky-800">{p.activity?.leave_pending}</span>
                    ) : (
                      <span className="text-slate-400">0</span>
                    )}
                  </td>
                  <td className="p-3 text-right text-slate-600">{p.activity?.messages_30d ?? 0}</td>
                  <td className="p-3 text-xs text-slate-500 whitespace-nowrap">{fmtDateTime(p.activity?.last_activity ?? '')}</td>
                  <td className="p-3">
                    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${p.report_enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                      {p.report_enabled ? 'Activé' : 'Désactivé'}
                    </span>
                  </td>
                </tr>
              ))}
              {pharmacies.length === 0 && (
                <tr><td colSpan={12} className="p-6 text-center text-slate-500">Aucune donnée pour le moment.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-slate-400 mt-3">
          Autres indicateurs par pharmacie disponibles via l'API : quarts ouverts, évaluations, livraisons, tâches de quart, avantages publiés et événements d'audit (30 j).
        </p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-7 mb-10" data-testid="accounts-detail-panel">
        <h2 className="font-heading text-base font-bold text-slate-900 inline-flex items-center gap-2 mb-1">
          <UsersRound className="w-4 h-4 text-emerald-600" /> Tous les comptes ({accounts.length})
        </h2>
        <p className="text-xs text-slate-500 mb-5">Activité de connexion et état de chaque compte, triés par connexion la plus récente.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]" data-testid="accounts-detail-table">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.15em] text-slate-500">
                <th className="p-3">Nom</th>
                <th className="p-3">Courriel</th>
                <th className="p-3">Rôle</th>
                <th className="p-3">Pharmacie</th>
                <th className="p-3">État</th>
                <th className="p-3 text-right">Connexions 30 j</th>
                <th className="p-3">Dernière connexion</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.email} data-testid={`account-row-${a.email}`} className="border-b border-slate-100 last:border-0">
                  <td className="p-3 font-semibold text-slate-800">{a.name || '—'}</td>
                  <td className="p-3 text-slate-600">{a.email}</td>
                  <td className="p-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${a.role === 'superadmin' ? 'bg-violet-100 text-violet-800' : a.role === 'admin' ? 'bg-emerald-100 text-emerald-800' : a.role === 'manager' ? 'bg-bronze-100 text-bronze-800' : 'bg-slate-100 text-slate-600'}`}>
                      {ROLE_LABELS[a.role] ?? a.role}
                    </span>
                  </td>
                  <td className="p-3 text-slate-600">{a.role === 'superadmin' ? '—' : pharmacyName(a.pharmacy_id)}</td>
                  <td className="p-3">
                    {a.suspended ? (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800">Suspendu</span>
                    ) : a.is_temporary_password ? (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">Mdp temporaire</span>
                    ) : (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">Actif</span>
                    )}
                  </td>
                  <td className="p-3 text-right text-slate-600">{a.logins_30d}</td>
                  <td className="p-3 text-xs text-slate-500 whitespace-nowrap">{fmtDateTime(a.last_login)}</td>
                </tr>
              ))}
              {accounts.length === 0 && (
                <tr><td colSpan={7} className="p-6 text-center text-slate-500">Aucun compte pour le moment.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-7 mb-10" data-testid="email-settings-panel">
        <h2 className="font-heading text-base font-bold text-slate-900 inline-flex items-center gap-2 mb-2">
          <Mail className="w-4 h-4 text-emerald-600" /> Adresse d'expéditeur des courriels
        </h2>
        <p className="text-xs text-slate-500 mb-5">
          Utilisée pour les rapports mensuels et les rappels de licences. Pour envoyer à tous les employés, vérifiez d'abord
          votre domaine sur <a href="https://resend.com/domains" target="_blank" rel="noreferrer" className="text-emerald-700 underline">resend.com/domains</a>,
          puis entrez une adresse de ce domaine (ex. rh@mapharmacie.ca).
          {defaultSender && <> Expéditeur actuel par défaut : <span className="font-mono">{defaultSender}</span></>}
        </p>
        <form onSubmit={(e) => void saveEmail(e)} className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="space-y-2 flex-1">
            <Label>Nom d'expéditeur</Label>
            <Input data-testid="sender-name-input" value={senderName} onChange={(e) => setSenderName(e.target.value)} />
          </div>
          <div className="space-y-2 flex-1">
            <Label>Courriel d'expéditeur (domaine vérifié)</Label>
            <Input data-testid="sender-email-input" type="email" placeholder="rh@votredomaine.ca" value={senderEmail} onChange={(e) => setSenderEmail(e.target.value)} />
          </div>
          <Button data-testid="sender-save-button" type="submit" className="rounded-full bg-emerald-600 hover:bg-emerald-700">
            Enregistrer
          </Button>
        </form>
        {(!senderEmail || senderEmail.endsWith('resend.dev')) && (
          <div data-testid="resend-test-mode-warning" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-800">
            <b>Mode test Resend :</b> avec l'expéditeur par défaut ({defaultSender || 'onboarding@resend.dev'}), les courriels
            (réinitialisations de mot de passe, rapports, rappels) ne sont livrés qu'à l'adresse du propriétaire du compte Resend.
            Vérifiez votre domaine sur resend.com/domains puis enregistrez un expéditeur de ce domaine ci-dessus.
          </div>
        )}
        <div className="mt-5 pt-4 border-t border-slate-100 flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="space-y-2 flex-1">
            <Label>Tester l'envoi vers</Label>
            <Input data-testid="test-email-input" type="email" placeholder="votre@courriel.ca" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} />
          </div>
          <Button
            data-testid="send-test-email-button"
            type="button" variant="outline" disabled={sendingTest || !testEmail}
            className="rounded-full"
            onClick={() => void sendTest()}
          >
            {sendingTest ? 'Envoi…' : 'Envoyer un courriel de test'}
          </Button>
        </div>
      </div>
    </>
  );
};
