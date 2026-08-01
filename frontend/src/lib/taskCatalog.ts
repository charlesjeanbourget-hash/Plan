export interface CatalogTask {
  title: string;
  description: string;
  competences: string[];
}

export interface CatalogSection {
  key: string;
  label: string;
  tasks: CatalogTask[];
}

export interface CatalogDomain {
  key: 'commerce' | 'labo';
  label: string;
  sections: CatalogSection[];
}

export const TASK_CATALOG: CatalogDomain[] = [
  {
    key: 'commerce',
    label: 'Commerce (avant-boutique)',
    sections: [
      {
        key: 'caisse',
        label: 'Ouverture & caisse',
        tasks: [
          { title: 'Ouvrir les caisses et compter les fonds de caisse', description: 'Fonds standard selon la procédure', competences: ['Gestion de la caisse', 'Ouverture de la pharmacie'] },
          { title: 'Balancer les caisses et préparer le dépôt bancaire', description: 'Fin de quart', competences: ['Gestion de la caisse', 'Fermeture de la pharmacie'] },
          { title: 'Vérifier les terminaux de paiement et remplacer les rouleaux', description: '', competences: ['Gestion de la caisse'] },
          { title: 'Traiter les retours et remboursements au comptoir', description: 'Selon la politique de retours', competences: ['Gestion de la caisse'] },
          { title: 'Vendre et valider les billets de loterie', description: 'Registre Loto-Québec', competences: ['Gestion de la loterie', 'Gestion de la caisse'] },
          { title: 'Gérer le programme de fidélité et les cartes-cadeaux', description: '', competences: ['Gestion de la caisse', 'Service à la clientèle'] },
        ],
      },
      {
        key: 'service-client',
        label: 'Service à la clientèle',
        tasks: [
          { title: 'Accueillir et orienter les clients en magasin', description: '', competences: ['Service à la clientèle'] },
          { title: 'Répondre au téléphone et acheminer les appels', description: '', competences: ['Réception et gestion des appels téléphoniques'] },
          { title: 'Traiter les commandes spéciales des clients', description: 'Produits non tenus en inventaire', competences: ['Service à la clientèle', 'Commandes et gestion de l\'inventaire'] },
          { title: 'Diriger les questions de médicaments en vente libre vers le pharmacien', description: 'MVL / annexe II-III', competences: ['Service à la clientèle'] },
        ],
      },
      {
        key: 'marchandisage',
        label: 'Marchandisage & mise en marché',
        tasks: [
          { title: 'Faire le facing des tablettes (façade des produits)', description: '', competences: ['Planogrammes et mise en marché', 'Étiquetage et mise en tablette'] },
          { title: 'Monter les présentoirs de la circulaire de la semaine', description: '', competences: ['Planogrammes et mise en marché'] },
          { title: 'Changer les étiquettes de prix et affichettes promo', description: '', competences: ['Étiquetage et mise en tablette'] },
          { title: 'Vérifier l\'exactitude des prix scannés', description: 'Politique d\'exactitude des prix', competences: ['Étiquetage et mise en tablette', 'Gestion de la caisse'] },
          { title: 'Mettre en place le planogramme saisonnier', description: '', competences: ['Planogrammes et mise en marché'] },
          { title: 'Mettre à jour l\'affichage et la vitrine promotionnelle', description: '', competences: ['Planogrammes et mise en marché', 'Gestion des réseaux sociaux et promotions'] },
          { title: 'Publier les promotions de la semaine sur les réseaux sociaux', description: '', competences: ['Gestion des réseaux sociaux et promotions'] },
        ],
      },
      {
        key: 'reception-commerce',
        label: 'Réception & inventaire (commerce)',
        tasks: [
          { title: 'Recevoir la commande avant-boutique et vérifier les factures', description: '', competences: ['Réception de marchandise'] },
          { title: 'Placer la marchandise et faire la rotation des tablettes', description: 'Premier entré, premier sorti', competences: ['Étiquetage et mise en tablette', 'Rotation des stocks et dates de péremption'] },
          { title: 'Vérifier les dates de péremption de la section du jour', description: 'Rotation des stocks', competences: ['Rotation des stocks et dates de péremption'] },
          { title: 'Faire le décompte cyclique d\'inventaire', description: '', competences: ['Commandes et gestion de l\'inventaire'] },
          { title: 'Préparer les retours fournisseurs et produits endommagés', description: '', competences: ['Gestion des retours et des périmés'] },
          { title: 'Passer la commande hebdomadaire avant-boutique', description: '', competences: ['Commandes et gestion de l\'inventaire'] },
          { title: 'Signaler les ruptures de stock au gestionnaire', description: '', competences: ['Commandes et gestion de l\'inventaire'] },
        ],
      },
      {
        key: 'cosmetiques',
        label: 'Cosmétiques',
        tasks: [
          { title: 'Conseiller la clientèle en dermocosmétique', description: '', competences: ['Conseils dermocosmétiques'] },
          { title: 'Nettoyer et réapprovisionner les testeurs', description: '', competences: ['Conseils dermocosmétiques', 'Entretien de l\'aire de vente'] },
          { title: 'Faire l\'inventaire du comptoir cosmétique', description: '', competences: ['Conseils dermocosmétiques', 'Commandes et gestion de l\'inventaire'] },
        ],
      },
      {
        key: 'entretien-commerce',
        label: 'Entretien & sécurité (commerce)',
        tasks: [
          { title: 'Balayer et laver les allées', description: '', competences: ['Entretien de l\'aire de vente'] },
          { title: 'Nettoyer les vitres d\'entrée et les comptoirs', description: '', competences: ['Entretien de l\'aire de vente'] },
          { title: 'Désinfecter les paniers et surfaces de contact', description: '', competences: ['Entretien de l\'aire de vente'] },
          { title: 'Sortir les poubelles et le recyclage', description: '', competences: ['Entretien de l\'aire de vente'] },
          { title: 'Vérifier que les allées et sorties d\'urgence sont dégagées', description: 'Sécurité', competences: ['Entretien de l\'aire de vente'] },
        ],
      },
    ],
  },
  {
    key: 'labo',
    label: 'Laboratoire',
    sections: [
      {
        key: 'ouverture-labo',
        label: 'Ouverture du laboratoire',
        tasks: [
          { title: 'Vérifier et consigner les températures des réfrigérateurs', description: 'Registre des frigos (vaccins, insuline)', competences: ['Ouverture de la pharmacie', 'Suivi de la conformité (Loi 25, registres)'] },
          { title: 'Écouter la boîte vocale et traiter les renouvellements', description: '', competences: ['Réception et gestion des appels téléphoniques', 'Saisie des ordonnances'] },
          { title: 'Traiter les télécopies et ordonnances électroniques reçues', description: '', competences: ['Saisie des ordonnances'] },
          { title: 'Vérifier les ordonnances préparées la veille', description: '', competences: ['Vérification contenant-contenu'] },
          { title: 'Démarrer les équipements et systèmes du laboratoire', description: '', competences: ['Ouverture de la pharmacie'] },
        ],
      },
      {
        key: 'preparation',
        label: 'Préparation des ordonnances',
        tasks: [
          { title: 'Saisir les nouvelles ordonnances au dossier patient', description: '', competences: ['Saisie des ordonnances'] },
          { title: 'Compter les comprimés et préparer les fioles', description: '', competences: ['Comptage des pilules'] },
          { title: 'Étiqueter les fioles et préparations', description: '', competences: ['Comptage des pilules', 'Saisie des ordonnances'] },
          { title: 'Préparer les piluliers hebdomadaires (Dispill)', description: '', competences: ['Préparation des piluliers (Dispill)'] },
          { title: 'Remplir les cassettes de l\'ensacheuse automatisée', description: '', competences: ['Ensacheuse automatisée'] },
          { title: 'Gérer la file d\'attente et prioriser les urgences', description: '', competences: ['Service au comptoir des ordonnances'] },
          { title: 'Servir les patients au comptoir des ordonnances', description: '', competences: ['Service au comptoir des ordonnances'] },
        ],
      },
      {
        key: 'verification',
        label: 'Vérification & actes du pharmacien',
        tasks: [
          { title: 'Valider les ordonnances (vérification contenant-contenu)', description: 'Réservé au pharmacien', competences: ['Vérification contenant-contenu', 'Conseils aux patients (pharmacien)'] },
          { title: 'Conseiller les patients — nouvelles ordonnances', description: '', competences: ['Conseils aux patients (pharmacien)'] },
          { title: 'Analyser les interactions médicamenteuses et allergies', description: '', competences: ['Conseils aux patients (pharmacien)'] },
          { title: 'Contacter les prescripteurs pour clarifications', description: '', competences: ['Conseils aux patients (pharmacien)'] },
          { title: 'Réviser les dossiers pharmacologiques des piluliers', description: '', competences: ['Conseils aux patients (pharmacien)'] },
          { title: 'Prolonger ou ajuster des ordonnances (Loi 31)', description: 'Actes autorisés au pharmacien', competences: ['Conseils aux patients (pharmacien)'] },
        ],
      },
      {
        key: 'narcotiques',
        label: 'Narcotiques & substances contrôlées',
        tasks: [
          { title: 'Faire le décompte des narcotiques et compléter le registre', description: 'Registre obligatoire', competences: ['Gestion des narcotiques et substances contrôlées'] },
          { title: 'Ranger les narcotiques au coffre en fin de journée', description: '', competences: ['Gestion des narcotiques et substances contrôlées', 'Fermeture de la pharmacie'] },
          { title: 'Préparer la destruction des substances contrôlées périmées', description: 'Avec registre de destruction', competences: ['Gestion des narcotiques et substances contrôlées', 'Gestion des retours et des périmés'] },
        ],
      },
      {
        key: 'magistrales',
        label: 'Préparations magistrales',
        tasks: [
          { title: 'Préparer les magistrales (crèmes, sirops, capsules)', description: '', competences: ['Préparations magistrales'] },
          { title: 'Compléter le registre de préparation (traçabilité)', description: '', competences: ['Préparations magistrales', 'Suivi de la conformité (Loi 25, registres)'] },
          { title: 'Nettoyer et désinfecter la zone de préparation', description: '', competences: ['Préparations magistrales', 'Nettoyage et désinfection du laboratoire'] },
          { title: 'Vérifier les dates des matières premières', description: '', competences: ['Préparations magistrales', 'Rotation des stocks et dates de péremption'] },
        ],
      },
      {
        key: 'cliniques',
        label: 'Services cliniques',
        tasks: [
          { title: 'Administrer les vaccins aux rendez-vous du jour', description: '', competences: ['Vaccination / injections'] },
          { title: 'Préparer la salle de consultation et le matériel d\'injection', description: '', competences: ['Vaccination / injections', 'Prise de rendez-vous cliniques'] },
          { title: 'Prendre la tension artérielle et consigner les suivis', description: '', competences: ['Prise de tension artérielle et suivis cliniques'] },
          { title: 'Faire les appels de suivi des nouveaux traitements', description: '', competences: ['Conseils aux patients (pharmacien)', 'Réception et gestion des appels téléphoniques'] },
          { title: 'Gérer l\'horaire des rendez-vous cliniques', description: '', competences: ['Prise de rendez-vous cliniques'] },
        ],
      },
      {
        key: 'administratif',
        label: 'Facturation & administratif',
        tasks: [
          { title: 'Facturer la RAMQ et les assurances privées', description: '', competences: ['Facturation et tiers payeurs (assurances)'] },
          { title: 'Retraiter les réclamations d\'assurance rejetées', description: '', competences: ['Facturation et tiers payeurs (assurances)'] },
          { title: 'Numériser et classer les ordonnances papier', description: '', competences: ['Numérisation et classement des ordonnances'] },
          { title: 'Passer la commande au grossiste avant l\'heure limite', description: '', competences: ['Commandes et gestion de l\'inventaire'] },
          { title: 'Recevoir la commande de médicaments (réfrigérés en priorité)', description: '', competences: ['Réception de marchandise', 'Rotation des stocks et dates de péremption'] },
          { title: 'Traiter les rappels de lots et retirer les produits visés', description: '', competences: ['Gestion des retours et des périmés', 'Suivi de la conformité (Loi 25, registres)'] },
        ],
      },
      {
        key: 'livraisons',
        label: 'Livraisons',
        tasks: [
          { title: 'Préparer les sacs de livraison et les factures', description: '', competences: ['Préparation des livraisons', 'Livraison des ordonnances'] },
          { title: 'Planifier la tournée du livreur', description: '', competences: ['Livraison des ordonnances'] },
          { title: 'Confirmer les livraisons auprès des patients', description: '', competences: ['Livraison des ordonnances', 'Réception et gestion des appels téléphoniques'] },
        ],
      },
      {
        key: 'fermeture-labo',
        label: 'Fermeture du laboratoire',
        tasks: [
          { title: 'Consigner les températures des réfrigérateurs (soir)', description: 'Registre des frigos', competences: ['Fermeture de la pharmacie', 'Suivi de la conformité (Loi 25, registres)'] },
          { title: 'Préparer le travail du lendemain (piluliers, ordonnances à venir)', description: '', competences: ['Préparation des piluliers (Dispill)', 'Fermeture de la pharmacie'] },
          { title: 'Nettoyer les comptoirs et équipements du laboratoire', description: '', competences: ['Nettoyage et désinfection du laboratoire'] },
          { title: 'Balancer le poste du laboratoire et fermer les systèmes', description: '', competences: ['Fermeture de la pharmacie', 'Gestion de la caisse'] },
        ],
      },
    ],
  },
];

export const catalogDomainItems = (domainKey: string): CatalogTask[] => {
  const domain = TASK_CATALOG.find((d) => d.key === domainKey);
  if (!domain) return [];
  return domain.sections.flatMap((s) => s.tasks);
};
