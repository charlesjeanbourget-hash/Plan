import {
  Fingerprint, CalendarClock, TreePalm, ListChecks, MessagesSquare, GraduationCap,
  UserRound, HeartPulse, KeyRound, LucideIcon, Rocket,
} from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

interface Guide {
  id: string;
  icon: LucideIcon;
  title: string;
  goal: string;
  steps: string[];
}

const GUIDES: Guide[] = [
  {
    id: 'guide-premiers-pas',
    icon: Rocket,
    title: 'Premiers pas dans Arrière Plan',
    goal: 'Se connecter et configurer son compte en 5 minutes.',
    steps: [
      'Ouvrez le lien reçu par courriel et connectez-vous avec votre adresse et le mot de passe temporaire.',
      'Changez votre mot de passe dès la première connexion (menu Mon espace → Sécurité).',
      'Complétez votre profil : photo, téléphone et contact d\'urgence.',
      'Vérifiez vos disponibilités dans Mon espace → Disponibilités pour que vos horaires soient justes.',
      'Sur mobile, ajoutez l\'app à votre écran d\'accueil (menu du navigateur → « Ajouter à l\'écran d\'accueil »).',
    ],
  },
  {
    id: 'guide-punch',
    icon: Fingerprint,
    title: 'Pointer ses heures (punch)',
    goal: 'Enregistrer correctement ses entrées, pauses et sorties.',
    steps: [
      'À votre arrivée, entrez votre NIP à 4 chiffres sur la borne tablette de la pharmacie.',
      'Appuyez sur « Entrée » — votre quart démarre et l\'heure est enregistrée.',
      'Pour la pause, entrez votre NIP puis choisissez « Début de pause » ; refaites-le au retour.',
      'À la fin du quart, entrez votre NIP puis « Sortie ». Vos heures réelles sont envoyées à la paie.',
      'Oubli de punch ? Avisez votre gestionnaire : il peut corriger l\'entrée dans le module Paie.',
    ],
  },
  {
    id: 'guide-horaire',
    icon: CalendarClock,
    title: 'Consulter son horaire et échanger un quart',
    goal: 'Toujours savoir quand on travaille et gérer les imprévus.',
    steps: [
      'Ouvrez Horaires : vos quarts sont en couleur, avec le poste de travail (labo, plancher, Dispill…).',
      'Utilisez la vue Jour ou Semaine selon votre besoin ; la météo s\'affiche sur chaque journée.',
      'Un quart « ouvert » est disponible ? Cliquez « Réclamer » — il est attribué selon l\'ancienneté.',
      'Empêchement ? Ouvrez votre quart et proposez un échange à un collègue qualifié.',
      'Vous recevez un rappel automatique avant chaque quart et un résumé matinal dans le chat d\'équipe.',
    ],
  },
  {
    id: 'guide-conges',
    icon: TreePalm,
    title: 'Demander un congé ou des vacances',
    goal: 'Faire une demande claire et suivre son approbation.',
    steps: [
      'Allez dans Vacances → « Nouvelle demande ».',
      'Choisissez le type (vacances, maladie, personnel…) et les dates.',
      'Ajoutez une note si nécessaire, puis soumettez : votre gestionnaire est notifié.',
      'Suivez le statut (en attente, approuvé, refusé) directement dans le module.',
      'Vos heures accumulées en banque de temps sont visibles dans Mon espace → Banque de temps.',
    ],
  },
  {
    id: 'guide-taches',
    icon: ListChecks,
    title: 'Compléter ses tâches de quart',
    goal: 'Savoir quoi faire pendant son quart et le prouver.',
    steps: [
      'Ouvrez Tâches par quart : la liste du jour s\'affiche selon votre poste de travail.',
      'Cochez chaque tâche au fur et à mesure — la progression est visible par l\'équipe.',
      'Une tâche bloquée ? Ajoutez un commentaire pour expliquer pourquoi.',
      'Les tâches non complétées déclenchent un rappel automatique avant la fin du quart.',
    ],
  },
  {
    id: 'guide-messages',
    icon: MessagesSquare,
    title: 'Messages et annonces',
    goal: 'Rester informé sans rien manquer d\'important.',
    steps: [
      'Ouvrez Messages : canal d\'équipe pour tous, conversations directes pour le privé.',
      'Consultez le fil d\'annonces (module Équipe) : les annonces épinglées sont prioritaires.',
      'Cliquez « J\'ai lu » sur les annonces qui le demandent — votre gestionnaire voit la confirmation.',
      'Participez aux sondages éclair et envoyez des kudos à vos collègues pour souligner le bon travail.',
    ],
  },
  {
    id: 'guide-formations',
    icon: GraduationCap,
    title: 'Suivre une formation',
    goal: 'Compléter ses parcours de formation et ses examens.',
    steps: [
      'Ouvrez Formations : vos parcours assignés apparaissent avec leur échéance.',
      'Lisez chaque section, puis passez l\'examen à la fin du parcours.',
      'Un quart « formation » à l\'horaire signifie que vous serez jumelé à un collègue formateur.',
      'Votre résultat est enregistré automatiquement dans votre dossier employé.',
    ],
  },
  {
    id: 'guide-documents',
    icon: UserRound,
    title: 'Documents et signatures',
    goal: 'Fournir ses documents et signer sans paperasse.',
    steps: [
      'Une demande de document (ex. spécimen de chèque) apparaît dans Mon espace → Documents.',
      'Téléversez le fichier demandé directement depuis votre téléphone.',
      'Pour un contrat ou une politique, cliquez « Signer » et tracez votre signature à l\'écran.',
      'Tous vos documents signés restent accessibles dans votre dossier, conformes à la Loi 25.',
    ],
  },
  {
    id: 'guide-sst',
    icon: HeartPulse,
    title: 'Signaler un incident (santé & sécurité)',
    goal: 'Déclarer rapidement un accident ou une situation à risque.',
    steps: [
      'Ouvrez Santé & sécurité → « Déclarer un incident ».',
      'Choisissez le type (accident, quasi-accident, situation dangereuse) et décrivez les faits.',
      'Ajoutez une photo si pertinent, puis soumettez : le responsable SST est notifié immédiatement.',
      'Suivez les mesures correctives mises en place dans la fiche de l\'incident.',
    ],
  },
  {
    id: 'guide-mfa',
    icon: KeyRound,
    title: 'Activer la double authentification (MFA)',
    goal: 'Protéger son compte en 2 minutes.',
    steps: [
      'Allez dans Mon espace → Sécurité → « Activer la MFA ».',
      'Scannez le code QR avec Google Authenticator ou une app similaire.',
      'Entrez le code à 6 chiffres affiché dans l\'app pour confirmer.',
      'À chaque connexion, votre code à 6 chiffres vous sera demandé après le mot de passe.',
    ],
  },
];

export const StarterGuides = (): JSX.Element => (
  <div className="max-w-3xl" data-testid="starter-guides">
    <p className="text-sm text-slate-500 mb-6">
      Nouveaux membres de l'équipe : suivez ces mini-guides pas-à-pas pour maîtriser chaque module en autonomie.
    </p>
    <Accordion type="single" collapsible className="bg-white rounded-xl border border-slate-200 px-6">
      {GUIDES.map((g) => (
        <AccordionItem key={g.id} value={g.id}>
          <AccordionTrigger data-testid={g.id} className="text-left hover:no-underline group">
            <span className="flex items-center gap-3">
              <span className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                <g.icon className="w-4 h-4" />
              </span>
              <span>
                <span className="block font-semibold text-slate-800 text-sm group-hover:text-emerald-700">{g.title}</span>
                <span className="block text-xs text-slate-400 font-normal mt-0.5">{g.goal}</span>
              </span>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <ol className="space-y-2.5 pl-11 pr-2 pb-1">
              {g.steps.map((s, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-slate-600">
                  <span className="w-5 h-5 rounded-full bg-emerald-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  {s}
                </li>
              ))}
            </ol>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  </div>
);
