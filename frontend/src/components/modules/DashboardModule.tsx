import { useState, useEffect } from 'react';
import axios from 'axios';
import { useHR } from '@/context/HRContext';
import { useAuth } from '@/context/AuthContext';
import { ModuleHeader, StatCard, StatusBadge } from '@/components/modules/shared';
import { HonorRoll } from '@/components/HonorRoll';
import { Users, CalendarClock, Briefcase, TreePalm, BadgeAlert } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function DashboardModule(): JSX.Element {
  const { state, getEmployee } = useHR();
  const { currentUser, token } = useAuth();
  const [expiringCount, setExpiringCount] = useState(0);

  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'manager' || currentUser?.role === 'superadmin';

  useEffect(() => {
    if (!isAdmin || !token) return;
    axios
      .get<{ items: unknown[] }>(`${API}/licenses/report`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => setExpiringCount(res.data.items.length))
      .catch(() => setExpiringCount(0));
  }, [isAdmin, token]);

  const today = new Date().toISOString().slice(0, 10);
  const activeEmployees = state.employees.filter((e) => e.status === 'Actif').length;
  const todayShifts = state.shifts.filter((s) => s.date === today);
  const pendingLeaves = state.leaveRequests.filter((l) => l.status === 'En attente').length;
  const activeOffers = state.jobOffers.filter((o) => o.active).length;
  const upcomingShifts = [...state.shifts].filter((s) => s.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);

  return (
    <div data-testid="dashboard-module">
      <ModuleHeader
        title={`Bonjour, ${currentUser?.name ?? ''}`}
        subtitle="Voici l'état de votre pharmacie aujourd'hui."
      />
      {isAdmin && expiringCount > 0 && (
        <div data-testid="license-alert-banner" className="mb-8 flex items-center gap-4 rounded-xl border border-amber-300 bg-amber-50 px-5 py-4">
          <div className="relative">
            <BadgeAlert className="w-6 h-6 text-amber-600" />
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-900">
              {expiringCount} licence{expiringCount > 1 ? 's' : ''} professionnelle{expiringCount > 1 ? 's' : ''} arrive{expiringCount > 1 ? 'nt' : ''} à échéance dans les 60 prochains jours
            </p>
            <p className="text-xs text-amber-700">Consultez le module « Licences pro. » pour les détails et le renouvellement.</p>
          </div>
          <span data-testid="license-alert-count" className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-amber-600 text-white text-sm font-bold">
            {expiringCount}
          </span>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <StatCard label="Employés actifs" value={String(activeEmployees)} icon={Users} hint={`${state.employees.length} au total`} />
        <StatCard label="Quarts aujourd'hui" value={String(todayShifts.length)} icon={CalendarClock} hint="Comptoir et laboratoire" />
        <StatCard label="Demandes de congé" value={String(pendingLeaves)} icon={TreePalm} hint="En attente d'approbation" />
        <StatCard label="Offres actives" value={String(activeOffers)} icon={Briefcase} hint={`${state.candidates.length} candidatures reçues`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <HonorRoll />
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
