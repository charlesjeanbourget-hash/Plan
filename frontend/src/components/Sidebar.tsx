import { useState, FormEvent } from 'react';
import { ModuleKey } from '@/types';
import { useAuth } from '@/context/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  LayoutDashboard, Users, CalendarClock, Briefcase, Wallet, RefreshCw, TreePalm,
  TrendingUp, ClipboardCheck, FileText, HeartHandshake, HelpCircle, ShieldCheck,
  LogOut, Pill, Menu, X, LucideIcon, BadgeCheck, UserRound, KeyRound, Eye, EyeOff,
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
  const { currentUser, changePassword } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [showCurrentPwd, setShowCurrentPwd] = useState(false);
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [pwdError, setPwdError] = useState('');

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

  const items = NAV_ITEMS.filter((item) => {
    if (currentUser?.role === 'employee') return EMPLOYEE_MODULES.includes(item.key);
    if (item.key === 'myspace') return false;
    if (item.key === 'superadmin') return currentUser?.role === 'superadmin';
    return true;
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
          data-testid="sidebar-password-button"
          onClick={() => setPwdOpen(true)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <KeyRound className="w-4 h-4" /> Mot de passe
          {currentUser?.isTemporaryPassword && (
            <span className="ml-auto w-2 h-2 rounded-full bg-amber-400 animate-pulse" title="Mot de passe temporaire" />
          )}
        </button>
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
      <Dialog open={pwdOpen} onOpenChange={setPwdOpen}>
        <DialogContent data-testid="password-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Changer mon mot de passe</DialogTitle>
          </DialogHeader>
          {currentUser?.isTemporaryPassword && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
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
        </DialogContent>
      </Dialog>
    </>
  );
}
