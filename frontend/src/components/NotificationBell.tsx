import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { useHR } from '@/context/HRContext';
import { ModuleKey, LicenseReportItem, Training, ScheduleProposal, Evaluation, Delivery, Appointment } from '@/types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Bell, TreePalm, RefreshCw, BadgeCheck, GraduationCap, CheckCheck, CalendarCheck, ClipboardCheck, HandCoins, Truck, Stethoscope, X, Trash2 } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

interface Notif {
  id: string;
  title: string;
  detail: string;
  module: ModuleKey;
  tone: 'amber' | 'red' | 'sky' | 'emerald';
  icon: 'leave' | 'swap' | 'license' | 'training' | 'schedule' | 'eval' | 'salary' | 'delivery' | 'appointment';
}

const ICONS = { leave: TreePalm, swap: RefreshCw, license: BadgeCheck, training: GraduationCap, schedule: CalendarCheck, eval: ClipboardCheck, salary: HandCoins, delivery: Truck, appointment: Stethoscope } as const;

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
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [serverNotifs, setServerNotifs] = useState<{ id: string; title: string; detail: string; module: string; tone: string; icon: string }[]>([]);
  const [open, setOpen] = useState(false);
  const readKey = `luminahr_notif_read_v1_${currentUser?.id ?? ''}`;
  const [readIds, setReadIds] = useState<string[]>(() => {
    const raw = localStorage.getItem(`luminahr_notif_read_v1_${currentUser?.id ?? ''}`);
    return raw ? (JSON.parse(raw) as string[]) : [];
  });
  const dismissKey = `luminahr_notif_dismissed_v1_${currentUser?.id ?? ''}`;
  const [dismissedIds, setDismissedIds] = useState<string[]>(() => {
    const raw = localStorage.getItem(`luminahr_notif_dismissed_v1_${currentUser?.id ?? ''}`);
    return raw ? (JSON.parse(raw) as string[]) : [];
  });

  useEffect(() => {
    if (!token || !currentUser) return;
    const headers = { Authorization: `Bearer ${token}` };
    const loadServer = (): void => {
      axios.get<typeof serverNotifs>(`${API}/notifications`, { headers })
        .then((r) => setServerNotifs(r.data))
        .catch(() => undefined);
    };
    loadServer();
    const intervalId = window.setInterval(loadServer, 30000);
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
      axios.get<Delivery[]>(`${API}/deliveries`, { headers })
        .then((r) => setDeliveries(r.data))
        .catch(() => undefined);
      const d = new Date();
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      axios.get<Appointment[]>(`${API}/appointments?start=${today}&end=${today}`, { headers })
        .then((r) => setAppointments(r.data))
        .catch(() => undefined);
    } else {
      axios.get<{ items: LicenseReportItem[] }>(`${API}/licenses/report`, { headers })
        .then((r) => setLicenseItems(r.data.items))
        .catch(() => undefined);
    }
    return () => window.clearInterval(intervalId);
  }, [token, currentUser]);

  const notifs = useMemo<Notif[]>(() => {
    if (!currentUser) return [];
    const list: Notif[] = [];
    serverNotifs.forEach((n) => list.push({
      id: `srv-${n.id}`,
      title: n.title,
      detail: n.detail,
      module: (n.module || 'dashboard') as ModuleKey,
      tone: (['amber', 'red', 'sky', 'emerald'].includes(n.tone) ? n.tone : 'emerald') as Notif['tone'],
      icon: (n.icon in ICONS ? n.icon : 'schedule') as Notif['icon'],
    }));
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
      state.shiftSwaps
        .filter((s) => s.targetEmployeeId === empId && s.status === 'En attente' && s.peerStatus === 'En attente')
        .forEach((s) => {
          const req = getEmployee(s.requesterId);
          list.push({
            id: `swap-accept-${s.id}`,
            title: 'Échange de quart à accepter',
            detail: `${req ? `${req.firstName} ${req.lastName}` : 'Un(e) collègue'} vous propose de reprendre un quart — répondez dans « Mon espace »`,
            module: 'myspace',
            tone: 'amber',
            icon: 'swap',
          });
        });
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
      const myAppts = appointments
        .filter((a) => a.employee_id === empId)
        .sort((a, b) => a.start.localeCompare(b.start));
      if (myAppts.length > 0) {
        list.push({
          id: `appts-${myAppts[0].date}-${myAppts.length}`,
          title: myAppts.length > 1 ? `${myAppts.length} rendez-vous aujourd'hui` : 'Rendez-vous aujourd\'hui',
          detail: `Premier à ${myAppts[0].start} — ${myAppts[0].client_name}${myAppts[0].reason ? ` (${myAppts[0].reason})` : ''}`,
          module: 'myspace',
          tone: 'sky',
          icon: 'appointment',
        });
      }
      deliveries
        .filter((d) => d.status !== 'livree')
        .forEach((d) => list.push({
          id: `delivery-${d.id}-${d.status}`,
          title: d.status === 'a_ramasser'
            ? (d.priority === 'urgent' ? 'Livraison URGENTE à ramasser' : 'Livraison à ramasser')
            : 'Livraison en cours',
          detail: `${d.client_name} — ${d.address}`,
          module: 'deliveries',
          tone: d.priority === 'urgent' ? 'red' : 'sky',
          icon: 'delivery',
        }));
    } else {
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
    return list.filter((n) => !dismissedIds.includes(n.id));
  }, [currentUser, state, trainings, licenseItems, proposals, evaluations, deliveries, appointments, serverNotifs, getEmployee, dismissedIds]);

  const unreadCount = notifs.filter((n) => !readIds.includes(n.id)).length;

  const persist = (ids: string[]): void => {
    setReadIds(ids);
    localStorage.setItem(readKey, JSON.stringify(ids));
  };

  const persistDismissed = (ids: string[]): void => {
    const capped = ids.slice(-300);
    setDismissedIds(capped);
    localStorage.setItem(dismissKey, JSON.stringify(capped));
  };

  const dismissNotif = (id: string): void => {
    persistDismissed([...dismissedIds, id]);
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
            <div className="flex items-center gap-3">
              <button
                data-testid="mark-all-read-button"
                onClick={() => persist(notifs.map((n) => n.id))}
                className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:text-emerald-900 font-semibold"
              >
                <CheckCheck className="w-3.5 h-3.5" /> Tout lu
              </button>
              <button
                data-testid="dismiss-all-button"
                onClick={() => persistDismissed([...dismissedIds, ...notifs.map((n) => n.id)])}
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-red-600 font-semibold"
              >
                <Trash2 className="w-3.5 h-3.5" /> Tout effacer
              </button>
            </div>
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
              <div
                key={n.id}
                data-testid={`notification-item-${n.id}`}
                role="button"
                tabIndex={0}
                onClick={() => clickNotif(n)}
                onKeyDown={(e) => { if (e.key === 'Enter') clickNotif(n); }}
                className={`group w-full flex items-start gap-3 px-4 py-3 text-left border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors cursor-pointer ${isRead ? 'opacity-60' : ''}`}
              >
                <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${TONES[n.tone]}`}>
                  <Icon className="w-4 h-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-800">{n.title}</span>
                  <span className="block text-xs text-slate-500 truncate">{n.detail}</span>
                </span>
                {!isRead && <span className="w-2 h-2 rounded-full bg-emerald-500 mt-1.5 shrink-0" />}
                <button
                  data-testid={`notification-dismiss-${n.id}`}
                  aria-label="Fermer la notification"
                  onClick={(e) => { e.stopPropagation(); dismissNotif(n.id); }}
                  className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-slate-300 hover:text-red-600 hover:bg-red-50 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
};
