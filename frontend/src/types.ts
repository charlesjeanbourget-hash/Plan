export type Role = 'superadmin' | 'admin' | 'employee';

export type View = 'landing' | 'login' | 'careers' | 'agency' | 'dashboard';

export type ModuleKey =
  | 'dashboard'
  | 'employees'
  | 'scheduling'
  | 'recruitment'
  | 'payroll'
  | 'replacements'
  | 'vacations'
  | 'performance'
  | 'onboarding'
  | 'contracts'
  | 'benefits'
  | 'faq'
  | 'superadmin';

export interface User {
  id: string;
  name: string;
  email: string;
  password: string;
  role: Role;
  employeeId?: string;
}

export type Position =
  | 'Pharmacien(ne)'
  | 'ATP'
  | 'Technicien(ne) de laboratoire'
  | 'Commis'
  | 'Livreur(se)';

export const POSITIONS: Position[] = [
  'Pharmacien(ne)',
  'ATP',
  'Technicien(ne) de laboratoire',
  'Commis',
  'Livreur(se)',
];

export type EmployeeStatus = 'Actif' | 'En congé' | 'Inactif';

export interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  position: Position;
  status: EmployeeStatus;
  hireDate: string;
  hourlyRate: number;
  weeklyHours: number;
  address: string;
  emergencyContact: string;
  avatarColor: string;
}

export interface Shift {
  id: string;
  employeeId: string;
  date: string;
  startTime: string;
  endTime: string;
  notes?: string;
}

export type TaskStatus = 'À faire' | 'En cours' | 'Terminée';
export type TaskPriority = 'Basse' | 'Moyenne' | 'Haute';

export interface Task {
  id: string;
  title: string;
  assignedTo: string;
  dueDate: string;
  status: TaskStatus;
  priority: TaskPriority;
}

export type ContractType = 'Temps plein' | 'Temps partiel' | 'Contractuel';

export interface JobOffer {
  id: string;
  title: string;
  position: Position;
  type: ContractType;
  location: string;
  salaryRange: string;
  description: string;
  requirements: string[];
  postedDate: string;
  active: boolean;
}

export type CandidateStatus =
  | 'Nouvelle'
  | 'Présélection'
  | 'Entrevue'
  | 'Offre'
  | 'Embauché(e)'
  | 'Refusé(e)';

export const CANDIDATE_STATUSES: CandidateStatus[] = [
  'Nouvelle',
  'Présélection',
  'Entrevue',
  'Offre',
  'Embauché(e)',
  'Refusé(e)',
];

export interface Candidate {
  id: string;
  jobOfferId: string;
  name: string;
  email: string;
  phone: string;
  status: CandidateStatus;
  appliedDate: string;
  notes: string;
  source: 'Portail Carrières' | 'Agence' | 'Interne';
}

export type LeaveType = 'Vacances' | 'Maladie' | 'Personnel' | 'Formation';
export type RequestStatus = 'En attente' | 'Approuvée' | 'Refusée';

export interface LeaveRequest {
  id: string;
  employeeId: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  reason: string;
  status: RequestStatus;
}

export type ReplacementStatus = 'Ouverte' | 'Proposée' | 'Comblée' | 'Annulée';

export interface ReplacementRequest {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  position: Position;
  reason: string;
  status: ReplacementStatus;
  agencyProposal?: string;
}

export type PayrollStatus = 'En préparation' | 'Validée' | 'Payée';

export interface PayrollEntry {
  id: string;
  employeeId: string;
  period: string;
  hoursWorked: number;
  overtimeHours: number;
  grossPay: number;
  deductions: number;
  netPay: number;
  status: PayrollStatus;
}

export interface PerformanceReview {
  id: string;
  employeeId: string;
  date: string;
  reviewer: string;
  score: number;
  strengths: string;
  improvements: string;
  goals: string;
}

export type OnboardingCategory = 'Documents' | 'Formation' | 'Équipement' | 'Intégration';

export interface OnboardingItem {
  id: string;
  employeeId: string;
  label: string;
  done: boolean;
  category: OnboardingCategory;
}

export interface Contract {
  id: string;
  employeeId: string;
  type: ContractType;
  startDate: string;
  endDate?: string;
  signed: boolean;
  salary: string;
}

export interface Benefit {
  id: string;
  name: string;
  provider: string;
  description: string;
  monthlyCost: number;
  enrolledEmployeeIds: string[];
}

export interface FAQItem {
  id: string;
  question: string;
  answer: string;
  category: string;
}

export type PharmacyPlan = 'Essentiel' | 'Pro' | 'Entreprise';

export interface Pharmacy {
  id: string;
  name: string;
  address: string;
  city: string;
  ownerName: string;
  employeeCount: number;
  plan: PharmacyPlan;
  active: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface HRState {
  employees: Employee[];
  shifts: Shift[];
  tasks: Task[];
  jobOffers: JobOffer[];
  candidates: Candidate[];
  leaveRequests: LeaveRequest[];
  replacementRequests: ReplacementRequest[];
  payrollEntries: PayrollEntry[];
  performanceReviews: PerformanceReview[];
  onboardingItems: OnboardingItem[];
  contracts: Contract[];
  benefits: Benefit[];
  faqItems: FAQItem[];
  pharmacies: Pharmacy[];
}
