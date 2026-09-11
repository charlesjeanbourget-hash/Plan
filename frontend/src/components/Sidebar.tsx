import { useState, useEffect, FormEvent } from 'react';
import { ModuleKey } from '@/types';
import { MfaSettings } from '@/components/MfaSettings';
import { SecurityPolicyPanel } from '@/components/SecurityPolicyPanel';
import { useAuth } from '@/context/AuthContext';
import { BrandLogo } from '@/components/BrandLogo';
import { InstallAppButton } from '@/components/InstallAppButton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import {
  LayoutDashboard, Users, CalendarClock, Briefcase, Wallet, RefreshCw, TreePalm,
  TrendingUp, ClipboardCheck, FileText, HeartHandshake, HelpCircle, ShieldCheck,
  LogOut, Menu, X, LucideIcon, BadgeCheck, UserRound, KeyRound, Eye, EyeOff, GraduationCap, ListChecks, Truck, MessagesSquare, Boxes, PartyPopper, Glasses, HeartPulse, ChevronDown,
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

interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    id: 'quotidien',
    label: 'Au quotidien',
    items: [
      { key: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
      { key: 'myspace', label: 'Mon espace', icon: UserRound },
      { key: 'messages', label: 'Messages', icon: MessagesSquare },
      { key: 'scheduling', label: 'Horaires', icon: CalendarClock },
      { key: 'tasks', label: 'Tâches', icon: ListChecks },
      { key: 'deliveries', label: 'Livraisons', icon: Truck },
      { key: 'replacements', label: 'Remplacements', icon: RefreshCw },
      { key: 'vacations', label: 'Congés', icon: TreePalm },
    ],
  },
  {
    id: 'equipe',
    label: 'Équipe',
    items: [
      { key: 'employees', label: 'Employés', icon: Users },
      { key: 'team', label: 'Vie d’équipe', icon: PartyPopper },
      { key: 'licenses', label: 'Licences', icon: BadgeCheck },
      { key: 'resources', label: 'Ressources', icon: Boxes },
      { key: 'performance', label: 'Performance', icon: TrendingUp },
      { key: 'training', label: 'Formations', icon: GraduationCap },
    ],
  },
  {
    id: 'rh',
    label: 'RH & paie',
    items: [
      { key: 'recruitment', label: 'Recrutement', icon: Briefcase },
      { key: 'onboarding', label: 'Intégration', icon: ClipboardCheck },
      { key: 'contracts', label: 'Contrats', icon: FileText },
      { key: 'payroll', label: 'Paie', icon: Wallet },
      { key: 'benefits', label: 'Avantages', icon: HeartHandshake },
    ],
  },
  {
    id: 'sst',
    label: 'Santé & sécurité',
    items: [
      { key: 'sst', label: 'Docs & événements', icon: HeartPulse },
    ],
  },
  {
    id: 'aide',
    label: 'Aide',
    items: [
      { key: 'faq', label: 'FAQ', icon: HelpCircle },
      { key: 'superadmin', label: 'Superadmin', icon: ShieldCheck },
    ],
  },
];

const HIDDEN_FOR_NOW: ModuleKey[] = ['reports'];

const EMPLOYEE_MODULES: ModuleKey[] = ['dashboard', 'myspace', 'messages', 'team', 'scheduling', 'tasks', 'deliveries', 'vacations', 'training', 'sst', 'benefits', 'faq'];

const SIMPLE_MODULES: ModuleKey[] = ['dashboard', 'myspace', 'messages', 'scheduling', 'tasks', 'vacations', 'employees', 'payroll', 'faq'];

const SIMPLE_MODE_KEY = 'ap_simple_mode_v1';

