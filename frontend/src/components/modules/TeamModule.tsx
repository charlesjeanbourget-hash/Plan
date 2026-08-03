import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useHR } from '@/context/HRContext';
import { useAuth } from '@/context/AuthContext';
import { ModuleHeader } from '@/components/modules/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PartyPopper, Plus, BarChart3, Heart, Award, Star, UsersRound, Rocket, ThumbsUp, Trash2, Lock, CheckCircle2, LucideIcon } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

interface PollOption { id: string; label: string }
interface Poll {
  id: string;
  question: string;
  options: PollOption[];
  anonymous: boolean;
  status: string;
  total_votes: number;
  my_vote: string | null;
  results: Record<string, number> | null;
  created_at: string;
}
interface Kudos {
  id: string;
  from_email: string;
  from_name: string;
  to_employee_id: string;
  to_name: string;
  category: string;
  message: string;
  applause_count: number;
  my_applause: boolean;
  created_at: string;
}

const KUDOS_META: Record<string, { icon: LucideIcon; cls: string }> = {
  'Merci': { icon: Heart, cls: 'bg-rose-100 text-rose-700' },
  'Bravo': { icon: Award, cls: 'bg-emerald-100 text-emerald-700' },
  'Étoile du service': { icon: Star, cls: 'bg-amber-100 text-amber-700' },
  'Esprit d\'équipe': { icon: UsersRound, cls: 'bg-sky-100 text-sky-700' },
  'Dépassement': { icon: Rocket, cls: 'bg-violet-100 text-violet-700' },
};
const KUDOS_CATEGORIES = Object.keys(KUDOS_META);

const extractDetail = (err: unknown): string => {
  const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
  return typeof detail === 'string' ? detail : 'Action impossible.';
};

const fmtAgo = (iso: string): string => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `il y a ${mins} min`;
  if (mins < 1440) return `il y a ${Math.round(mins / 60)} h`;
  return new Date(iso).toLocaleDateString('fr-CA');
};

