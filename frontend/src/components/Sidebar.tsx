import { useState } from 'react';
import { ModuleKey } from '@/types';
import { useAuth } from '@/context/AuthContext';
import {
  LayoutDashboard, Users, CalendarClock, Briefcase, Wallet, RefreshCw, TreePalm,
  TrendingUp, ClipboardCheck, FileText, HeartHandshake, HelpCircle, ShieldCheck,
  LogOut, Pill, Menu, X, LucideIcon, BadgeCheck, UserRound,
} from 'lucide-react';

interface Props {
  active: ModuleKey;
  onSelect: (m: ModuleKey) => void;
  onLogout: () => void;
}

interface NavItem {
  key: ModuleKey;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
  { key: 'myspace', label: 'Mon espace', icon: UserRound },
  { key: 'employees', label: 'Employés', icon: Users },
  { key: 'licenses', label: 'Licences pro.', icon: BadgeCheck },
  { key: 'scheduling', label: 'Horaires', icon: CalendarClock },
  { key: 'recruitment', label: 'Recrutement', icon: Briefcase },
  { key: 'payroll', label: 'Paie', icon: Wallet },
  { key: 'replacements', label: 'Remplacements', icon: RefreshCw },
  { key: 'vacations', label: 'Vacances', icon: TreePalm },
  { key: 'performance', label: 'Performance', icon: TrendingUp },
  { key: 'onboarding', label: 'Onboarding', icon: ClipboardCheck },
  { key: 'contracts', label: 'Contrats', icon: FileText },
  { key: 'benefits', label: 'Avantages sociaux', icon: HeartHandshake },
  { key: 'faq', label: 'FAQ', icon: HelpCircle },
  { key: 'superadmin', label: 'Superadmin', icon: ShieldCheck },
];

const EMPLOYEE_MODULES: ModuleKey[] = ['dashboard', 'myspace', 'scheduling', 'vacations', 'benefits', 'faq'];

export default function Sidebar({ active, onSelect, onLogout }: Props): JSX.Element {
  const { currentUser } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const items = NAV_ITEMS.filter((item) => {
    if (currentUser?.role === 'employee') return EMPLOYEE_MODULES.includes(item.key);
    return item.key !== 'myspace';
  });

  const content = (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-6 h-16 border-b border-slate-800">
        <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center">
          <Pill className="w-4 h-4 text-white" />
        </div>
        <span className="font-heading font-extrabold text-lg text-white">LuminaHR</span>
      </div>
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5" data-testid="sidebar-nav">
        {items.map((item) => (
          <button
            key={item.key}
            data-testid={`sidebar-link-${item.key}`}
            onClick={() => {
              onSelect(item.key);
              setMobileOpen(false);
            }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left ${
              active === item.key
                ? 'bg-emerald-600 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <item.icon className="w-4 h-4 shrink-0" />
            {item.label}
          </button>
        ))}
      </nav>
      <div className="p-4 border-t border-slate-800">
        <p className="text-sm font-semibold text-white truncate" data-testid="sidebar-user-name">{currentUser?.name}</p>
        <p className="text-xs text-slate-500 mb-3 capitalize">
          {currentUser?.role === 'admin' ? 'Gestionnaire' : currentUser?.role === 'superadmin' ? 'Superadmin' : 'Employé(e)'}
        </p>
        <button
          data-testid="sidebar-logout-button"
          onClick={onLogout}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <LogOut className="w-4 h-4" /> Déconnexion
        </button>
      </div>
    </div>
  );

  return (
    <>
      <button
        data-testid="sidebar-mobile-toggle"
        onClick={() => setMobileOpen(!mobileOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 w-10 h-10 rounded-lg bg-slate-900 text-white flex items-center justify-center"
      >
        {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>
      <aside className="hidden lg:block fixed inset-y-0 left-0 w-64 bg-slate-900 z-40">{content}</aside>
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <aside className="w-64 bg-slate-900">{content}</aside>
          <div className="flex-1 bg-slate-900/50" onClick={() => setMobileOpen(false)} />
        </div>
      )}
    </>
  );
}
