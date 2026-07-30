import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import {
  HRState, Employee, Shift, Task, JobOffer, Candidate, LeaveRequest, ReplacementRequest,
  PayrollEntry, PerformanceReview, OnboardingItem, Contract, Benefit, FAQItem, Pharmacy,
  CandidateStatus, RequestStatus, TaskStatus, PayrollStatus, ReplacementStatus, ShiftSwapRequest, Branch,
} from '@/types';
import { SEED_STATE } from '@/context/seedData';

const STATE_KEY = 'luminahr_state_v3';

export const uid = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

interface HRContextValue {
  state: HRState;
  getEmployee: (id: string) => Employee | undefined;
  addEmployee: (e: Omit<Employee, 'id'>) => Employee;
  updateEmployee: (id: string, patch: Partial<Employee>) => void;
  deleteEmployee: (id: string) => void;
  addShift: (s: Omit<Shift, 'id'>) => void;
  updateShift: (id: string, patch: Partial<Shift>) => void;
  deleteShift: (id: string) => void;
  addShiftSwap: (s: Omit<ShiftSwapRequest, 'id'>) => void;
  setShiftSwapStatus: (id: string, status: RequestStatus) => void;
  addTask: (t: Omit<Task, 'id'>) => void;
  setTaskStatus: (id: string, status: TaskStatus) => void;
  addJobOffer: (o: Omit<JobOffer, 'id'>) => void;
  updateJobOffer: (id: string, patch: Partial<JobOffer>) => void;
  addCandidate: (c: Omit<Candidate, 'id'>) => void;
  setCandidateStatus: (id: string, status: CandidateStatus) => void;
  addLeaveRequest: (l: Omit<LeaveRequest, 'id'>) => void;
  setLeaveStatus: (id: string, status: RequestStatus) => void;
  addReplacementRequest: (r: Omit<ReplacementRequest, 'id'>) => void;
  updateReplacement: (id: string, patch: Partial<ReplacementRequest>) => void;
  setReplacementStatus: (id: string, status: ReplacementStatus) => void;
  addPayrollEntry: (p: Omit<PayrollEntry, 'id'>) => void;
  setPayrollStatus: (id: string, status: PayrollStatus) => void;
  addReview: (r: Omit<PerformanceReview, 'id'>) => void;
  addOnboardingItem: (o: Omit<OnboardingItem, 'id'>) => void;
  toggleOnboardingItem: (id: string) => void;
  addContract: (c: Omit<Contract, 'id'>) => void;
  updateContract: (id: string, patch: Partial<Contract>) => void;
  addBenefit: (b: Omit<Benefit, 'id'>) => void;
  toggleBenefitEnrollment: (benefitId: string, employeeId: string) => void;
  addFAQ: (f: Omit<FAQItem, 'id'>) => void;
  addPharmacy: (p: Omit<Pharmacy, 'id'>) => void;
  updatePharmacy: (id: string, patch: Partial<Pharmacy>) => void;
  addBranch: (b: Omit<Branch, 'id'>) => void;
  deleteBranch: (id: string) => void;
  resetData: () => void;
}

const HRContext = createContext<HRContextValue | undefined>(undefined);

const loadState = (): HRState => {
  const raw = localStorage.getItem(STATE_KEY);
  if (raw) {
    return JSON.parse(raw) as HRState;
  }
  localStorage.setItem(STATE_KEY, JSON.stringify(SEED_STATE));
  return SEED_STATE;
};

