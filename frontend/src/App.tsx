import { useState, useCallback } from 'react';
import '@/App.css';
import { View, ModuleKey } from '@/types';
import { useAuth } from '@/context/AuthContext';
import LandingPage from '@/components/LandingPage';
import LoginPage from '@/components/LoginPage';
import PublicCareers from '@/components/PublicCareers';
import AgencyPortal from '@/components/AgencyPortal';
import Sidebar from '@/components/Sidebar';
import ChatWidget from '@/components/ChatWidget';
import DashboardModule from '@/components/modules/DashboardModule';
import EmployeeDossier from '@/components/modules/EmployeeDossier';
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

const MODULES: Record<ModuleKey, () => JSX.Element> = {
  dashboard: DashboardModule,
  myspace: MySpaceModule,
  employees: EmployeeDossier,
  licenses: LicensesModule,
  scheduling: SchedulingModule,
  recruitment: RecruitmentModule,
  payroll: PayrollModule,
  replacements: ReplacementModule,
  vacations: VacationModule,
  performance: PerformanceModule,
  onboarding: OnboardingModule,
  contracts: ContractsModule,
  benefits: BenefitsModule,
  faq: FAQModule,
  superadmin: SuperadminModule,
};

function App(): JSX.Element {
  const { currentUser, logout } = useAuth();
  const [view, setView] = useState<View>(currentUser ? 'dashboard' : 'landing');
  const [activeModule, setActiveModule] = useState<ModuleKey>('dashboard');

  const navigate = useCallback((v: View) => setView(v), []);

  const handleLogout = (): void => {
    logout();
    setActiveModule('dashboard');
    setView('landing');
  };

  if (view === 'dashboard' && currentUser) {
    const ActiveModule = MODULES[activeModule];
    return (
      <div className="App flex min-h-screen bg-slate-50" data-testid="dashboard-layout">
        <Sidebar active={activeModule} onSelect={setActiveModule} onLogout={handleLogout} />
        <main className="flex-1 min-w-0 lg:ml-64 p-6 md:p-10">
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
      ) : (
        <LandingPage onNavigate={navigate} />
      )}
    </div>
  );
}

export default App;
