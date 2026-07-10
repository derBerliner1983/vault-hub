import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { de } from './locales/de';
import { en } from './locales/en';

// ── Modulare Sprachen ─────────────────────────────────────────────────────────
// Basis sind Deutsch + Englisch. Weitere Sprachen können ZUR LAUFZEIT registriert
// werden — z. B. durch ein Sprach-Plugin aus dem Store (registerLanguage) oder
// durch eine App, die eigene Strings mitbringt (registerMessages). So bleibt die
// Sprache modular und pro App/Store erweiterbar.

export interface LanguageMeta { code: string; label: string; flag?: string }
export type LangCode = string;
export type TranslationDict = Record<string, string>;

export const LANGUAGES: LanguageMeta[] = [
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
];

const DICTS: Record<string, TranslationDict> = { de, en };

/** Eine neue Sprache registrieren (z. B. Sprach-Plugin aus dem Store). */
export function registerLanguage(code: string, label: string, dict: TranslationDict, flag?: string): void {
  if (!LANGUAGES.some((l) => l.code === code)) LANGUAGES.push({ code, label, flag });
  DICTS[code] = { ...(DICTS[code] || {}), ...dict };
}

/** Zusätzliche Strings in eine (ggf. neue) Sprache einmischen (z. B. von einer App). */
export function registerMessages(code: string, partial: TranslationDict): void {
  DICTS[code] = { ...(DICTS[code] || {}), ...partial };
}

const STORAGE_KEY = 'lang';

function detectInitial(): LangCode {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && DICTS[stored]) return stored;
  const nav = (navigator.language || 'de').slice(0, 2).toLowerCase();
  return DICTS[nav] ? nav : 'de';
}

// ── Modulweite Übersetzung (Deutsch = Schlüssel/Fallback) ─────────────────────
let currentLang: LangCode = (typeof navigator !== 'undefined') ? detectInitial() : 'de';

/** Übersetzt einen Schlüssel ODER direkt einen deutschen Quelltext. */
export function tt(key: string, vars?: Record<string, string | number>): string {
  const dict = DICTS[currentLang] ?? de;
  // Deutsch ist die Basissprache: die deutschen Quelltexte SIND die Schlüssel.
  // Im Deutsch-Modus (leeres de-Dict) wird also der Schlüssel selbst zurückgegeben –
  // KEIN Englisch-Fallback. Für andere Sprachen greift deren Wörterbuch, sonst der
  // deutsche Quelltext (Schlüssel) als Fallback.
  let s = dict[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return s;
}

/** Lokalisierten Wert auflösen: entweder ein String oder eine {lang: text}-Map. */
export function localized(value: string | Record<string, string> | undefined): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return value[currentLang] || value.de || value.en || Object.values(value)[0] || '';
}

interface I18nContextValue {
  lang: LangCode;
  setLang: (l: LangCode) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<LangCode>(detectInitial);
  currentLang = lang;

  useEffect(() => { document.documentElement.setAttribute('lang', lang); }, [lang]);

  const setLang = useCallback((l: LangCode) => {
    currentLang = l;
    setLangState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch { /* */ }
  }, []);

  const t = useCallback((key: string, vars?: Record<string, string | number>) => tt(key, vars), [lang]);

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}

/** Bequemer Hook, der nur die t-Funktion liefert. */
export function useT() {
  return useI18n().t;
}
