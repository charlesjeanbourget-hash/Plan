import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { ScheduleProposal } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CalendarCheck, Check, X, Hourglass } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const deadlineLabel = (iso: string): string => {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'Délai écoulé — approbation tacite appliquée';
  const h = Math.floor(ms / 3600000);
  if (h >= 24) return `Il vous reste ${Math.floor(h / 24)} j ${h % 24} h pour répondre`;
  return `Il vous reste ${h} h ${Math.floor((ms % 3600000) / 60000)} min pour répondre`;
};

export const MyProposalsPanel = (): JSX.Element | null => {
  const { token, currentUser } = useAuth();
  const headers = { Authorization: `Bearer ${token ?? ''}` };
  const [proposals, setProposals] = useState<ScheduleProposal[]>([]);
  const [comments, setComments] = useState<Record<string, string>>({});

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await axios.get<ScheduleProposal[]>(`${API}/schedule/proposals`, { headers });
      setProposals(res.data);
    } catch {
      setProposals([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh]);

  const respond = async (id: string, status: 'approved' | 'rejected'): Promise<void> => {
    try {
      await axios.post(`${API}/schedule/proposals/${id}/respond`, { status, comment: comments[id] ?? '' }, { headers });
      toast.success(status === 'approved' ? 'Horaire approuvé, merci !' : 'Refus transmis au gestionnaire.');
      await refresh();
    } catch {
      toast.error('Réponse impossible.');
    }
  };

  if (proposals.length === 0) return null;
  const eid = currentUser?.employeeId ?? '';

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-7 lg:col-span-2" data-testid="myspace-proposals-panel">
      <h2 className="font-heading text-base font-bold text-slate-900 mb-5 inline-flex items-center gap-2">
        <CalendarCheck className="w-4 h-4 text-emerald-600" /> Horaires proposés à approuver
      </h2>
      <div className="space-y-5">
        {proposals.map((p) => {
          const myShifts = p.shifts.filter((s) => s.employee_id === eid).sort((a, b) => a.date.localeCompare(b.date));
          const mySlot = p.employee_approvals[eid];
          const answered = mySlot && mySlot.status !== 'pending';
          return (
            <div key={p.id} data-testid={`proposal-employee-${p.id}`} className="rounded-lg border border-slate-200 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <p className="text-sm font-bold text-slate-800">Semaine du {p.week_start}</p>
                {answered ? (
                  <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${mySlot.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                    {mySlot.status === 'approved' ? 'Vous avez approuvé' : 'Vous avez refusé'}
                  </span>
                ) : (
                  <span data-testid={`proposal-deadline-${p.id}`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700">
                    <Hourglass className="w-3.5 h-3.5" /> {deadlineLabel(p.approval_deadline)}
                  </span>
                )}
              </div>
              <div className="space-y-1.5 mb-4">
                {myShifts.map((s) => (
                  <p key={s.id} className="text-sm text-slate-600">
                    <span className="font-semibold text-slate-800">{s.date}</span> · {s.start}–{s.end}
                    {s.role && <span className="text-xs text-slate-400"> — {s.role}</span>}
                  </p>
                ))}
                {myShifts.length === 0 && <p className="text-sm text-slate-500">Aucun quart pour vous cette semaine.</p>}
              </div>
              {!answered && (
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    data-testid={`proposal-comment-${p.id}`}
                    placeholder="Commentaire (optionnel)"
                    className="h-9 text-sm flex-1"
                    value={comments[p.id] ?? ''}
                    onChange={(e) => setComments({ ...comments, [p.id]: e.target.value })}
                  />
                  <div className="flex gap-2">
                    <Button data-testid={`proposal-approve-${p.id}`} size="sm" onClick={() => void respond(p.id, 'approved')} className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs">
                      <Check className="w-3.5 h-3.5 mr-1" /> Approuver
                    </Button>
                    <Button data-testid={`proposal-reject-${p.id}`} size="sm" variant="outline" onClick={() => void respond(p.id, 'rejected')} className="rounded-full text-xs text-red-600 border-red-200 hover:bg-red-50">
                      <X className="w-3.5 h-3.5 mr-1" /> Refuser
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