export default function TeamModule(): JSX.Element {
  const { state } = useHR();
  const { currentUser, token } = useAuth();
  const isAdmin = currentUser?.role !== 'employee';
  const headers = { Authorization: `Bearer ${token ?? ''}` };

  const [polls, setPolls] = useState<Poll[]>([]);
  const [kudos, setKudos] = useState<Kudos[]>([]);
  const [pollOpen, setPollOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [anonymous, setAnonymous] = useState(true);
  const [kudosOpen, setKudosOpen] = useState(false);
  const [kudosTo, setKudosTo] = useState('');
  const [kudosCat, setKudosCat] = useState('Bravo');
  const [kudosMsg, setKudosMsg] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!token) return;
    const h = { Authorization: `Bearer ${token}` };
    try {
      const [p, k] = await Promise.all([
        axios.get<Poll[]>(`${API}/polls`, { headers: h }),
        axios.get<Kudos[]>(`${API}/kudos`, { headers: h }),
      ]);
      setPolls(p.data);
      setKudos(k.data);
    } catch {
      /* hors ligne */
    }
  }, [token]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 20000);
    return () => clearInterval(id);
  }, [refresh]);

  const createPoll = async (): Promise<void> => {
    try {
      await axios.post(`${API}/polls`, { question, options: options.filter((o) => o.trim()), anonymous }, { headers });
      toast.success('Sondage publié — l\'équipe est notifiée.');
      setPollOpen(false);
      setQuestion('');
      setOptions(['', '']);
      void refresh();
    } catch (err) {
      toast.error(extractDetail(err));
    }
  };

  const vote = async (pollId: string, optionId: string): Promise<void> => {
    try {
      await axios.post(`${API}/polls/${pollId}/vote`, { option_id: optionId }, { headers });
      toast.success('Vote enregistré !');
      void refresh();
    } catch (err) {
      toast.error(extractDetail(err));
    }
  };

  const closePoll = async (pollId: string): Promise<void> => {
    await axios.post(`${API}/polls/${pollId}/close`, {}, { headers }).catch(() => undefined);
    void refresh();
  };

  const deletePoll = async (pollId: string): Promise<void> => {
    if (confirmDelete !== pollId) {
      setConfirmDelete(pollId);
      toast.warning('Cliquez de nouveau pour confirmer la suppression.');
      return;
    }
    setConfirmDelete(null);
    await axios.delete(`${API}/polls/${pollId}`, { headers }).catch(() => undefined);
    void refresh();
  };

  const sendKudos = async (): Promise<void> => {
    const emp = state.employees.find((e) => e.id === kudosTo);
    if (!emp) {
      toast.error('Choisissez un(e) collègue.');
      return;
    }
    try {
      await axios.post(`${API}/kudos`, {
        to_employee_id: emp.id, to_name: `${emp.firstName} ${emp.lastName}`,
        category: kudosCat, message: kudosMsg,
      }, { headers });
      toast.success(`${emp.firstName} recevra votre ${kudosCat.toLowerCase()} !`);
      setKudosOpen(false);
      setKudosMsg('');
      setKudosTo('');
      void refresh();
    } catch (err) {
      toast.error(extractDetail(err));
    }
  };

  const applaud = async (id: string): Promise<void> => {
    try {
      const res = await axios.post<{ applause_count: number; my_applause: boolean }>(`${API}/kudos/${id}/applaud`, {}, { headers });
      setKudos((prev) => prev.map((k) => (k.id === id ? { ...k, ...res.data } : k)));
    } catch {
      /* silencieux */
    }
  };

  const deleteKudos = async (id: string): Promise<void> => {
    await axios.delete(`${API}/kudos/${id}`, { headers }).catch(() => undefined);
    void refresh();
  };

  const activeEmployees = state.employees.filter((e) => !e.anonymized && e.id !== currentUser?.employeeId);

  return (
    <div data-testid="team-module">
      <ModuleHeader
        title="Équipe"
        subtitle="Sondages éclair et mur de reconnaissance — prenez le pouls et célébrez vos collègues."
        action={
          <div className="flex flex-wrap gap-2">
            {isAdmin && (
              <Button data-testid="poll-add-button" variant="outline" onClick={() => setPollOpen(true)} className="rounded-full border-bronze-300 text-bronze-800 hover:bg-bronze-50">
                <BarChart3 className="w-4 h-4 mr-1" /> Nouveau sondage
              </Button>
            )}
            <Button data-testid="kudos-add-button" onClick={() => setKudosOpen(true)} className="rounded-full bg-emerald-600 hover:bg-emerald-700">
              <PartyPopper className="w-4 h-4 mr-1" /> Féliciter un(e) collègue
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        <section data-testid="polls-panel">
          <h3 className="font-heading font-bold text-slate-900 text-lg mb-4 inline-flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-bronze-600" /> Sondages éclair
          </h3>
          {polls.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-500" data-testid="polls-empty">
              Aucun sondage pour le moment.{isAdmin ? ' Lancez-en un — deux choix suffisent !' : ''}
            </div>
          )}
          <div className="space-y-4">
            {polls.map((p) => {
              const total = p.total_votes || 0;
              return (
                <div key={p.id} data-testid={`poll-card-${p.id}`} className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="font-heading font-bold text-slate-900">{p.question}</p>
                    {p.status === 'closed' && <span className="shrink-0 px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold uppercase">Terminé</span>}
                  </div>
                  <p className="text-[11px] text-slate-400 mb-4">
                    {p.anonymous ? 'Réponses anonymes' : 'Réponses nominatives'} · {total} vote{total > 1 ? 's' : ''} · {fmtAgo(p.created_at)}
                  </p>
                  <div className="space-y-2">
                    {p.options.map((o) => {
                      const count = p.results?.[o.id] ?? 0;
                      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                      const voted = p.my_vote === o.id;
                      if (p.results === null && p.status === 'open') {
                        return (
                          <button
                            key={o.id}
                            data-testid={`poll-option-${p.id}-${o.id}`}
                            onClick={() => void vote(p.id, o.id)}
                            className="w-full text-left rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:border-emerald-400 hover:bg-emerald-50 transition-colors"
                          >
                            {o.label}
                          </button>
                        );
                      }
                      return (
                        <div key={o.id} data-testid={`poll-result-${p.id}-${o.id}`} className="relative rounded-xl border border-slate-200 px-4 py-2.5 overflow-hidden">
                          <div className={`absolute inset-y-0 left-0 ${voted ? 'bg-emerald-100' : 'bg-slate-100'}`} style={{ width: `${pct}%` }} />
                          <div className="relative flex items-center justify-between text-sm">
                            <span className="font-semibold text-slate-700 inline-flex items-center gap-1.5">
                              {voted && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}{o.label}
                            </span>
                            <span className="text-slate-500 text-xs font-bold">{pct} % ({count})</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {p.results === null && p.status === 'open' && (
                    <p className="text-[11px] text-slate-400 mt-2 inline-flex items-center gap-1"><Lock className="w-3 h-3" /> Les résultats s'affichent après votre vote.</p>
                  )}
                  {isAdmin && (
                    <div className="flex gap-1.5 mt-4 pt-3 border-t border-slate-100">
                      {p.status === 'open' && (
                        <Button data-testid={`poll-close-${p.id}`} size="sm" variant="outline" onClick={() => void closePoll(p.id)} className="rounded-full text-xs h-7">
                          Clore le sondage
                        </Button>
                      )}
                      <Button data-testid={`poll-delete-${p.id}`} size="sm" variant="outline" onClick={() => void deletePoll(p.id)} className={`rounded-full text-xs h-7 text-red-600 ${confirmDelete === p.id ? 'border-red-400 bg-red-50' : ''}`}>
                        <Trash2 className="w-3 h-3 mr-1" /> {confirmDelete === p.id ? 'Confirmer' : 'Supprimer'}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section data-testid="kudos-panel">
          <h3 className="font-heading font-bold text-slate-900 text-lg mb-4 inline-flex items-center gap-2">
            <PartyPopper className="w-4 h-4 text-bronze-600" /> Mur de reconnaissance
          </h3>
          {kudos.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-500" data-testid="kudos-empty">
              Le mur est vide — soyez la première personne à féliciter un(e) collègue !
            </div>
          )}
          <div className="space-y-4">
            {kudos.map((k) => {
              const meta = KUDOS_META[k.category] ?? KUDOS_META['Bravo'];
              const Icon = meta.icon;
              return (
                <div key={k.id} data-testid={`kudos-card-${k.id}`} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                  <div className="flex items-start gap-3">
                    <span className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${meta.cls}`}>
                      <Icon className="w-4 h-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-900">
                        <span className="font-bold">{k.from_name}</span>
                        <span className="text-slate-400"> → </span>
                        <span className="font-bold text-emerald-700">{k.to_name}</span>
                      </p>
                      <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${meta.cls}`}>{k.category}</span>
                      {k.message && <p className="text-sm text-slate-600 mt-2">{k.message}</p>}
                      <div className="flex items-center gap-3 mt-3">
                        <button
                          data-testid={`kudos-applaud-${k.id}`}
                          onClick={() => void applaud(k.id)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border transition-colors ${k.my_applause ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-400'}`}
                        >
                          <ThumbsUp className="w-3 h-3" /> {k.applause_count > 0 ? k.applause_count : 'Applaudir'}
                        </button>
                        <span className="text-[11px] text-slate-400">{fmtAgo(k.created_at)}</span>
                        {(isAdmin || k.from_email === currentUser?.email) && (
                          <button data-testid={`kudos-delete-${k.id}`} onClick={() => void deleteKudos(k.id)} className="text-slate-300 hover:text-red-500 transition-colors" aria-label="Supprimer">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <Dialog open={pollOpen} onOpenChange={setPollOpen}>
        <DialogContent data-testid="poll-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Nouveau sondage éclair</DialogTitle>
            <DialogDescription>Une question courte, 2 à 6 choix — l'équipe est notifiée instantanément.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Question</Label>
              <Input data-testid="poll-question-input" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Quel horaire préférez-vous pour la réunion d'équipe ?" />
            </div>
            <div className="space-y-1.5">
              <Label>Choix de réponse</Label>
              {options.map((o, i) => (
                <Input key={i} data-testid={`poll-option-input-${i}`} value={o} onChange={(e) => setOptions((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Choix ${i + 1}`} className="mb-2" />
              ))}
              <div className="flex gap-2">
                {options.length < 6 && (
                  <Button data-testid="poll-add-option" size="sm" variant="outline" onClick={() => setOptions((p) => [...p, ''])} className="rounded-full text-xs">
                    <Plus className="w-3 h-3 mr-1" /> Ajouter un choix
                  </Button>
                )}
                {options.length > 2 && (
                  <Button size="sm" variant="outline" onClick={() => setOptions((p) => p.slice(0, -1))} className="rounded-full text-xs">
                    Retirer le dernier
                  </Button>
                )}
              </div>
            </div>
            <label data-testid="poll-anonymous-checkbox" className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" checked={anonymous} onChange={() => setAnonymous(!anonymous)} className="accent-emerald-600 w-4 h-4" />
              Réponses anonymes (recommandé pour un pouls honnête)
            </label>
            <Button data-testid="poll-submit-button" onClick={() => void createPoll()} className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              Publier le sondage
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={kudosOpen} onOpenChange={setKudosOpen}>
        <DialogContent data-testid="kudos-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Féliciter un(e) collègue</DialogTitle>
            <DialogDescription>Votre message sera affiché sur le mur d'équipe et la personne sera notifiée.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Collègue</Label>
              <Select value={kudosTo} onValueChange={setKudosTo}>
                <SelectTrigger data-testid="kudos-employee-select"><SelectValue placeholder="Choisir…" /></SelectTrigger>
                <SelectContent>
                  {activeEmployees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.firstName} {e.lastName} — {e.position}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Type de félicitation</Label>
              <div className="flex flex-wrap gap-2">
                {KUDOS_CATEGORIES.map((c) => (
                  <button
                    key={c}
                    data-testid={`kudos-category-${c}`}
                    onClick={() => setKudosCat(c)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${kudosCat === c ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300'}`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Message (facultatif)</Label>
              <Textarea data-testid="kudos-message-input" value={kudosMsg} onChange={(e) => setKudosMsg(e.target.value)} rows={3} placeholder="Merci d'avoir couvert mon quart samedi — tu m'as sauvé la vie !" />
            </div>
            <Button data-testid="kudos-submit-button" onClick={() => void sendKudos()} className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              Publier sur le mur
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
