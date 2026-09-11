import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { BookOpenCheck, Send } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { ReadReceiptsDialog } from '@/components/ReadReceiptsDialog';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export function mondayISO(d = new Date()): string {
  const x = new Date(d);
  const day = x.getDay();
  x.setDate(x.getDate() + (day === 0 ? -6 : 1 - day));
  return x.toISOString().slice(0, 10);
}

export function ScheduleWeekOps({ weekStart }: { weekStart?: string }): JSX.Element {
  const start = weekStart ?? mondayISO();
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(0);
  const [total, setTotal] = useState(0);
  const [published, setPublished] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await axios.get<{ published: boolean; recipients: { seen: boolean }[] }>(
        `${API}/schedule/publish/status?week_start=${start}`,
        { headers: { Authorization: `Bearer ${token ?? ''}` } },
      );
      setPublished(Boolean(res.data.published));
      const rec = res.data.recipients ?? [];
      setTotal(rec.length);
      setSeen(rec.filter((r) => r.seen).length);
    } catch {
      setPublished(false);
      setTotal(0);
      setSeen(0);
    }
  }, [start, token]);

  useEffect(() => { void load(); }, [load]);

  const publish = async (): Promise<void> => {
    setBusy(true);
    try {
      await axios.post(`${API}/schedule/publish`, { week_start: start }, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      toast.success('Horaire publié — chaque employé est notifié.');
      await load();
    } catch {
      toast.error('Publication impossible. Vérifiez la connexion.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2" data-testid="schedule-week-ops">
      <Button data-testid="publish-week-button" onClick={() => void publish()} disabled={busy} className="rounded-full bg-emerald-600 hover:bg-emerald-700">
        <Send className="w-4 h-4 mr-1" /> {published ? 'Republier la semaine' : 'Publier la semaine'}
      </Button>
      <button
        type="button"
        data-testid="read-receipts-chip"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold border ${
          published && total > 0 && seen === total
            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
            : 'bg-white text-slate-700 border-slate-200'
        }`}
      >
        <BookOpenCheck className="w-3.5 h-3.5" />
        {published ? `Horaire vu par ${seen}/${total || '—'}` : 'Pas encore publié'}
      </button>
      <ReadReceiptsDialog open={open} onClose={() => setOpen(false)} weekStart={start} />
    </div>
  );
}
