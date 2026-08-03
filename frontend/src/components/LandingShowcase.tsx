import type { ComponentType, ReactNode } from 'react';
import {
  Sparkles, BellRing, CheckCheck, RefreshCw, Timer, FileSpreadsheet, AlertTriangle, Wallet,
  ListChecks, Repeat, BarChart3, Award, MessagesSquare, Pin, Paperclip, Route, MapPin, Camera,
  Car, Mail, Link2, ArrowLeftRight, CalendarCheck, FileUp, HelpCircle, GraduationCap, Star,
  TrendingUp, BadgeCheck, History, ShieldCheck, CalendarClock, ScrollText, Eraser, Globe,
  KanbanSquare, UserPlus, ClipboardCheck, TreePalm, FileDown, Layers, Vote, PartyPopper, Hand,
  Cake, HeartHandshake, ImagePlus, Filter, Building2, LineChart, Glasses, Download, UserRound,
  Stethoscope, KeyRound,
} from 'lucide-react';
import {
  MockSchedule, MockPunch, MockTasks, MockChat, MockDelivery, MockReplacement,
  MockTraining, MockEvaluation, MockLicenses, MockRecruitment,
  MockLeaves, MockBenefits, MockTeam, MockBudgets,
} from '@/components/LandingMockups';

interface Bullet { icon: ComponentType<{ className?: string }>; title: string; text: string }
interface Section { id: string; eyebrow: string; title: string; highlight: string; bullets: Bullet[]; mock: ReactNode }

const ALSO_INCLUDED: { id: string; icon: ComponentType<{ className?: string; style?: React.CSSProperties }>; title: string; text: string }[] = [
  { id: 'simplifie', icon: Glasses, title: 'Mode simplifié', text: 'Textes agrandis, contrastes renforcés et menu allégé — pensé pour le personnel moins à l\'aise avec les petits caractères.' },
  { id: 'pwa', icon: Download, title: 'Application installable', text: 'Ajoutez Arrière Plan à l\'écran d\'accueil de n\'importe quel téléphone ou tablette — comme une vraie app, sans magasin d\'applications.' },
  { id: 'monespace', icon: UserRound, title: 'Mon espace employé', text: 'Chaque employé retrouve ses quarts, ses relevés de paie PDF, ses congés et ses demandes d\'échange au même endroit.' },
  { id: 'infirmiere', icon: Stethoscope, title: 'Rendez-vous infirmière', text: 'Les rendez-vous clients se planifient à l\'intérieur des quarts de votre infirmière, visibles sur l\'horaire.' },
  { id: 'rappels', icon: BellRing, title: 'Rappels de quart la veille', text: 'Chaque soir à 18 h, ceux qui travaillent le lendemain reçoivent automatiquement le détail de leurs quarts.' },
  { id: 'securite', icon: KeyRound, title: 'Comptes sécurisés', text: 'Verrouillage anti-intrusion, mots de passe robustes, récupération par code courriel et alertes de connexion inhabituelle.' },
];

