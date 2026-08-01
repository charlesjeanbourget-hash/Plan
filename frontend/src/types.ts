export type Role = 'superadmin' | 'admin' | 'manager' | 'employee';

export type View = 'landing' | 'login' | 'careers' | 'agency' | 'dashboard' | 'punch' | 'privacy';

export type ModuleKey =
  | 'dashboard'
  | 'tasks'
  | 'myspace'
  | 'messages'
  | 'employees'
  | 'licenses'
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
  | 'training'
  | 'deliveries'
  | 'resources'
  | 'superadmin';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  employeeId?: string;
  pharmacyId?: string;
  isTemporaryPassword?: boolean;
  privacyAcceptedAt?: string | null;
}

export type Position =
  | 'Pharmacien(ne)'
  | 'ATP'
  | 'Technicien(ne) de laboratoire'
  | 'Infirmier(ère)'
  | 'Gestionnaire'
  | 'Commis'
  | 'Caissier(ère)'
  | "Commis d'entrepôt"
  | 'Livreur(se)';

export const POSITIONS: Position[] = [
  'Pharmacien(ne)',
  'ATP',
  'Technicien(ne) de laboratoire',
  'Infirmier(ère)',
  'Gestionnaire',
  'Commis',
  'Caissier(ère)',
  "Commis d'entrepôt",
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
  branchId: string;
  status: EmployeeStatus;
  hireDate: string;
  hourlyRate: number;
  weeklyHours: number;
  address: string;
  emergencyContact: string;
  avatarColor: string;
  anonymized?: boolean;
}

export interface Shift {
  id: string;
  employeeId: string;
  date: string;
  startTime: string;
  endTime: string;
  notes?: string;
  resourceIds?: string[];
  aiGenerated?: boolean;
  proposalId?: string;
  department?: string;
}

export type ResourceType = 'lieu' | 'equipement';

export interface Resource {
  id: string;
  type: ResourceType;
  name: string;
  address?: string;
  description?: string;
}

export interface GeoPoint {
  lat: number;
  lng: number;
  accuracy?: number | null;
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
  periodStart: string;
  periodEnd: string;
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
  adminEmail: string;
  employeeCount: number;
  plan: PharmacyPlan;
  active: boolean;
}

export interface Branch {
  id: string;
  pharmacyId: string;
  name: string;
  address: string;
}

export interface ShiftSwapRequest {
  id: string;
  shiftId: string;
  requesterId: string;
  targetEmployeeId: string;
  reason: string;
  status: RequestStatus;
  peerStatus?: RequestStatus;
}

export interface License {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_email: string | null;
  position: string;
  pharmacy_id: string;
  branch_id: string;
  license_number: string;
  expiry_date: string;
  certificate_filename: string | null;
  certificate_content_type: string | null;
  certificate_size: number;
  created_at: string;
  updated_at: string;
}

export interface LicenseReportItem extends License {
  days_remaining: number;
}

export interface AuditLog {
  id: string;
  actor_email: string;
  actor_role: string;
  action: string;
  resource_type: string;
  resource_id: string;
  details: string;
  pharmacy_id: string;
  created_at: string;
}

export interface ReportSettings {
  pharmacy_id: string;
  pharmacy_name: string;
  admin_email: string;
  enabled: boolean;
}

export interface ManagedUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  pharmacy_id: string | null;
  employee_id: string | null;
  is_temporary_password: boolean;
  suspended: boolean;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export type TrainingStatus = 'processing' | 'draft' | 'published' | 'error';

export interface TrainingSection {
  id: string;
  sector: string;
  title: string;
  content: string;
  key_points: string[];
}

export interface ExamQuestion {
  id: string;
  question: string;
  options: string[];
  correct_index?: number;
  explanation?: string;
}

export interface Training {
  id: string;
  pharmacy_id: string;
  title: string;
  status: TrainingStatus;
  category?: string;
  error?: string | null;
  source_filename: string;
  source_size: number;
  sections: TrainingSection[];
  exam: ExamQuestion[];
  passing_score: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  published_at?: string | null;
  my_attempts?: number;
  my_best_score?: number | null;
  my_passed?: boolean;
  my_assignment?: { due_date: string } | null;
}

