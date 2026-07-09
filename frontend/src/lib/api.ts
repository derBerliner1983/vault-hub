import type { User } from './types';
import { tt } from './i18n';

const getToken = () => localStorage.getItem('token');

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  // Content-Type nur setzen, wenn ein Body mitgeschickt wird – sonst lehnt
  // Fastify einen leeren JSON-Body mit 400 "Bad Request" ab.
  if (init?.body != null) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { ...init, headers, credentials: 'include' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string; errorKey?: string; errorVars?: Record<string, string | number> };
    const rawMsg = body.error ?? `HTTP ${res.status}`;
    const msg = body.errorKey ? tt(body.errorKey, body.errorVars) : tt(rawMsg);
    const err = new Error(msg) as Error & { data?: unknown; status?: number; raw?: string };
    err.raw = rawMsg;
    err.data = body;
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

// Vault-Hub-Kern: nur Authentifizierung (inkl. 2FA) und Benutzer-Präferenzen.
// Alles Weitere kommt als Plugin über /api/plugins und /api/store.
export const api = {
  auth: {
    login: (username: string, password: string, token?: string) =>
      req<{ user?: User; token?: string; totpRequired?: boolean }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password, token }) }),
    logout: () => req('/api/auth/logout', { method: 'POST' }),
    me: () => req<{ user: User }>('/api/auth/me'),
    changePassword: (currentPassword: string, newPassword: string) =>
      req('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
    twoFactor: {
      status: () => req<{ enabled: boolean }>('/api/auth/2fa/status'),
      setup: () => req<{ secret: string; otpauth: string }>('/api/auth/2fa/setup', { method: 'POST' }),
      enable: (token: string) => req('/api/auth/2fa/enable', { method: 'POST', body: JSON.stringify({ token }) }),
      disable: (password: string) => req('/api/auth/2fa/disable', { method: 'POST', body: JSON.stringify({ password }) }),
    },
  },

  prefs: {
    get: () => req<{ prefs: Record<string, unknown> }>('/api/prefs'),
    update: (prefs: Record<string, unknown>) =>
      req<{ ok: boolean; prefs: Record<string, unknown> }>('/api/prefs', { method: 'PUT', body: JSON.stringify({ prefs }) }),
  },
};
