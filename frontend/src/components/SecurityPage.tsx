import { View } from '@/types';
import { BrandLogo } from '@/components/BrandLogo';
import { EfvpSection } from '@/components/EfvpSection';
import {
  ArrowLeft, ShieldCheck, FileDown, KeyRound, Lock, EyeOff, GitBranch, Server,
  FileSignature, ScrollText, UserX, Fingerprint, BellRing, LucideIcon,
  Radar, CheckCircle2, Clock3, Bot, BookOpenText,
} from 'lucide-react';

interface Props {
  onNavigate: (view: View) => void;
}

const PILLARS: { id: string; icon: LucideIcon; title: string; items: string[] }[] = [
  {
    id: 'loi25',
    icon: ScrollText,
    title: 'Conformité Loi 25 (protection des renseignements personnels)',
    items: [
      'Consentement explicite et horodaté à la première connexion.',
      'Droit à l\'oubli : anonymisation complète d\'un ancien employé en un clic (nom, courriel, pointages, licences).',
      'Journal d\'audit inaltérable : plus de 140 points d\'audit — chaque action sensible est tracée (auteur, rôle, date, détail).',
      'Cloisonnement strict : chaque pharmacie ne voit que ses propres données ; chaque employé, que les siennes.',
    ],
  },
  {
    id: 'auth',
    icon: KeyRound,
    title: 'Authentification forte',
    items: [
      'Mots de passe hachés avec bcrypt (algorithme de hachage renforcé) — jamais stockés en clair.',
      'Vérification en 2 étapes (MFA — authentification multifacteur) par codes TOTP (mot de passe à usage unique basé sur le temps), que l\'administrateur peut imposer à toute l\'équipe.',
      'Politique de mot de passe configurable : longueur, complexité et expiration (90 jours à 1 an) avec renouvellement forcé.',
      'Sessions limitées à 24 h par jetons JWT (JSON Web Token) ; réinitialisation par code à usage unique valide 15 minutes (maximum 5 tentatives).',
    ],
  },
  {
    id: 'chiffrement',
    icon: Lock,
    title: 'Chiffrement',
    items: [
      'HTTPS/TLS (Transport Layer Security — chiffrement des communications) pour tous les échanges entre le navigateur et le serveur.',
      'Certificats de licences professionnelles (OPQ — Ordre des pharmaciens du Québec) chiffrés avec Fernet/AES (Advanced Encryption Standard — norme de chiffrement avancé) avant stockage.',
      'Secrets de la vérification en 2 étapes chiffrés en base de données.',
      'Aucune clé ni identifiant dans le code source — variables d\'environnement serveur uniquement.',
    ],
  },
  {
    id: 'acces',
    icon: EyeOff,
    title: 'Contrôle d\'accès',
    items: [
      'Rôles hiérarchiques : superadmin, administrateur, gestionnaire, employé.',
      'Accès par module personnalisable rôle par rôle, personne par personne.',
      'Taux horaires, NIP et données RH (ressources humaines) jamais exposés aux employés non autorisés.',
    ],
  },
  {
    id: 'punch',
    icon: Fingerprint,
    title: 'Borne de pointage protégée',
    items: [
      'NIP (numéro d\'identification personnel) à 4 chiffres haché avec SHA-256 (Secure Hash Algorithm — algorithme de hachage sécurisé) et un poivre secret — jamais conservé en clair.',
      'Verrouillage temporaire après plusieurs NIP invalides (protection anti-force brute).',
      'Géolocalisation au punch uniquement avec le consentement du navigateur.',
    ],
  },
  {
    id: 'incidents',
    icon: BellRing,
    title: 'Détection d\'incidents',
    items: [
      'Alerte courriel automatique lors d\'une connexion depuis une nouvelle adresse IP (Internet Protocol — l\'adresse réseau de l\'appareil).',
      'Registre des incidents tenu par le responsable de la protection des renseignements personnels.',
      'Signalement à la CAI (Commission d\'accès à l\'information du Québec) et aux personnes concernées en cas de risque de préjudice sérieux, conformément à la Loi 25.',
    ],
  },
  {
    id: 'github',
    icon: GitBranch,
    title: 'Code source sécurisé (GitHub)',
    items: [
      'Le code source ne contient aucune donnée personnelle ni aucun secret.',
      'Dépôt privé avec historique complet et inaltérable de chaque modification.',
      'Continuité d\'affaires : redéploiement possible en quelques heures en cas de panne.',
    ],
  },
  {
    id: 'hebergement',
    icon: Server,
    title: 'Hébergement des données',
    items: [
      'Données hébergées sur Google Cloud, région us-central1 (Iowa, États-Unis) : chiffrement au repos et en transit, sauvegardes horaires et quotidiennes, conteneurs isolés.',
      'Communication hors Québec encadrée par la Loi 25 (article 17) : ÉFVP (évaluation des facteurs relatifs à la vie privée) documentée et divulgation transparente dans la politique de confidentialité.',
      'Option d\'hébergement 100 % québécois (MongoDB Atlas, région Montréal) planifiée : les données ne quitteraient plus le Québec.',
    ],
  },
  {
    id: 'complementaires',
    icon: FileSignature,
    title: 'Mesures complémentaires',
    items: [
      'Signatures électroniques horodatées au dossier de l\'employé.',
      'Environnement de développement séparé de la production — aucun test sur les données réelles.',
      'Suspension immédiate des comptes au départ d\'un employé, avec anonymisation possible.',
    ],
  },
];