const SECTIONS: Section[] = [
  {
    id: 'horaires',
    eyebrow: 'Gestion des horaires de travail',
    title: 'Les horaires de votre équipe,',
    highlight: 'en quelques clics.',
    mock: <MockSchedule />,
    bullets: [
      { icon: Sparkles, title: 'Générés par l\'IA', text: 'Disponibilités, rôles, budget salarial et achalandage respectés — l\'horaire se propose tout seul.' },
      { icon: CheckCheck, title: 'Publiés avec accusés de lecture', text: 'Chaque employé est notifié et vous voyez qui a consulté son horaire. Fini l\'incertitude.' },
      { icon: RefreshCw, title: 'Échanges de quarts encadrés', text: 'Les employés s\'échangent des quarts entre eux, le collègue accepte, vous approuvez en un clic.' },
      { icon: TreePalm, title: 'Congés pris en compte', text: 'Les vacances approuvées bloquent automatiquement la planification — zéro conflit d\'horaire.' },
    ],
  },
  {
    id: 'vacances',
    eyebrow: 'Congés & vacances',
    title: 'Les demandes de congé,',
    highlight: 'approuvées sans maux de tête.',
    mock: <MockLeaves />,
    bullets: [
      { icon: TreePalm, title: 'Soldes en temps réel', text: 'Vacances, maladie, congés mobiles : chaque employé voit ses jours restants, vous aussi.' },
      { icon: CheckCheck, title: 'Circuit d\'approbation simple', text: 'Demande, note du gestionnaire, décision en un clic — tout est tracé, conforme Loi 25.' },
      { icon: AlertTriangle, title: 'Filigranes sur l\'horaire', text: 'Un congé approuvé apparaît en filigrane dans la grille et bloque la planification ce jour-là.' },
      { icon: FileDown, title: 'Report et relevé annuel PDF', text: 'Les jours inutilisés se reportent selon votre politique, et le relevé annuel se télécharge en PDF.' },
    ],
  },
  {
    id: 'punch',
    eyebrow: 'Temps de travail & présences',
    title: 'Simplifiez le suivi des heures',
    highlight: 'et accélérez la paie.',
    mock: <MockPunch />,
    bullets: [
      { icon: Timer, title: 'Transformez tout appareil en horodateur', text: 'Tablette ou ordinateur devient une borne de punch à NIP avec confirmation d\'identité.' },
      { icon: FileSpreadsheet, title: 'Oubliez les feuilles de temps papier', text: 'Les heures punchées remplissent la paie automatiquement, temps supplémentaire calculé.' },
      { icon: AlertTriangle, title: 'Irrégularités détectées', text: 'Un punch oublié depuis 12 heures ? Vous êtes alerté et le corrigez en un clic.' },
      { icon: Wallet, title: 'Relevés de paie PDF québécois', text: 'Impôts, RRQ, AE, RQAP et cumulatifs annuels — des relevés complets à votre image.' },
    ],
  },
  {
    id: 'budgets',
    eyebrow: 'Budgets & succursales',
    title: 'Vos coûts de main-d\'œuvre,',
    highlight: 'maîtrisés au dollar près.',
    mock: <MockBudgets />,
    bullets: [
      { icon: Layers, title: 'Budgets par département', text: 'Laboratoire, plancher, livraison : chaque département a son budget, dépassement signalé en rouge.' },
      { icon: Building2, title: 'Multi-succursales', text: 'Un employé peut travailler dans plusieurs succursales — chaque quart est imputé au bon budget.' },
      { icon: LineChart, title: 'Évolution sur 6 mois', text: 'Un graphique compare les coûts planifiés par département, mois après mois.' },
      { icon: Mail, title: 'Rapport mensuel automatique', text: 'Le 1ᵉʳ du mois, un rapport budgets vs coûts réels arrive dans votre boîte courriel.' },
    ],
  },
  {
    id: 'taches',
    eyebrow: 'Organisation du travail',
    title: 'Chaque quart sait',
    highlight: 'exactement quoi faire.',
    mock: <MockTasks />,
    bullets: [
      { icon: ListChecks, title: 'Distribuées par quart', text: 'Matin, après-midi, soir — chacun voit ses tâches, coche, et vous suivez en direct.' },
      { icon: Repeat, title: 'Routines récurrentes', text: 'Ouverture, fermeture, inventaire : les tâches hebdomadaires se recréent toutes seules.' },
      { icon: BarChart3, title: 'Statistiques par quart', text: 'Repérez les quarts qui accrochent et recevez le rapport hebdomadaire par courriel.' },
      { icon: Award, title: 'Badges de reconnaissance', text: 'Semaines parfaites et coups de main récompensés — un tableau d\'honneur qui motive.' },
    ],
  },
  {
    id: 'communication',
    eyebrow: 'Communication professionnelle',
    title: 'Communiquez efficacement',
    highlight: 'avec votre équipe.',
    mock: <MockChat />,
    bullets: [
      { icon: MessagesSquare, title: 'Une seule et même app', text: 'Fini les groupes de textos personnels — la communication reste professionnelle et centralisée.' },
      { icon: Pin, title: 'Messages épinglés', text: 'Les annonces importantes restent en haut de la conversation, impossibles à manquer.' },
      { icon: Paperclip, title: 'Photos & documents', text: 'Partagez protocoles, notes de service et photos directement en pièce jointe.' },
      { icon: Sparkles, title: 'Assistant IA intégré', text: 'Un assistant qui répond aux questions de votre équipe, disponible en tout temps.' },
    ],
  },
  {
    id: 'equipe',
    eyebrow: 'Engagement d\'équipe',
    title: 'Une équipe mobilisée,',
    highlight: 'ça se cultive chaque jour.',
    mock: <MockTeam />,
    bullets: [
      { icon: Vote, title: 'Sondages éclair', text: 'Posez une question à l\'équipe — chacun vote une fois, les résultats s\'affichent en direct.' },
      { icon: Hand, title: 'Kudos entre collègues', text: 'Un merci public qui récolte des applaudissements — la reconnaissance devient contagieuse.' },
      { icon: PartyPopper, title: 'Quarts ouverts à réclamer', text: 'Publiez un quart à combler : premier arrivé, premier servi, directement du téléphone.' },
      { icon: Cake, title: 'Anniversaires soulignés', text: 'Chaque matin d\'anniversaire, un message festif se publie tout seul dans le chat d\'équipe.' },
    ],
  },
  {
    id: 'livraisons',
    eyebrow: 'Livraisons & tournées',
    title: 'Vos livraisons suivies du comptoir',
    highlight: 'à la porte du client.',
    mock: <MockDelivery />,
    bullets: [
      { icon: Route, title: 'Tournée optimisée', text: 'Urgences d\'abord, puis le trajet le plus court — kilomètres calculés à chaque arrêt.' },
      { icon: MapPin, title: 'Navigation en un clic', text: 'Un lien Google Maps multi-étapes prêt pour votre livreur, statuts mis à jour en direct.' },
      { icon: Camera, title: 'Preuves de livraison', text: 'Photo ou signature du client, archivée et retrouvable par nom en quelques secondes.' },
      { icon: Car, title: 'Kilométrage remboursé', text: 'Les kilomètres parcourus se compilent automatiquement pour le remboursement du livreur.' },
    ],
  },
  {
    id: 'remplacements',
    eyebrow: 'Remplacements & agences',
    title: 'Un quart à combler ?',
    highlight: 'Réglé sans un seul appel.',
    mock: <MockReplacement />,
    bullets: [
      { icon: Mail, title: 'Courriels automatiques', text: 'Vos agences partenaires reçoivent la demande instantanément, selon le poste à combler.' },
      { icon: Link2, title: 'Lien public sécurisé', text: 'Les agences soumettent leurs candidats en ligne — sans compte, sans appel, sans attente.' },
      { icon: ArrowLeftRight, title: 'Offres comparées', text: 'Taux horaire, expérience et licence côte à côte : choisissez la meilleure en un coup d\'œil.' },
      { icon: CalendarCheck, title: 'À l\'horaire automatiquement', text: 'Le remplaçant retenu apparaît directement dans la grille d\'horaire de la semaine.' },
    ],
  },
  {
    id: 'formations',
    eyebrow: 'Formations générées par l\'IA',
    title: 'D\'un simple PDF',
    highlight: 'à une formation complète.',
    mock: <MockTraining />,
    bullets: [
      { icon: FileUp, title: 'Déposez votre document', text: 'L\'IA structure le contenu par secteur : ouverture, laboratoire, conformité, savoir-être…' },
      { icon: HelpCircle, title: 'Examens générés', text: 'Questionnaire à choix multiples créé automatiquement, note de passage configurable.' },
      { icon: GraduationCap, title: 'Certificats PDF', text: 'Un certificat officiel à chaque réussite, aux couleurs de votre pharmacie.' },
      { icon: BellRing, title: 'Relances automatiques', text: 'Échéances suivies et rappels courriel envoyés sans que vous ayez à y penser.' },
    ],
  },
  {
    id: 'evaluations',
    eyebrow: 'Performance & rémunération',
    title: 'Des augmentations justes,',
    highlight: 'alignées sur votre BAIIA.',
    mock: <MockEvaluation />,
    bullets: [
      { icon: Star, title: 'Évaluations structurées', text: '10 critères employeur + auto-évaluation de l\'employé, avec relances automatiques.' },
      { icon: TrendingUp, title: 'Suggestion liée au BAIIA', text: 'L\'augmentation proposée respecte la santé financière réelle de votre officine.' },
      { icon: BadgeCheck, title: 'Acceptation en ligne', text: 'L\'employé accepte ou commente la proposition — tout est tracé et documenté.' },
      { icon: History, title: 'Historique salarial', text: 'Chaque changement de taux archivé au dossier avec le score de performance associé.' },
    ],
  },
  {
    id: 'avantages',
    eyebrow: 'Avantages sociaux',
    title: 'Vos avantages sociaux,',
    highlight: 'enfin mis en valeur.',
    mock: <MockBenefits />,
    bullets: [
      { icon: FileUp, title: 'Du PDF d\'assureur à la fiche claire', text: 'Déposez le contrat de votre assureur : l\'IA en extrait des avantages lisibles pour l\'équipe.' },
      { icon: ImagePlus, title: 'Illustrations générées par l\'IA', text: 'Chaque avantage reçoit une image attrayante — une vitrine dont votre équipe se souvient.' },
      { icon: Filter, title: 'Ciblés par poste', text: 'Chaque employé ne voit que les avantages auxquels son poste donne droit.' },
      { icon: HeartHandshake, title: 'Brouillon puis publication', text: 'Préparez en coulisses, publiez quand tout est prêt — modifiable en tout temps.' },
    ],
  },
  {
    id: 'licences',
    eyebrow: 'Conformité Loi 25',
    title: 'Les licences professionnelles',
    highlight: 'sous clé, sans effort.',
    mock: <MockLicenses />,
    bullets: [
      { icon: ShieldCheck, title: 'Coffre-fort numérique', text: 'Certificats stockés de façon sécurisée, accès réservé aux gestionnaires autorisés.' },
      { icon: CalendarClock, title: 'Rappels 30 jours avant', text: 'L\'employé est prévenu automatiquement avant l\'échéance — zéro licence expirée.' },
      { icon: ScrollText, title: 'Journal d\'audit invisible', text: 'Chaque consultation et modification est journalisée, conformément à la Loi 25.' },
      { icon: Eraser, title: 'Droit à l\'oubli', text: 'Destruction définitive des licences et documents sur demande, en un clic.' },
    ],
  },
  {
    id: 'recrutement',
    eyebrow: 'Recrutement & intégration',
    title: 'De la candidature au premier quart,',
    highlight: 'sans friction.',
    mock: <MockRecruitment />,
    bullets: [
      { icon: Globe, title: 'Portail carrières public', text: 'Vos offres en ligne : les candidatures arrivent directement dans votre pipeline.' },
      { icon: KanbanSquare, title: 'Pipeline visuel', text: 'Candidature, entrevue, embauche — suivez chaque candidat d\'un coup d\'œil.' },
      { icon: UserPlus, title: 'Embauche en un clic', text: 'Poste, taux horaire et compétences : le dossier employé se crée tout seul.' },
      { icon: ClipboardCheck, title: 'Onboarding automatique', text: 'La liste d\'intégration démarre dès l\'embauche — contrat, NIP, formations, tout y est.' },
    ],
  },
];

