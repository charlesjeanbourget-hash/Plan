import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import axios from 'axios';
import { User } from '@/types';

const AUTH_KEY = 'luminahr_auth_v3';
const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export interface BackendUser {
  id: string;
  email: string;
  name: string;
  role: User['role'];
  pharmacy_id: string | null;
  employee_id: string | null;
  is_temporary_password: boolean;
  password_expired?: boolean;
  mfa_setup_required?: boolean;
  privacy_accepted_at?: string | null;
  mfa_enabled?: boolean;
  module_overrides?: Record<string, boolean>;
  onboarding_pending?: boolean;
}

interface StoredAuth {
  token: string;
  user: User;
}

const mapUser = (u: BackendUser): User => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  pharmacyId: u.pharmacy_id ?? undefined,
  employeeId: u.employee_id ?? undefined,
  isTemporaryPassword: u.is_temporary_password,
  passwordExpired: u.password_expired ?? false,
  mfaSetupRequired: u.mfa_setup_required ?? false,
  privacyAcceptedAt: u.privacy_accepted_at ?? null,
  mfaEnabled: u.mfa_enabled ?? false,
  moduleOverrides: u.module_overrides ?? {},
  onboardingPending: u.onboarding_pending ?? false,
});

export const formatApiError = (detail: unknown): string => {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((e) => (e && typeof (e as { msg?: unknown }).msg === 'string' ? (e as { msg: string }).msg : ''))
      .filter(Boolean)
      .join(' ') || 'Une erreur est survenue.';
  }
  return 'Une erreur est survenue. Veuillez réessayer.';
};

interface AuthContextValue {
  currentUser: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<{ error: string | null; mfaToken?: string }>;
  verifyMfa: (mfaToken: string, code: string) => Promise<string | null>;
  logout: () => void;
  changePassword: (currentPassword: string, newPassword: string) => Promise<string | null>;
  refreshUser: () => Promise<void>;
  acceptPrivacy: () => Promise<void>;
  adoptSession: (token: string, user: BackendUser) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const loadStored = (): StoredAuth | null => {
  const raw = localStorage.getItem(AUTH_KEY);
  return raw ? (JSON.parse(raw) as StoredAuth) : null;
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [auth, setAuth] = useState<StoredAuth | null>(loadStored);

  useEffect(() => {
    if (auth) {
      localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
    } else {
      localStorage.removeItem(AUTH_KEY);
    }
  }, [auth]);

  useEffect(() => {
    const stored = loadStored();
    if (!stored) return;
    axios
      .get<BackendUser>(`${API}/auth/me`, { headers: { Authorization: `Bearer ${stored.token}` } })
      .then((res) => setAuth({ token: stored.token, user: mapUser(res.data) }))
      .catch((err) => {
        if (axios.isAxiosError(err) && err.response && (err.response.status === 401 || err.response.status === 403)) {
          setAuth(null);
        }
      });
  }, []);

  const login = async (email: string, password: string): Promise<{ error: string | null; mfaToken?: string }> => {
    try {
      const res = await axios.post<{ access_token?: string; user?: BackendUser; mfa_required?: boolean; mfa_token?: string }>(`${API}/auth/login`, {
        email,
        password,
      });
      if (res.data.mfa_required && res.data.mfa_token) {
        return { error: null, mfaToken: res.data.mfa_token };
      }
      const next = { token: res.data.access_token as string, user: mapUser(res.data.user as BackendUser) };
      localStorage.setItem(AUTH_KEY, JSON.stringify(next));
      setAuth(next);
      return { error: null };
    } catch (err) {
      if (axios.isAxiosError(err) && err.response) {
        return { error: formatApiError((err.response.data as { detail?: unknown }).detail) };
      }
      return { error: 'Connexion au serveur impossible.' };
    }
  };

  const verifyMfa = async (mfaToken: string, code: string): Promise<string | null> => {
    try {
      const res = await axios.post<{ access_token: string; user: BackendUser }>(`${API}/auth/mfa/verify`, {
        mfa_token: mfaToken,
        code,
      });
      const next = { token: res.data.access_token, user: mapUser(res.data.user) };
      localStorage.setItem(AUTH_KEY, JSON.stringify(next));
      setAuth(next);
      return null;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response) {
        return formatApiError((err.response.data as { detail?: unknown }).detail);
      }
      return 'Connexion au serveur impossible.';
    }
  };

  const changePassword = async (currentPassword: string, newPassword: string): Promise<string | null> => {
    if (!auth) return 'Non connecté.';
    try {
      await axios.post(
        `${API}/auth/change-password`,
        { current_password: currentPassword, new_password: newPassword },
        { headers: { Authorization: `Bearer ${auth.token}` } }
      );
      setAuth({ ...auth, user: { ...auth.user, isTemporaryPassword: false, passwordExpired: false } });
      return null;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response) {
        return formatApiError((err.response.data as { detail?: unknown }).detail);
      }
      return 'Connexion au serveur impossible.';
    }
  };

  const logout = (): void => {
    localStorage.removeItem(AUTH_KEY);
    setAuth(null);
  };

  const refreshUser = async (): Promise<void> => {
    if (!auth) return;
    try {
      const res = await axios.get<BackendUser>(`${API}/auth/me`, { headers: { Authorization: `Bearer ${auth.token}` } });
      setAuth({ token: auth.token, user: mapUser(res.data) });
    } catch {
      /* silencieux */
    }
  };

  const acceptPrivacy = async (): Promise<void> => {
    if (!auth) return;
    try {
      const res = await axios.post<{ privacy_accepted_at: string }>(
        `${API}/auth/accept-privacy`, {}, { headers: { Authorization: `Bearer ${auth.token}` } });
      setAuth({ ...auth, user: { ...auth.user, privacyAcceptedAt: res.data.privacy_accepted_at } });
    } catch {
      /* silencieux — réessai à la prochaine connexion */
    }
  };

  const adoptSession = (token: string, backendUser: BackendUser): void => {
    const next = { token, user: mapUser(backendUser) };
    localStorage.setItem(AUTH_KEY, JSON.stringify(next));
    setAuth(next);
  };

  return (
    <AuthContext.Provider
      value={{ currentUser: auth?.user ?? null, token: auth?.token ?? null, login, verifyMfa, logout, changePassword, refreshUser, acceptPrivacy, adoptSession }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans un AuthProvider');
  return ctx;
};
