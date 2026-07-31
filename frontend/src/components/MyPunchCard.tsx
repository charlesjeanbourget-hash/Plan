import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { PunchStatus, PunchActionResult } from '@/types';
import { fmtTime } from '@/lib/pharmacy';
import { Button } from '@/components/ui/button';
import { Timer, LogIn, LogOut } from 'lucide-react';
import { getPunchGeo } from '@/lib/geo';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const MyPunchCard = (): JSX.Element => {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token ?? ''}` };
  const [status, setStatus] = useState<PunchStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await axios.get<PunchStatus>(`${API}/punch/me/status`, { headers });
      setStatus(res.data);
    } catch {
      setStatus(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh]);

  const punch = async (): Promise<void> => {
    setBusy(true);
    try {
      const geo = await getPunchGeo();
      const res = await axios.post<PunchActionResult>(`${API}/punch/me`, geo ?? {}, { headers });
      toast.success(res.data.action === 'in'
        ? `Entrée punchée à ${fmtTime(res.data.time)}. Bon quart !`
        : `Sortie punchée à ${fmtTime(res.data.time)} — durée ${res.data.duration_hours} h.`);
      await refresh();
    } catch {
      toast.error('Punch impossible.');
    } finally {
      setBusy(false);
    }
  };

  const open = status?.open ?? null;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-7" data-testid="myspace-punch-card">
      <h2 className="font-heading text-base font-bold text-slate-900 mb-4 inline-flex items-center gap-2">
        <Timer className="w-4 h-4 text-emerald-600" /> Punch des heures
      </h2>
      <div className="flex items-center justify-between gap-4">
        <div>
          {open ? (
            <>
              <p data-testid="punch-open-status" className="text-sm font-semibold text-emerald-700">Au travail depuis {fmtTime(open.punch_in)}</p>
              <p className="text-xs text-slate-500">Punché aujourd'hui : {status?.today_hours ?? 0} h (quarts terminés)</p>
            </>
          ) : (
            <>
              <p data-testid="punch-closed-status" className="text-sm font-semibold text-slate-700">Vous n'êtes pas punché(e).</p>
              <p className="text-xs text-slate-500">Punché aujourd'hui : {status?.today_hours ?? 0} h</p>
            </>
          )}
        </div>
        <Button
          data-testid="punch-me-button"
          disabled={busy || status === null}
          onClick={() => void punch()}
          className={`rounded-full ${open ? 'bg-sky-600 hover:bg-sky-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
        >
          {open ? <><LogOut className="w-4 h-4 mr-1" /> Puncher la sortie</> : <><LogIn className="w-4 h-4 mr-1" /> Puncher l'entrée</>}
        </Button>
      </div>
      {(status?.today_entries.length ?? 0) > 0 && (
        <div className="mt-4 pt-3 border-t border-slate-100 space-y-1.5">
          {status?.today_entries.map((p) => (
            <p key={p.id} className="text-xs text-slate-500">
              {fmtTime(p.punch_in)} → {p.punch_out ? fmtTime(p.punch_out) : 'en cours…'}
              {p.source === 'manual' && <span className="ml-2 text-amber-700 font-semibold">(saisie admin)</span>}
            </p>
          ))}
        </div>
      )}
      <p className="text-xs text-slate-400 mt-4">
        Seules les heures punchées (NIP ou bouton ci-dessus) ou saisies par l'administration comptent pour la paie.
      </p>
    </div>
  );
};
