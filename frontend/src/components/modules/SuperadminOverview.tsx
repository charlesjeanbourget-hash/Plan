import { useState, useEffect, FormEvent } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { useHR } from '@/context/HRContext';
import { OverviewPharmacy, EmailSettings } from '@/types';
import { StatCard } from '@/components/modules/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Globe2, BadgeCheck, AlertTriangle, GraduationCap, Mail } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const SuperadminOverview = (): JSX.Element => {
  const { token } = useAuth();
  const { state } = useHR();
  const headers = { Authorization: `Bearer ${token ?? ''}` };
  const [pharmacies, setPharmacies] = useState<OverviewPharmacy[]>([]);
  const [senderEmail, setSenderEmail] = useState('');
  const [senderName, setSenderName] = useState('LuminaHR');
  const [defaultSender, setDefaultSender] = useState('');

  useEffect(() => {
    axios.get<{ pharmacies: OverviewPharmacy[] }>(`${API}/superadmin/overview`, { headers })
      .then((r) => setPharmacies(r.data.pharmacies))
      .catch(() => toast.error("Impossible de charger la vue d'ensemble."));
    axios.get<EmailSettings>(`${API}/email-settings`, { headers })
      .then((r) => {
        setSenderEmail(r.data.sender_email);
        setSenderName(r.data.sender_name || 'LuminaHR');
        setDefaultSender(r.data.default_sender ?? '');
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pharmacyName = (id: string): string => state.pharmacies.find((p) => p.id === id)?.name ?? id;

  const totalAccounts = pharmacies.reduce((s, p) => s + p.accounts.total, 0);
  const totalLicenses = pharmacies.reduce((s, p) => s + p.licenses.total, 0);
  const totalAlerts = pharmacies.reduce((s, p) => s + p.licenses.expiring_30 + p.licenses.expired, 0);
  const totalPublished = pharmacies.reduce((s, p) => s + p.trainings.published, 0);

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
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-10" data-testid="overview-stats">
        <StatCard label="Comptes clients" value={String(totalAccounts)} icon={Globe2} hint="Admins et employés" />
        <StatCard label="Licences suivies" value={String(totalLicenses)} icon={BadgeCheck} hint="Toutes pharmacies" />
        <StatCard label="Alertes licences" value={String(totalAlerts)} icon={AlertTriangle} hint="≤ 30 jours ou expirées" />
        <StatCard label="Formations publiées" value={String(totalPublished)} icon={GraduationCap} hint="Générées par IA" />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-7 mb-10" data-testid="superadmin-overview-panel">
        <h2 className="font-heading text-base font-bold text-slate-900 inline-flex items-center gap-2 mb-5">
          <Globe2 className="w-4 h-4 text-emerald-600" /> Vue globale par pharmacie
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.15em] text-slate-500">
                <th className="p-3">Pharmacie</th>
                <th className="p-3 text-right">Comptes</th>
                <th className="p-3 text-right">Suspendus</th>
                <th className="p-3 text-right">Licences</th>
                <th className="p-3 text-right">≤ 30 j</th>
                <th className="p-3 text-right">Expirées</th>
                <th className="p-3 text-right">Formations</th>
                <th className="p-3">Rapport mensuel</th>
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
                    {p.licenses.expiring_30 > 0 ? (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">{p.licenses.expiring_30}</span>
                    ) : (
                      <span className="text-slate-400">0</span>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    {p.licenses.expired > 0 ? (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800">{p.licenses.expired}</span>
                    ) : (
                      <span className="text-slate-400">0</span>
                    )}
                  </td>
                  <td className="p-3 text-right text-slate-600">{p.trainings.published}/{p.trainings.total}</td>
                  <td className="p-3">
                    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${p.report_enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                      {p.report_enabled ? 'Activé' : 'Désactivé'}
                    </span>
                  </td>
                </tr>
              ))}
              {pharmacies.length === 0 && (
                <tr><td colSpan={8} className="p-6 text-center text-slate-500">Aucune donnée pour le moment.</td></tr>
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
      </div>
    </>
  );
};
