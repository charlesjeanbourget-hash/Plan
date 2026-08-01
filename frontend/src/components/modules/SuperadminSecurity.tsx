import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { ShieldCheck, RefreshCw, Unlock, AlertTriangle, KeyRound, UserX } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

interface SuspiciousLogin {
  email: string;
  name: string;
  role: string;
  ip: string;
  created_at: string;
}

interface LockedAccount {
  identifier: string;
  locked_until: string;
}

interface OpenIncident {
  id: string;
  title: string;
  severity: string;
  status: string;
}

interface SecurityData {
  suspicious_logins_7d: SuspiciousLogin[];
  locked_accounts: LockedAccount[];
  open_incidents: OpenIncident[];
  temporary_password_count: number;
  suspended_count: number;
}

const SEVERITY_CLS: Record<string, string> = {
  faible: 'bg-slate-100 text-slate-700',
  moyen: 'bg-amber-100 text-amber-800',
  eleve: 'bg-orange-100 text-orange-800',
  critique: 'bg-red-100 text-red-800',
};

const fmtDate = (iso: string): string => {
  try {
    return new Date(iso).toLocaleString('fr-CA', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
};

const Tile = ({ label, value, alert, icon: Icon, testId }: {
  label: string; value: number; alert: boolean; icon: typeof ShieldCheck; testId: string;
}): JSX.Element => (
  <div
    data-testid={testId}
    className={`rounded-xl border p-4 flex items-center gap-3 ${alert ? 'border-red-300 bg-red-50' : 'border-emerald-200 bg-emerald-50/50'}`}
  >
    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${alert ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-700'}`}>
      <Icon className="w-5 h-5" />
    </div>
    <div>
      <p className={`text-2xl font-bold leading-none ${alert ? 'text-red-700' : 'text-emerald-800'}`}>{value}</p>
      <p className="text-xs text-slate-600 mt-1">{label}</p>
    </div>
  </div>
);

export const SuperadminSecurity = (): JSX.Element => {
  const { token } = useAuth();
  const [data, setData] = useState<SecurityData | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const res = await axios.get<SecurityData>(`${API}/superadmin/security-overview`, {
        headers: { Authorization: `Bearer ${token ?? ''}` },
      });
      setData(res.data);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh]);

  const unlock = async (identifier: string): Promise<void> => {
    try {
      await axios.post(`${API}/superadmin/unlock`, { identifier }, {
        headers: { Authorization: `Bearer ${token ?? ''}` },
      });
      toast.success(`Verrou levé pour ${identifier}.`);
      void refresh();
    } catch {
      toast.error('Impossible de lever le verrou.');
    }
  };

  if (!data) return <div data-testid="security-panel" className="mb-10" />;

  return (
    <div data-testid="security-panel" className="mb-10">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-emerald-600" />
          <h2 className="font-heading text-lg font-bold text-slate-900">Sécurité — vue d'ensemble</h2>
        </div>
        <Button
          data-testid="security-refresh-button"
          variant="outline"
          size="sm"
          onClick={() => void refresh()}
          disabled={loading}
          className="rounded-full"
        >
          <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Actualiser
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <Tile label="Connexions suspectes (7 j)" value={data.suspicious_logins_7d.length}
          alert={data.suspicious_logins_7d.length > 0} icon={AlertTriangle} testId="security-suspicious-count" />
        <Tile label="Comptes verrouillés" value={data.locked_accounts.length}
          alert={data.locked_accounts.length > 0} icon={Unlock} testId="security-locked-count" />
        <Tile label="Incidents ouverts" value={data.open_incidents.length}
          alert={data.open_incidents.length > 0} icon={ShieldCheck} testId="security-incidents-count" />
        <Tile label={`Mots de passe temporaires${data.suspended_count > 0 ? ` · ${data.suspended_count} suspendu(s)` : ''}`}
          value={data.temporary_password_count} alert={false} icon={KeyRound} testId="security-temp-pw-count" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500" /> Connexions depuis une IP inhabituelle (7 derniers jours)
          </h3>
          <div data-testid="security-suspicious-list" className="space-y-2 max-h-56 overflow-y-auto">
            {data.suspicious_logins_7d.map((s, i) => (
              <div key={`${s.email}-${s.created_at}-${i}`} className="flex items-center gap-3 text-sm border-b border-slate-100 last:border-0 pb-2">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800 truncate">{s.name || s.email}</p>
                  <p className="text-xs text-slate-500 truncate">{s.email} · {s.role}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-mono text-red-600">{s.ip}</p>
                  <p className="text-xs text-slate-400">{fmtDate(s.created_at)}</p>
                </div>
              </div>
            ))}
            {data.suspicious_logins_7d.length === 0 && (
              <p className="text-sm text-slate-500">Aucune connexion suspecte détectée. ✓</p>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
              <UserX className="w-4 h-4 text-amber-600" /> Comptes verrouillés (tentatives échouées)
            </h3>
            <div data-testid="security-locked-list" className="space-y-2 max-h-40 overflow-y-auto">
              {data.locked_accounts.map((l) => (
                <div key={l.identifier} className="flex items-center gap-3 text-sm border-b border-slate-100 last:border-0 pb-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-800 truncate">{l.identifier}</p>
                    <p className="text-xs text-slate-500">Verrouillé jusqu'à {fmtDate(l.locked_until)}</p>
                  </div>
                  <Button
                    data-testid={`unlock-button-${l.identifier}`}
                    variant="outline"
                    size="sm"
                    onClick={() => void unlock(l.identifier)}
                    className="rounded-full border-emerald-300 text-emerald-700 hover:bg-emerald-50 shrink-0"
                  >
                    <Unlock className="w-3.5 h-3.5 mr-1" /> Déverrouiller
                  </Button>
                </div>
              ))}
              {data.locked_accounts.length === 0 && <p className="text-sm text-slate-500">Aucun compte verrouillé. ✓</p>}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-bronze-600" /> Incidents de confidentialité ouverts
            </h3>
            <div data-testid="security-incidents-list" className="flex flex-wrap gap-2">
              {data.open_incidents.map((inc) => (
                <span key={inc.id} className={`inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1.5 ${SEVERITY_CLS[inc.severity] ?? 'bg-slate-100 text-slate-700'}`}>
                  {inc.title}
                </span>
              ))}
              {data.open_incidents.length === 0 && <p className="text-sm text-slate-500">Aucun incident ouvert. ✓</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
