import { createContext, useContext, useEffect, useState, ReactNode, useCallback, useRef } from 'react';
import axios from 'axios';
import {
  HRState, Employee, Shift, Task, JobOffer, Candidate, LeaveRequest, ReplacementRequest,
  PayrollEntry, PerformanceReview, OnboardingItem, Contract, Benefit, FAQItem, Pharmacy,
  CandidateStatus, RequestStatus, TaskStatus, PayrollStatus, ReplacementStatus, ShiftSwapRequest, Branch, Resource,
} from '@/types';
import { SEED_STATE, EMPTY_STATE } from '@/context/seedData';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';

const STATE_KEY_PREFIX = 'ap_state_v5_';
const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const AUTH_KEY = 'luminahr_auth_v3';

const stateKeyFor = (scope: string): string => `${STATE_KEY_PREFIX}${scope}`;

export const uid = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

const getToken = (): string => {
  try {
    return (JSON.parse(localStorage.getItem(AUTH_KEY) ?? '{}') as { token?: string }).token ?? '';
  } catch {
    return '';
  }
};

const authHeaders = (): Record<string, string> => ({ Authorization: `Bearer ${getToken()}` });

interface ServerShift {
  id: string;
  employee_id: string;
  date: string;
  start: string;
  end: string;
  department?: string;
  resource_ids?: string[];
  ai_generated?: boolean;
  proposal_id?: string;
  branch_id?: string;
  station?: string;
  notes?: string;
  training?: boolean;
}

const shiftFromServer = (d: ServerShift): Shift => ({
  id: d.id,
  employeeId: d.employee_id,
  date: d.date,
  startTime: d.start,
  endTime: d.end,
  department: d.department || 'Général',
  resourceIds: d.resource_ids ?? [],
  aiGenerated: d.ai_generated || undefined,
  proposalId: d.proposal_id || undefined,
  notes: d.notes || undefined,
  branchId: d.branch_id || undefined,
  station: d.station || undefined,
  training: d.training || undefined,
});

const shiftToServer = (s: Shift, branchId: string, employeeName = ''): Record<string, unknown> => ({
  id: s.id,
  employee_id: s.employeeId,
  employee_name: employeeName,
  date: s.date,
  start: s.startTime,
  end: s.endTime,
  department: s.department ?? 'Général',
  resource_ids: s.resourceIds ?? [],
  ai_generated: s.aiGenerated ?? false,
  proposal_id: s.proposalId ?? '',
  branch_id: s.branchId || branchId,
  station: s.station ?? '',
  notes: s.notes ?? '',
  training: s.training ?? false,
});

interface HRContextValue {
  state: HRState;
  getEmployee: (id: string) => Employee | undefined;
  addEmployee: (e: Omit<Employee, 'id'>) => Employee;
  updateEmployee: (id: string, patch: Partial<Employee>) => void;
  anonymizeEmployee: (id: string) => void;
  deleteEmployee: (id: string) => void;
  addShift: (s: Omit<Shift, 'id'> & { id?: string }) => void;
  updateShift: (id: string, patch: Partial<Shift>) => void;
  deleteShift: (id: string) => void;
  addShiftSwap: (s: Omit<ShiftSwapRequest, 'id'>) => void;
  updateShiftSwap: (id: string, patch: Partial<ShiftSwapRequest>) => void;
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
  addResource: (r: Omit<Resource, 'id'>) => void;
  updateResource: (id: string, patch: Partial<Resource>) => void;
  deleteResource: (id: string) => void;
  refreshShifts: () => Promise<void>;
  shiftsSynced: boolean;
  resetData: () => void;
}

const HRContext = createContext<HRContextValue | undefined>(undefined);

const loadStateFor = (scope: string): HRState => {
  const seed = scope === 'anon' ? SEED_STATE : EMPTY_STATE;
  const raw = localStorage.getItem(stateKeyFor(scope));
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<HRState>;
      return { ...seed, ...parsed } as HRState;
    } catch {
      /* cache corrompu : repart du seed */
    }
  }
  localStorage.setItem(stateKeyFor(scope), JSON.stringify(seed));
  return seed;
};

