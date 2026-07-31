import { FileSpreadsheet, ArrowDownToLine } from 'lucide-react';
import logoUrl from '@/assets/logo-arriere-plan.png';

const SOFTWARES = [
  { name: 'Nethris', dot: 'bg-sky-500', pos: 'top-2 left-[8%]', anim: 'animate-float' },
  { name: 'EmployeurD', dot: 'bg-blue-700', pos: 'top-[30%] left-0', anim: 'animate-float-slow' },
  { name: 'Desjardins', dot: 'bg-emerald-600', pos: 'bottom-[18%] left-[6%]', anim: 'animate-float' },
  { name: 'Acomba', dot: 'bg-cyan-500', pos: 'bottom-0 left-[28%]', anim: 'animate-float-slow' },
  { name: 'QuickBooks', dot: 'bg-green-600', pos: 'top-0 right-[22%]', anim: 'animate-float-slow' },
  { name: 'ADP', dot: 'bg-red-600', pos: 'top-[28%] right-0', anim: 'animate-float' },
  { name: 'Sage', dot: 'bg-lime-600', pos: 'bottom-[22%] right-[4%]', anim: 'animate-float-slow' },
  { name: 'Payworks', dot: 'bg-slate-800', pos: 'bottom-2 right-[26%]', anim: 'animate-float' },
];

export function PayrollSection(): JSX.Element {
  return (
    <section className="bg-slate-50/80 border-y border-slate-100 overflow-hidden" data-testid="payroll-section">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <div className="text-center max-w-3xl mx-auto mb-10">
          <p className="text-xs sm:text-sm uppercase tracking-[0.18em] text-bronze-700 font-bold mb-3">Intégrez feuilles de temps et paie</p>
          <h2 className="font-heading text-2xl sm:text-3xl lg:text-4xl font-extrabold text-slate-900 leading-tight">
            Compatible avec votre <span className="text-emerald-600">système de paie.</span>
          </h2>
          <p className="mt-4 text-sm sm:text-base text-slate-500 max-w-2xl mx-auto">
            Les heures punchées s'exportent en un clic dans un format CSV universel, prêt à importer
            dans les principaux logiciels de paie canadiens.
          </p>
        </div>
        <div className="relative max-w-2xl mx-auto h-[300px] sm:h-[340px] mb-10" aria-hidden="true">
          <div className="absolute inset-x-8 inset-y-4 rounded-full bg-[radial-gradient(50%_50%_at_50%_50%,rgba(233,188,150,0.45),rgba(16,185,129,0.12)_60%,transparent_80%)] blur-xl" />
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white border border-slate-200 shadow-[0_30px_60px_-20px_rgba(15,23,42,0.3)] px-6 py-5 flex flex-col items-center">
            <img src={logoUrl} alt="Arrière Plan" className="w-14 h-14 object-contain mb-1" />
            <p className="font-heading font-bold text-slate-900 text-sm">Arrière Plan</p>
            <p className="text-[10px] text-emerald-700 font-semibold flex items-center gap-1 mt-0.5">
              <ArrowDownToLine className="w-3 h-3" /> Export CSV en 1 clic
            </p>
          </div>
          {SOFTWARES.map((s) => (
            <span
              key={s.name}
              className={`absolute ${s.pos} ${s.anim} inline-flex items-center gap-1.5 rounded-full bg-white border border-slate-200 shadow-[0_12px_30px_-12px_rgba(15,23,42,0.3)] px-3 py-1.5 text-[10px] sm:text-xs font-bold text-slate-700`}
            >
              <span className={`w-2 h-2 rounded-full ${s.dot}`} />
              {s.name}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-8 max-w-3xl mx-auto">
          <div className="flex items-start gap-4">
            <span className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0">
              <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
            </span>
            <div>
              <p className="font-heading font-bold text-slate-900 text-sm sm:text-base mb-1">Feuilles de temps prêtes à importer</p>
              <p className="text-xs sm:text-sm text-slate-500 leading-relaxed">Heures punchées, temps supplémentaire et saisies manuelles compilés par employé et par période.</p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <span className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0">
              <ArrowDownToLine className="w-4 h-4 text-emerald-700" />
            </span>
            <div>
              <p className="font-heading font-bold text-slate-900 text-sm sm:text-base mb-1">Format CSV universel</p>
              <p className="text-xs sm:text-sm text-slate-500 leading-relaxed">Reconnu par tous les grands logiciels de paie — aucune ressaisie, aucune erreur de transcription.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
