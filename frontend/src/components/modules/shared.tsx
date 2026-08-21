import { ReactNode, useState, useEffect, useRef } from 'react';
import { LucideIcon, ChevronDown, ChevronRight } from 'lucide-react';

export const openSection = (id: string): void => {
  window.dispatchEvent(new CustomEvent('ap-open-section', { detail: id }));
};

export const ModuleHeader = ({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }): JSX.Element => (
  <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
    <div>
      <span className="block w-12 h-1 rounded-full bg-gradient-to-r from-emerald-500 to-bronze-500 mb-3" />
      <h1 className="font-heading text-3xl font-extrabold tracking-tight text-slate-900">{title}</h1>
      <p className="text-sm text-slate-500 mt-1.5">{subtitle}</p>
    </div>
    {action}
  </div>
);

export const StatCard = ({ label, value, icon: Icon, hint, onClick, testId }: { label: string; value: string; icon: LucideIcon; hint?: string; onClick?: () => void; testId?: string }): JSX.Element => {
  const inner = (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs uppercase tracking-[0.15em] text-slate-500 font-semibold">{label}</p>
        <Icon className="w-4 h-4 text-emerald-600" />
      </div>
      <p className="font-heading text-3xl font-extrabold text-slate-900">{value}</p>
      {hint && (
        <p className="text-xs text-slate-400 mt-1.5 inline-flex items-center gap-1">
          {hint}
          {onClick && <ChevronRight className="w-3 h-3 text-emerald-600" />}
        </p>
      )}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        data-testid={testId}
        onClick={onClick}
        className="w-full text-left bg-white rounded-xl border border-slate-200 p-6 hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
      >
        {inner}
      </button>
    );
  }
  return (
    <div data-testid={testId} className="bg-white rounded-xl border border-slate-200 p-6 hover:-translate-y-0.5 transition-transform">
      {inner}
    </div>
  );
};

const BADGE_STYLES: Record<string, string> = {
  'Actif': 'bg-emerald-100 text-emerald-800',
  'Approuvée': 'bg-emerald-100 text-emerald-800',
  'Terminée': 'bg-emerald-100 text-emerald-800',
  'Payée': 'bg-emerald-100 text-emerald-800',
  'Comblée': 'bg-emerald-100 text-emerald-800',
  'Embauché(e)': 'bg-emerald-100 text-emerald-800',
  'Validée': 'bg-sky-100 text-sky-800',
  'Entrevue': 'bg-sky-100 text-sky-800',
  'Offre': 'bg-violet-100 text-violet-800',
  'Présélection': 'bg-bronze-100 text-bronze-800',
  'En attente': 'bg-bronze-100 text-bronze-800',
  'En cours': 'bg-bronze-100 text-bronze-800',
  'En préparation': 'bg-bronze-100 text-bronze-800',
  'Proposée': 'bg-bronze-100 text-bronze-800',
  'En congé': 'bg-bronze-100 text-bronze-800',
  'Nouvelle': 'bg-sky-100 text-sky-800',
  'Ouverte': 'bg-bronze-100 text-bronze-800',
  'À faire': 'bg-slate-100 text-slate-700',
  'Refusée': 'bg-red-100 text-red-800',
  'Refusé(e)': 'bg-red-100 text-red-800',
  'Annulée': 'bg-red-100 text-red-800',
  'Inactif': 'bg-slate-200 text-slate-600',
};

export const StatusBadge = ({ status }: { status: string }): JSX.Element => (
  <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${BADGE_STYLES[status] ?? 'bg-slate-100 text-slate-700'}`}>
    {status}
  </span>
);

export const EmptyState = ({ text }: { text: string }): JSX.Element => (
  <div className="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center">
    <p className="text-sm text-slate-500">{text}</p>
  </div>
);

const SECTION_TONES: Record<string, string> = {
  slate: 'bg-slate-100 text-slate-600',
  amber: 'bg-amber-100 text-amber-800',
  emerald: 'bg-emerald-100 text-emerald-800',
};

export const CollapsibleSection = ({ id, title, icon: Icon, badge, badgeTone = 'slate', defaultOpen = false, className = '', children }: {
  id: string;
  title: string;
  icon?: LucideIcon;
  badge?: string;
  badgeTone?: 'slate' | 'amber' | 'emerald';
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}): JSX.Element => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(`ap-section-${id}`);
      return saved === null ? defaultOpen : saved === '1';
    } catch {
      return defaultOpen;
    }
  });
  useEffect(() => {
    const onOpen = (e: Event): void => {
      if ((e as CustomEvent<string>).detail !== id) return;
      setOpen(true);
      try { localStorage.setItem(`ap-section-${id}`, '1'); } catch { /* noop */ }
      window.setTimeout(() => containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
    };
    window.addEventListener('ap-open-section', onOpen);
    return () => window.removeEventListener('ap-open-section', onOpen);
  }, [id]);
  const toggle = (): void => {
    setOpen((o) => {
      try { localStorage.setItem(`ap-section-${id}`, o ? '0' : '1'); } catch { /* noop */ }
      return !o;
    });
  };
  return (
    <div ref={containerRef} className={`${className} scroll-mt-4`}>
      <button
        type="button"
        data-testid={`section-toggle-${id}`}
        onClick={toggle}
        aria-expanded={open}
        className={`w-full flex items-center gap-2.5 rounded-xl border bg-white px-4 py-2.5 text-left shadow-sm transition-colors ${open ? 'border-emerald-200' : 'border-slate-200 hover:border-emerald-300'}`}
      >
        {Icon && <Icon className="w-4 h-4 text-emerald-600 shrink-0" />}
        <span className="font-heading text-sm font-bold text-slate-900 truncate">{title}</span>
        {badge && (
          <span data-testid={`section-badge-${id}`} className={`inline-flex shrink-0 rounded-full text-[10px] font-bold px-2 py-0.5 ${SECTION_TONES[badgeTone]}`}>{badge}</span>
        )}
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 shrink-0">
          <span className="hidden sm:inline">{open ? 'Réduire' : 'Développer'}</span>
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {open && <div className="mt-3" data-testid={`section-content-${id}`}>{children}</div>}
    </div>
  );
};
