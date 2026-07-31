import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { BarChart3, Users, CalendarRange, Award, Flame, Medal, Trophy, Crown, HeartHandshake, Send, LucideIcon } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

interface WeekStat { week_start: string; total: number; done: number; rate: number }
interface ShiftStat { shift: string; total: number; done: number; rate: number }
interface BadgeInfo { key: string; label: string; description: string }
interface EmployeeStat {
  name: string; total: number; done: number; rate: number; team_checks: number;
  current_streak: number; perfect_weeks: number; badges: BadgeInfo[];
}
interface TaskStats {
  weekly: WeekStat[];
  by_shift: ShiftStat[];
  by_employee: EmployeeStat[];
  team: { total: number; done: number; rate: number };
}

const BADGE_ICONS: Record<string, LucideIcon> = {
  perfect_week: Medal,
  streak_2: Flame,
  streak_4: Trophy,
  streak_8: Crown,
  team_5: HeartHandshake,
  team_20: Award,
};

const rateColor = (rate: number): string =>
  rate >= 85 ? 'text-emerald-700' : rate >= 60 ? 'text-bronze-700' : 'text-red-600';

const barColor = (rate: number): string =>
  rate >= 85 ? 'bg-emerald-500' : rate >= 60 ? 'bg-bronze-500' : 'bg-red-500';

const RateBar = ({ rate }: { rate: number }): JSX.Element => (
  <div className="h-2 flex-1 rounded-full bg-slate-100 overflow-hidden min-w-[80px]">
    <div className={`h-full rounded-full ${barColor(rate)}`} style={{ width: `${rate}%` }} />
  </div>
);

