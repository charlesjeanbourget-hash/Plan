import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { BookOpenCheck, CheckCircle2, CircleDashed } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

interface ReceiptRecipient {
  employee_id: string;
  employee_name: string;
  shift_count: number;
  hours: number;
  seen: boolean;
  seen_at: string | null;
}

interface PublishStatus {
  published: boolean;
  published_at?: string;
  count?: number;
  recipients: ReceiptRecipient[];
}

export const ReadReceiptsDialog = ({ open, onClose, weekStart }: {
  open: boolean;
  onClose: () => void;
  weekStart: string;
}): JSX.Element => {
  const { token } = useAuth();
  const [status, setStatus] = useState<PublishStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const res = await axios.get<PublishStatus>(`${API}/schedule/publish/status?week_start=${weekStart}`, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      setStatus(res.data);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [weekStart, token]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const seenCount = status?.recipients.filter((r) => r.seen).length ?? 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="read-receipts-dialog" className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading inline-flex items-center gap-2">
            <BookOpenCheck className="w-4 h-4 text-emerald-600" /> Accusés de lecture — semaine du {weekStart}
          </DialogTitle>
          <DialogDescription>
            Un employé est marqué « Vu » lorsqu'il ouvre son module Horaires après la publication.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-slate-400 py-4">Chargement…</p>
        ) : !status?.published ? (
          <p data-testid="receipts-not-published" className="text-sm text-slate-500 py-4">
            Cette semaine n'a pas encore été publiée — utilisez « Publier la semaine » d'abord.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span data-testid="receipts-summary" className={`inline-flex px-3 py-1 rounded-full text-xs font-bold ${seenCount === status.recipients.length ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                {seenCount}/{status.recipients.length} employé(s) ont vu leur horaire
              </span>
              <span className="text-xs text-slate-500">
                Publié le {status.published_at ? new Date(status.published_at).toLocaleString('fr-CA', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                {status.count && status.count > 1 ? ` · ${status.count} publication(s)` : ''}
              </span>
            </div>
            <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
              {status.recipients.map((r) => (
                <div key={r.employee_id} data-testid={`receipt-row-${r.employee_id}`} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{r.employee_name || r.employee_id}</p>
                    <p className="text-xs text-slate-500">{r.shift_count} quart(s) · ~{r.hours} h</p>
                  </div>
                  {r.seen ? (
                    <span data-testid={`receipt-seen-${r.employee_id}`} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-semibold">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Vu {r.seen_at ? `le ${new Date(r.seen_at).toLocaleString('fr-CA', { dateStyle: 'short', timeStyle: 'short' })}` : ''}
                    </span>
                  ) : (
                    <span data-testid={`receipt-unseen-${r.employee_id}`} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-semibold">
                      <CircleDashed className="w-3.5 h-3.5" /> Pas encore ouvert
                    </span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
