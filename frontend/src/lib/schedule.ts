import { Shift } from '@/types';

export interface PlannedShift {
  employeeId: string;
  date: string;
  startTime: string;
  endTime: string;
}

export interface OvertimeWarning {
  employeeId: string;
  employeeName: string;
  weekMonday: string;
  projected: number;
  max: number;
}

export const hoursBetween = (start: string, end: string): number => {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return Math.max(0, (eh * 60 + (em || 0) - sh * 60 - (sm || 0)) / 60);
};

export const addDaysIso = (isoDate: string, n: number): string => {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const mondayOf = (isoDate: string): string => {
  const d = new Date(`${isoDate}T00:00:00`);
  const diff = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const computeOvertimeWarnings = (
  existing: Shift[],
  additions: PlannedShift[],
  maxByEmp: Record<string, number>,
  nameByEmp: Record<string, string>,
): OvertimeWarning[] => {
  const added = new Map<string, number>();
  additions.forEach((a) => {
    const key = `${a.employeeId}|${mondayOf(a.date)}`;
    added.set(key, (added.get(key) ?? 0) + hoursBetween(a.startTime, a.endTime));
  });
  const warnings: OvertimeWarning[] = [];
  added.forEach((hours, key) => {
    const [employeeId, weekMonday] = key.split('|');
    const max = maxByEmp[employeeId];
    if (!max || max <= 0) return;
    const weekEnd = addDaysIso(weekMonday, 6);
    const existingHours = existing
      .filter((s) => s.employeeId === employeeId && s.date >= weekMonday && s.date <= weekEnd)
      .reduce((sum, s) => sum + hoursBetween(s.startTime, s.endTime), 0);
    const projected = Math.round((existingHours + hours) * 10) / 10;
    if (projected > max) {
      warnings.push({ employeeId, employeeName: nameByEmp[employeeId] ?? employeeId, weekMonday, projected, max });
    }
  });
  return warnings.sort((a, b) => a.weekMonday.localeCompare(b.weekMonday) || a.employeeName.localeCompare(b.employeeName));
};
