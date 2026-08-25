import { useState, useCallback, useEffect } from 'react';
import '@/App.css';
import { View, ModuleKey } from '@/types';
import { useAuth } from '@/context/AuthContext';
import LandingPage from '@/components/LandingPage';
import PunchKiosk from '@/components/PunchKiosk';
import PublicReplacementPage from '@/components/PublicReplacementPage';
import LoginPage from '@/components/LoginPage';
import PublicCareers from '@/components/PublicCareers';
import AgencyPortal from '@/components/AgencyPortal';
import Sidebar from '@/components/Sidebar';
import ChatWidget from '@/components/ChatWidget';
import DashboardModule from '@/components/modules/DashboardModule';
import EmployeeDossier from '@/components/modules/EmployeeDossier';
import ResourcesModule from '@/components/modules/ResourcesModule';
import PrivacyPolicy from '@/components/PrivacyPolicy';
import SecurityPage from '@/components/SecurityPage';
import { ForcePasswordChangeDialog } from '@/components/ForcePasswordChangeDialog';
import { ForceMfaDialog } from '@/components/ForceMfaDialog';
import { PrivacyConsentDialog } from '@/components/PrivacyConsentDialog';
import SchedulingModule from '@/components/modules/SchedulingModule';
import RecruitmentModule from '@/components/modules/RecruitmentModule';
import PayrollModule from '@/components/modules/PayrollModule';
import ReplacementModule from '@/components/modules/ReplacementModule';
import VacationModule from '@/components/modules/VacationModule';
import PerformanceModule from '@/components/modules/PerformanceModule';
import OnboardingModule from '@/components/modules/OnboardingModule';
import ContractsModule from '@/components/modules/ContractsModule';
import BenefitsModule from '@/components/modules/BenefitsModule';
import FAQModule from '@/components/modules/FAQModule';
import SuperadminModule from '@/components/modules/SuperadminModule';
import LicensesModule from '@/components/modules/LicensesModule';
import MySpaceModule from '@/components/modules/MySpaceModule';
import TrainingModule from '@/components/modules/TrainingModule';
import TasksModule from '@/components/modules/TasksModule';
import DeliveriesModule from '@/components/modules/DeliveriesModule';
import MessagesModule from '@/components/modules/MessagesModule';
import TeamModule from '@/components/modules/TeamModule';
import SstModule from '@/components/modules/SstModule';
import ReportsModule from '@/components/modules/ReportsModule';
import { NotificationBell } from '@/components/NotificationBell';

const MODULES: Record<ModuleKey, () => JSX.Element> = {
  dashboard: DashboardModule,
  tasks: TasksModule,
  deliveries: DeliveriesModule,
  myspace: MySpaceModule,
  messages: MessagesModule,
  team: TeamModule,
  employees: EmployeeDossier,
  licenses: LicensesModule,
  scheduling: SchedulingModule,
  resources: ResourcesModule,
  recruitment: RecruitmentModule,
  payroll: PayrollModule,
  replacements: ReplacementModule,
  vacations: VacationModule,
  performance: PerformanceModule,
  onboarding: OnboardingModule,
  contracts: ContractsModule,
  benefits: BenefitsModule,
  faq: FAQModule,
  training: TrainingModule,
  sst: SstModule,
  reports: ReportsModule,
  superadmin: SuperadminModule,
};

function App(): JSX.Element {
  const { currentUser, logout } = useAuth();
  const [view, setView] = useState<View>(currentUser ? 'dashboard' : 'landing');
  const [activeModule, setActiveModule] = useState<ModuleKey>('dashboard');

  const navigate = useCallback((v: View) => setView(v), []);

  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent).detail as { module: ModuleKey; payload?: unknown };
      if (detail.payload) sessionStorage.setItem('ap_nav_payload', JSON.stringify(detail.payload));
      setView('dashboard');
      setActiveModule(detail.module);
    };
    window.addEventListener('ap-navigate', handler);
    return () => window.removeEventListener('ap-navigate', handler);
  }, []);

  useEffect(() => {
    if (currentUser?.role === 'superadmin') setActiveModule('superadmin');
  }, [currentUser?.role]);

  useEffect(() => {
    // Entrée dans un champ = passer au champ suivant (au lieu de soumettre le formulaire)
    const onEnter = (e: KeyboardEvent): void => {
      if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement;
      if (!(target instanceof HTMLInputElement)) return;
      if (['checkbox', 'radio', 'button', 'submit', 'reset', 'file'].includes(target.type)) return;
      const form = target.closest('form');
      if (!form) return;
      e.preventDefault();
      e.stopPropagation();
      const fields = Array.from(form.querySelectorAll<HTMLElement>(
        'input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [role="combobox"]'
      )).filter((el) => {
        if (el.offsetParent === null) return false;
        if (el instanceof HTMLInputElement && ['checkbox', 'radio', 'button', 'submit', 'reset', 'file'].includes(el.type)) return false;
        return true;
      });
      const idx = fields.indexOf(target);
      const next = fields[idx + 1];
      if (next) {
        next.focus();
        return;
      }
      const submit = form.querySelector<HTMLElement>('button[type="submit"], input[type="submit"]');
      if (submit && submit.offsetParent !== null) submit.focus();
    };
    document.addEventListener('keydown', onEnter, true);
    return () => document.removeEventListener('keydown', onEnter, true);
  }, []);

  const replacementToken = new URLSearchParams(window.location.search).get('remplacement');
  if (replacementToken) {
    return (
      <div className="App">
        <PublicReplacementPage token={replacementToken} />
      </div>
    );
  }

  const handleLogout = (): void => {
    logout();
    setActiveModule('dashboard');
    setView('landing');
  };

  if (view === 'dashboard' && currentUser) {
    if (currentUser.isTemporaryPassword || currentUser.passwordExpired) {
      return (
        <div className="App">
          <ForcePasswordChangeDialog expired={!currentUser.isTemporaryPassword} />
        </div>
      );
    }
    if (!currentUser.privacyAcceptedAt) {
      return (
        <div className="App">
          <PrivacyConsentDialog />
        </div>
      );
    }
    if (currentUser.mfaSetupRequired && !currentUser.mfaEnabled) {
      return (
        <div className="App">
          <ForceMfaDialog />
        </div>
      );
    }
    const ActiveModule = MODULES[activeModule];
    return (
      <div className="App flex min-h-screen bg-slate-50" data-testid="dashboard-layout">
        <Sidebar active={activeModule} onSelect={setActiveModule} onLogout={handleLogout} />
        <NotificationBell onNavigate={setActiveModule} />
        <main className="flex-1 min-w-0 lg:ml-64 p-4 pt-20 sm:p-6 sm:pt-20 md:p-10 md:pt-20 lg:pt-10">
          <ActiveModule />
        </main>
        <ChatWidget />
      </div>
    );
  }

  return (
    <div className="App">
      {view === 'login' ? (
        <LoginPage onNavigate={navigate} onSuccess={() => setView('dashboard')} />
      ) : view === 'careers' ? (
        <PublicCareers onNavigate={navigate} />
      ) : view === 'agency' ? (
        <AgencyPortal onNavigate={navigate} />
      ) : view === 'punch' ? (
        <PunchKiosk onNavigate={navigate} />
      ) : view === 'privacy' ? (
        <PrivacyPolicy onNavigate={navigate} />
      ) : view === 'security' ? (
        <SecurityPage onNavigate={navigate} />
      ) : (
        <LandingPage onNavigate={navigate} />
      )}
    </div>
  );
}

export default App;
