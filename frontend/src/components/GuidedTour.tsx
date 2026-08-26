import { useState, useEffect, useRef } from 'react';
import { MockSchedule, MockPunch, MockTasks, MockChat, MockDelivery, MockLicenses } from '@/components/LandingMockups';
import { Sparkles, Fingerprint, ListChecks, MessagesSquare, Truck, ShieldCheck, Play, Pause, ChevronLeft, ChevronRight, Clock3, CheckCircle2, LucideIcon } from 'lucide-react';

const STEP_SECONDS = 10;

interface TourStep {
  icon: LucideIcon;
  kicker: string;
  title: string;
  desc: string;
  bullets: string[];
  mock: JSX.Element;
}

const STEPS: TourStep[] = [
  {
    icon: Sparkles,
    kicker: 'Étape 1 — Horaires',
    title: "L'IA bâtit l'horaire de la semaine",
    desc: 'Budgets, achalandage, disponibilités, congés approuvés et priorités du gestionnaire : tout est respecté automatiquement.',
    bullets: ['Génération en quelques secondes', 'Glissez-déposez pour ajuster', 'Coûts par département en direct'],
    mock: <MockSchedule />,
  },
  {
    icon: Fingerprint,
    kicker: 'Étape 2 — Punch & paie',
    title: 'Punch par NIP, paie sans recomptage',
    desc: 'Borne tablette avec pauses et arrondis; les heures réelles alimentent directement vos exports de paie.',
    bullets: ['Pauses et arrondis automatiques', 'Exports Employeur D, Nethris, ADP', 'Alertes d\'oubli de punch'],
    mock: <MockPunch />,
  },
  {
    icon: ListChecks,
    kicker: 'Étape 3 — Tâches',
    title: 'Chaque quart connaît ses tâches',
    desc: 'Le catalogue pharmacie (labo, plancher, caisse, entrepôt…) se distribue par quart et se coche sans supervision.',
    bullets: ['Catalogue 100 % pharmacie', 'Tableau d\'honneur mensuel', 'Rappels automatiques par plage'],
    mock: <MockTasks />,
  },
  {
    icon: MessagesSquare,
    kicker: 'Étape 4 — Communication',
    title: "Toute l'équipe sur la même page",
    desc: 'Conversations d\'équipe, annonces épinglées, sondages éclair, kudos et souhaits d\'anniversaire automatiques.',
    bullets: ['Messages directs et d\'équipe', 'Pièces jointes et épinglage', 'Anniversaires soulignés 🎂'],
    mock: <MockChat />,
  },
  {
    icon: Truck,
    kicker: 'Étape 5 — Livraisons',
    title: 'Tournées optimisées, preuves à l\'appui',
    desc: 'Itinéraire calculé pour le livreur, suivi des statuts et photo de preuve à la livraison.',
    bullets: ['Trajet optimisé automatiquement', 'Preuves photo horodatées', 'Suivi en temps réel'],
    mock: <MockDelivery />,
  },
  {
    icon: ShieldCheck,
    kicker: 'Étape 6 — Loi 25',
    title: 'Conformité Loi 25, sans effort',
    desc: 'Licences professionnelles suivies, certificats chiffrés, journal d\'audit invisible et droit à l\'oubli.',
    bullets: ['Rappels d\'expiration automatiques', 'Certificats chiffrés au repos', 'Journal d\'audit complet'],
    mock: <MockLicenses />,
  },
];

