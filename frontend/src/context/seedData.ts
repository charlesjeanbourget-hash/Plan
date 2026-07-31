import { HRState } from '@/types';

const d = (offset: number): string => {
  const dt = new Date();
  dt.setDate(dt.getDate() + offset);
  return dt.toISOString().slice(0, 10);
};

export const SEED_STATE: HRState = {
  branches: [
    { id: 'br1', pharmacyId: 'ph1', name: 'Succursale Centre-Ville', address: '1200 rue Sainte-Catherine, Montréal' },
    { id: 'br2', pharmacyId: 'ph1', name: 'Succursale Plateau', address: '88 av. du Parc, Montréal' },
  ],
  resources: [
    { id: 'res1', type: 'lieu', name: 'Succursale Centre-Ville', address: '1200 rue Sainte-Catherine, Montréal' },
    { id: 'res2', type: 'lieu', name: 'Succursale Plateau', address: '88 av. du Parc, Montréal' },
    { id: 'res3', type: 'equipement', name: 'Véhicule de livraison #1', description: 'Toyota Corolla — plaque FLW 204' },
    { id: 'res4', type: 'equipement', name: 'Tablette borne de punch', description: 'iPad du comptoir laboratoire' },
  ],
  shiftSwaps: [
    { id: 'sw1', shiftId: 's5', requesterId: 'e2', targetEmployeeId: 'e3', reason: 'Rendez-vous personnel impossible à déplacer', status: 'En attente' },
  ],
  employees: [
    {
      id: 'e1', firstName: 'Sophie', lastName: 'Lavoie', email: 'admin@luminahr.ca', phone: '514-555-0101',
      position: 'Pharmacien(ne)', branchId: 'br1', status: 'Actif', hireDate: '2019-03-11', hourlyRate: 62, weeklyHours: 40,
      address: '1200 rue Sainte-Catherine, Montréal', emergencyContact: 'Marc Lavoie — 514-555-0199', avatarColor: 'bg-emerald-600',
    },
    {
      id: 'e2', firstName: 'Julie', lastName: 'Gagnon', email: 'julie@luminahr.ca', phone: '514-555-0102',
      position: 'ATP', branchId: 'br1', status: 'Actif', hireDate: '2021-09-07', hourlyRate: 26.5, weeklyHours: 35,
      address: '88 av. du Parc, Montréal', emergencyContact: 'Lise Gagnon — 514-555-0188', avatarColor: 'bg-orange-500',
    },
    {
      id: 'e3', firstName: 'Karim', lastName: 'Benali', email: 'karim@luminahr.ca', phone: '514-555-0103',
      position: 'ATP', branchId: 'br2', status: 'Actif', hireDate: d(-21), hourlyRate: 24, weeklyHours: 30,
      address: '45 rue Ontario, Montréal', emergencyContact: 'Nadia Benali — 514-555-0177', avatarColor: 'bg-sky-600',
    },
  ],
  shifts: [
    { id: 's1', employeeId: 'e1', date: d(0), startTime: '08:00', endTime: '16:00' },
    { id: 's2', employeeId: 'e2', date: d(0), startTime: '09:00', endTime: '17:00' },
    { id: 's3', employeeId: 'e3', date: d(1), startTime: '12:00', endTime: '20:00' },
    { id: 's4', employeeId: 'e1', date: d(2), startTime: '08:00', endTime: '16:00' },
    { id: 's5', employeeId: 'e2', date: d(3), startTime: '09:00', endTime: '17:00', notes: 'Inventaire mensuel' },
  ],
  tasks: [
    { id: 't1', title: 'Vérifier les commandes de la semaine', assignedTo: 'e2', dueDate: d(1), status: 'En cours', priority: 'Haute' },
    { id: 't2', title: 'Former Karim sur le système de caisse', assignedTo: 'e1', dueDate: d(3), status: 'À faire', priority: 'Moyenne' },
    { id: 't3', title: 'Mettre à jour les fiches de sécurité', assignedTo: 'e3', dueDate: d(-1), status: 'Terminée', priority: 'Basse' },
  ],
  jobOffers: [
    {
      id: 'j1', title: 'Pharmacien(ne) remplaçant(e) — fins de semaine', position: 'Pharmacien(ne)', type: 'Temps partiel',
      location: 'Montréal, QC', salaryRange: '58 $ – 68 $ / h',
      description: "Nous recherchons un(e) pharmacien(ne) pour assurer les quarts de fin de semaine dans notre pharmacie communautaire achalandée du centre-ville.",
      requirements: ['Membre de l\'OPQ en règle', '2 ans d\'expérience en pharmacie communautaire', 'Maîtrise du français'],
      postedDate: d(-9), active: true,
    },
    {
      id: 'j2', title: 'Assistant(e) technique en pharmacie (ATP)', position: 'ATP', type: 'Temps plein',
      location: 'Montréal, QC', salaryRange: '23 $ – 28 $ / h',
      description: "Poste permanent de jour au laboratoire. Préparation des ordonnances, service à la clientèle et gestion de l'inventaire.",
      requirements: ['DEP en assistance technique en pharmacie', 'Expérience avec un logiciel de pharmacie (atout)', 'Rigueur et esprit d\'équipe'],
      postedDate: d(-4), active: true,
    },
    {
      id: 'j3', title: 'Livreur(se) — soirs', position: 'Livreur(se)', type: 'Temps partiel',
      location: 'Montréal, QC', salaryRange: '17 $ – 19 $ / h',
      description: 'Livraison des ordonnances aux patients du quartier, du lundi au vendredi en soirée.',
      requirements: ['Permis de conduire valide', 'Dossier de conduite impeccable'],
      postedDate: d(-30), active: false,
    },
  ],
  candidates: [
    { id: 'c1', jobOfferId: 'j2', name: 'Amélie Roy', email: 'amelie.roy@mail.com', phone: '438-555-0110', status: 'Entrevue', appliedDate: d(-3), notes: 'Très bon dossier, 4 ans d\'expérience.', source: 'Portail Carrières' },
    { id: 'c2', jobOfferId: 'j1', name: 'David Nguyen', email: 'd.nguyen@mail.com', phone: '514-555-0111', status: 'Nouvelle', appliedDate: d(-1), notes: '', source: 'Portail Carrières' },
    { id: 'c3', jobOfferId: 'j2', name: 'Fatima El Amrani', email: 'f.elamrani@mail.com', phone: '438-555-0112', status: 'Présélection', appliedDate: d(-2), notes: 'Disponible immédiatement.', source: 'Agence' },
  ],
  leaveRequests: [
    { id: 'l1', employeeId: 'e2', type: 'Vacances', startDate: d(14), endDate: d(21), reason: 'Vacances familiales annuelles', status: 'En attente' },
    { id: 'l2', employeeId: 'e3', type: 'Personnel', startDate: d(5), endDate: d(5), reason: 'Rendez-vous médical', status: 'Approuvée' },
  ],
  replacementRequests: [
    { id: 'r1', date: d(6), startTime: '09:00', endTime: '17:00', position: 'Pharmacien(ne)', reason: 'Congé approuvé de la pharmacienne titulaire', status: 'Ouverte' },
    { id: 'r2', date: d(2), startTime: '12:00', endTime: '20:00', position: 'ATP', reason: 'Absence maladie', status: 'Proposée', agencyProposal: 'Agence PharmaStaff — candidat disponible, 32 $/h' },
  ],
  payrollEntries: [
    { id: 'p1', employeeId: 'e1', period: 'Période 13 — 15 au 28 juin 2026', periodStart: '2026-06-15', periodEnd: '2026-06-28', hoursWorked: 80, overtimeHours: 2, grossPay: 5146, deductions: 1698.18, netPay: 3447.82, status: 'Validée' },
    { id: 'p2', employeeId: 'e2', period: 'Période 13 — 15 au 28 juin 2026', periodStart: '2026-06-15', periodEnd: '2026-06-28', hoursWorked: 70, overtimeHours: 0, grossPay: 1855, deductions: 556.5, netPay: 1298.5, status: 'En préparation' },
    { id: 'p3', employeeId: 'e3', period: 'Période 13 — 15 au 28 juin 2026', periodStart: '2026-06-15', periodEnd: '2026-06-28', hoursWorked: 60, overtimeHours: 0, grossPay: 1440, deductions: 403.2, netPay: 1036.8, status: 'En préparation' },
    { id: 'p4', employeeId: 'e1', period: 'Période 12 — 1er au 14 juin 2026', periodStart: '2026-06-01', periodEnd: '2026-06-14', hoursWorked: 80, overtimeHours: 0, grossPay: 4960, deductions: 1636.8, netPay: 3323.2, status: 'Payée' },
    { id: 'p5', employeeId: 'e2', period: 'Période 12 — 1er au 14 juin 2026', periodStart: '2026-06-01', periodEnd: '2026-06-14', hoursWorked: 72, overtimeHours: 2, grossPay: 1934.5, deductions: 580.35, netPay: 1354.15, status: 'Payée' },
    { id: 'p6', employeeId: 'e3', period: 'Période 12 — 1er au 14 juin 2026', periodStart: '2026-06-01', periodEnd: '2026-06-14', hoursWorked: 58, overtimeHours: 0, grossPay: 1392, deductions: 389.76, netPay: 1002.24, status: 'Payée' },
    { id: 'p7', employeeId: 'e1', period: 'Période 11 — 18 au 31 mai 2026', periodStart: '2026-05-18', periodEnd: '2026-05-31', hoursWorked: 78, overtimeHours: 0, grossPay: 4836, deductions: 1595.88, netPay: 3240.12, status: 'Payée' },
    { id: 'p8', employeeId: 'e2', period: 'Période 11 — 18 au 31 mai 2026', periodStart: '2026-05-18', periodEnd: '2026-05-31', hoursWorked: 70, overtimeHours: 0, grossPay: 1855, deductions: 556.5, netPay: 1298.5, status: 'Payée' },
  ],
  performanceReviews: [
    { id: 'pr1', employeeId: 'e2', date: d(-40), reviewer: 'Dr. Sophie Lavoie', score: 4.5, strengths: 'Excellente relation client, rigueur au laboratoire.', improvements: 'Déléguer davantage lors des périodes de pointe.', goals: 'Obtenir la certification en préparations stériles.' },
    { id: 'pr2', employeeId: 'e3', date: d(-7), reviewer: 'Dr. Sophie Lavoie', score: 3.8, strengths: 'Apprentissage rapide, très ponctuel.', improvements: 'Approfondir la connaissance des génériques.', goals: 'Autonomie complète au laboratoire d\'ici 3 mois.' },
  ],
  onboardingItems: [
    { id: 'o1', employeeId: 'e3', label: 'Contrat de travail signé', done: true, category: 'Documents' },
    { id: 'o2', employeeId: 'e3', label: 'Spécimen de chèque et fiche fiscale', done: true, category: 'Documents' },
    { id: 'o3', employeeId: 'e3', label: 'Formation logiciel de pharmacie', done: true, category: 'Formation' },
    { id: 'o4', employeeId: 'e3', label: 'Formation confidentialité et Loi 25', done: false, category: 'Formation' },
    { id: 'o5', employeeId: 'e3', label: 'Remise de l\'uniforme et du badge', done: true, category: 'Équipement' },
    { id: 'o6', employeeId: 'e3', label: 'Accès au système de caisse', done: false, category: 'Équipement' },
    { id: 'o7', employeeId: 'e3', label: 'Rencontre avec l\'équipe du laboratoire', done: false, category: 'Intégration' },
    { id: 'o8', employeeId: 'e2', label: 'Formation d\'intégration Proxim (examen Arrière Plan)', done: false, category: 'Formation' },
  ],
  contracts: [
    { id: 'ct1', employeeId: 'e1', type: 'Temps plein', startDate: '2019-03-11', signed: true, salary: '62 $ / h' },
    { id: 'ct2', employeeId: 'e2', type: 'Temps plein', startDate: '2021-09-07', signed: true, salary: '26,50 $ / h' },
    { id: 'ct3', employeeId: 'e3', type: 'Temps partiel', startDate: d(-21), endDate: d(160), signed: false, salary: '24 $ / h' },
  ],
  benefits: [
    { id: 'b1', name: 'Assurance collective santé', provider: 'Desjardins Assurances', description: 'Couverture médicaments, dentaire et vision. Prime partagée 50/50.', monthlyCost: 145, enrolledEmployeeIds: ['e1', 'e2'] },
    { id: 'b2', name: 'REER collectif', provider: 'Fonds FTQ', description: 'Cotisation de l\'employeur jusqu\'à 3 % du salaire.', monthlyCost: 0, enrolledEmployeeIds: ['e1'] },
    { id: 'b3', name: 'Programme d\'aide aux employés (PAE)', provider: 'Telus Santé', description: 'Soutien psychologique, juridique et financier confidentiel 24/7.', monthlyCost: 12, enrolledEmployeeIds: ['e1', 'e2', 'e3'] },
  ],
  faqItems: [
    { id: 'f1', question: 'Comment demander des vacances ?', answer: 'Rendez-vous dans le module Vacances et cliquez sur « Nouvelle demande ». Votre gestionnaire recevra la demande et vous serez notifié de la décision.', category: 'Congés' },
    { id: 'f2', question: 'Quand la paie est-elle déposée ?', answer: 'La paie est déposée toutes les deux semaines, le jeudi. Le relevé est disponible dans le module Paie.', category: 'Paie' },
    { id: 'f3', question: 'Comment échanger un quart de travail ?', answer: 'Contactez votre gestionnaire ou utilisez le module Remplacements pour publier votre quart. Tout échange doit être approuvé.', category: 'Horaires' },
    { id: 'f4', question: 'Qui contacter en cas d\'accident de travail ?', answer: 'Avisez immédiatement le pharmacien en service, puis remplissez le formulaire CNESST disponible auprès de votre gestionnaire.', category: 'Santé et sécurité' },
  ],
  pharmacies: [
    { id: 'ph1', name: 'Pharmacie Lavoie & Associés', address: '1200 rue Sainte-Catherine', city: 'Montréal', ownerName: 'Dr. Sophie Lavoie', adminEmail: 'admin@luminahr.ca', employeeCount: 3, plan: 'Pro', active: true },
    { id: 'ph2', name: 'Pharmacie du Vieux-Port', address: '45 rue de la Commune', city: 'Montréal', ownerName: 'Dr. Jean Fortin', adminEmail: 'jean.fortin@pharmavp.ca', employeeCount: 12, plan: 'Entreprise', active: true },
    { id: 'ph3', name: 'Pharmacie Beaulieu', address: '780 boul. Laurier', city: 'Québec', ownerName: 'Dr. Anne Beaulieu', adminEmail: 'anne.beaulieu@pharmab.ca', employeeCount: 6, plan: 'Essentiel', active: false },
  ],
};
