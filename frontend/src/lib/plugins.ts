import { useEffect, useState, useCallback } from 'react';
import { registerMessages } from './i18n';

/** Lokalisierbarer Text: fester String ODER {lang: text}-Map (modulare Sprache). */
export type Localizable = string | Record<string, string>;

// ─── Plugin-/Store-Typen ──────────────────────────────────────────────────────
// Ein Plugin deklariert über `contributes` selbst, wo es sich in die Shell
// einklinkt (Contribution Points, Prinzip wie bei VS-Code-Extensions). Der Kern
// liest das zur Laufzeit und verdrahtet Navigation/Einstellungen/Widgets — ohne
// Neukompilieren.

export interface NavContribution {
  section?: string;   // Sidebar-Abschnitt, z. B. "SYSTEM" (Default: "APPS")
  label: string;
  route: string;      // z. B. "/app/antivirus"
  icon?: string;      // lucide-Icon-Name (Fallback: generisch)
}

export interface SettingsPanelContribution {
  label: string;
  ui?: string;        // z. B. "iframe:/app/ssh/settings"
}

export interface ServiceToggleContribution {
  label: string;
  service: string;    // systemd-Dienstname, z. B. "ssh"
}

export interface DashboardWidgetContribution {
  label: string;
  ui?: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  icon?: string;
  description?: Localizable;
  type?: 'app' | 'extension';
  source?: string;
  permissions?: string[];
  // Modulare Sprach-Variablen der App: { de: {...}, en: {...}, … }
  i18n?: Record<string, Record<string, string>>;
  contributes?: {
    nav?: NavContribution;
    settingsPanel?: SettingsPanelContribution;
    serviceToggle?: ServiceToggleContribution;
    dashboardWidget?: DashboardWidgetContribution;
  };
}

export interface StoreItem extends PluginManifest {
  installed?: boolean;
  installedVersion?: string;
  updateAvailable?: boolean;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// Wird nach Install/Uninstall gefeuert, damit Sidebar & Co. sofort neu laden
// (kein F5 nötig).
export const PLUGINS_CHANGED = 'vh:plugins-changed';
function notifyPluginsChanged() {
  try { window.dispatchEvent(new Event(PLUGINS_CHANGED)); } catch { /* SSR/kein window */ }
}

// ─── API-Aufrufe (Cookie-basiertes JWT → credentials: 'include') ──────────────

export async function fetchInstalledPlugins(): Promise<PluginManifest[]> {
  try {
    const r = await fetch('/api/plugins', { credentials: 'include' });
    if (!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d.plugins) ? d.plugins : [];
  } catch {
    return [];
  }
}

export async function fetchStore(): Promise<{ items: StoreItem[]; error?: string }> {
  try {
    const r = await fetch('/api/store', { credentials: 'include' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { items: [], error: d.error || `HTTP ${r.status}` };
    return { items: Array.isArray(d.items) ? d.items : [], error: d.error };
  } catch (e) {
    return { items: [], error: e instanceof Error ? e.message : 'Store nicht erreichbar' };
  }
}

export async function installPlugin(id: string, source?: string): Promise<void> {
  const r = await fetch('/api/plugins/install', {
    method: 'POST', credentials: 'include', headers: JSON_HEADERS,
    body: JSON.stringify({ id, source }),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.error || 'Installation fehlgeschlagen');
  }
  notifyPluginsChanged();
}

export async function uninstallPlugin(id: string): Promise<void> {
  const r = await fetch('/api/plugins/uninstall', {
    method: 'POST', credentials: 'include', headers: JSON_HEADERS,
    body: JSON.stringify({ id }),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.error || 'Deinstallation fehlgeschlagen');
  }
  notifyPluginsChanged();
}

// ─── Hook: installierte Plugins laden ─────────────────────────────────────────

export function useInstalledPlugins() {
  const [plugins, setPlugins] = useState<PluginManifest[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const list = await fetchInstalledPlugins();
    // Modulare Sprach-Variablen jeder App in i18n einmischen.
    for (const p of list) {
      if (p.i18n) for (const [lang, dict] of Object.entries(p.i18n)) registerMessages(lang, dict);
    }
    setPlugins(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
    // Nach Install/Uninstall automatisch neu laden (kein F5) + beim Fensterfokus.
    const onChange = () => { void reload(); };
    window.addEventListener(PLUGINS_CHANGED, onChange);
    window.addEventListener('focus', onChange);
    return () => {
      window.removeEventListener(PLUGINS_CHANGED, onChange);
      window.removeEventListener('focus', onChange);
    };
  }, [reload]);

  return { plugins, loading, reload };
}