export const GuidedTour = (): JSX.Element => {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(() =>
    typeof window === 'undefined' || !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [cycle, setCycle] = useState(0);
  const [inView, setInView] = useState(true);
  const sectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const obs = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.15 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!playing || !inView) return undefined;
    const t = window.setTimeout(() => setStep((s) => (s + 1) % STEPS.length), STEP_SECONDS * 1000);
    return () => window.clearTimeout(t);
  }, [playing, inView, step, cycle]);

  const goTo = (i: number): void => {
    setStep((i + STEPS.length) % STEPS.length);
    setCycle((c) => c + 1);
  };

  const togglePlay = (): void => {
    setPlaying((p) => !p);
    setCycle((c) => c + 1);
  };

  return (
    <section ref={sectionRef} className="bg-white" data-testid="guided-tour-section" id="visite">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
          <div>
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-bronze-100 text-bronze-800 text-xs font-bold uppercase tracking-[0.18em] mb-4">
              <Clock3 className="w-3.5 h-3.5" /> Visite guidée · 60 secondes
            </span>
            <h2 className="font-heading text-2xl sm:text-3xl font-extrabold text-slate-900">
              Découvrez Arrière Plan sans lever le petit doigt
            </h2>
          </div>
          <p className="text-sm text-slate-500 max-w-sm">
            Six étapes, dix secondes chacune — la visite défile toute seule. Mettez en pause ou naviguez à votre rythme.
          </p>
        </div>

        <div className="rounded-3xl bg-slate-900 overflow-hidden shadow-2xl relative">
          <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full bg-emerald-600/15 blur-3xl pointer-events-none" />
          <div className="flex gap-1.5 px-5 sm:px-8 pt-5" data-testid="tour-progress-bars">
            {STEPS.map((_, i) => (
              <button
                key={i}
                data-testid={`tour-bar-${i}`}
                onClick={() => goTo(i)}
                aria-label={`Aller à l'étape ${i + 1}`}
                className="flex-1 h-1.5 rounded-full bg-white/15 overflow-hidden"
              >
                {i < step && <span className="block h-full w-full bg-emerald-400" />}
                {i === step && (
                  <span
                    key={`${step}-${cycle}`}
                    className="block h-full bg-emerald-400"
                    style={{
                      animation: `tourProgress ${STEP_SECONDS}s linear forwards`,
                      animationPlayState: playing && inView ? 'running' : 'paused',
                    }}
                  />
                )}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-10 items-center px-5 sm:px-8 py-8 sm:py-10 relative">
            <div className="lg:col-span-5">
              <div className="grid">
                {STEPS.map((st, i) => {
                  const StepIcon = st.icon;
                  const active = i === step;
                  return (
                    <div
                      key={st.kicker}
                      aria-hidden={!active}
                      className={`col-start-1 row-start-1 ${active ? 'animate-fade-up' : 'invisible pointer-events-none'}`}
                    >
                      <p className="text-xs uppercase tracking-[0.2em] text-emerald-400 font-bold mb-3 inline-flex items-center gap-2">
                        <StepIcon className="w-4 h-4" /> {st.kicker}
                      </p>
                      <h3 data-testid={active ? 'tour-step-title' : undefined} className="font-heading text-xl sm:text-2xl font-extrabold text-white leading-snug mb-3">
                        {st.title}
                      </h3>
                      <p className="text-sm text-slate-300 mb-5 max-w-md">{st.desc}</p>
                      <ul className="space-y-2.5 mb-7">
                        {st.bullets.map((b) => (
                          <li key={b} className="flex items-start gap-2.5 text-sm text-slate-200">
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" /> {b}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-3">
                <button
                  data-testid="tour-play-pause"
                  onClick={togglePlay}
                  aria-label={playing ? 'Mettre en pause' : 'Reprendre'}
                  className="w-11 h-11 rounded-full bg-emerald-500 text-white flex items-center justify-center hover:bg-emerald-400 transition-colors"
                >
                  {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                </button>
                <button
                  data-testid="tour-prev"
                  onClick={() => goTo(step - 1)}
                  aria-label="Étape précédente"
                  className="w-9 h-9 rounded-full border border-white/25 text-white/80 flex items-center justify-center hover:bg-white/10 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  data-testid="tour-next"
                  onClick={() => goTo(step + 1)}
                  aria-label="Étape suivante"
                  className="w-9 h-9 rounded-full border border-white/25 text-white/80 flex items-center justify-center hover:bg-white/10 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <span data-testid="tour-step-counter" className="ml-1 text-xs font-semibold text-slate-400">
                  {step + 1} / {STEPS.length}
                </span>
              </div>
            </div>

            <div className="lg:col-span-7 min-w-0">
              <div className="grid">
                {STEPS.map((st, i) => (
                  <div
                    key={st.kicker}
                    aria-hidden={i !== step}
                    className={`col-start-1 row-start-1 rounded-2xl bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/10 p-2 sm:p-4 ${i === step ? 'animate-fade-up' : 'invisible pointer-events-none'}`}
                  >
                    {st.mock}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
