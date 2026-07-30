import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import axios from 'axios';
import { User } from '@/types';

const AUTH_KEY = 'luminahr_auth_v3';
const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

interface BackendUser {
  id: string;
  email: string;
  name: string;
  role: User['role'];
  pharmacy_id: string | null;
  employee_id: string | null;
  is_temporary_password: boolean;
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
  login: (email: string, password: string) => Promise<string | null>;
  logout: () => void;
  changePassword: (currentPassword: string, newPassword: string) => Promise<string | null>;
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

  const login = async (email: string, password: string): Promise<string | null> => {
    try {
      const res = await axios.post<{ access_token: string; user: BackendUser }>(`${API}/auth/login`, {
        email,
        password,
      });
      setAuth({ token: res.data.access_token, user: mapUser(res.data.user) });
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
      setAuth({ ...auth, user: { ...auth.user, isTemporaryPassword: false } });
      return null;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response) {
        return formatApiError((err.response.data as { detail?: unknown }).detail);
      }
      return 'Connexion au serveur impossible.';
    }
  };

  const logout = (): void => setAuth(null);

  return (
    <AuthContext.Provider
      value={{ currentUser: auth?.user ?? null, token: auth?.token ?? null, login, logout, changePassword }}
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