const AI_SAFEGUARDS: string[] = [
  'Minimisation des données : l\'IA ne reçoit que le strict nécessaire à chaque tâche (noms, postes, disponibilités, budgets). Elle ne reçoit jamais de mots de passe, de NIP, de documents signés ni de renseignements médicaux.',
  'Aucun accès direct : l\'IA n\'a aucun accès à la base de données. Elle reçoit une demande ponctuelle, renvoie une proposition, puis la conversation se termine — sans mémoire persistante de vos données.',
  'Aucun entraînement sur vos données : les modèles sont utilisés par API professionnelle (interface de programmation d\'applications), dont les conditions d\'utilisation excluent l\'usage des données transmises pour entraîner les modèles.',
  'Transit chiffré : chaque échange avec les modèles d\'IA passe par TLS (Transport Layer Security), comme le reste de l\'application.',
  'Un humain garde toujours le dernier mot : aucune décision automatisée — chaque horaire, formation ou proposition générée par l\'IA doit être revue et approuvée par un gestionnaire avant d\'être appliquée (transparence exigée par la Loi 25 pour les traitements automatisés).',
  'Garde-fous serveur : chaque réponse de l\'IA est validée par le serveur (employés existants, succursales permises, budgets, chevauchements) avant tout enregistrement — une réponse invalide est rejetée.',
];

const TESTS: { id: string; title: string; method: string; result: string; status: 'ok' | 'planned' }[] = [
  {
    id: 'scan-externe',
    title: 'Balayage externe des ports base de données (« test ultime »)',
    method: 'Tentatives de connexion TCP (Transmission Control Protocol — protocole de connexion réseau) depuis l\'extérieur du réseau vers les ports MongoDB (27017-27019) de la production et du développement.',
    result: 'Connexion refusée sur tous les ports base de données. Seul le port 443 (HTTPS) répond.',
    status: 'ok',
  },
  {
    id: 'point-entree',
    title: 'Point d\'entrée unique',
    method: 'Vérification des ports exposés publiquement.',
    result: 'L\'application n\'est joignable que par HTTPS ; la base de données n\'a aucune adresse publique.',
    status: 'ok',
  },
  {
    id: 'isolation',
    title: 'Isolation réseau (équivalent pare-feu)',
    method: 'La base MongoDB vit dans un conteneur isolé : seul le serveur d\'application du même conteneur peut lui parler.',
    result: 'Équivalent moderne de la règle pare-feu « autoriser uniquement l\'adresse IP de l\'application ».',
    status: 'ok',
  },
  {
    id: 'bindip',
    title: 'Liaison d\'adresses (bindIp)',
    method: 'Inspection de la configuration du serveur de base de données.',
    result: 'Connexions locales seulement dans la configuration ; exposition externe bloquée au niveau réseau (confirmé par balayage).',
    status: 'ok',
  },
  {
    id: 'auth-mongo',
    title: 'Authentification MongoDB obligatoire',
    method: 'Vérification de la configuration de sécurité du serveur de base de données.',
    result: 'Compensée par l\'inaccessibilité externe ; sera imposée d\'office avec MongoDB Atlas région Montréal (authentification + TLS + liste blanche d\'adresses IP).',
    status: 'planned',
  },
];

