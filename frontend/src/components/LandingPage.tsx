import { View } from '@/types';
import { BrandLogo } from '@/components/BrandLogo';
import { LandingShowcase } from '@/components/LandingShowcase';
import { PayrollSection } from '@/components/PayrollSection';
import { TestimonialsSection } from '@/components/TestimonialsSection';
import { DemoSection } from '@/components/DemoSection';
import { FaqSection } from '@/components/FaqSection';
import { Users, Briefcase, Building2, ArrowRight, CheckCircle2, ShieldCheck, Leaf } from 'lucide-react';

interface Props {
  onNavigate: (view: View) => void;
}

const scrollToId = (id: string): void => {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
};

const TIME_BULLETS = [
  'Les horaires, rappels, relances et examens de formation se préparent tout seuls',
  'Les remplacements se règlent par courriel automatique — sans appels à répétition',
  'La paie se calcule à partir des punchs réels, temps supplémentaire inclus',
  'Chaque tâche du quart est distribuée, suivie et cochée sans supervision constante',
];

export default function LandingPage({ onNavigate }: Props): JSX.Element {
  return (
    <div className="min-h-screen bg-white" data-testid="landing-page">
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 sm:h-20 flex items-center justify-between gap-2">
          <BrandLogo size="sm" hideTextOnSmall />
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              data-testid="header-demo-button"
              onClick={() => scrollToId('demo')}
              className="hidden sm:inline-flex px-3.5 sm:px-5 py-2 rounded-full bg-bronze-600 text-white text-xs sm:text-sm font-semibold whitespace-nowrap hover:bg-bronze-700 transition-colors"
            >
              Réserver une démo
            </button>
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-14 md:py-24 grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-12 items-center">
          <div className="md:col-span-7 animate-fade-up">
            <p className="text-xs uppercase tracking-[0.2em] text-bronze-700 font-bold mb-5">SIRH conçu pour les pharmacies</p>
            <h1 className="font-heading text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-900 leading-[1.05]">
              Moins de paperasse. Plus de temps pour <span className="text-emerald-600">ce qui rapporte.</span>
            </h1>
            <p className="mt-6 text-slate-600 text-base md:text-lg max-w-xl">
              Arrière Plan automatise toute l'administration RH de votre officine — horaires, paie, tâches, remplacements,
              formations — pour redonner à votre équipe du temps de qualité au comptoir, en consultation et sur les services rémunérateurs.
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
                className="w-full h-[380px] md:h-[420px] object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-900/50 to-transparent" />
              <div className="absolute bottom-5 left-5 right-5 text-white">
                <p className="font-heading font-bold text-lg">Votre équipe au bon endroit, au bon moment</p>
                <p className="text-sm text-white/80">Pensé pour le rythme des pharmacies du Québec</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-slate-50 border-y border-slate-200" data-testid="roi-section">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-14 sm:py-16 grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { big: 'Des heures récupérées', small: 'chaque semaine : horaires, rappels, examens et relevés se préparent automatiquement.' },
            { big: 'Zéro oubli', small: 'licences, formations, punchs et tâches de quart — tout est rappelé et tracé pour vous.' },
            { big: 'Plus de valeur par heure', small: 'votre équipe se consacre aux ordonnances, aux conseils et aux services facturables.' },
          ].map((s) => (
            <div key={s.big} className="rounded-2xl bg-white border border-slate-200 p-8 hover:border-bronze-300 hover:-translate-y-1 transition-all">
              <p className="font-heading text-2xl font-extrabold text-slate-900 mb-2">{s.big}</p>
              <p className="text-sm text-slate-500">{s.small}</p>
            </div>
          ))}
        </div>
      </section>

      <LandingShowcase />

      <PayrollSection />

      <TestimonialsSection />

      <section className="bg-slate-50 border-y border-slate-200" data-testid="time-value-section">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-16 sm:py-20 grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
          <div>
            <span className="block w-12 h-1 rounded-full bg-gradient-to-r from-emerald-500 to-bronze-500 mb-4" />
            <h2 className="font-heading text-2xl sm:text-3xl font-extrabold text-slate-900 mb-4">
              Votre temps vaut plus que l'administration
            </h2>
            <p className="text-slate-600 mb-6 max-w-lg">
              Chaque heure passée à bâtir un horaire, courir après un remplaçant ou recompter des feuilles de temps
              est une heure perdue pour vos patients — et pour votre chiffre d'affaires.
            </p>
            <ul className="space-y-3">
              {TIME_BULLETS.map((b) => (
                <li key={b} className="flex items-start gap-3 text-sm text-slate-700">
                  <CheckCircle2 className="w-5 h-5 text-bronze-600 shrink-0 mt-0.5" /> {b}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl bg-emerald-600 p-8 sm:p-10 text-white">
            <p className="font-heading text-xl sm:text-2xl font-extrabold mb-3">
              « Déléguez l'arrière-plan de votre pharmacie — gardez le devant de la scène. »
            </p>
            <p className="text-emerald-50 text-sm mb-8">
              Pendant que la plateforme coordonne l'équipe en coulisses, vous facturez des services,
              conseillez vos patients et développez votre officine.
            </p>
            <button
              data-testid="time-value-cta"
              onClick={() => onNavigate('login')}
              className="px-7 py-3 rounded-full bg-white text-emerald-700 font-semibold text-sm hover:bg-emerald-50 transition-colors inline-flex items-center gap-2"
            >
              Commencer maintenant <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </section>

      <FaqSection />

      <DemoSection />

      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-16 sm:py-24 border-t border-slate-100">
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
              Connectez-vous pour gérer les horaires, la paie, les tâches, les dossiers et l'ensemble de vos opérations RH.
            </p>
            <span className="inline-flex items-center gap-2 text-emerald-700 text-sm font-semibold group-hover:gap-3 transition-[gap]">
              Se connecter <ArrowRight className="w-4 h-4" />
            </span>
          </button>

          <button
            data-testid="portal-card-careers"
            onClick={() => onNavigate('careers')}
            className="md:col-span-3 group text-left rounded-2xl bg-white border border-slate-200 p-6 sm:p-10 hover:border-bronze-400 hover:-translate-y-1 shadow-sm hover:shadow-md transition-all"
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

      <footer className="bg-slate-50/80 border-t border-slate-200" data-testid="landing-footer">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-14 grid grid-cols-2 md:grid-cols-12 gap-8 md:gap-6">
          <div className="col-span-2 md:col-span-4">
            <BrandLogo size="sm" />
            <p className="mt-4 text-sm text-slate-500 max-w-xs">
              Le SIRH des pharmacies du Québec — horaires, punch, paie, tâches, remplacements,
              formations et conformité, réunis en un seul outil.
            </p>
          </div>
          <div className="md:col-span-4">
            <p className="text-xs uppercase tracking-[0.15em] text-slate-400 font-bold mb-4">Fonctionnalités</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm text-slate-600">
              {[
                { id: 'horaires', label: 'Horaires' },
                { id: 'punch', label: 'Punch & paie' },
                { id: 'taches', label: 'Tâches par quart' },
                { id: 'communication', label: 'Communication' },
                { id: 'livraisons', label: 'Livraisons' },
                { id: 'remplacements', label: 'Remplacements' },
                { id: 'formations', label: 'Formations IA' },
                { id: 'evaluations', label: 'Évaluations' },
                { id: 'licences', label: 'Licences Loi 25' },
                { id: 'recrutement', label: 'Recrutement' },
              ].map((l) => (
                <button
                  key={l.id}
                  data-testid={`footer-feature-${l.id}`}
                  onClick={() => scrollToId(`sec-${l.id}`)}
                  className="text-left hover:text-emerald-700 transition-colors"
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
          <div className="md:col-span-2">
            <p className="text-xs uppercase tracking-[0.15em] text-slate-400 font-bold mb-4">Espaces</p>
            <div className="flex flex-col gap-2.5 text-sm text-slate-600">
              <button data-testid="footer-login-link" onClick={() => onNavigate('login')} className="text-left hover:text-emerald-700 transition-colors">Connexion</button>
              <button data-testid="footer-careers-link" onClick={() => onNavigate('careers')} className="text-left hover:text-emerald-700 transition-colors">Portail Carrières</button>
              <button data-testid="footer-agency-link" onClick={() => onNavigate('agency')} className="text-left hover:text-emerald-700 transition-colors">Portail Agence</button>
              <button data-testid="footer-punch-link" onClick={() => onNavigate('punch')} className="text-left hover:text-emerald-700 transition-colors">Borne de punch</button>
            </div>
          </div>
          <div className="md:col-span-2">
            <p className="text-xs uppercase tracking-[0.15em] text-slate-400 font-bold mb-4">Support</p>
            <div className="flex flex-col gap-2.5 text-sm text-slate-600">
              <button data-testid="footer-demo-link" onClick={() => scrollToId('demo')} className="text-left hover:text-emerald-700 transition-colors">Réserver une démo</button>
              <button data-testid="footer-faq-link" onClick={() => scrollToId('faq')} className="text-left hover:text-emerald-700 transition-colors">Questions fréquentes</button>
              <button data-testid="footer-privacy-link" onClick={() => onNavigate('privacy')} className="text-left hover:text-emerald-700 transition-colors">Politique de confidentialité</button>
              <button data-testid="footer-testimonials-link" onClick={() => scrollToId('demo')} className="text-left hover:text-emerald-700 transition-colors">Nous joindre</button>
            </div>
          </div>
        </div>
        <div className="border-t border-slate-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-sm text-slate-500">© 2026 Arrière Plan — Le SIRH des pharmacies.</p>
            <div className="flex items-center gap-6">
              <span data-testid="footer-badge-loi25" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600">
                <ShieldCheck className="w-4 h-4 text-emerald-600" /> Conforme Loi 25
              </span>
              <span data-testid="footer-badge-quebec" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600">
                <Leaf className="w-4 h-4 text-bronze-600" /> Fait au Québec
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