export function LandingShowcase(): JSX.Element {
  return (
    <div data-testid="features-showcase">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-4 text-center">
        <span className="inline-block w-12 h-1 rounded-full bg-gradient-to-r from-emerald-500 to-bronze-500 mb-5" />
        <h2 className="font-heading text-3xl sm:text-4xl font-extrabold text-slate-900 mb-4">
          Tout ce qu'Arrière Plan fait pour votre pharmacie
        </h2>
        <p className="text-sm sm:text-base text-slate-500 max-w-2xl mx-auto">
          Un seul outil qui remplace les tableurs, les groupes de textos, les feuilles de punch papier et les rappels manuels.
        </p>
      </div>
      {SECTIONS.map((s, idx) => (
        <section
          key={s.id}
          id={`sec-${s.id}`}
          data-testid={`showcase-${s.id}`}
          className={`overflow-hidden ${idx % 2 === 1 ? 'bg-slate-50/80 border-y border-slate-100' : 'bg-white'}`}
        >
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
            <div className="text-center max-w-3xl mx-auto mb-10 sm:mb-12">
              <p className="text-xs sm:text-sm uppercase tracking-[0.18em] text-bronze-700 font-bold mb-3">{s.eyebrow}</p>
              <h3 className="font-heading text-2xl sm:text-3xl lg:text-4xl font-extrabold text-slate-900 leading-tight">
                {s.title} <span className="text-emerald-600">{s.highlight}</span>
              </h3>
            </div>
            <div className="relative flex justify-center mb-12 sm:mb-16">
              <div
                aria-hidden="true"
                className="absolute -inset-x-6 -inset-y-10 sm:-inset-x-16 rounded-[3rem] bg-[radial-gradient(55%_65%_at_50%_42%,rgba(233,188,150,0.4),rgba(16,185,129,0.1)_58%,transparent_78%)] blur-xl"
              />
              <div className="relative w-full max-w-2xl">{s.mock}</div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-8 max-w-4xl mx-auto">
              {s.bullets.map((b) => (
                <div key={b.title} className="flex items-start gap-4">
                  <span className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0">
                    <b.icon className="w-4 h-4 text-emerald-700" />
                  </span>
                  <div>
                    <p className="font-heading font-bold text-slate-900 text-sm sm:text-base mb-1">{b.title}</p>
                    <p className="text-xs sm:text-sm text-slate-500 leading-relaxed">{b.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      ))}
      <section id="sec-aussi" data-testid="also-included-section" className="bg-slate-50/80 border-y border-slate-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
          <div className="text-center max-w-3xl mx-auto mb-10">
            <p className="text-xs sm:text-sm uppercase tracking-[0.18em] text-bronze-700 font-bold mb-3">Et ce n'est pas tout</p>
            <h3 className="font-heading text-2xl sm:text-3xl font-extrabold text-slate-900 leading-tight">
              Aussi inclus, <span className="text-emerald-600">sans supplément.</span>
            </h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {ALSO_INCLUDED.map((a) => (
              <div key={a.title} data-testid={`also-card-${a.id}`} className="rounded-2xl bg-white border border-slate-200 p-6 hover:border-emerald-300 hover:-translate-y-1 transition-all">
                <span className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center mb-4">
                  <a.icon className="w-4.5 h-4.5 text-emerald-700" style={{ width: 18, height: 18 }} />
                </span>
                <p className="font-heading font-bold text-slate-900 text-sm sm:text-base mb-1.5">{a.title}</p>
                <p className="text-xs sm:text-sm text-slate-500 leading-relaxed">{a.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
