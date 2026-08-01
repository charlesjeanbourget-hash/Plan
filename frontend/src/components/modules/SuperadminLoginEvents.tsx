import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { History, RefreshCw, LogIn, KeyRound } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

interface LoginEvent {
  id: string;
  email: string;
  name: string;
  role: string;
  event: string;
  ip: string;
  user_agent: string;
  created_at: string;
}

const fmt = (iso: string): string => {
  try {
    return new Date(iso).toLocaleString('fr-CA', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
};

const shortAgent = (ua: string): string => {
  if (/Mobi|Android|iPhone/i.test(ua)) return 'Mobile';
  if (/Mac/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Navigateur';
};

export const SuperadminLoginEvents = (): JSX.Element => {
  const { token } = useAuth();
  const [events, setEvents] = useState<LoginEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const res = await axios.get<LoginEvent[]>(`${API}/superadmin/login-events`, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      setEvents(res.data);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-7 mb-10" data-testid="login-events-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="font-heading text-base font-bold text-slate-900 inline-flex items-center gap-2">
            <History className="w-4 h-4 text-emerald-600" /> Journal des connexions
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">200 derniers événements — repérez tout accès suspect.</p>
        </div>
        <Button data-testid="login-events-refresh" size="sm" variant="outline" className="rounded-full text-xs" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} /> Actualiser
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
              <th className="pb-2 pr-3">Date et heure</th>
              <th className="pb-2 pr-3">Utilisateur</th>
              <th className="pb-2 pr-3">Événement</th>
              <th className="pb-2 pr-3">Adresse IP</th>
              <th className="pb-2">Appareil</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} data-testid={`login-event-row-${e.id}`} className="border-b border-slate-50">
                <td className="py-2 pr-3 text-slate-600 whitespace-nowrap">{fmt(e.created_at)}</td>
                <td className="py-2 pr-3">
                  <span className="font-semibold text-slate-800">{e.name || e.email}</span>
                  <span className="text-xs text-slate-400 ml-1">({e.role})</span>
                </td>
                <td className="py-2 pr-3">
                  {e.event === 'CHANGEMENT_MOT_DE_PASSE' ? (
                    <span className="inline-flex items-center gap-1 text-bronze-700 font-semibold text-xs">
                      <KeyRound className="w-3 h-3" /> Mot de passe changé
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold text-xs">
                      <LogIn className="w-3 h-3" /> Connexion
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3 font-mono text-xs text-slate-500">{e.ip}</td>
                <td className="py-2 text-xs text-slate-500">{shortAgent(e.user_agent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {events.length === 0 && !loading && (
          <p className="text-sm text-slate-500 py-3" data-testid="login-events-empty">Aucun événement de connexion enregistré pour l'instant.</p>
        )}
      </div>
    </div>
  );
};
