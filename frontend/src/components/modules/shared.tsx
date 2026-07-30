import { ReactNode } from 'react';
import { LucideIcon } from 'lucide-react';

export const ModuleHeader = ({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }): JSX.Element => (
  <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
    <div>
      <h1 className="font-heading text-3xl font-extrabold tracking-tight text-slate-900">{title}</h1>
      <p className="text-sm text-slate-500 mt-1.5">{subtitle}</p>
    </div>
    {action}
  </div>
);

export const StatCard = ({ label, value, icon: Icon, hint }: { label: string; value: string; icon: LucideIcon; hint?: string }): JSX.Element => (
  <div className="bg-white rounded-xl border border-slate-200 p-6 hover:-translate-y-0.5 transition-transform">
    <div className="flex items-center justify-between mb-4">
      <p className="text-xs uppercase tracking-[0.15em] text-slate-500 font-semibold">{label}</p>
      <Icon className="w-4 h-4 text-emerald-600" />
    </div>
    <p className="font-heading text-3xl font-extrabold text-slate-900">{value}</p>
    {hint && <p className="text-xs text-slate-400 mt-1.5">{hint}</p>}
  </div>
);

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
  'Présélection': 'bg-amber-100 text-amber-800',
  'En attente': 'bg-amber-100 text-amber-800',
  'En cours': 'bg-amber-100 text-amber-800',
  'En préparation': 'bg-amber-100 text-amber-800',
  'Proposée': 'bg-orange-100 text-orange-800',
  'En congé': 'bg-orange-100 text-orange-800',
  'Nouvelle': 'bg-sky-100 text-sky-800',
  'Ouverte': 'bg-amber-100 text-amber-800',
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
