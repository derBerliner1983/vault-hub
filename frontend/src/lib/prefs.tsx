import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { api } from './api';
import { useAuth } from './auth';

// Pro-Benutzer UI-Einstellungen (Sortierung von Sidebar/Panels usw.).
// Quelle der Wahrheit ist der Server (/api/prefs, an das Benutzerkonto gebunden).
// localStorage dient nur als Sofort-Cache, damit beim Kaltstart nichts „springt".

const CACHE_KEY = 'user-prefs-cache';

type Prefs = Record<string, unknown>;

function loadCache(): Prefs {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; }
}
function saveCache(p: Prefs) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(p)); } catch { /* */ }
}

interface PrefsContextValue {
  prefs: Prefs;
  /** Einen Schlüssel setzen (lokal sofort, serverseitig gespeichert/zusammengeführt). */
  setPref: (key: string, value: unknown) => void;
  loaded: boolean;
}

const PrefsContext = createContext<PrefsContextValue | null>(null);

export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<Prefs>(loadCache);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Prefs>({});

  // Beim Anmelden die Server-Einstellungen laden (überschreiben den Cache)
  useEffect(() => {
    if (!user) { setLoaded(false); return; }
    let cancelled = false;
    api.prefs.get()
      .then((r) => { if (!cancelled) { setPrefs(r.prefs || {}); saveCache(r.prefs || {}); setLoaded(true); } })
      .catch(() => { if (!cancelled) setLoaded(true); });   // Cache bleibt als Fallback
    return () => { cancelled = true; };
  }, [user]);

  const setPref = useCallback((key: string, value: unknown) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value };
      saveCache(next);
      return next;
    });
    // Server-Speicherung sammeln und gebündelt senden (debounced)
    pending.current[key] = value;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const patch = pending.current; pending.current = {};
      api.prefs.update(patch).catch(() => { /* offline → Cache bleibt, später erneut */ });
    }, 600);
  }, []);

  return <PrefsContext.Provider value={{ prefs, setPref, loaded }}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): PrefsContextValue {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error('usePrefs must be used within PrefsProvider');
  return ctx;
}

/**
 * Bequemer Hook für eine gespeicherte Sortier-Reihenfolge.
 * `scope` ist z.B. 'sidebarOrder' oder 'panelOrder', `key` der Abschnitt/Panel-Schlüssel.
 * Liefert die Reihenfolge (Array von IDs) und einen Setter, der pro-Benutzer speichert.
 */
export function useOrder(scope: string, key: string): [string[], (order: string[]) => void] {
  const { prefs, setPref } = usePrefs();
  const all = (prefs[scope] as Record<string, string[]>) || {};
  const order = all[key] || [];
  const set = useCallback((next: string[]) => {
    const current = (prefs[scope] as Record<string, string[]>) || {};
    setPref(scope, { ...current, [key]: next });
  }, [prefs, scope, key, setPref]);
  return [order, set];
}
