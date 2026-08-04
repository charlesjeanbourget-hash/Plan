import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { CalendarPlus, Copy, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const CalendarSyncCard = (): JSX.Element => {
  const { token } = useAuth();
  const [feedToken, setFeedToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    axios.get<{ token: string }>(`${API}/my/calendar-feed`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => setFeedToken(r.data.token))
      .catch(() => undefined);
  }, [token]);

  const feedUrl = feedToken ? `${API}/calendar/${feedToken}` : '';

  const copyUrl = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(feedUrl);
      toast.success('Lien copié ! Collez-le dans votre application de calendrier.');
    } catch {
      toast.error('Copie impossible — sélectionnez le lien manuellement.');
    }
  };

  const regenerate = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await axios.post<{ token: string }>(`${API}/my/calendar-feed/reset`, {}, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      setFeedToken(r.data.token);
      toast.success('Nouveau lien généré. L\'ancien lien ne fonctionne plus.');
    } catch {
      toast.error('Régénération impossible pour le moment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6" data-testid="calendar-sync-card">
      <p className="text-sm text-slate-600 flex items-start gap-2">
        <CalendarPlus className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
        Abonnez votre calendrier personnel (Google, Apple, Outlook) à vos quarts de travail.
        Vos quarts apparaîtront automatiquement et se mettront à jour d'eux-mêmes.
      </p>
      {feedToken && (
        <>
          <div className="mt-4 flex flex-col sm:flex-row gap-2">
            <code data-testid="calendar-feed-url" className="flex-1 text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 break-all select-all">
              {feedUrl}
            </code>
            <div className="flex gap-2 shrink-0">
              <Button data-testid="calendar-copy-button" size="sm" onClick={() => void copyUrl()} className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs">
                <Copy className="w-3.5 h-3.5 mr-1" /> Copier le lien
              </Button>
              <Button data-testid="calendar-reset-button" size="sm" variant="outline" onClick={() => void regenerate()} disabled={busy} className="rounded-full text-xs">
                <RefreshCw className={`w-3.5 h-3.5 mr-1 ${busy ? 'animate-spin' : ''}`} /> Régénérer
              </Button>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-slate-500">
            <div className="rounded-lg bg-slate-50 border border-slate-100 p-3">
              <p className="font-bold text-slate-700 mb-1">Google Calendar</p>
              <p>Paramètres → Ajouter un agenda → « À partir de l'URL » → collez le lien.</p>
            </div>
            <div className="rounded-lg bg-slate-50 border border-slate-100 p-3">
              <p className="font-bold text-slate-700 mb-1">Apple Calendrier (iPhone/Mac)</p>
              <p>Fichier → Nouvel abonnement à un calendrier → collez le lien.</p>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-slate-400">
            Ce lien est personnel et secret. Si vous pensez qu'il a été partagé, cliquez « Régénérer » pour l'invalider.
          </p>
        </>
      )}
      {!feedToken && <p className="mt-3 text-xs text-slate-400">Chargement du lien de synchronisation…</p>}
    </div>
  );
};