export interface AttemptQuestionResult {
  question_id: string;
  your_answer: number;
  correct: boolean;
  correct_index: number;
  explanation: string;
}

export interface AttemptResult {
  score: number;
  passed: boolean;
  correct_count: number;
  total: number;
  passing_score: number;
  results: AttemptQuestionResult[];
}

export interface TrainingAttempt {
  id: string;
  training_id: string;
  pharmacy_id: string;
  user_id: string;
  user_email: string;
  user_name: string;
  score: number;
  passed: boolean;
  correct_count: number;
  total: number;
  completed_at: string;
}

export interface TrainingAssignment {
  id: string;
  training_id: string;
  pharmacy_id: string;
  employee_email: string;
  employee_name: string;
  due_date: string;
  assigned_by: string;
  assigned_at: string;
  reminder_sent_for?: string | null;
  passed?: boolean;
  passed_score?: number | null;
  overdue?: boolean;
}

export interface OverviewPharmacy {
  pharmacy_id: string;
  accounts: { total: number; admins: number; employees: number; suspended: number };
  licenses: { total: number; expiring_60: number; expiring_30: number; expired: number };
  trainings: { total: number; published: number };
  report_enabled: boolean;
}

export interface EmailSettings {
  sender_email: string;
  sender_name: string;
  default_sender?: string;
}

export interface AvailabilityDay {
  available: boolean;
  start: string;
  end: string;
}

export type WeekDayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface EmployeeProfile {
  id: string;
  pharmacy_id: string;
  employee_id: string;
  employee_name: string;
  roles: string[];
  capacities: string[];
  restrictions: string[];
  min_hours_week: number;
  max_hours_week: number;
  availability: Record<WeekDayKey, AvailabilityDay>;
  punch_code: string | null;
  punch_code_set?: boolean;
  payroll_number?: string | null;
  notes: string;
  updated_at: string;
  updated_by: string;
}

export interface Punch {
  id: string;
  pharmacy_id: string;
  employee_id: string;
  employee_name: string;
  date: string;
  punch_in: string;
  punch_out: string | null;
  source: 'punch' | 'manual';
  created_by: string;
  note: string;
  punch_in_location?: GeoPoint | null;
  punch_out_location?: GeoPoint | null;
}

export interface OpenPunch extends Punch {
  elapsed_hours: number;
}

export interface ShiftTask {
  id: string;
  pharmacy_id: string;
  date: string;
  shift: string;
  title: string;
  description: string;
  assignee_employee_id: string;
  assignee_name: string;
  recurring?: boolean;
  series_id?: string;
  qualification_warning?: boolean;
  done: boolean;
  done_by: string;
  done_at: string | null;
  created_by: string;
  created_at: string;
}

export interface PunchSummaryRow {
  employee_id: string;
  employee_name: string;
  punched_hours: number;
  manual_hours: number;
  total_hours: number;
  regular_hours: number;
  overtime_hours: number;
  entries: number;
  open_entries: number;
}

export interface PunchStatus {
  open: Punch | null;
  today_hours: number;
  today_entries: Punch[];
}

export interface PunchActionResult {
  action: 'in' | 'out';
  employee_name: string;
  time: string;
  punch_in?: string;
  duration_hours?: number;
}

export interface PaySettings {
  pharmacy_id: string;
  period_type: 'weekly' | 'biweekly';
  anchor: string;
}

export interface ProposalWarning {
  text: string;
  kind: 'absence' | 'profile';
}

export interface ProposalAlert {
  text: string;
  kind: 'task' | 'profile' | 'budget' | 'traffic';
  task_id?: string;
  task_date?: string;
  employee_id?: string;
}

export interface ProposalShift {
  id: string;
  employee_id: string;
  employee_name: string;
  date: string;
  start: string;
  end: string;
  role: string;
  warnings?: (string | ProposalWarning)[];
}

export interface ApprovalSlot {
  status: 'pending' | 'approved' | 'rejected';
  responded_at: string | null;
  comment: string;
}

export type ProposalStatus = 'generating' | 'error' | 'pending' | 'attention' | 'approved' | 'rejected' | 'applied';

