import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User } from '@/types';
import { SEED_USERS } from '@/context/seedData';

const USERS_KEY = 'luminahr_users_v1';
const SESSION_KEY = 'luminahr_session_v1';

interface AuthContextValue {
  currentUser: User | null;
  login: (email: string, password: string) => boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const loadUsers = (): User[] => {
  const raw = localStorage.getItem(USERS_KEY);
  if (raw) {
    return JSON.parse(raw) as User[];
  }
  localStorage.setItem(USERS_KEY, JSON.stringify(SEED_USERS));
  return SEED_USERS;
};

const loadSession = (): User | null => {
  const raw = localStorage.getItem(SESSION_KEY);
  return raw ? (JSON.parse(raw) as User) : null;
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [users] = useState<User[]>(loadUsers);
  const [currentUser, setCurrentUser] = useState<User | null>(loadSession);

  useEffect(() => {
    if (currentUser) {
      localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
  }, [currentUser]);

  const login = (email: string, password: string): boolean => {
    const user = users.find(
      (u) => u.email.toLowerCase() === email.trim().toLowerCase() && u.password === password
    );
    if (user) {
      setCurrentUser(user);
      return true;
    }
    return false;
  };

  const logout = (): void => setCurrentUser(null);

  return (
    <AuthContext.Provider value={{ currentUser, login, logout }}>{children}</AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans un AuthProvider');
  return ctx;
};