export const TaskStatsPanel = ({ isAdmin }: { isAdmin: boolean }): JSX.Element => {
  const { token } = useAuth();
  const [stats, setStats] = useState<TaskStats | null>(null);
  const [error, setError] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    axios.get<TaskStats>(`${API}/tasks/stats?weeks=8`, { headers: { Authorization: `Bearer ${token ?? ''}` } })
      .then((r) => setStats(r.data))
      .catch(() => setError(true));
  }, [token]);

  const sendWeeklyReport = async (): Promise<void> => {
    setSending(true);
    try {
      const res = await axios.post<{ sent: number }>(`${API}/tasks/weekly-report/run`, {}, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      if (res.data.sent > 0) {
        toast.success(`Rapport hebdo envoyé — ${res.data.sent} courriel(s) aux gestionnaires.`);
      } else {
        toast.info('Aucun courriel livré : aucune tâche la semaine dernière, ou envoi limité par le mode test Resend (domaine à vérifier sur resend.com).');
      }
    } catch {
      toast.error('Envoi du rapport impossible.');
    } finally {
      setSending(false);
    }
  };

  if (error) return <p className="text-sm text-red-600">Impossible de charger les statistiques.</p>;
  if (!stats) return <p className="text-sm text-slate-400">Chargement des statistiques…</p>;

  const hasData = stats.weekly.length > 0;
  const me = !isAdmin ? stats.by_employee[0] : undefined;

  return (
    <div data-testid="task-stats-panel" className="space-y-6">
      {isAdmin && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">
            Un rapport récapitulatif (taux par quart, par employé, quarts à surveiller) est envoyé automatiquement
            aux gestionnaires <span className="font-semibold text-slate-700">chaque lundi à 7 h</span>.
          </p>
          <Button
            data-testid="send-weekly-report-button"
            size="sm"
            variant="outline"
            disabled={sending}
            onClick={() => void sendWeeklyReport()}
            className="rounded-full text-xs border-bronze-300 text-bronze-800 hover:bg-bronze-50"
          >
            <Send className="w-3.5 h-3.5 mr-1.5" /> {sending ? 'Envoi…' : 'Envoyer le rapport maintenant'}
          </Button>
        </div>
      )}
      {me && (
        <div data-testid="badges-panel" className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="font-heading text-base font-bold text-slate-900 mb-1 inline-flex items-center gap-2">
            <Award className="w-4 h-4 text-bronze-600" /> Vos badges
          </h2>
          {me.current_streak >= 1 && (
            <p data-testid="badge-streak-label" className="text-sm font-semibold text-bronze-800 inline-flex items-center gap-1.5 mb-3">
              <Flame className="w-4 h-4 text-bronze-600" /> Série en cours : {me.current_streak} semaine{me.current_streak > 1 ? 's' : ''} parfaite{me.current_streak > 1 ? 's' : ''} d'affilée
            </p>
          )}
          {me.badges.length === 0 ? (
            <p className="text-sm text-slate-500">
              Complétez toutes vos tâches d'une semaine pour décrocher votre premier badge « Semaine parfaite ».
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {me.badges.map((b) => {
                const Icon = BADGE_ICONS[b.key] ?? Medal;
                return (
                  <div key={b.key} data-testid={`badge-${b.key}`} className="flex items-start gap-3 rounded-xl border border-bronze-200 bg-bronze-50/50 p-4">
                    <div className="w-9 h-9 rounded-full bg-bronze-100 border border-bronze-300 flex items-center justify-center shrink-0">
                      <Icon className="w-5 h-5 text-bronze-700" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900">{b.label}</p>
                      <p className="text-xs text-slate-500">{b.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {!hasData ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
          <p className="text-sm text-slate-500">Aucune donnée pour l'instant — les statistiques apparaîtront dès que des tâches auront été distribuées.</p>
        </div>
      ) : (
        <>
          <div>
            <h2 className="font-heading text-base font-bold text-slate-900 mb-3 inline-flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-bronze-600" /> {isAdmin ? 'Taux de complétion par quart (8 dernières semaines)' : 'Vos taux de complétion par quart (8 dernières semaines)'}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" data-testid="stats-by-shift">
              {stats.by_shift.map((s) => (
                <div key={s.shift} data-testid={`stats-shift-${s.shift}`} className="bg-white rounded-xl border border-slate-200 p-5">
                  <p className="text-xs uppercase tracking-[0.15em] text-slate-500 font-semibold mb-1">{s.shift}</p>
                  <p className={`font-heading text-3xl font-extrabold ${rateColor(s.rate)}`}>{s.rate} %</p>
                  <p className="text-xs text-slate-500 mb-2">{s.done}/{s.total} tâches complétées</p>
                  <RateBar rate={s.rate} />
                  {s.rate < 60 && <p className="text-[11px] text-red-600 font-semibold mt-2">Ce quart accroche — à surveiller</p>}
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="font-heading text-base font-bold text-slate-900 mb-4 inline-flex items-center gap-2">
              <CalendarRange className="w-4 h-4 text-bronze-600" /> Historique par semaine
            </h2>
            <div className="space-y-2.5">
              {stats.weekly.map((w, i) => (
                <div key={w.week_start} data-testid={`stats-week-${w.week_start}`} className="flex flex-wrap items-center gap-3">
                  <span className="text-xs font-semibold text-slate-600 w-40">
                    Semaine du {w.week_start}{i === 0 && <span className="text-emerald-700"> (en cours)</span>}
                  </span>
                  <RateBar rate={w.rate} />
                  <span className={`text-xs font-bold w-24 text-right ${rateColor(w.rate)}`}>{w.done}/{w.total} · {w.rate} %</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="font-heading text-base font-bold text-slate-900 mb-1 inline-flex items-center gap-2">
              <Users className="w-4 h-4 text-bronze-600" /> {isAdmin ? 'Par employé' : 'Votre bilan personnel'}
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              {isAdmin
                ? <>Tâches assignées personnellement + coups de main sur les tâches d'équipe ({stats.team.done}/{stats.team.total} tâches d'équipe complétées).</>
                : <>Vos tâches assignées + vos coups de main sur les tâches d'équipe ({stats.team.done}/{stats.team.total} tâches d'équipe complétées au total).</>}
            </p>
            {stats.by_employee.length === 0 ? (
              <p className="text-sm text-slate-400">Aucune tâche assignée à un employé pour le moment.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-slate-200">
                      <th className="p-3">Employé(e)</th>
                      <th className="p-3">Tâches assignées</th>
                      <th className="p-3 w-1/3">Taux de complétion</th>
                      <th className="p-3 text-right">Tâches d'équipe cochées</th>
                      <th className="p-3 text-right">Badges</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.by_employee.map((e) => (
                      <tr key={e.name} data-testid={`stats-employee-${e.name}`} className="border-b border-slate-100 last:border-0">
                        <td className="p-3 font-semibold text-slate-800">{e.name}</td>
                        <td className="p-3 text-slate-600">{e.total > 0 ? `${e.done}/${e.total}` : '—'}</td>
                        <td className="p-3">
                          {e.total > 0 ? (
                            <div className="flex items-center gap-2">
                              <RateBar rate={e.rate} />
                              <span className={`text-xs font-bold ${rateColor(e.rate)}`}>{e.rate} %</span>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>
                        <td className="p-3 text-right font-semibold text-emerald-700">{e.team_checks}</td>
                        <td className="p-3 text-right">
                          <div className="inline-flex items-center gap-1.5 justify-end">
                            {e.current_streak >= 2 && (
                              <span title={`Série en cours : ${e.current_streak} semaines parfaites d'affilée`} className="inline-flex items-center gap-0.5 text-bronze-700 font-bold text-xs">
                                <Flame className="w-3.5 h-3.5" />{e.current_streak}
                              </span>
                            )}
                            {e.badges.map((b) => {
                              const Icon = BADGE_ICONS[b.key] ?? Medal;
                              return (
                                <span key={b.key} title={`${b.label} — ${b.description}`}>
                                  <Icon className="w-3.5 h-3.5 text-bronze-600" />
                                </span>
                              );
                            })}
                            {e.badges.length === 0 && e.current_streak < 2 && <span className="text-xs text-slate-300">—</span>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
