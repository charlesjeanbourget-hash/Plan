import { useState, useEffect, useCallback, FormEvent } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { useHR } from '@/context/HRContext';
import { ScheduleProposal, ProposalStatus } from '@/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sparkles, Loader2, Check, X, Trash2, CalendarPlus } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const STATUS_META: Record<ProposalStatus, { label: string; cls: string }> = {
  generating: { label: 'Génération par l\'IA…', cls: 'bg-sky-100 text-sky-800' },
  error: { label: 'Erreur', cls: 'bg-red-100 text-red-800' },
  pending: { label: 'En attente d\'approbations', cls: 'bg-amber-100 text-amber-800' },
  attention: { label: 'Refus d\'employé — à réviser', cls: 'bg-orange-100 text-orange-800' },
  approved: { label: 'Approuvé — prêt à appliquer', cls: 'bg-emerald-100 text-emerald-800' },
  rejected: { label: 'Rejeté par l\'admin', cls: 'bg-red-100 text-red-800' },
  applied: { label: 'Appliqué à l\'horaire', cls: 'bg-slate-200 text-slate-700' },
};

const nextMonday = (): string => {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day + 7);
  return d.toISOString().slice(0, 10);
};

export const ScheduleProposals = (): JSX.Element => {
  const { token } = useAuth();
  const { state, addShift } = useHR();
  const headers = { Authorization: `Bearer ${token ?? ''}` };
  const [proposals, setProposals] = useState<ScheduleProposal[]>([]);
  const [genOpen, setGenOpen] = useState(false);
  const [weekStart, setWeekStart] = useState(nextMonday());
  const [instructions, setInstructions] = useState('');
  const [deadlineHours, setDeadlineHours] = useState('48');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  useEffect(() => {
    if (!proposals.some((p) => p.effective_status === 'generating')) return undefined;
    const id = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(id);
  }, [proposals, refresh]);

  const generate = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    try {
      await axios.post(`${API}/schedule/generate`, {
        week_start: weekStart,
        instructions,
        approval_deadline_hours: Number(deadlineHours),
        employees: state.employees.filter((emp) => emp.status === 'Actif').map((emp) => ({
          id: emp.id, name: `${emp.firstName} ${emp.lastName}`, position: emp.position,
        })),
      }, { headers });
      toast.success('L\'IA prépare l\'horaire en respectant les profils des employés…');
      setGenOpen(false);
      await refresh();
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
      toast.error(typeof detail === 'string' ? detail : 'Génération impossible.');
    } finally {
      setBusy(false);
    }
  };

  const decide = async (id: string, status: 'approved' | 'rejected'): Promise<void> => {
    try {
      await axios.post(`${API}/schedule/proposals/${id}/decision`, { status }, { headers });
      toast.success(status === 'approved'
        ? 'Approuvé. L\'horaire sera final quand les employés auront répondu (ou au délai écoulé).'
        : 'Proposition rejetée.');
      await refresh();
    } catch {
      toast.error('Action impossible.');
    }
  };

  const apply = async (p: ScheduleProposal): Promise<void> => {
    try {
      await axios.post(`${API}/schedule/proposals/${p.id}/apply`, {}, { headers });
      p.shifts.forEach((s) => addShift({ employeeId: s.employee_id, date: s.date, startTime: s.start, endTime: s.end }));
      toast.success(`${p.shifts.length} quart(s) ajoutés à l'horaire de la semaine du ${p.week_start}.`);
      await refresh();
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
      toast.error(typeof detail === 'string' ? detail : 'Application impossible.');
    }
  };

  const remove = async (id: string): Promise<void> => {
    try {
      await axios.delete(`${API}/schedule/proposals/${id}`, { headers });
      toast.success('Proposition supprimée.');
      await refresh();
    } catch {
      toast.error('Suppression impossible.');
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6" data-testid="schedule-proposals-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="font-heading text-base font-bold text-slate-900 inline-flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-emerald-600" /> Horaires générés par IA
        </h2>
        <Button data-testid="generate-schedule-button" size="sm" onClick={() => setGenOpen(true)} className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs">
          <Sparkles className="w-3.5 h-3.5 mr-1" /> Générer l'horaire par IA
        </Button>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        L'IA respecte les profils (disponibilités, rôles, restrictions, heures min/max). Vous approuvez, puis chaque employé approuve
        dans le délai fixé — sans réponse au délai, l'approbation est tacite.
      </p>

      {proposals.length === 0 && <p className="text-sm text-slate-500">Aucune proposition. Générez votre premier horaire par IA.</p>}

      <div className="space-y-4">
        {proposals.map((p) => {
          const meta = STATUS_META[p.effective_status];
          const days = Array.from(new Set(p.shifts.map((s) => s.date))).sort();
          const isOpen = expanded === p.id;
          return (
            <div key={p.id} data-testid={`proposal-card-${p.id}`} className="rounded-lg border border-slate-200 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {p.effective_status === 'generating' && <Loader2 className="w-4 h-4 text-sky-600 animate-spin" />}
                  <p className="text-sm font-bold text-slate-800">Semaine du {p.week_start}</p>
                  <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${meta.cls}`}>{meta.label}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {p.effective_status !== 'generating' && (
                    <Button size="sm" variant="outline" data-testid={`proposal-toggle-${p.id}`} onClick={() => setExpanded(isOpen ? null : p.id)} className="rounded-full text-xs">
                      {isOpen ? 'Réduire' : `Détails (${p.shifts.length} quarts)`}
                    </Button>
                  )}
                  {p.admin_status === 'pending' && p.effective_status !== 'generating' && p.effective_status !== 'error' && (
                    <>
                      <Button data-testid={`admin-approve-${p.id}`} size="sm" onClick={() => void decide(p.id, 'approved')} className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs">
                        <Check className="w-3.5 h-3.5 mr-1" /> Approuver (admin)
                      </Button>
                      <Button data-testid={`admin-reject-${p.id}`} size="sm" variant="outline" onClick={() => void decide(p.id, 'rejected')} className="rounded-full text-xs text-red-600 border-red-200 hover:bg-red-50">
                        <X className="w-3.5 h-3.5 mr-1" /> Rejeter
                      </Button>
                    </>
                  )}
                  {p.effective_status === 'approved' && (
                    <Button data-testid={`apply-proposal-${p.id}`} size="sm" onClick={() => void apply(p)} className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs">
                      <CalendarPlus className="w-3.5 h-3.5 mr-1" /> Appliquer à l'horaire
                    </Button>
                  )}
                  <Button data-testid={`delete-proposal-${p.id}`} size="sm" variant="outline" onClick={() => void remove(p.id)} className="rounded-full text-xs text-red-600 border-red-200 hover:bg-red-50">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              {p.effective_status === 'error' && <p className="text-xs text-red-600 mt-2">{p.error}</p>}

              {p.effective_status !== 'generating' && Object.keys(p.employee_approvals).length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {Object.entries(p.employee_approvals).map(([eid, slot]) => {
                    const emp = state.employees.find((e2) => e2.id === eid);
                    const name = emp ? `${emp.firstName} ${emp.lastName[0]}.` : eid;
                    const cls = slot.status === 'approved'
                      ? 'bg-emerald-100 text-emerald-800'
                      : slot.status === 'rejected'
                        ? 'bg-red-100 text-red-800'
                        : p.deadline_passed ? 'bg-slate-200 text-slate-600' : 'bg-amber-100 text-amber-800';
                    const label = slot.status === 'approved' ? '✓' : slot.status === 'rejected' ? '✕' : p.deadline_passed ? 'tacite' : '…';
                    return (
                      <span key={eid} title={slot.comment} className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>
                        {name} {label}
                      </span>
                    );
                  })}
                  <span className="text-xs text-slate-400 ml-1">Délai : {new Date(p.approval_deadline).toLocaleString('fr-CA', { dateStyle: 'short', timeStyle: 'short' })}</span>
                </div>
              )}

              {isOpen && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                  {p.summary && <p className="text-xs text-slate-500 italic mb-4">{p.summary}</p>}
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {days.map((d) => (
                      <div key={d} className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                        <p className="text-xs font-bold text-slate-700 mb-2">{d}</p>
                        {p.shifts.filter((s) => s.date === d).sort((a, b) => a.start.localeCompare(b.start)).map((s) => (
                          <p key={s.id} className="text-xs text-slate-600 mb-1">
                            <span className="font-semibold text-slate-800">{s.start}–{s.end}</span> {s.employee_name}
                            {s.role && <span className="text-slate-400"> · {s.role}</span>}
                          </p>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={genOpen} onOpenChange={setGenOpen}>
        <DialogContent data-testid="generate-schedule-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Générer l'horaire par IA</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => void generate(e)} className="space-y-4">
            <div className="space-y-2">
              <Label>Semaine (lundi)</Label>
              <Input data-testid="gen-week-start-input" type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Consignes pour l'IA (besoins, heures d'ouverture, événements…)</Label>
              <Textarea data-testid="gen-instructions-input" rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Ex. 2 personnes au labo en tout temps, vaccination jeudi PM, ouverture 8h-21h en semaine…" />
            </div>
            <div className="space-y-2">
              <Label>Délai maximal d'approbation par les employés</Label>
              <Select value={deadlineHours} onValueChange={setDeadlineHours}>
                <SelectTrigger data-testid="gen-deadline-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="24">24 heures</SelectItem>
                  <SelectItem value="48">48 heures</SelectItem>
                  <SelectItem value="72">72 heures</SelectItem>
                  <SelectItem value="168">7 jours</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">Sans réponse au délai, l'approbation de l'employé est considérée tacite.</p>
            </div>
            <Button data-testid="gen-submit-button" type="submit" disabled={busy} className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              {busy ? 'Lancement…' : 'Lancer la génération'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