export const HRProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<HRState>(loadState);

  useEffect(() => {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  }, [state]);

  const patchList = useCallback(
    <K extends keyof HRState>(key: K, fn: (items: HRState[K]) => HRState[K]) => {
      setState((prev) => ({ ...prev, [key]: fn(prev[key]) }));
    },
    []
  );

  const value: HRContextValue = {
    state,
    getEmployee: (id) => state.employees.find((e) => e.id === id),
    addEmployee: (e) => {
      const emp: Employee = { ...e, id: uid() };
      patchList('employees', (items) => [...items, emp]);
      return emp;
    },
    updateEmployee: (id, patch) =>
      patchList('employees', (items) => items.map((i) => (i.id === id ? { ...i, ...patch } : i))),
    deleteEmployee: (id) =>
      patchList('employees', (items) => items.filter((i) => i.id !== id)),
    addShift: (s) => patchList('shifts', (items) => [...items, { ...s, id: uid() }]),
    updateShift: (id, patch) =>
      patchList('shifts', (items) => items.map((i) => (i.id === id ? { ...i, ...patch } : i))),
    deleteShift: (id) => patchList('shifts', (items) => items.filter((i) => i.id !== id)),
    addShiftSwap: (s) => patchList('shiftSwaps', (items) => [{ ...s, id: uid() }, ...items]),
    setShiftSwapStatus: (id, status) =>
      patchList('shiftSwaps', (items) => items.map((i) => (i.id === id ? { ...i, status } : i))),
    addTask: (t) => patchList('tasks', (items) => [...items, { ...t, id: uid() }]),
    setTaskStatus: (id, status) =>
      patchList('tasks', (items) => items.map((i) => (i.id === id ? { ...i, status } : i))),
    addJobOffer: (o) => patchList('jobOffers', (items) => [{ ...o, id: uid() }, ...items]),
    updateJobOffer: (id, patch) =>
      patchList('jobOffers', (items) => items.map((i) => (i.id === id ? { ...i, ...patch } : i))),
    addCandidate: (c) => patchList('candidates', (items) => [{ ...c, id: uid() }, ...items]),
    setCandidateStatus: (id, status) =>
      patchList('candidates', (items) => items.map((i) => (i.id === id ? { ...i, status } : i))),
    addLeaveRequest: (l) => patchList('leaveRequests', (items) => [{ ...l, id: uid() }, ...items]),
    setLeaveStatus: (id, status) =>
      patchList('leaveRequests', (items) => items.map((i) => (i.id === id ? { ...i, status } : i))),
    addReplacementRequest: (r) =>
      patchList('replacementRequests', (items) => [{ ...r, id: uid() }, ...items]),
    updateReplacement: (id, patch) =>
      patchList('replacementRequests', (items) => items.map((i) => (i.id === id ? { ...i, ...patch } : i))),
    setReplacementStatus: (id, status) =>
      patchList('replacementRequests', (items) => items.map((i) => (i.id === id ? { ...i, status } : i))),
    addPayrollEntry: (p) => patchList('payrollEntries', (items) => [{ ...p, id: uid() }, ...items]),
    setPayrollStatus: (id, status) =>
      patchList('payrollEntries', (items) => items.map((i) => (i.id === id ? { ...i, status } : i))),
    addReview: (r) => patchList('performanceReviews', (items) => [{ ...r, id: uid() }, ...items]),
    addOnboardingItem: (o) =>
      patchList('onboardingItems', (items) => [...items, { ...o, id: uid() }]),
    toggleOnboardingItem: (id) =>
      patchList('onboardingItems', (items) => items.map((i) => (i.id === id ? { ...i, done: !i.done } : i))),
    addContract: (c) => patchList('contracts', (items) => [{ ...c, id: uid() }, ...items]),
    updateContract: (id, patch) =>
      patchList('contracts', (items) => items.map((i) => (i.id === id ? { ...i, ...patch } : i))),
    addBenefit: (b) => patchList('benefits', (items) => [...items, { ...b, id: uid() }]),
    toggleBenefitEnrollment: (benefitId, employeeId) =>
      patchList('benefits', (items) =>
        items.map((b) =>
          b.id === benefitId
            ? {
                ...b,
                enrolledEmployeeIds: b.enrolledEmployeeIds.includes(employeeId)
                  ? b.enrolledEmployeeIds.filter((e) => e !== employeeId)
                  : [...b.enrolledEmployeeIds, employeeId],
              }
            : b
        )
      ),
    addFAQ: (f) => patchList('faqItems', (items) => [...items, { ...f, id: uid() }]),
    addPharmacy: (p) => patchList('pharmacies', (items) => [...items, { ...p, id: uid() }]),
    updatePharmacy: (id, patch) =>
      patchList('pharmacies', (items) => items.map((i) => (i.id === id ? { ...i, ...patch } : i))),
    addBranch: (b) => patchList('branches', (items) => [...items, { ...b, id: uid() }]),
    deleteBranch: (id) => patchList('branches', (items) => items.filter((i) => i.id !== id)),
    resetData: () => {
      localStorage.setItem(STATE_KEY, JSON.stringify(SEED_STATE));
      setState(SEED_STATE);
    },
  };

  return <HRContext.Provider value={value}>{children}</HRContext.Provider>;
};

export const useHR = (): HRContextValue => {
  const ctx = useContext(HRContext);
  if (!ctx) throw new Error('useHR doit être utilisé dans un HRProvider');
  return ctx;
};
