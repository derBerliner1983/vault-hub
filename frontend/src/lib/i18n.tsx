import { createContext, useContext, useState, useCallback, useEffect } from 'react';

// ── Verfügbare Sprachen ──────────────────────────────────────────────────────
// Neue Sprache hinzufügen: hier eintragen + Wörterbuch in ./locales/<code>.ts
// anlegen und unten in DICTS importieren. Fehlt ein Schlüssel, wird automatisch
// auf Deutsch (Basis) zurückgegriffen.
export const LANGUAGES = [
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'it', label: 'Italiano', flag: '🇮🇹' },
] as const;

export type LangCode = (typeof LANGUAGES)[number]['code'];

import { de } from './locales/de';
import { en } from './locales/en';
import { fr } from './locales/fr';
import { es } from './locales/es';
import { it } from './locales/it';

export type TranslationDict = Record<string, string>;

const DICTS: Record<LangCode, TranslationDict> = { de, en, fr, es, it };

const STORAGE_KEY = 'lang';

function detectInitial(): LangCode {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && DICTS[stored as LangCode]) return stored as LangCode;
  const nav = (navigator.language || 'de').slice(0, 2).toLowerCase();
  return (DICTS[nav as LangCode] ? nav : 'de') as LangCode;
}

// ── Modulweite Übersetzung (Deutsch = Schlüssel) ─────────────────────────────
// Damit auch Unterkomponenten und Hilfsfunktionen ohne Hook übersetzen können.
// Die aktuelle Sprache wird vom I18nProvider hier gespiegelt. Reaktivität ist
// gewährleistet, weil die Seitenkomponenten via useT() am Context hängen und
// beim Sprachwechsel ihren gesamten Teilbaum neu rendern.
let currentLang: LangCode = (typeof navigator !== 'undefined') ? detectInitial() : 'de';

/** Übersetzt einen Schlüssel ODER direkt einen deutschen Quelltext. */
export function tt(key: string, vars?: Record<string, string | number>): string {
  const dict = DICTS[currentLang] ?? de;
  // 1) Semantischer Schlüssel (de.ts) → 2) Deutsch-als-Schlüssel im Ziel-Dict → 3) Quelltext selbst
  let s = dict[key] ?? de[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return s;
}

interface I18nContextValue {
  lang: LangCode;
  setLang: (l: LangCode) => void;
  /** Übersetzt einen Schlüssel; optional mit {platzhalter}-Ersetzung. */
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<LangCode>(detectInitial);
  // Modulweite Sprache sofort spiegeln (vor dem ersten Render der Kinder)
  currentLang = lang;

  useEffect(() => {
    document.documentElement.setAttribute('lang', lang);
  }, [lang]);

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
