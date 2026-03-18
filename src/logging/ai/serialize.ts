import type { LanguageCode } from '../../i18n/i18n';
import type { FlavorNote } from '../types';
import type { AiTempUnit } from './prefs';

export type AiBrewSummary = {
  uid: string;
  brew_date: string;
  bean_uid: string;
  grinder: {
    maker: string | null;
    model: string | null;
    setting: string | null;
  };
  recipe: string | null;
  coffee_dose_g: number | null;
  coffee_yield_g: number | null;
  coffee_tds: number | null;
  water: string | null;
  water_temp_c: number | null;
  grind_median_um: number | null;
  rating: number | null;
  extraction_note: string | null;
  taste_note: string | null;
  taste_flavor_notes: FlavorNote[] | null;
};

export type AiBeanSummary = {
  uid: string;
  bean_name: string | null;
  roastery: string | null;
  producer: string | null;
  origin_location: string | null;
  origin_country: string | null;
  process: string | null;
  varietal: string | null;
  roasted_on: string | null;
  cup_flavor_notes: FlavorNote[] | null;
};

export type AiUserPrefs = {
  language: LanguageCode;
  tempUnit: AiTempUnit;
};

export type AiBrewPayload = {
  user_prefs: AiUserPrefs;
  current_brew: AiBrewSummary & { bean: AiBeanSummary | null };
  past_brews: Array<AiBrewSummary & { bean: AiBeanSummary | null }>;
};

export function serializeBrewForAi(
  current: AiBrewSummary & { bean: AiBeanSummary | null },
  past: Array<AiBrewSummary & { bean: AiBeanSummary | null }>,
  prefs: AiUserPrefs,
): AiBrewPayload {
  return {
    user_prefs: prefs,
    current_brew: current,
    past_brews: past,
  };
}

