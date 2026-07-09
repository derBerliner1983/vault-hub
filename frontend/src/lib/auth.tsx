import { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { api } from './api';
import type { User } from './types';

const IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours
const IDLE_CHECK_MS = 60_000; // check every minute

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string, token?: string) => Promise<{ totpRequired: boolean }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    api.auth.me()
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const logout = useCallback(async () => {
    await api.auth.logout().catch(() => {});
    localStorage.removeItem('token');
    setUser(null);
  }, []);

  // Track user activity
  useEffect(() => {
    if (!user) return;
    const touch = () => { lastActivityRef.current = Date.now(); };
    const events = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'];
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, touch));
  }, [user]);

  // Auto-logout on idle
  useEffect(() => {
    if (!user) return;
    const t = setInterval(() => {
      if (Date.now() - lastActivityRef.current > IDLE_TIMEOUT_MS) {
        void logout();
      }
    }, IDLE_CHECK_MS);
    return () => clearInterval(t);
  }, [user, logout]);

  const login = async (username: string, password: string, token?: string) => {
    const res = await api.auth.login(username, password, token);
    if (res.totpRequired) return { totpRequired: true };
    if (res.user && res.token) {
      localStorage.setItem('token', res.token);
      lastActivityRef.current = Date.now();
      setUser(res.user);
      return { totpRequired: false };
    }
    throw new Error('Anmeldung fehlgeschlagen');
  };

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