const snapWithoutShifts = (s: HRState): string => {
  const { shifts: _omit, ...rest } = s;
  return JSON.stringify(rest);
};

interface InnerProps {
  scope: string;
  token: string | null;
  children: ReactNode;
}

const HRProviderInner = ({ scope, token, children }: InnerProps) => {
  const canSync = scope !== 'anon' && scope !== 'nopharm';
  const [state, setState] = useState<HRState>(() => loadStateFor(scope));
  const stateRef = useRef(state);
  const syncedRef = useRef(false);
  const dirtyRef = useRef(false);
  const lastPushedRef = useRef(snapWithoutShifts(state));
  const pushTimer = useRef<number | null>(null);
  const syncHrStateRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    stateRef.current = state;
    localStorage.setItem(stateKeyFor(scope), JSON.stringify(state));
    if (!canSync || !getToken()) return;
    const snapshot = snapWithoutShifts(state);
    if (snapshot === lastPushedRef.current) return;
    dirtyRef.current = true;
    if (pushTimer.current) window.clearTimeout(pushTimer.current);
    const flush = (): void => {
      if (!dirtyRef.current) return;
      if (!syncedRef.current) {
        pushTimer.current = window.setTimeout(flush, 1000);
        return;
      }
      const latest = stateRef.current;
      const snap2 = snapWithoutShifts(latest);
      const { shifts: _o2, ...rest2 } = latest;
      axios.put(`${API}/hr-state`, { state: rest2 }, { headers: authHeaders() })
        .then(() => {
          lastPushedRef.current = snap2;
          dirtyRef.current = false;
        })
        .catch((err) => {
          if (axios.isAxiosError(err) && err.response?.status === 409) {
            dirtyRef.current = false;
            toast.error('Synchronisation refusée par le serveur — rechargement de l\'état à jour.');
            void syncHrStateRef.current?.();
          }
        });
    };
    pushTimer.current = window.setTimeout(flush, 1500);
  }, [state]);

  const branchOf = useCallback((employeeId: string): string =>
    stateRef.current.employees.find((e) => e.id === employeeId)?.branchId ?? '', []);

  const nameOf = useCallback((employeeId: string): string => {
    const e = stateRef.current.employees.find((x) => x.id === employeeId);
    return e ? `${e.firstName} ${e.lastName}` : '';
  }, []);

  const [shiftsSynced, setShiftsSynced] = useState(false);

  const syncShifts = useCallback(async (): Promise<void> => {
    if (!canSync || !getToken()) return;
    try {
      const res = await axios.get<{ shifts: ServerShift[]; migrated: boolean }>(`${API}/shifts`, { headers: authHeaders() });
      if (!res.data.migrated) {
        const local = stateRef.current.shifts;
        if (local.length > 0) {
          await axios.post(`${API}/shifts/bulk`,
            { shifts: local.map((s) => shiftToServer(s, branchOf(s.employeeId), nameOf(s.employeeId))) },
            { headers: authHeaders() }).catch(() => undefined);
        }
        return;
      }
      const server = res.data.shifts.map(shiftFromServer);
      setState((prev) => ({ ...prev, shifts: server }));
    } catch {
      /* hors ligne : on garde l'état local */
    } finally {
      setShiftsSynced(true);
    }
  }, [branchOf, nameOf]);

  const syncLeaves = useCallback(async (): Promise<void> => {
    if (!canSync || !getToken()) return;
    try {
      const res = await axios.get<{ items: { id: string; employee_id: string; start_date: string; end_date: string; type: string }[]; migrated: boolean }>(`${API}/leave/absences`, { headers: authHeaders() });
      if (!res.data.migrated) {
        const local = stateRef.current.leaveRequests;
        if (local.length > 0) {
          const emps = stateRef.current.employees;
          await axios.post(`${API}/leave/bulk-import`, {
            requests: local.map((l) => {
              const emp = emps.find((e) => e.id === l.employeeId);
              return {
                id: l.id, employee_id: l.employeeId,
                employee_name: emp ? `${emp.firstName} ${emp.lastName}` : '',
                type: l.type, start_date: l.startDate, end_date: l.endDate,
                reason: l.reason, status: l.status,
              };
            }),
          }, { headers: authHeaders() }).catch(() => undefined);
        }
        return;
      }
      const approved: LeaveRequest[] = res.data.items.map((d) => ({
        id: d.id, employeeId: d.employee_id, type: d.type as LeaveRequest['type'],
        startDate: d.start_date, endDate: d.end_date, reason: '', status: 'Approuvée',
      }));
      setState((prev) => ({ ...prev, leaveRequests: approved }));
    } catch {
      /* hors ligne : on garde l'état local */
    }
  }, []);

  const syncHrState = useCallback(async (): Promise<void> => {
    if (!canSync || !getToken()) return;
    const pushLocal = async (): Promise<boolean> => {
      const latest = stateRef.current;
      const snap = snapWithoutShifts(latest);
      const { shifts: _omit, ...rest } = latest;
      try {
        await axios.put(`${API}/hr-state`, { state: rest }, { headers: authHeaders() });
        lastPushedRef.current = snap;
        dirtyRef.current = false;
        syncedRef.current = true;
        return true;
      } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 409) {
          dirtyRef.current = false;
          return false; // le garde-fou serveur a refusé : on adopte l'état serveur
        }
        throw err;
      }
    };
    try {
      if (dirtyRef.current && (await pushLocal())) return;
      const res = await axios.get<{ state: Partial<HRState> | null }>(`${API}/hr-state`, { headers: authHeaders() });
      if (dirtyRef.current && (await pushLocal())) return;
      const server = res.data.state;
      if (server && Object.keys(server).length > 0) {
        const incoming = { ...EMPTY_STATE, ...server } as HRState;
        const incomingSnap = snapWithoutShifts(incoming);
        if (incomingSnap !== snapWithoutShifts(stateRef.current)) {
          if (!syncedRef.current) {
            localStorage.setItem(`ap_state_backup_v5_${scope}`, JSON.stringify(stateRef.current));
          }
          lastPushedRef.current = incomingSnap;
          setState((prev) => ({ ...incoming, shifts: prev.shifts }));
        }
      } else {
        await pushLocal();
      }
      syncedRef.current = true;
    } catch {
      /* hors ligne : on garde l'état local */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  syncHrStateRef.current = syncHrState;

  useEffect(() => {
    if (!token || !canSync) {
      syncedRef.current = false;
      return undefined;
    }
    dirtyRef.current = false;
    lastPushedRef.current = snapWithoutShifts(stateRef.current);
    void (async () => {
      await syncHrState();
      void syncShifts();
      void syncLeaves();
    })();
    const intervalId = window.setInterval(() => {
      void syncShifts();
      void syncLeaves();
      void syncHrState();
    }, 15000);
    const onFocus = (): void => {
      void syncShifts();
      void syncLeaves();
      void syncHrState();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
    };
  }, [token, syncShifts, syncLeaves, syncHrState]);

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
    anonymizeEmployee: (id) =>
      patchList('employees', (items) => items.map((i) => (i.id === id ? {
        ...i,
        firstName: 'Employé',
        lastName: `anonymisé ${i.id.slice(-4)}`,
        email: '',
        phone: '',
        address: '',
        emergencyContact: '',
        status: 'Inactif',
        anonymized: true,
      } : i))),
    deleteEmployee: (id) =>
      patchList('employees', (items) => items.filter((i) => i.id !== id)),
    addShift: (s) => {
      const id = s.id ?? uid();
      const shift: Shift = { ...s, id };
      patchList('shifts', (items) => (items.some((i) => i.id === id) ? items : [...items, shift]));
      if (canSync && getToken()) {
        void axios.post<{ incompat_warning?: string | null }>(`${API}/shifts`, shiftToServer(shift, branchOf(shift.employeeId), nameOf(shift.employeeId)), { headers: authHeaders() })
          .then((r) => { if (r.data.incompat_warning) toast.warning(r.data.incompat_warning, { duration: 9000 }); })
          .catch(() => undefined);
      }
    },
    updateShift: (id, patch) => {
      patchList('shifts', (items) => items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
      if (canSync && getToken()) {
        const body: Record<string, unknown> = {};
        if (patch.employeeId !== undefined) {
          body.employee_id = patch.employeeId;
          body.employee_name = nameOf(patch.employeeId);
          body.branch_id = patch.branchId ?? branchOf(patch.employeeId);
        }
        if (patch.branchId !== undefined) body.branch_id = patch.branchId;
        if (patch.station !== undefined) body.station = patch.station;
        if (patch.date !== undefined) body.date = patch.date;
        if (patch.startTime !== undefined) body.start = patch.startTime;
        if (patch.endTime !== undefined) body.end = patch.endTime;
        if (patch.department !== undefined) body.department = patch.department;
        if (patch.resourceIds !== undefined) body.resource_ids = patch.resourceIds;
        if (patch.aiGenerated !== undefined) body.ai_generated = patch.aiGenerated;
        if (patch.proposalId !== undefined) body.proposal_id = patch.proposalId;
        if (patch.notes !== undefined) body.notes = patch.notes;
        if (patch.training !== undefined) body.training = patch.training;
        if (Object.keys(body).length > 0) {
          void axios.put<{ incompat_warning?: string | null }>(`${API}/shifts/${id}`, body, { headers: authHeaders() })
            .then((r) => { if (r.data.incompat_warning) toast.warning(r.data.incompat_warning, { duration: 9000 }); })
            .catch(() => undefined);
        }
      }
    },
    deleteShift: (id) => {
      patchList('shifts', (items) => items.filter((i) => i.id !== id));
      if (canSync && getToken()) {
        void axios.delete(`${API}/shifts/${id}`, { headers: authHeaders() }).catch(() => undefined);
      }
    },
    addShiftSwap: (s) => patchList('shiftSwaps', (items) => [{ ...s, id: uid() }, ...items]),
    updateShiftSwap: (id, patch) =>
      patchList('shiftSwaps', (items) => items.map((i) => (i.id === id ? { ...i, ...patch } : i))),
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
    deleteBranch: (id) => {
      const doomedShifts = state.shifts.filter((s) => s.branchId === id).map((s) => s.id);
      setState((prev) => ({
        ...prev,
        branches: prev.branches.filter((b) => b.id !== id),
        employees: prev.employees.map((e) => ({
          ...e,
          branchId: e.branchId === id ? '' : e.branchId,
          branchIds: e.branchIds ? e.branchIds.filter((bid) => bid !== id) : e.branchIds,
        })),
        shifts: prev.shifts.filter((s) => s.branchId !== id),
      }));
      if (canSync && getToken()) {
        doomedShifts.forEach((sid) => {
          void axios.delete(`${API}/shifts/${sid}`, { headers: authHeaders() }).catch(() => undefined);
        });
      }
    },
    addResource: (r) => patchList('resources', (items) => [...items, { ...r, id: uid() }]),
    updateResource: (id, patch) =>
      patchList('resources', (items) => items.map((i) => (i.id === id ? { ...i, ...patch } : i))),
    deleteResource: (id) => {
      patchList('resources', (items) => items.filter((i) => i.id !== id));
      patchList('shifts', (items) => items.map((s) =>
        s.resourceIds ? { ...s, resourceIds: s.resourceIds.filter((rid) => rid !== id) } : s));
    },
    resetData: () => {
      const seed = scope === 'anon' ? SEED_STATE : EMPTY_STATE;
      localStorage.setItem(stateKeyFor(scope), JSON.stringify(seed));
      setState(seed);
    },
    refreshShifts: syncShifts,
    shiftsSynced,
  };

  return <HRContext.Provider value={value}>{children}</HRContext.Provider>;
};

export const HRProvider = ({ children }: { children: ReactNode }) => {
  const { currentUser, token } = useAuth();
  const scope = currentUser ? (currentUser.pharmacyId || 'nopharm') : 'anon';
  return (
    <HRProviderInner key={scope} scope={scope} token={currentUser ? token : null}>
      {children}
    </HRProviderInner>
  );
};

export const useHR = (): HRContextValue => {
  const ctx = useContext(HRContext);
  if (!ctx) throw new Error('useHR doit être utilisé dans un HRProvider');
  return ctx;
};