export interface ScheduleProposal {
  id: string;
  pharmacy_id: string;
  week_start: string;
  status: string;
  effective_status: ProposalStatus;
  error?: string | null;
  summary: string;
  instructions: string;
  shifts: ProposalShift[];
  alerts?: (string | ProposalAlert)[];
  warnings_count?: number;
  estimated_cost?: number | null;
  weekly_budget?: number | null;
  department?: string;
  existing_mode?: string;
  employee_approvals: Record<string, ApprovalSlot>;
  admin_status: 'pending' | 'approved' | 'rejected';
  approval_deadline: string;
  approval_deadline_hours: number;
  deadline_passed: boolean;
  applied_at: string | null;
  created_by: string;
  created_at: string;
}

export interface PunchPreview {
  employee_name: string;
  next_action: 'in' | 'out';
  since: string | null;
}

export interface EvalSuggestion {
  performance_score: number;
  multiplier: number;
  suggested_increase_pct: number;
  suggested_rate: number;
}

export interface AdminEval {
  answers: Record<string, number>;
  score: number;
  strengths: string;
  improvements: string;
  objectives: string;
  completed_at: string;
  by: string;
}

export interface SelfEval {
  answers: Record<string, number>;
  score: number;
  accomplishments: string;
  needs: string;
  goals: string;
  completed_at: string;
}

export type EvaluationStatus = 'en_cours' | 'a_proposer' | 'propose' | 'accepte' | 'refuse' | 'applique';

export interface Evaluation {
  id: string;
  pharmacy_id: string;
  employee_id: string;
  employee_name: string;
  current_rate: number;
  baiia_increase_pct: number;
  status: EvaluationStatus;
  admin_eval: AdminEval | null;
  self_eval: SelfEval | null;
  suggestion: EvalSuggestion | null;
  proposed_rate: number | null;
  proposed_at: string | null;
  employee_decision: { accepted: boolean; comment: string; at: string } | null;
  agreed_rate: number | null;
  applied: boolean;
  created_by: string;
  created_at: string;
}

export interface Agency {
  id: string;
  pharmacy_id: string;
  name: string;
  email: string;
  roles: string[];
  created_at: string;
  global?: boolean;
  partner_type?: 'agency' | 'individual';
}

export interface GlobalPartner {
  id: string;
  name: string;
  email: string;
  roles: string[];
  partner_type: 'agency' | 'individual';
  created_at: string;
}

export interface Delivery {
  id: string;
  pharmacy_id: string;
  client_name: string;
  address: string;
  phone: string;
  order_ref: string;
  products: string;
  notes: string;
  priority: 'normal' | 'urgent';
  courier_employee_id: string;
  courier_name: string;
  status: 'a_ramasser' | 'en_route' | 'livree';
  proof_image?: string | null;
  proof_type?: 'photo' | 'signature' | null;
  created_by: string;
  created_at: string;
  picked_up_at: string | null;
  delivered_at: string | null;
}

export interface Appointment {
  id: string;
  pharmacy_id: string;
  employee_id: string;
  employee_name: string;
  date: string;
  start: string;
  end: string;
  client_name: string;
  reason: string;
  notes: string;
  created_by: string;
  created_at: string;
}

export interface ReplacementSlotT {
  date: string;
  start: string;
  end: string;
}

export interface ReplacementRequestDoc {
  id: string;
  pharmacy_id: string;
  role: string;
  slots: ReplacementSlotT[];
  notes: string;
  urgency: string;
  status: 'open' | 'filled';
  link?: string;
  chosen_offer_id: string | null;
  chosen_offer?: { candidate_name: string; agency_name: string; hourly_rate: number } | null;
  emails_sent: number;
  offers_count?: number;
  created_by: string;
  created_at: string;
}

export interface ReplacementOfferDoc {
  id: string;
  request_id: string;
  agency_name: string;
  agency_email: string;
  candidate_name: string;
  license_number: string;
  experience_years: number;
  hourly_rate: number;
  phone: string;
  email: string;
  note: string;
  status: 'received' | 'chosen' | 'declined';
  created_at: string;
}

export interface PublicReplacementRequest {
  role: string;
  slots: ReplacementSlotT[];
  notes: string;
  urgency: string;
  status: string;
  created_at: string;
}

export interface HRState {
  employees: Employee[];
  branches: Branch[];
  resources: Resource[];
  shifts: Shift[];
  shiftSwaps: ShiftSwapRequest[];
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