export default function Sidebar({ active, onSelect, onLogout }: Props): JSX.Element {
  const { currentUser, changePassword } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [showCurrentPwd, setShowCurrentPwd] = useState(false);
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [pwdError, setPwdError] = useState('');
  const [simpleMode, setSimpleMode] = useState(() => localStorage.getItem(SIMPLE_MODE_KEY) === '1');
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    quotidien: true,
    equipe: true,
    rh: true,
    sst: true,
    aide: false,
  });

  useEffect(() => {
    document.documentElement.classList.toggle('simple-mode', simpleMode);
    localStorage.setItem(SIMPLE_MODE_KEY, simpleMode ? '1' : '0');
    return () => document.documentElement.classList.remove('simple-mode');
  }, [simpleMode]);

  const submitPassword = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setPwdError('');
    const err = await changePassword(currentPwd.trim(), newPwd.trim());
    if (err) {
      setPwdError(err);
    } else {
      toast.success('Mot de passe modifié avec succès.');
      setPwdOpen(false);
      setCurrentPwd('');
      setNewPwd('');
    }
  };

  const allowed = (key: ModuleKey): boolean => {
    if (HIDDEN_FOR_NOW.includes(key)) return false;
    const overrides = currentUser?.moduleOverrides ?? {};
    if (overrides[key] === false) return false;
    if (simpleMode && !SIMPLE_MODULES.includes(key)) return false;
    if (currentUser?.role === 'superadmin') return key === 'superadmin';
    if (currentUser?.role === 'employee') return overrides[key] === true || EMPLOYEE_MODULES.includes(key);
    if (key === 'myspace') return false;
    if (key === 'superadmin') return false;
    return true;
  };

  const groups = NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((i) => allowed(i.key)) }))
    .filter((g) => g.items.length > 0);

  const content = (
    <div className="flex flex-col h-full bg-white">
      <div className="flex items-center px-5 h-20 border-b border-slate-200">
        <BrandLogo size="sm" />
      </div>
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-3" data-testid="sidebar-nav">
        {groups.map((group) => (
          <div key={group.id}>
            <button
              type="button"
              onClick={() => setOpenGroups((prev) => ({ ...prev, [group.id]: !prev[group.id] }))}
              className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-600"
            >
              {group.label}
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${openGroups[group.id] === false ? '-rotate-90' : ''}`} />
            </button>
            {openGroups[group.id] !== false && (
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <button
                    key={item.key}
                    data-testid={`sidebar-link-${item.key}`}
                    onClick={() => {
                      onSelect(item.key);
                      setMobileOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left border-l-4 ${
                      active === item.key
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-600'
                        : 'text-slate-500 border-transparent hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    <item.icon className={`w-4 h-4 shrink-0 ${active === item.key ? 'text-emerald-600' : ''}`} />
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>
      <div className="p-4 border-t border-slate-200">
        <p className="text-sm font-semibold text-slate-900 truncate" data-testid="sidebar-user-name">{currentUser?.name}</p>
        <p className="text-xs text-bronze-700 font-semibold mb-3 capitalize">
          {currentUser?.role === 'admin' ? 'Admin (propriétaire)' : currentUser?.role === 'manager' ? 'Gestionnaire' : currentUser?.role === 'superadmin' ? 'Superadmin' : 'Employé(e)'}
        </p>
        <div className="mb-2">
          <InstallAppButton />
        </div>
        <div
          data-testid="simple-mode-row"
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-500"
          title="Grossit les textes, renforce les contrastes et simplifie le menu — idéal pour un usage sans lunettes."
        >
          <Glasses className="w-4 h-4 shrink-0" /> Mode simplifié
          <Switch
            data-testid="simple-mode-toggle"
            className="ml-auto"
            checked={simpleMode}
            onCheckedChange={(v: boolean) => {
              setSimpleMode(v);
              toast.success(v ? 'Mode simplifié activé : textes agrandis et menu allégé.' : 'Mode simplifié désactivé.');
            }}
          />
        </div>
        <button
          data-testid="sidebar-password-button"
          onClick={() => setPwdOpen(true)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-colors"
        >
          <KeyRound className="w-4 h-4" /> Mot de passe
          {currentUser?.isTemporaryPassword && (
            <span className="ml-auto w-2 h-2 rounded-full bg-bronze-500 animate-pulse" title="Mot de passe temporaire" />
          )}
        </button>
        <button
          data-testid="sidebar-logout-button"
          onClick={onLogout}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-500 hover:text-red-700 hover:bg-red-50 transition-colors"
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
        className="lg:hidden fixed top-4 left-4 z-50 w-10 h-10 rounded-lg bg-white border border-slate-200 shadow-md text-slate-700 flex items-center justify-center"
      >
        {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>
      <aside className="hidden lg:block fixed inset-y-0 left-0 w-64 bg-white border-r border-slate-200 z-40">{content}</aside>
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <aside className="w-64 bg-white border-r border-slate-200">{content}</aside>
          <div className="flex-1 bg-slate-900/30" onClick={() => setMobileOpen(false)} />
        </div>
      )}
      <Dialog open={pwdOpen} onOpenChange={setPwdOpen}>
        <DialogContent data-testid="password-dialog" className="max-h-[88vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="font-heading">Sécurité de mon compte</DialogTitle>
          </DialogHeader>
          {currentUser?.isTemporaryPassword && (
            <p className="text-xs text-bronze-800 bg-bronze-50 border border-bronze-200 rounded-lg p-3">
              Votre mot de passe actuel est temporaire. Veuillez le remplacer par un mot de passe personnel.
            </p>
          )}
          <form onSubmit={(e) => void submitPassword(e)} className="space-y-4">
            <div className="space-y-2">
              <Label>Mot de passe actuel</Label>
              <div className="relative">
                <Input data-testid="current-password-input" type={showCurrentPwd ? 'text' : 'password'} className="pr-10" value={currentPwd} onChange={(e) => setCurrentPwd(e.target.value)} required />
                <button type="button" data-testid="current-password-toggle" onClick={() => setShowCurrentPwd((v) => !v)} aria-label={showCurrentPwd ? 'Masquer le mot de passe' : 'Afficher le mot de passe'} className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-700 transition-colors">
                  {showCurrentPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Nouveau mot de passe (min. 8 caractères)</Label>
              <div className="relative">
                <Input data-testid="new-password-input" type={showNewPwd ? 'text' : 'password'} className="pr-10" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} minLength={8} required />
                <button type="button" data-testid="new-password-toggle" onClick={() => setShowNewPwd((v) => !v)} aria-label={showNewPwd ? 'Masquer le mot de passe' : 'Afficher le mot de passe'} className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-700 transition-colors">
                  {showNewPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {pwdError && <p data-testid="password-error" className="text-sm text-red-600">{pwdError}</p>}
            <Button data-testid="password-submit-button" type="submit" className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              Modifier le mot de passe
            </Button>
          </form>
          <MfaSettings />
          <SecurityPolicyPanel />
        </DialogContent>
      </Dialog>
    </>
  );
}
