import { FileDown, FileCheck2, ShieldCheck, AlertTriangle } from 'lucide-react';

const IDENTIFICATION: { k: string; v: string }[] = [
  { k: 'Projet évalué', v: 'Hébergement et exploitation de la plateforme Arrière Plan (SIRH — système d\'information de ressources humaines pour pharmacies) sur une infrastructure infonuagique située hors Québec.' },
  { k: 'Responsable de la protection des renseignements personnels', v: 'Charles Jean-Bourget — charlesjeanbourget@gmail.com' },
  { k: 'Date de l\'évaluation', v: '20 août 2026' },
  { k: 'Déclencheur', v: 'Article 17 de la Loi 25 : évaluation obligatoire avant toute communication de renseignements personnels à l\'extérieur du Québec.' },
  { k: 'Destination', v: 'Google Cloud Platform (GCP), région us-central1 — Iowa, États-Unis — gérée par le fournisseur de plateforme Emergent.' },
];

const DATA_SCOPE: string[] = [
  'Coordonnées des employés : nom, courriel, téléphone, contact d\'urgence.',
  'Données d\'emploi : poste, taux horaire, matricule de paie, horaires, heures travaillées, banques de temps.',
  'Données de pointage, incluant — avec consentement explicite du navigateur — la position géographique au moment du punch.',
  'Licences et certificats professionnels (OPQ — Ordre des pharmaciens du Québec), chiffrés avant stockage.',
  'Évaluations de performance, documents signés électroniquement, messages de la messagerie interne, candidatures.',
];

const RISKS: { risk: string; level: string; mitigation: string }[] = [
  {
    risk: 'Accès par les autorités américaines (CLOUD Act)',
    level: 'Probabilité faible · impact moyen',
    mitigation: 'Données limitées (aucun numéro d\'assurance sociale ni donnée médicale), chiffrement applicatif des documents sensibles, migration québécoise planifiée.',
  },
  {
    risk: 'Accès non autorisé à la base de données',
    level: 'Probabilité très faible · impact élevé',
    mitigation: 'Base injoignable depuis Internet (vérifié par balayage externe), isolation réseau, authentification forte, journal d\'audit.',
  },
  {
    risk: 'Perte de données',
    level: 'Probabilité très faible · impact élevé',
    mitigation: 'Sauvegardes horaires et quotidiennes ; code source versionné (GitHub) permettant un redéploiement rapide.',
  },
  {
    risk: 'Usage non autorisé par l\'IA',
    level: 'Probabilité très faible · impact moyen',
    mitigation: 'Minimisation des données transmises, API sans entraînement sur les données, validation humaine de chaque proposition, garde-fous serveur.',
  },
];

export const EfvpSection = (): JSX.Element => (
  <div className="mt-12" data-testid="security-efvp-section">
    <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-4">
      <div className="flex items-center gap-3 flex-1">
        <span className="w-10 h-10 rounded-xl bg-emerald-700 text-white flex items-center justify-center shrink-0">
          <FileCheck2 className="w-5 h-5" />
        </span>
        <div>
          <h2 className="font-heading text-xl font-bold text-slate-900">Évaluation des facteurs relatifs à la vie privée (ÉFVP)</h2>
          <p className="text-xs text-slate-500">Réalisée en vertu de l'article 17 de la Loi 25 — 20 août 2026</p>
        </div>
      </div>
      <a
        data-testid="efvp-pdf-download"
        href="/efvp-arriere-plan.pdf"
        download
        className="shrink-0 inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-emerald-700 text-white font-semibold text-sm hover:bg-emerald-600 transition-colors"
      >
        <FileDown className="w-4 h-4" /> Télécharger l'ÉFVP (PDF)
      </a>
    </div>

    <div className="rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-6 py-4 bg-slate-50 border-b border-slate-100">
        <p className="text-sm font-bold text-slate-800">1. Identification du projet</p>
      </div>
      <div className="divide-y divide-slate-100">
        {IDENTIFICATION.map((r) => (
          <div key={r.k} className="grid grid-cols-1 sm:grid-cols-[220px,1fr] gap-1 sm:gap-4 px-6 py-3">
            <p className="text-xs font-bold text-emerald-800">{r.k}</p>
            <p className="text-xs text-slate-600 leading-relaxed">{r.v}</p>
          </div>
        ))}
      </div>
    </div>

    <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="rounded-2xl border border-slate-200 p-6">
        <p className="text-sm font-bold text-slate-800 mb-3">2. Renseignements personnels visés</p>
        <ul className="space-y-2">
          {DATA_SCOPE.map((d, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-slate-600 leading-relaxed">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
              {d}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-500 italic">
          Ne sont PAS traités par la plateforme : numéros d'assurance sociale, renseignements bancaires des employés, dossiers médicaux.
        </p>
      </div>
      <div className="rounded-2xl border border-slate-200 p-6">
        <p className="text-sm font-bold text-slate-800 mb-3">3. Analyse des risques et atténuation</p>
        <div className="space-y-3">
          {RISKS.map((r) => (
            <div key={r.risk} className="rounded-xl bg-slate-50 border border-slate-100 p-3">
              <p className="text-xs font-bold text-slate-800 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" /> {r.risk}
              </p>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mt-1">{r.level}</p>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">{r.mitigation}</p>
            </div>
          ))}
        </div>
      </div>
    </div>

    <div className="mt-4 rounded-2xl bg-emerald-50 border-l-4 border-emerald-600 p-6">
      <p className="text-sm font-bold text-emerald-900 mb-1">4. Conclusion de l'évaluation</p>
      <p className="text-sm text-emerald-900/80 leading-relaxed italic">
        Compte tenu de la nature des renseignements visés, des mesures de protection techniques et organisationnelles
        en place (chiffrement, authentification forte, isolation réseau vérifiée par tests, journal d'audit, sauvegardes)
        et de la transparence assurée auprès des personnes concernées, les renseignements personnels communiqués à
        l'extérieur du Québec bénéficient d'une <strong>protection adéquate au sens de l'article 17 de la Loi 25</strong>.
        La communication est donc autorisée. Cette évaluation sera revue lors de tout changement d'infrastructure ou
        au plus tard 12 mois après sa signature.
      </p>
    </div>
  </div>
);