const GLOSSARY: { term: string; full: string }[] = [
  { term: 'Loi 25', full: 'Loi québécoise modernisant la protection des renseignements personnels dans le secteur privé.' },
  { term: 'MFA', full: 'Multi-Factor Authentication — authentification multifacteur : un code en plus du mot de passe.' },
  { term: 'TOTP', full: 'Time-based One-Time Password — mot de passe à usage unique basé sur le temps (ex. Google Authenticator).' },
  { term: 'JWT', full: 'JSON Web Token — jeton de session signé qui expire automatiquement (24 h ici).' },
  { term: 'HTTPS / TLS', full: 'Transport Layer Security — chiffrement de toutes les communications entre votre appareil et le serveur.' },
  { term: 'AES / Fernet', full: 'Advanced Encryption Standard — norme de chiffrement utilisée pour protéger les fichiers sensibles.' },
  { term: 'SHA-256', full: 'Secure Hash Algorithm — fonction de hachage : transforme une donnée en empreinte irréversible.' },
  { term: 'bcrypt', full: 'Algorithme de hachage renforcé conçu spécifiquement pour protéger les mots de passe.' },
  { term: 'NIP', full: 'Numéro d\'identification personnel — le code à 4 chiffres de la borne de pointage.' },
  { term: 'OPQ', full: 'Ordre des pharmaciens du Québec — ordre professionnel encadrant la pratique.' },
  { term: 'CAI', full: 'Commission d\'accès à l\'information du Québec — organisme de surveillance de la Loi 25.' },
  { term: 'ÉFVP', full: 'Évaluation des facteurs relatifs à la vie privée — analyse exigée avant un transfert de données hors Québec.' },
  { term: 'API', full: 'Application Programming Interface — interface de programmation permettant à deux logiciels de communiquer.' },
  { term: 'IA', full: 'Intelligence artificielle — ici, les modèles générant horaires et formations, toujours validés par un humain.' },
  { term: 'IP', full: 'Internet Protocol — l\'adresse réseau identifiant un appareil connecté.' },
  { term: 'SIRH', full: 'Système d\'information de ressources humaines — la catégorie de logiciel d\'Arrière Plan.' },
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
            Les données RH (ressources humaines) de votre pharmacie sont parmi les plus sensibles qui soient. Voici, en toute
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
            <div key={p.id} data-testid={`security-pillar-${p.id}`} className="rounded-2xl border border-slate-200 bg-white p-6 hover:shadow-md transition-shadow">
              <div className="flex items-center gap-3 mb-3">
                <span className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
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

        <div className="mt-12" data-testid="security-ai-section">
          <div className="flex items-center gap-3 mb-2">
            <span className="w-10 h-10 rounded-xl bg-slate-900 text-emerald-400 flex items-center justify-center shrink-0">
              <Bot className="w-5 h-5" />
            </span>
            <div>
              <h2 className="font-heading text-xl font-bold text-slate-900">Intelligence artificielle (IA) : encadrée et sans accès à vos données sensibles</h2>
              <p className="text-xs text-slate-500">Comment l'IA qui génère vos horaires et formations ne peut pas faire un usage non autorisé de vos renseignements</p>
            </div>
          </div>
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/50 p-6">
            <ul className="space-y-3">
              {AI_SAFEGUARDS.map((it, i) => (
                <li key={i} data-testid={`security-ai-item-${i + 1}`} className="flex items-start gap-2.5 text-sm text-slate-600 leading-relaxed">
                  <ShieldCheck className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                  {it}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-12" data-testid="security-tests-section">
          <div className="flex items-center gap-3 mb-2">
            <span className="w-10 h-10 rounded-xl bg-slate-900 text-emerald-400 flex items-center justify-center shrink-0">
              <Radar className="w-5 h-5" />
            </span>
            <div>
              <h2 className="font-heading text-xl font-bold text-slate-900">Tests de sécurité effectués</h2>
              <p className="text-xs text-slate-500">Durcissement de la base de données — vérifié le 19 août 2026 sur la production et le développement</p>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {TESTS.map((t) => (
              <div key={t.id} data-testid={`security-test-${t.id}`} className={`rounded-2xl border p-5 ${t.status === 'ok' ? 'border-emerald-100 bg-emerald-50/40' : 'border-amber-100 bg-amber-50/40'}`}>
                <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                  <span className={`shrink-0 min-w-[110px] justify-center inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold ${t.status === 'ok' ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-white'}`}>
                    {t.status === 'ok' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Clock3 className="w-3.5 h-3.5" />}
                    {t.status === 'ok' ? 'Conforme' : 'Planifié'}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900">{t.title}</p>
                    <p className="text-xs text-slate-500 mt-1"><span className="font-semibold text-slate-600">Méthode :</span> {t.method}</p>
                    <p className="text-xs text-slate-600 mt-1"><span className="font-semibold text-slate-700">Résultat :</span> {t.result}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500 italic">
            Conclusion : le critère décisif — l'injoignabilité de la base de données depuis Internet — est démontré
            sur les deux environnements. Le détail complet figure dans le dossier PDF téléchargeable.
          </p>
        </div>

        <EfvpSection />

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

        <div className="mt-12" data-testid="security-glossary">
          <div className="flex items-center gap-3 mb-4">
            <span className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
              <BookOpenText className="w-5 h-5" />
            </span>
            <div>
              <h2 className="font-heading text-xl font-bold text-slate-900">Lexique des termes techniques</h2>
              <p className="text-xs text-slate-500">Chaque acronyme utilisé sur cette page, expliqué simplement</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {GLOSSARY.map((g) => (
              <div key={g.term} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-xs font-extrabold text-emerald-700 uppercase tracking-wider">{g.term}</p>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">{g.full}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-slate-400 mt-12 border-t border-slate-100 pt-6">
          Document informatif — dernière mise à jour : 19 août 2026. Pour toute question de sécurité,
          contactez le responsable de la protection des renseignements personnels indiqué dans la politique de confidentialité.
        </p>
      </main>
    </div>
  );
}
