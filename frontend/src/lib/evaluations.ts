import { EvaluationStatus } from '@/types';

export const EMPLOYER_QUESTIONS: { id: string; label: string }[] = [
  { id: 'q1', label: 'Qualité et précision du travail (ordonnances, comptage, vérifications)' },
  { id: 'q2', label: 'Productivité et gestion des priorités en période d\'achalandage' },
  { id: 'q3', label: 'Ponctualité et assiduité (punchs, respect de l\'horaire)' },
  { id: 'q4', label: 'Service à la clientèle et courtoisie envers les patients' },
  { id: 'q5', label: 'Travail d\'équipe et collaboration avec les collègues' },
  { id: 'q6', label: 'Respect des procédures et de la conformité (Loi 25, registres, narcotiques)' },
  { id: 'q7', label: 'Autonomie et sens de l\'initiative' },
  { id: 'q8', label: 'Adaptabilité face aux imprévus et aux changements' },
  { id: 'q9', label: 'Communication avec l\'équipe et les patients' },
  { id: 'q10', label: 'Leadership et encadrement des nouveaux employés' },
];

export const SELF_QUESTIONS: { id: string; label: string }[] = [
  { id: 's1', label: 'Je maîtrise les tâches et responsabilités de mon poste' },
  { id: 's2', label: 'Je gère bien mon temps et mes priorités' },
  { id: 's3', label: 'Je contribue positivement à l\'esprit d\'équipe' },
  { id: 's4', label: 'Je respecte les procédures et la réglementation de la pharmacie' },
  { id: 's5', label: 'Je communique efficacement avec l\'équipe et les patients' },
  { id: 's6', label: 'Je prends des initiatives pour améliorer le travail' },
  { id: 's7', label: 'Je suis satisfait(e) de mon travail et de mon environnement' },
  { id: 's8', label: 'Je souhaite assumer de nouvelles responsabilités' },
];

export const EVAL_STATUS_META: Record<EvaluationStatus, { label: string; cls: string }> = {
  en_cours: { label: 'Évaluations en cours', cls: 'bg-sky-100 text-sky-800' },
  a_proposer: { label: 'Salaire à proposer', cls: 'bg-amber-100 text-amber-800' },
  propose: { label: 'En attente de l\'employé', cls: 'bg-amber-100 text-amber-800' },
  accepte: { label: 'Salaire accepté', cls: 'bg-emerald-100 text-emerald-800' },
  refuse: { label: 'Refusé — à re-proposer', cls: 'bg-red-100 text-red-800' },
  applique: { label: 'Appliqué au dossier', cls: 'bg-slate-200 text-slate-700' },
};

export const RATING_LABELS = ['Insuffisant', 'À améliorer', 'Satisfaisant', 'Très bon', 'Exceptionnel'];
