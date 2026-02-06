import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { LOCALES, format, type I18nKey, type LanguageCode } from './i18n';
import { loadPreferredLanguage, savePreferredLanguage } from './prefs';

type I18nContextValue = {
  lang: LanguageCode;
  setLang: (lang: LanguageCode) => void;
  t: (key: I18nKey, params?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<LanguageCode>(() => loadPreferredLanguage() ?? 'en-us');

  const setLang = (next: LanguageCode) => {
    setLangState(next);
    savePreferredLanguage(next);
  };

  const value = useMemo<I18nContextValue>(() => {
    const strings = LOCALES[lang];
    return {
      lang,
      setLang,
      t: (key, params) => format(strings[key], params)
    };
  }, [lang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}


