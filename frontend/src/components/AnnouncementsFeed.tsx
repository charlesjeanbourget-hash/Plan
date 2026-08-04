import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Pin, Plus, ThumbsUp, Trash2, Newspaper } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

interface Announcement {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  author_name: string;
  likes: string[];
  created_at: string;
}

const fmtAgo = (isoStr: string): string => {
  const d = new Date(isoStr);
  return d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });
};

export const AnnouncementsFeed = (): JSX.Element => {
  const { currentUser, token } = useAuth();
  const isAdmin = currentUser?.role !== 'employee';
  const headers = { Authorization: `Bearer ${token ?? ''}` };
  const myKey = currentUser?.employeeId || currentUser?.email || '';
  const [items, setItems] = useState<Announcement[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    if (!token) return;
    try {
      const r = await axios.get<Announcement[]>(`${API}/announcements`, { headers: { Authorization: `Bearer ${token}` } });
      setItems([...r.data].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.created_at.localeCompare(a.created_at)));
    } catch { /* hors ligne */ }
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh]);

  const publish = async (): Promise<void> => {
    try {
      await axios.post(`${API}/announcements`, { title, body, pinned }, { headers });
      toast.success('Annonce publiée — toute l\'équipe est notifiée.');
      setDialogOpen(false);
      setTitle(''); setBody(''); setPinned(false);
      void refresh();
    } catch {
      toast.error('Publication impossible.');
    }
  };

  const like = async (id: string): Promise<void> => {
    await axios.post(`${API}/announcements/${id}/like`, {}, { headers }).catch(() => undefined);
    void refresh();
  };

  const remove = async (id: string): Promise<void> => {
    await axios.delete(`${API}/announcements/${id}`, { headers }).catch(() => undefined);
    toast.success('Annonce retirée.');
    void refresh();
  };

  return (
    <div data-testid="announcements-feed">
      {isAdmin && (
        <div className="flex justify-end mb-3">
          <Button data-testid="announcement-new-button" size="sm" onClick={() => setDialogOpen(true)} className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs">
            <Plus className="w-3.5 h-3.5 mr-1" /> Publier une annonce
          </Button>
        </div>
      )}
      {items.length === 0 ? (
        <p className="text-sm text-slate-500 bg-white rounded-xl border border-slate-200 p-5">
          Aucune annonce pour l'instant{isAdmin ? ' — publiez la première !' : '.'}
        </p>
      ) : (
        <div className="space-y-3">
          {items.map((a) => (
            <div key={a.id} data-testid={`announcement-card-${a.id}`} className={`bg-white rounded-xl border p-4 ${a.pinned ? 'border-bronze-300 bg-bronze-50/40' : 'border-slate-200'}`}>
              <div className="flex items-start gap-2">
                {a.pinned && <Pin data-testid={`announcement-pin-${a.id}`} className="w-3.5 h-3.5 text-bronze-600 shrink-0 mt-1" />}
                <div className="min-w-0 flex-1">
                  <p className="font-heading font-bold text-slate-900 text-sm">{a.title}</p>
                  {a.body && <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap">{a.body}</p>}
                  <p className="text-[11px] text-slate-400 mt-2">{a.author_name} · {fmtAgo(a.created_at)}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    data-testid={`announcement-like-${a.id}`}
                    onClick={() => void like(a.id)}
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold transition-colors ${a.likes.includes(myKey) ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-500 border-slate-200 hover:border-emerald-300'}`}
                  >
                    <ThumbsUp className="w-3 h-3" /> {a.likes.length > 0 ? a.likes.length : ''}
                  </button>
                  {isAdmin && (
                    <button data-testid={`announcement-delete-${a.id}`} onClick={() => void remove(a.id)} className="w-7 h-7 rounded-full text-slate-300 hover:text-red-600 hover:bg-red-50 flex items-center justify-center transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="announcement-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading inline-flex items-center gap-2"><Newspaper className="w-4 h-4 text-emerald-600" /> Nouvelle annonce</DialogTitle>
            <DialogDescription>Visible par toute l'équipe sur le tableau de bord.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Titre</Label>
              <Input data-testid="announcement-title-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Réunion d'équipe vendredi 12 h" />
            </div>
            <div className="space-y-1.5">
              <Label>Message (facultatif)</Label>
              <Textarea data-testid="announcement-body-input" value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[80px]" placeholder="Détails de l'annonce…" />
            </div>
            <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer rounded-lg border border-slate-200 px-3 py-2.5">
              <input data-testid="announcement-pinned-input" type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="accent-bronze-600 w-4 h-4" />
              <Pin className="w-3.5 h-3.5 text-bronze-600" />
              <span>Épingler en haut du fil</span>
            </label>
            <Button data-testid="announcement-submit-button" onClick={() => void publish()} disabled={!title.trim()} className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              Publier et notifier l'équipe
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
