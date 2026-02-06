import { enUS } from './locales/en-us';
import { koKR } from './locales/ko-kr';

export type LanguageCode = 'en-us' | 'ko-kr';
export type I18nKey = keyof typeof enUS;
export type I18nStrings = Record<I18nKey, string>;

export const LOCALES: Record<LanguageCode, I18nStrings> = {
  'en-us': enUS,
  'ko-kr': koKR
};

export function format(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_m, key) => String(params[key] ?? `{${key}}`));
}


