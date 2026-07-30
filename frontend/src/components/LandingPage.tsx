import { View } from '@/types';
import { BrandLogo } from '@/components/BrandLogo';
import { Users, Briefcase, Building2, ArrowRight, CalendarClock, Wallet, TrendingUp, ShieldCheck } from 'lucide-react';

interface Props {
  onNavigate: (view: View) => void;
}

export default function LandingPage({ onNavigate }: Props): JSX.Element {
  return (
    <div className="min-h-screen bg-white" data-testid="landing-page">
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 sm:h-20 flex items-center justify-between gap-2">
          <BrandLogo size="sm" hideTextOnSmall />
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              data-testid="header-punch-button"
              onClick={() => onNavigate('punch')}
              className="px-3.5 sm:px-5 py-2 rounded-full border border-bronze-300 text-bronze-800 text-xs sm:text-sm font-semibold whitespace-nowrap hover:bg-bronze-50 hover:border-bronze-400 transition-colors"
            >
              Borne de punch
            </button>
            <button
              data-testid="header-login-button"
              onClick={() => onNavigate('login')}
              className="px-3.5 sm:px-5 py-2 rounded-full bg-emerald-600 text-white text-xs sm:text-sm font-semibold whitespace-nowrap hover:bg-emerald-700 transition-colors"
            >
              Connexion
            </button>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-14 md:py-28 grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-12 items-center">
          <div className="md:col-span-7 animate-fade-up">
            <p className="text-xs uppercase tracking-[0.2em] text-bronze-700 font-bold mb-5">SIRH conçu pour les pharmacies</p>
            <h1 className="font-heading text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-900 leading-[1.05]">
              La gestion RH de votre pharmacie, <span className="text-emerald-600">simplifiée.</span>
            </h1>
            <p className="mt-6 text-slate-600 text-base md:text-lg max-w-xl">
              Horaires, paie, recrutement, remplacements et dossiers employés — tout ce dont votre officine a besoin, dans une seule plateforme pensée pour le rythme du comptoir.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <button
                data-testid="hero-cta-login"
                onClick={() => onNavigate('login')}
                className="px-7 py-3.5 rounded-full bg-emerald-600 text-white font-semibold text-sm hover:bg-emerald-700 transition-colors inline-flex items-center gap-2"
              >
                Accéder à la plateforme <ArrowRight className="w-4 h-4" />
              </button>
              <button
                data-testid="hero-cta-careers"
                onClick={() => onNavigate('careers')}
                className="px-7 py-3.5 rounded-full border border-bronze-300 text-bronze-800 font-semibold text-sm hover:bg-bronze-50 hover:border-bronze-400 transition-colors"
              >
                Voir les offres d'emploi
              </button>
            </div>
          </div>
          <div className="md:col-span-5 animate-fade-up" style={{ animationDelay: '120ms' }}>
            <div className="relative rounded-2xl overflow-hidden border border-bronze-200 shadow-lg">
              <img
                src="https://images.pexels.com/photos/19471013/pexels-photo-19471013.jpeg?auto=compress&cs=tinysrgb&w=900"
                alt="Pharmacienne dans une pharmacie moderne"
                className="w-full h-[420px] object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-900/50 to-transparent" />
              <div className="absolute bottom-5 left-5 right-5 text-white">
                <p className="font-heading font-bold text-lg">+ de 200 pharmacies nous font confiance</p>
                <p className="text-sm text-white/80">Partout au Québec et au Canada</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-16 sm:pb-24">
        <span className="block w-12 h-1 rounded-full bg-gradient-to-r from-emerald-500 to-bronze-500 mb-4" />
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500 font-bold mb-8">Choisissez votre espace</p>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
          <button
            data-testid="portal-card-employees"
            onClick={() => onNavigate('login')}
            className="md:col-span-6 group text-left rounded-2xl bg-white border border-slate-200 p-6 sm:p-10 hover:border-emerald-400 hover:-translate-y-1 shadow-sm hover:shadow-md transition-all"
          >
            <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center mb-6">
              <Users className="w-6 h-6 text-emerald-600" />
            </div>
            <h2 className="font-heading text-lg font-bold text-slate-900 mb-2">Espace Employés & Gestion</h2>
            <p className="text-slate-500 text-sm mb-6">
              Connectez-vous pour gérer les horaires, la paie, les dossiers et l'ensemble de vos opérations RH.
            </p>
            <span className="inline-flex items-center gap-2 text-emerald-700 text-sm font-semibold group-hover:gap-3 transition-[gap]">
              Se connecter <ArrowRight className="w-4 h-4" />
            </span>
          </button>

          <button
            data-testid="portal-card-careers"
            onClick={() => onNavigate('careers')}
            className="md:col-span-3 group text-left rounded-2xl bg-white border border-slate-200 p-10 hover:border-bronze-400 hover:-translate-y-1 shadow-sm hover:shadow-md transition-all"
          >
            <div className="w-12 h-12 rounded-xl bg-bronze-100 flex items-center justify-center mb-6">
              <Briefcase className="w-6 h-6 text-bronze-700" />
            </div>
            <h2 className="font-heading text-lg font-bold text-slate-900 mb-2">Portail Carrières</h2>
            <p className="text-slate-500 text-sm mb-6">Consultez nos offres d'emploi actives et postulez en ligne.</p>
            <span className="inline-flex items-center gap-2 text-bronze-700 text-sm font-semibold group-hover:gap-3 transition-[gap]">
              Voir les offres <ArrowRight className="w-4 h-4" />
            </span>
          </button>

          <button
            data-testid="portal-card-agency"
            onClick={() => onNavigate('agency')}
            className="md:col-span-3 group text-left rounded-2xl bg-white border border-slate-200 p-6 sm:p-10 hover:border-bronze-400 hover:-translate-y-1 shadow-sm hover:shadow-md transition-all"
          >
            <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center mb-6">
              <Building2 className="w-6 h-6 text-emerald-700" />
            </div>
            <h2 className="font-heading text-lg font-bold text-slate-900 mb-2">Portail Agence</h2>
            <p className="text-slate-500 text-sm mb-6">Accès sécurisé pour les agences de placement et remplacements.</p>
            <span className="inline-flex items-center gap-2 text-emerald-700 text-sm font-semibold group-hover:gap-3 transition-[gap]">
              Accéder <ArrowRight className="w-4 h-4" />
            </span>
          </button>
        </div>
      </section>

      <section className="bg-slate-50 border-y border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
          <span className="block w-12 h-1 rounded-full bg-gradient-to-r from-emerald-500 to-bronze-500 mb-4" />
          <h2 className="font-heading text-lg font-bold text-slate-900 mb-10">Tout votre SIRH, module par module</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { icon: CalendarClock, title: 'Horaires intelligents', text: 'Planifiez les quarts du comptoir et du laboratoire en quelques clics.', cls: 'text-emerald-600' },
              { icon: Wallet, title: 'Paie sans friction', text: 'Heures, temps supplémentaire et déductions calculés automatiquement.', cls: 'text-bronze-600' },
              { icon: TrendingUp, title: 'Performance & rétention', text: 'Évaluations structurées et suggestions salariales basées sur le BAIIA.', cls: 'text-emerald-600' },
              { icon: ShieldCheck, title: 'Conformité assurée', text: 'Dossiers, contrats et onboarding conformes aux normes du travail.', cls: 'text-bronze-600' },
            ].map((f) => (
              <div key={f.title} className="rounded-xl bg-white border border-slate-200 p-6 hover:-translate-y-1 hover:border-bronze-300 transition-all">
                <f.icon className={`w-6 h-6 mb-4 ${f.cls}`} />
                <h3 className="font-heading font-bold text-slate-900 text-base mb-1.5">{f.title}</h3>
                <p className="text-sm text-slate-500">{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="max-w-7xl mx-auto px-4 sm:px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4 bg-white">
        <p className="text-sm text-slate-500">© 2026 Arrière Plan — Le SIRH des pharmacies.</p>
        <div className="flex gap-6 text-sm text-slate-500">
          <button data-testid="footer-careers-link" onClick={() => onNavigate('careers')} className="hover:text-bronze-700 transition-colors">Carrières</button>
          <button data-testid="footer-agency-link" onClick={() => onNavigate('agency')} className="hover:text-bronze-700 transition-colors">Agences</button>
          <button data-testid="footer-punch-link" onClick={() => onNavigate('punch')} className="hover:text-bronze-700 transition-colors">Borne de punch</button>
          <button data-testid="footer-login-link" onClick={() => onNavigate('login')} className="hover:text-bronze-700 transition-colors">Connexion</button>
        </div>
      </footer>
    </div>
  );
}
