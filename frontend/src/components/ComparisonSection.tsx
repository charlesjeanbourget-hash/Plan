import logo from '@/assets/logo-arriere-plan.png';
import {
  CheckCircle2, XCircle, MinusCircle, Sparkles, Pill, ShieldCheck, GraduationCap,
  RefreshCw, Truck, Wallet, Fingerprint, MessagesSquare, PartyPopper, ArrowRight, Trophy, LucideIcon,
  CloudSun, HeartPulse, FileSignature, Megaphone, PiggyBank, KeyRound, BarChart3, UserCog, Award, BellRing,
} from 'lucide-react';

type Verdict = 'yes' | 'no' | 'partial';

interface Row {
  icon: LucideIcon;
  label: string;
  detail: string;
  ap: Verdict;
  agendrix: Verdict;
}

interface Group {
  title: string;
  rows: Row[];
}

const GROUPS: Group[] = [
  {
    title: 'Exclusivités pharmacie',
    rows: [
      { icon: Pill, label: 'Conçu exclusivement pour les pharmacies', detail: 'Laboratoire, plancher, livraisons, licences professionnelles — rien à adapter.', ap: 'yes', agendrix: 'no' },
      { icon: Sparkles, label: 'Horaires générés par IA', detail: 'Budgets, priorités, achalandage, disponibilités et congés respectés automatiquement.', ap: 'yes', agendrix: 'no' },
      { icon: GraduationCap, label: 'Formations générées par IA + examens', detail: 'Déposez un PDF : parcours de formation et examen créés en quelques secondes.', ap: 'yes', agendrix: 'no' },
      { icon: RefreshCw, label: 'Remplacements automatisés par agences', detail: 'Courriels aux agences, offres comparées, choix en un clic.', ap: 'yes', agendrix: 'no' },
      { icon: Truck, label: 'Livraisons et tournées optimisées', detail: 'Itinéraire calculé, preuves de livraison, suivi du livreur.', ap: 'yes', agendrix: 'no' },
    ],
  },
  {
    title: 'Horaires & temps',
    rows: [
      { icon: Fingerprint, label: 'Punch par NIP, pauses et arrondis', detail: 'Borne tablette, géolocalisation, règles d\'arrondi configurables.', ap: 'yes', agendrix: 'yes' },
      { icon: CloudSun, label: 'Météo intégrée à l\'horaire', detail: 'Prévisions affichées directement sur la grille pour anticiper l\'achalandage.', ap: 'yes', agendrix: 'no' },
      { icon: Award, label: 'Quarts ouverts par ancienneté + formation', detail: 'Attribution équitable des quarts ouverts et quarts de formation jumelés.', ap: 'yes', agendrix: 'yes' },
      { icon: PiggyBank, label: 'Banques de temps', detail: 'Heures supplémentaires accumulées et reprises, suivies employé par employé.', ap: 'yes', agendrix: 'yes' },
      { icon: BellRing, label: 'Rappels de quarts et résumé matinal', detail: 'Rappels automatiques avant chaque quart et résumé de la journée envoyé à l\'équipe.', ap: 'yes', agendrix: 'partial' },
    ],
  },
  {
    title: 'RH & documents',
    rows: [
      { icon: HeartPulse, label: 'Santé & sécurité au travail (SST)', detail: 'Déclaration d\'incidents, suivi CNESST et mesures correctives intégrées.', ap: 'yes', agendrix: 'no' },
      { icon: FileSignature, label: 'Demandes de documents et signatures', detail: 'Collecte de documents et signatures électroniques directement dans l\'app.', ap: 'yes', agendrix: 'yes' },
      { icon: UserCog, label: 'Champs RH personnalisés', detail: 'Ajoutez vos propres champs aux dossiers employés (taille d\'uniforme, allergies, etc.).', ap: 'yes', agendrix: 'yes' },
      { icon: Megaphone, label: 'Fil d\'annonces avec confirmations de lecture', detail: 'Annonces épinglées, réactions et suivi de qui a lu quoi.', ap: 'yes', agendrix: 'yes' },
      { icon: Wallet, label: 'Paie : exports Employeur D, Nethris, ADP', detail: 'Heures réelles punchées transformées en fichiers prêts pour votre logiciel de paie.', ap: 'yes', agendrix: 'partial' },
      { icon: PartyPopper, label: 'Sondages éclair, kudos et quarts à réclamer', detail: 'Engagement d\'équipe et quarts ouverts « premier arrivé, premier servi ».', ap: 'yes', agendrix: 'partial' },
      { icon: MessagesSquare, label: 'Messagerie d\'équipe et annonces épinglées', detail: 'Conversations d\'équipe, directes et gestionnaires, avec pièces jointes.', ap: 'yes', agendrix: 'yes' },
    ],
  },
  {
    title: 'Sécurité & administration',
    rows: [
      { icon: KeyRound, label: 'Authentification à deux facteurs (MFA)', detail: 'Codes TOTP compatibles Google Authenticator pour protéger chaque compte.', ap: 'yes', agendrix: 'yes' },
      { icon: ShieldCheck, label: 'Conformité Loi 25 intégrée', detail: 'Journal d\'audit, droit à l\'oubli, certificats chiffrés, suivi des licences.', ap: 'yes', agendrix: 'partial' },
      { icon: BarChart3, label: 'Rapports, API et webhooks POS', detail: 'Rapports exportables, API ouverte et connexion à votre caisse pour croiser ventes et heures.', ap: 'yes', agendrix: 'partial' },
      { icon: UserCog, label: 'Rôles personnalisés par module', detail: 'Contrôlez précisément quels modules chaque rôle peut voir et modifier.', ap: 'yes', agendrix: 'yes' },
    ],
  },
];

