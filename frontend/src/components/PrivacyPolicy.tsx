import { View } from '@/types';
import { BrandLogo } from '@/components/BrandLogo';
import { ArrowLeft, ShieldCheck } from 'lucide-react';

interface Props {
  onNavigate: (view: View) => void;
}

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: '1. Responsable de la protection des renseignements personnels',
    body: [
      'Conformément à la Loi 25 (Loi modernisant des dispositions législatives en matière de protection des renseignements personnels), le responsable de la protection des renseignements personnels d\'Arrière Plan est :',
      'Charles Jean-Bourget — charlesjeanbourget@gmail.com',
      'Toute question, demande d\'accès, de rectification ou de suppression de renseignements personnels peut lui être adressée à cette adresse.',
    ],
  },
  {
    title: '2. Renseignements que nous recueillons',
    body: [
      'Dans le cadre de la gestion des ressources humaines de votre pharmacie, la plateforme recueille et traite : les coordonnées des employés (nom, courriel, téléphone), les informations d\'emploi (poste, taux horaire, matricule de paie, horaires, heures travaillées), les licences et certificats professionnels, les évaluations de performance, les données de pointage (incluant, avec consentement du navigateur, la position géographique au moment du punch), les candidatures reçues, ainsi que les messages échangés dans la messagerie interne.',
      'Pour les visiteurs du site : les informations soumises volontairement via le formulaire de demande de démonstration (nom, pharmacie, courriel, téléphone, message).',
    ],
  },
  {
    title: '3. Finalités du traitement',
    body: [
      'Ces renseignements sont utilisés uniquement pour : la planification des horaires et le calcul de la paie, le suivi de la conformité des licences professionnelles, la gestion des remplacements et du recrutement, la communication interne d\'équipe, et la prise de contact suivant une demande de démonstration.',
      'Aucun renseignement personnel n\'est vendu ni communiqué à des tiers à des fins commerciales.',
    ],
  },
  {
    title: '4. Géolocalisation au pointage',
    body: [
      'La position géographique au moment du punch n\'est recueillie que si l\'employé l\'autorise explicitement dans son navigateur. Le refus n\'empêche jamais le pointage. Ces données servent uniquement à confirmer le lieu de travail (notamment pour les livreurs) et ne font l\'objet d\'aucun suivi continu.',
    ],
  },
  {
    title: '5. Conservation et destruction',
    body: [
      'Les renseignements sont conservés pendant la durée de l\'emploi et pour la période requise par les lois applicables (normes du travail, fiscalité). Les licences professionnelles et documents du coffre-fort peuvent être détruits définitivement sur demande (droit à l\'oubli), et chaque destruction est consignée au journal d\'audit.',
    ],
  },
  {
    title: '6. Mesures de sécurité',
    body: [
      'Les mots de passe sont hachés (bcrypt) et une politique de mots de passe forts est appliquée. Les NIP de pointage sont hachés et ne sont jamais conservés en clair. Les certificats de licences sont chiffrés avant leur stockage. Les accès sont limités par rôle (employé, gestionnaire, administrateur), les sessions expirent automatiquement et chaque consultation de document sensible est journalisée.',
    ],
  },
  {
    title: '7. Incidents de confidentialité',
    body: [
      'Tout incident de confidentialité présentant un risque de préjudice sérieux sera signalé à la Commission d\'accès à l\'information du Québec (CAI) et aux personnes concernées, conformément à la Loi 25. Un registre des incidents est tenu par le responsable de la protection des renseignements personnels.',
    ],
  },
  {
    title: '8. Vos droits',
    body: [
      'Vous pouvez en tout temps demander l\'accès aux renseignements personnels que nous détenons à votre sujet, leur rectification ou leur suppression, ou retirer votre consentement, en écrivant au responsable de la protection des renseignements personnels. Une réponse vous sera fournie dans un délai de 30 jours.',
    ],
  },
  {
    title: '9. Témoins (cookies) et stockage local',
    body: [
      'La plateforme n\'utilise aucun témoin publicitaire ni traceur tiers. Seul le stockage local du navigateur est utilisé pour maintenir votre session de travail et vos préférences d\'affichage.',
    ],
  },
];

export default function PrivacyPolicy({ onNavigate }: Props): JSX.Element {
  return (
    <div className="min-h-screen bg-white" data-testid="privacy-policy-page">
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <BrandLogo size="sm" />
          <button
            data-testid="privacy-back-button"
            onClick={() => onNavigate('landing')}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-emerald-700 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Retour à l'accueil
          </button>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold px-3 py-1.5 mb-5">
          <ShieldCheck className="w-3.5 h-3.5" /> Conforme Loi 25 — Québec
        </span>
        <h1 className="font-heading text-3xl sm:text-4xl font-extrabold text-slate-900 mb-3">
          Politique de confidentialité
        </h1>
        <p className="text-sm text-slate-500 mb-10">
          Dernière mise à jour : juillet 2026. Cette politique décrit comment Arrière Plan recueille,
          utilise, protège et détruit les renseignements personnels.
        </p>
        <div className="space-y-8">
          {SECTIONS.map((s) => (
            <section key={s.title}>
              <h2 className="font-heading text-lg font-bold text-slate-900 mb-2">{s.title}</h2>
              {s.body.map((p, i) => (
                <p key={i} className="text-sm text-slate-600 leading-relaxed mb-2">{p}</p>
              ))}
            </section>
          ))}
        </div>
        <p className="text-xs text-slate-400 mt-12 border-t border-slate-100 pt-6">
          Ce document constitue un modèle conforme aux exigences de la Loi 25 ; faites-le valider par un
          conseiller juridique avant votre mise en production commerciale.
        </p>
      </main>
    </div>
  );
}
