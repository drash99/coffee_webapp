import type { LanguageCode } from './i18n';

const KEY = 'beanlog.prefs.lang.v1';

export function loadPreferredLanguage(): LanguageCode | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === 'en-us' || raw === 'ko-kr') return raw;
    return null;
  } catch {
    return null;
  }
}

export function savePreferredLanguage(lang: LanguageCode) {
  localStorage.setItem(KEY, lang);
}


