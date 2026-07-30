import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { useHR } from '@/context/HRContext';
import { ModuleKey, LicenseReportItem, Training, ScheduleProposal, Evaluation } from '@/types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Bell, TreePalm, RefreshCw, BadgeCheck, GraduationCap, CheckCheck, CalendarCheck, ClipboardCheck, HandCoins } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

interface Notif {
  id: string;
  title: string;
  detail: string;
  module: ModuleKey;
  tone: 'amber' | 'red' | 'sky' | 'emerald';
  icon: 'leave' | 'swap' | 'license' | 'training' | 'schedule' | 'eval' | 'salary';
}

const ICONS = { leave: TreePalm, swap: RefreshCw, license: BadgeCheck, training: GraduationCap, schedule: CalendarCheck, eval: ClipboardCheck, salary: HandCoins } as const;

const TONES: Record<Notif['tone'], string> = {
  amber: 'bg-bronze-100 text-bronze-700',
  red: 'bg-red-100 text-red-700',
  sky: 'bg-sky-100 text-sky-700',
  emerald: 'bg-emerald-100 text-emerald-700',
};

export const NotificationBell = ({ onNavigate }: { onNavigate: (m: ModuleKey) => void }): JSX.Element => {
  const { currentUser, token } = useAuth();
  const { state, getEmployee } = useHR();
  const [licenseItems, setLicenseItems] = useState<LicenseReportItem[]>([]);
  const [trainings, setTrainings] = useState<Training[]>([]);
  const [proposals, setProposals] = useState<ScheduleProposal[]>([]);
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [open, setOpen] = useState(false);
  const readKey = `luminahr_notif_read_v1_${currentUser?.id ?? ''}`;
  const [readIds, setReadIds] = useState<string[]>(() => {
    const raw = localStorage.getItem(`luminahr_notif_read_v1_${currentUser?.id ?? ''}`);
    return raw ? (JSON.parse(raw) as string[]) : [];
  });

  useEffect(() => {
    if (!token || !currentUser) return;
    const headers = { Authorization: `Bearer ${token}` };
    if (currentUser.role === 'employee') {
      axios.get<Training[]>(`${API}/trainings`, { headers })
        .then((r) => setTrainings(r.data))
        .catch(() => undefined);
      axios.get<ScheduleProposal[]>(`${API}/schedule/proposals`, { headers })
        .then((r) => setProposals(r.data))
        .catch(() => undefined);
      axios.get<Evaluation[]>(`${API}/evaluations`, { headers })
        .then((r) => setEvaluations(r.data))
        .catch(() => undefined);
    } else {
      axios.get<{ items: LicenseReportItem[] }>(`${API}/licenses/report`, { headers })
        .then((r) => setLicenseItems(r.data.items))
        .catch(() => undefined);
    }
  }, [token, currentUser]);

  const notifs = useMemo<Notif[]>(() => {
    if (!currentUser) return [];
    const list: Notif[] = [];
    if (currentUser.role === 'employee') {
      const empId = currentUser.employeeId;
      proposals
        .filter((p) => p.employee_approvals[empId ?? '']?.status === 'pending' && !p.deadline_passed)
        .forEach((p) => list.push({
          id: `proposal-${p.id}`,
          title: 'Horaire à approuver',
          detail: `Semaine du ${p.week_start} — répondez avant le ${new Date(p.approval_deadline).toLocaleString('fr-CA', { dateStyle: 'short', timeStyle: 'short' })}`,
          module: 'myspace',
          tone: 'amber',
          icon: 'schedule',
        }));
      state.leaveRequests
        .filter((l) => l.employeeId === empId && l.status !== 'En attente')
        .forEach((l) => list.push({
          id: `leave-${l.id}-${l.status}`,
          title: `Congé ${l.status === 'Approuvée' ? 'approuvé' : 'refusé'}`,
          detail: `${l.type} du ${l.startDate} au ${l.endDate}`,
          module: 'myspace',
          tone: l.status === 'Approuvée' ? 'emerald' : 'red',
          icon: 'leave',
        }));
      state.shiftSwaps
        .filter((s) => s.requesterId === empId && s.status !== 'En attente')
        .forEach((s) => list.push({
          id: `swap-${s.id}-${s.status}`,
          title: `Échange de quart ${s.status === 'Approuvée' ? 'approuvé' : 'refusé'}`,
          detail: s.reason || 'Votre demande a été traitée.',
          module: 'myspace',
          tone: s.status === 'Approuvée' ? 'emerald' : 'red',
          icon: 'swap',
        }));
      trainings
        .filter((t) => !t.my_passed)
        .forEach((t) => {
          const due = t.my_assignment?.due_date;
          const overdue = !!due && due < new Date().toISOString().slice(0, 10);
          list.push({
            id: `training-${t.id}${due ? `-${due}` : ''}`,
            title: overdue ? 'Formation en retard' : 'Formation à compléter',
            detail: due ? `${t.title} — avant le ${due}` : t.title,
            module: 'training',
            tone: overdue ? 'red' : 'sky',
            icon: 'training',
          });
        });
      evaluations
        .filter((ev) => !ev.self_eval && ev.status === 'en_cours')
        .forEach((ev) => list.push({
          id: `eval-self-${ev.id}`,
          title: 'Auto-évaluation à compléter',
          detail: `Évaluation lancée le ${ev.created_at.slice(0, 10)} — complétez-la dans « Mon espace »`,
          module: 'myspace',
          tone: 'amber',
          icon: 'eval',
        }));
      evaluations
        .filter((ev) => ev.status === 'propose' && ev.proposed_rate !== null)
        .forEach((ev) => list.push({
          id: `eval-prop-${ev.id}`,
          title: 'Proposition salariale reçue',
          detail: `Nouveau taux proposé : ${ev.proposed_rate} $/h — répondez dans « Mon espace »`,
          module: 'myspace',
          tone: 'emerald',
          icon: 'salary',
        }));
    } else {
      state.leaveRequests
        .filter((l) => l.status === 'En attente')
        .forEach((l) => {
          const emp = getEmployee(l.employeeId);
          list.push({
            id: `leave-${l.id}`,
            title: 'Demande de congé en attente',
            detail: `${emp ? `${emp.firstName} ${emp.lastName}` : 'Employé'} — ${l.type} du ${l.startDate} au ${l.endDate}`,
            module: 'vacations',
            tone: 'amber',
            icon: 'leave',
          });
        });
      state.shiftSwaps
        .filter((s) => s.status === 'En attente')
        .forEach((s) => {
          const emp = getEmployee(s.requesterId);
          list.push({
            id: `swap-${s.id}`,
            title: 'Échange de quart à approuver',
            detail: `${emp ? `${emp.firstName} ${emp.lastName}` : 'Employé'} — ${s.reason || 'sans motif'}`,
            module: 'scheduling',
            tone: 'amber',
            icon: 'swap',
          });
        });
      licenseItems.forEach((i) => list.push({
        id: `license-${i.id}-${i.expiry_date}`,
        title: i.days_remaining < 0 ? 'Licence expirée' : `Licence expire dans ${i.days_remaining} jour(s)`,
        detail: `${i.employee_name} — ${i.license_number}`,
        module: 'licenses',
        tone: i.days_remaining < 0 ? 'red' : 'amber',
        icon: 'license',
      }));
    }
    return list;
  }, [currentUser, state, trainings, licenseItems, proposals, evaluations, getEmployee]);

  const unreadCount = notifs.filter((n) => !readIds.includes(n.id)).length;

  const persist = (ids: string[]): void => {
    setReadIds(ids);
    localStorage.setItem(readKey, JSON.stringify(ids));
  };

  const clickNotif = (n: Notif): void => {
    if (!readIds.includes(n.id)) persist([...readIds, n.id]);
    setOpen(false);
    onNavigate(n.module);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          data-testid="notification-bell"
          className="fixed top-5 right-6 z-40 w-11 h-11 rounded-full bg-white border border-slate-200 shadow-md flex items-center justify-center text-slate-600 hover:text-emerald-700 hover:border-emerald-300 transition-colors"
          aria-label="Notifications"
        >
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <span
              data-testid="notification-badge"
              className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-red-600 text-white text-[11px] font-bold flex items-center justify-center"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-96 p-0" data-testid="notification-panel">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <p className="font-heading font-bold text-sm text-slate-900">Notifications</p>
          {notifs.length > 0 && (
            <button
              data-testid="mark-all-read-button"
              onClick={() => persist(notifs.map((n) => n.id))}
              className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:text-emerald-900 font-semibold"
            >
              <CheckCheck className="w-3.5 h-3.5" /> Tout marquer comme lu
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {notifs.length === 0 && (
            <p data-testid="notification-empty" className="p-8 text-sm text-slate-500 text-center">Aucune notification.</p>
          )}
          {notifs.map((n) => {
            const Icon = ICONS[n.icon];
            const isRead = readIds.includes(n.id);
            return (
              <button
                key={n.id}
                data-testid={`notification-item-${n.id}`}
                onClick={() => clickNotif(n)}
                className={`w-full flex items-start gap-3 px-4 py-3 text-left border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors ${isRead ? 'opacity-60' : ''}`}
              >
                <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${TONES[n.tone]}`}>
                  <Icon className="w-4 h-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-800">{n.title}</span>
                  <span className="block text-xs text-slate-500 truncate">{n.detail}</span>
                </span>
                {!isRead && <span className="w-2 h-2 rounded-full bg-emerald-500 mt-1.5 shrink-0" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
};
