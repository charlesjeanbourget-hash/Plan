import { WeekDayKey } from '@/types';

export const PHARMACY_ROLES: string[] = [
  'Pharmacien(ne) propriétaire',
  'Pharmacien(ne) salarié(e)',
  'Pharmacien(ne) remplaçant(e)',
  'Pharmacien(ne) adjoint(e) / chef',
  'Étudiant(e) en pharmacie',
  'Stagiaire en pharmacie',
  'Assistant(e) technique en pharmacie (ATP)',
  'Technicien(ne) de laboratoire',
  'Superviseur(e) de laboratoire',
  'Commis de laboratoire',
  'Commis de plancher',
  'Commis sénior / gérant(e) de plancher',
  'Caissier(ère)',
  'Cosméticienne / conseiller(ère) beauté',
  'Responsable de la facturation (tiers payeurs)',
  'Préposé(e) aux piluliers (Dispill)',
  'Infirmier(ère) / injecteur(trice)-vaccinateur(trice)',
  'Responsable des commandes et de l\'inventaire',
  'Réceptionniste / secrétaire',
  'Livreur(se)',
  'Préposé(e) à l\'entretien',
  'Gestionnaire / directeur(trice) de succursale',
];

export const PHARMACY_TASKS: string[] = [
  'Ouverture de la pharmacie',
  'Fermeture de la pharmacie',
  'Saisie des ordonnances',
  'Comptage des pilules',
  'Préparation des piluliers (Dispill)',
  'Vérification contenant-contenu',
  'Préparations magistrales',
  'Gestion des narcotiques et substances contrôlées',
  'Vaccination / injections',
  'Conseils aux patients (pharmacien)',
  'Prise de rendez-vous cliniques',
  'Service au comptoir des ordonnances',
  'Gestion de la caisse',
  'Réception et gestion des appels téléphoniques',
  'Facturation et tiers payeurs (assurances)',
  'Commandes et gestion de l\'inventaire',
  'Réception de marchandise',
  'Étiquetage et mise en tablette',
  'Rotation des stocks et dates de péremption',
  'Planogrammes et mise en marché',
  'Conseils dermocosmétiques',
  'Livraison des ordonnances',
  'Gestion des retours et des périmés',
  'Nettoyage et désinfection du laboratoire',
  'Entretien de l\'aire de vente',
  'Formation des nouveaux employés',
  'Suivi de la conformité (Loi 25, registres)',
  'Gestion des réseaux sociaux et promotions',
];

export const PHARMACY_RESTRICTIONS: string[] = [
  'Aucun soir',
  'Aucune fin de semaine',
  'Aucune ouverture (tôt le matin)',
  'Aucune fermeture (tard le soir)',
  'Station debout prolongée limitée',
  'Ne peut soulever de charges lourdes',
  'Étudiant(e) — horaire scolaire à respecter',
  'Conciliation famille (heures de garderie)',
  'Transport en commun seulement',
  'Maximum un quart par jour',
];

export const DAY_KEYS: WeekDayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export const DAY_NAMES: Record<WeekDayKey, string> = {
  mon: 'Lundi',
  tue: 'Mardi',
  wed: 'Mercredi',
  thu: 'Jeudi',
  fri: 'Vendredi',
  sat: 'Samedi',
  sun: 'Dimanche',
};

export const fmtTime = (isoStr: string): string =>
  new Date(isoStr).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
