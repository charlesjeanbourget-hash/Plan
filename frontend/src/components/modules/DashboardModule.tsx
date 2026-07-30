import { useHR } from '@/context/HRContext';
import { useAuth } from '@/context/AuthContext';
import { ModuleHeader, StatCard, StatusBadge } from '@/components/modules/shared';
import { Users, CalendarClock, Briefcase, TreePalm } from 'lucide-react';

export default function DashboardModule(): JSX.Element {
  const { state, getEmployee } = useHR();
  const { currentUser } = useAuth();

  const today = new Date().toISOString().slice(0, 10);
  const activeEmployees = state.employees.filter((e) => e.status === 'Actif').length;
  const todayShifts = state.shifts.filter((s) => s.date === today);
  const pendingLeaves = state.leaveRequests.filter((l) => l.status === 'En attente').length;
  const activeOffers = state.jobOffers.filter((o) => o.active).length;
  const upcomingShifts = [...state.shifts].filter((s) => s.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);

  return (
    <div data-testid="dashboard-module">
      <ModuleHeader
        title={`Bonjour, ${currentUser?.name.split(' ')[0] ?? ''}`}
        subtitle="Voici l'état de votre pharmacie aujourd'hui."
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <StatCard label="Employés actifs" value={String(activeEmployees)} icon={Users} hint={`${state.employees.length} au total`} />
        <StatCard label="Quarts aujourd'hui" value={String(todayShifts.length)} icon={CalendarClock} hint="Comptoir et laboratoire" />
        <StatCard label="Demandes de congé" value={String(pendingLeaves)} icon={TreePalm} hint="En attente d'approbation" />
        <StatCard label="Offres actives" value={String(activeOffers)} icon={Briefcase} hint={`${state.candidates.length} candidatures reçues`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="font-heading text-base font-bold text-slate-900 mb-5">Prochains quarts de travail</h2>
          <div className="space-y-3">
            {upcomingShifts.map((s) => {
              const emp = getEmployee(s.employeeId);
              return (
                <div key={s.id} className="flex items-center gap-4 py-2 border-b border-slate-100 last:border-0">
                  <div className={`w-9 h-9 rounded-full ${emp?.avatarColor ?? 'bg-slate-400'} flex items-center justify-center text-white text-xs font-bold`}>
                    {emp ? `${emp.firstName[0]}${emp.lastName[0]}` : '?'}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-800">{emp ? `${emp.firstName} ${emp.lastName}` : 'Inconnu'}</p>
                    <p className="text-xs text-slate-500">{emp?.position}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-slate-800">{s.date === today ? "Aujourd'hui" : s.date}</p>
                    <p className="text-xs text-slate-500">{s.startTime} – {s.endTime}</p>
                  </div>
                </div>
              );
            })}
            {upcomingShifts.length === 0 && <p className="text-sm text-slate-500">Aucun quart planifié.</p>}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="font-heading text-base font-bold text-slate-900 mb-5">Tâches de l'équipe</h2>
          <div className="space-y-3">
            {state.tasks.map((t) => {
              const emp = getEmployee(t.assignedTo);
              return (
                <div key={t.id} className="flex items-center gap-4 py-2 border-b border-slate-100 last:border-0">
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-800">{t.title}</p>
                    <p className="text-xs text-slate-500">{emp ? `${emp.firstName} ${emp.lastName}` : '—'} · échéance {t.dueDate}</p>
                  </div>
                  <StatusBadge status={t.status} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