const ALL_ROWS: Row[] = GROUPS.flatMap((g) => g.rows);

const VERDICT_UI: Record<Verdict, { icon: LucideIcon; cls: string; label: string }> = {
  yes: { icon: CheckCircle2, cls: 'text-emerald-600', label: 'Inclus' },
  no: { icon: XCircle, cls: 'text-red-400', label: 'Absent' },
  partial: { icon: MinusCircle, cls: 'text-amber-500', label: 'Partiel' },
};

const VerdictCell = ({ v, testId }: { v: Verdict; testId: string }): JSX.Element => {
  const meta = VERDICT_UI[v];
  const Icon = meta.icon;
  return (
    <div data-testid={testId} className="flex flex-col items-center gap-0.5">
      <Icon className={`w-5 h-5 ${meta.cls}`} />
      <span className={`text-[10px] font-semibold ${meta.cls}`}>{meta.label}</span>
    </div>
  );
};

const scrollToDemo = (): void => {
  document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth' });
};

export const ComparisonSection = (): JSX.Element => {
  const apScore = ALL_ROWS.filter((r) => r.ap === 'yes').length;
  const agScore = ALL_ROWS.filter((r) => r.agendrix === 'yes').length;
  let rowIndex = -1;
  return (
    <section className="bg-slate-900 relative overflow-hidden" data-testid="comparison-section" id="sec-comparaison">
      <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-emerald-600/10 blur-3xl" />
      <div className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full bg-bronze-600/10 blur-3xl" />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24 relative">
        <div className="text-center mb-10 sm:mb-14">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-emerald-300 text-xs font-bold uppercase tracking-[0.18em] mb-5">
            <Trophy className="w-3.5 h-3.5" /> Le comparatif
          </span>
          <h2 className="font-heading text-3xl sm:text-4xl font-extrabold text-white leading-tight">
            Arrière Plan <span className="text-slate-500 font-bold">vs</span> Agendrix
          </h2>
          <p className="mt-4 text-slate-400 text-sm sm:text-base max-w-2xl mx-auto">
            Tout ce qu'Agendrix fait, Arrière Plan le fait aussi — plus tout ce qu'une pharmacie
            québécoise attend vraiment de son SIRH.
          </p>
        </div>

        <div className="rounded-3xl bg-white shadow-2xl overflow-hidden border border-slate-200">
          <div className="grid grid-cols-[1fr,88px,88px] sm:grid-cols-[1fr,150px,150px] items-center border-b-2 border-slate-100 bg-slate-50/80">
            <div className="px-4 sm:px-7 py-4 text-[11px] uppercase tracking-[0.18em] text-slate-400 font-semibold">Fonctionnalité</div>
            <div className="py-4 flex flex-col items-center gap-1.5 bg-emerald-50 border-x border-emerald-100 relative">
              <span className="absolute -top-px inset-x-0 h-1 bg-gradient-to-r from-emerald-500 to-bronze-500" />
              <img src={logo} alt="Arrière Plan" className="h-8 sm:h-10 w-auto object-contain" />
              <span className="text-[10px] sm:text-xs font-extrabold text-emerald-800 font-heading text-center leading-tight">Arrière Plan</span>
              <span className="hidden sm:inline-flex px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[9px] font-bold uppercase tracking-wider">Recommandé</span>
            </div>
            <div className="py-4 flex flex-col items-center gap-1.5">
              <span className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-slate-200 text-slate-500 font-heading font-extrabold text-lg sm:text-xl flex items-center justify-center">A</span>
              <span className="text-[10px] sm:text-xs font-bold text-slate-500 font-heading">Agendrix</span>
            </div>
          </div>

          {GROUPS.map((group) => (
            <div key={group.title}>
              <div
                data-testid={`comparison-group-${group.title}`}
                className="px-4 sm:px-7 py-2.5 bg-slate-900/[0.03] border-b border-slate-100 text-[10px] sm:text-[11px] uppercase tracking-[0.2em] text-emerald-700 font-extrabold"
              >
                {group.title}
              </div>
              {group.rows.map((r) => {
                rowIndex += 1;
                const i = rowIndex;
                return (
                  <div
                    key={r.label}
                    data-testid={`comparison-row-${i}`}
                    className="grid grid-cols-[1fr,88px,88px] sm:grid-cols-[1fr,150px,150px] items-center border-b border-slate-100 last:border-0 hover:bg-slate-50/60 transition-colors"
                  >
                    <div className="px-4 sm:px-7 py-3.5 flex items-start gap-3 min-w-0">
                      <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0 mt-0.5">
                        <r.icon className="w-4 h-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-800">{r.label}</p>
                        <p className="hidden md:block text-xs text-slate-500 mt-0.5">{r.detail}</p>
                      </div>
                    </div>
                    <div className="py-3.5 flex justify-center bg-emerald-50/60 border-x border-emerald-100 self-stretch items-center">
                      <VerdictCell v={r.ap} testId={`comparison-ap-${i}`} />
                    </div>
                    <div className="py-3.5 flex justify-center">
                      <VerdictCell v={r.agendrix} testId={`comparison-agendrix-${i}`} />
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

          <div className="grid grid-cols-[1fr,88px,88px] sm:grid-cols-[1fr,150px,150px] items-center bg-slate-50/80 border-t-2 border-slate-100">
            <div className="px-4 sm:px-7 py-4 text-xs font-bold uppercase tracking-[0.15em] text-slate-500">Score</div>
            <div className="py-4 text-center bg-emerald-600 self-stretch flex items-center justify-center">
              <span data-testid="comparison-score-ap" className="font-heading text-lg font-extrabold text-white">{apScore}/{ALL_ROWS.length}</span>
            </div>
            <div className="py-4 text-center">
              <span data-testid="comparison-score-agendrix" className="font-heading text-lg font-extrabold text-slate-400">{agScore}/{ALL_ROWS.length}</span>
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
          <button
            data-testid="comparison-cta-demo"
            onClick={scrollToDemo}
            className="px-7 py-3.5 rounded-full bg-emerald-500 text-white font-semibold text-sm hover:bg-emerald-400 transition-colors inline-flex items-center gap-2"
          >
            Voyez la différence en démo <ArrowRight className="w-4 h-4" />
          </button>
          <p className="text-[11px] text-slate-500 max-w-xs text-center sm:text-left">
            Comparaison indicative fondée sur les fonctionnalités publiques d'Agendrix (juin 2026).
          </p>
        </div>
      </div>
    </section>
  );
};
