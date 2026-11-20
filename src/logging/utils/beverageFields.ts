import type { I18nKey } from '../../i18n/i18n';
import type { BeanInput, BeanRow, BeverageDetails, BeverageType } from '../types';
import type { NonCoffeeBeverage } from './beverage';

export type DetailField = {
  key: I18nKey & `beverage.${string}`;
  storageKey?: string;
  options?: string[];
  numeric?: [number, number, number];
};

export const beverageItemFields: Record<NonCoffeeBeverage, DetailField[]> = {
  tea: [
    { key: 'beverage.style', storageKey: 'teaStyle', options: ['green', 'black', 'oolong', 'whiteTea', 'yellow', 'dark', 'herbal'] },
    { key: 'beverage.harvest' },
  ],
  wine: [
    { key: 'beverage.style', storageKey: 'wineStyle', options: ['red', 'whiteWine', 'rose', 'sparkling', 'orange', 'fortified', 'dessert'] },
    { key: 'beverage.vintage', numeric: [1000, 2100, 1] },
    { key: 'beverage.abv', numeric: [0, 100, 0.1] },
  ],
};

export const detailKey = (field: DetailField) => field.storageKey ?? field.key.slice('beverage.'.length);
export const detailOptionKey = (value: string) => `beverage.option.${value}` as I18nKey;

export const beverageTastingFields: Record<NonCoffeeBeverage, DetailField[]> = {
  tea: [
    { key: 'beverage.leafGrams', numeric: [0, 10000, 0.1] },
    { key: 'beverage.waterMl', numeric: [0, 100000, 1] },
    { key: 'beverage.steepSeconds', numeric: [0, 86400, 1] },
    { key: 'beverage.infusions', numeric: [1, 100, 1] },
  ],
  wine: [
    { key: 'beverage.serveTemp', numeric: [-10, 50, 0.1] },
    { key: 'beverage.decantMinutes', numeric: [0, 1440, 1] },
    { key: 'beverage.dryness', options: ['dry', 'offDry', 'sweet'] },
    { key: 'beverage.tannins', options: ['low', 'medium', 'high'] },
    { key: 'beverage.pairing' },
  ],
};

export type DetailsDraft = Record<string, string>;
export type ProductDraft = BeanInput & { details: DetailsDraft };
type Translate = (key: I18nKey, vars?: Record<string, string>) => string;

export const textDetails = (source: BeverageDetails = {}): DetailsDraft =>
  Object.fromEntries(Object.entries(source).map(([key, value]) => [key, String(value)]));

export function productDraft(category: BeverageType, item?: Partial<BeanRow>): ProductDraft {
  return {
    beverage_type: category, bean_name: item?.bean_name ?? '', producer: item?.producer ?? '',
    roastery: item?.roastery ?? '', roasted_on: item?.roasted_on ?? '',
    origin_country: item?.origin_country ?? '', origin_location: item?.origin_location ?? '',
    varietal: item?.varietal ?? '', process: item?.process ?? '',
    cup_notes: item?.cup_notes ?? '', cup_flavor_notes: item?.cup_flavor_notes ?? [],
    details: textDetails(item?.beverage_details),
  };
}

export function productFields(draft: ProductDraft) {
  return {
    bean_name: draft.bean_name.trim() || null,
    roastery: draft.roastery.trim() || null,
    producer: draft.producer.trim() || null,
    origin_country: draft.origin_country.trim() || null,
    origin_location: draft.origin_location.trim() || null,
    process: draft.process.trim() || null,
    varietal: draft.varietal.trim() || null,
    cup_notes: draft.cup_notes.trim() || null,
    cup_flavor_notes: draft.cup_flavor_notes,
    roasted_on: draft.roasted_on || null,
  };
}

export function parseBeverageDetails(
  values: DetailsDraft, fields: DetailField[], t: Translate, prior: BeverageDetails = {},
): BeverageDetails {
  const result = { ...prior };
  for (const field of fields) {
    const key = detailKey(field);
    const raw = values[key]?.trim();
    if (!raw) { delete result[key]; continue; }
    if (field.numeric) {
      const [min, max, step] = field.numeric;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < min || value > max || (step === 1 && !Number.isInteger(value))) {
        throw new Error(t('beverage.invalidNumber', { field: t(field.key) }));
      }
      result[key] = value;
    } else result[key] = raw;
  }
  return result;
}

export function beverageWaterTemperature(text: string, t: Translate): number | null {
  if (!text.trim()) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(t('beverage.invalidNumber', { field: t('brew.field.waterTemp', { unit: 'C' }) }));
  }
  return value;
}
