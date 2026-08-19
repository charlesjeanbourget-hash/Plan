import { View } from '@/types';
import { BrandLogo } from '@/components/BrandLogo';
import {
  ArrowLeft, ShieldCheck, FileDown, KeyRound, Lock, EyeOff, GitBranch, Server,
  FileSignature, ScrollText, UserX, Fingerprint, BellRing, LucideIcon,
} from 'lucide-react';

interface Props {
  onNavigate: (view: View) => void;
}

const PILLARS: { icon: LucideIcon; title: string; items: string[] }[] = [
  {
    icon: ScrollText,
    title: 'Conformité Loi 25',
    items: [
      'Consentement explicite et horodaté à la première connexion.',
      'Droit à l\'oubli : anonymisation complète d\'un ancien employé en un clic (nom, courriel, pointages, licences).',
      'Journal d\'audit inaltérable : plus de 140 points d\'audit — chaque action sensible est tracée (auteur, rôle, date, détail).',
      'Cloisonnement strict : chaque pharmacie ne voit que ses propres données ; chaque employé, que les siennes.',
    ],
  },
  {
    icon: KeyRound,
    title: 'Authentification forte',
    items: [
      'Mots de passe hachés (bcrypt) — jamais stockés en clair.',
      'Vérification en 2 étapes (MFA, codes TOTP) que l\'administrateur peut imposer à toute l\'équipe.',
      'Politique de mot de passe configurable : longueur, complexité et expiration (90 j à 1 an) avec renouvellement forcé.',
      'Sessions limitées à 24 h ; réinitialisation par code à usage unique valide 15 minutes (max 5 tentatives).',
    ],
  },
  {
    icon: Lock,
    title: 'Chiffrement',
    items: [
      'HTTPS/TLS pour toutes les communications.',
      'Certificats de licences professionnelles (OPQ) chiffrés (Fernet/AES) avant stockage.',
      'Secrets MFA chiffrés en base de données.',
      'Aucune clé ni identifiant dans le code source — variables d\'environnement serveur uniquement.',
    ],
  },
  {
    icon: EyeOff,
    title: 'Contrôle d\'accès',
    items: [
      'Rôles hiérarchiques : superadmin, administrateur, gestionnaire, employé.',
      'Accès par module personnalisable rôle par rôle, personne par personne.',
      'Taux horaires, NIP et données RH jamais exposés aux employés non autorisés.',
    ],
  },
  {
    icon: Fingerprint,
    title: 'Borne de pointage protégée',
    items: [
      'NIP à 4 chiffres hachés (SHA-256 + poivre secret) — jamais conservés en clair.',
      'Verrouillage temporaire après plusieurs NIP invalides (anti-force brute).',
      'Géolocalisation au punch uniquement avec le consentement du navigateur.',
    ],
  },
  {
    icon: BellRing,
    title: 'Détection d\'incidents',
    items: [
      'Alerte courriel automatique lors d\'une connexion depuis une nouvelle adresse IP.',
      'Registre des incidents tenu par le responsable de la protection des renseignements personnels.',
      'Signalement à la CAI et aux personnes concernées en cas de risque de préjudice sérieux, conformément à la Loi 25.',
    ],
  },
  {
    icon: GitBranch,
    title: 'Code source sécurisé (GitHub)',
    items: [
      'Le code source ne contient aucune donnée personnelle ni aucun secret.',
      'Dépôt privé avec historique complet et inaltérable de chaque modification.',
      'Continuité d\'affaires : redéploiement possible en quelques heures en cas de panne.',
    ],
  },
  {
    icon: Server,
    title: 'Hébergement des données',
    items: [
      'Infrastructure infonuagique gérée : conteneurs isolés, HTTPS, base de données dédiée.',
      'Option d\'hébergement 100 % québécois (région Montréal) : les données ne quittent jamais le Québec.',
      'Sauvegardes automatiques et chiffrement géré.',
    ],
  },
  {
    icon: FileSignature,
    title: 'Mesures complémentaires',
    items: [
      'Signatures électroniques horodatées au dossier de l\'employé.',
      'Environnement de développement séparé de la production — aucun test sur les données réelles.',
      'Suspension immédiate des comptes au départ d\'un employé, avec anonymisation possible.',
    ],
  },
];

export default function SecurityPage({ onNavigate }: Props): JSX.Element {
  return (
    <div className="min-h-screen bg-white" data-testid="security-page">
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <BrandLogo size="sm" />
          <button
            data-testid="security-back-button"
            onClick={() => onNavigate('landing')}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-emerald-700 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Retour à l'accueil
          </button>
        </div>
      </header>

      <section className="bg-slate-900 relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full bg-emerald-600/10 blur-3xl" />
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-14 sm:py-20 relative">
          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-emerald-300 text-xs font-bold uppercase tracking-[0.18em] px-4 py-1.5 mb-5">
            <ShieldCheck className="w-3.5 h-3.5" /> Protection dès la conception
          </span>
          <h1 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white leading-tight max-w-2xl">
            Sécurité et confidentialité
          </h1>
          <p className="mt-4 text-slate-400 text-sm sm:text-base max-w-2xl">
            Les données RH de votre pharmacie sont parmi les plus sensibles qui soient. Voici, en toute
            transparence, chaque mesure mise en place pour les protéger — conformément à la Loi 25 du Québec.
          </p>
          <a
            data-testid="security-pdf-download"
            href="/dossier-securite-loi25.pdf"
            download
            className="mt-7 inline-flex items-center gap-2 px-6 py-3 rounded-full bg-emerald-500 text-white font-semibold text-sm hover:bg-emerald-400 transition-colors"
          >
            <FileDown className="w-4 h-4" /> Télécharger le dossier complet (PDF)
          </a>
        </div>
      </section>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {PILLARS.map((p) => (
            <div key={p.title} data-testid={`security-pillar-${p.title}`} className="rounded-2xl border border-slate-200 bg-white p-6 hover:shadow-md transition-shadow">
              <div className="flex items-center gap-3 mb-3">
                <span className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
                  <p.icon className="w-5 h-5" />
                </span>
                <h2 className="font-heading text-base font-bold text-slate-900">{p.title}</h2>
              </div>
              <ul className="space-y-2">
                {p.items.map((it, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-600 leading-relaxed">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
                    {it}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 rounded-2xl bg-emerald-50 border border-emerald-100 p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
          <UserX className="w-8 h-8 text-emerald-700 shrink-0" />
          <div className="flex-1">
            <p className="font-heading font-bold text-slate-900">Vos droits en tout temps</p>
            <p className="text-sm text-slate-600 mt-1">
              Accès, rectification, suppression ou retrait de consentement : écrivez au responsable de la
              protection des renseignements personnels. Réponse sous 30 jours, conformément à la Loi 25.
            </p>
          </div>
          <button
            data-testid="security-privacy-link"
            onClick={() => onNavigate('privacy')}
            className="shrink-0 px-5 py-2.5 rounded-full bg-white border border-emerald-200 text-emerald-800 text-sm font-semibold hover:bg-emerald-100 transition-colors"
          >
            Lire la politique de confidentialité
          </button>
        </div>

        <p className="text-xs text-slate-400 mt-12 border-t border-slate-100 pt-6">
          Document informatif — dernière mise à jour : juin 2026. Pour toute question de sécurité,
          contactez le responsable de la protection des renseignements personnels indiqué dans la politique de confidentialité.
        </p>
      </main>
    </div>
  );
}
