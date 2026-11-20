import type { I18nKey } from '../../i18n/i18n';
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
