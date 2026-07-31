import { ModuleKey } from '@/types';

export interface NavPayload {
  employeeId?: string;
  taskDate?: string;
  taskId?: string;
}

export const requestNavigate = (module: ModuleKey, payload?: NavPayload): void => {
  window.dispatchEvent(new CustomEvent('ap-navigate', { detail: { module, payload } }));
};

export const consumeNavPayload = (): NavPayload | null => {
  const raw = sessionStorage.getItem('ap_nav_payload');
  if (!raw) return null;
  sessionStorage.removeItem('ap_nav_payload');
  try {
    return JSON.parse(raw) as NavPayload;
  } catch {
    return null;
  }
};
