import type { BeverageType } from '../types';

export const BEVERAGE_TYPES = ['coffee', 'tea', 'wine'] as const;
export type NonCoffeeBeverage = Exclude<BeverageType, 'coffee'>;

// Keep these conservative legacy-name rules in sync with the beverage SQL backfill.
const coffeeOrFlavorName = /(^|[^a-z0-9])(coffee|espresso|decaf|arabica|robusta|washed|gesha|geisha|notes?|flavou?red|aroma|tea[ -]like)([^a-z0-9]|$)|커피|원두|에스프레소|디카페인|향미|노트/iu;
const teaName = /(^|[^a-z0-9])(oolong|sencha|matcha|gyokuro|pu[ -]?er[ -]?h?|hojicha|genmaicha|darjeeling|earl[ -]grey|green tea|black tea|white tea|yellow tea|dark tea|herbal tea)([^a-z0-9]|$)|^tea([^a-z0-9]|$)|(^|[^a-z0-9])tea\s*$|녹차|홍차|백차|황차|흑차|우롱|보이차|보이숙차|보이생차|말차|센차|호지차|겐마이차|옥로|다즐링|얼그레이|대홍포|철관음/iu;

export function classifyLegacyBean<T extends { bean_name?: string | null; beverage_type?: BeverageType }>(row: T): T {
  const name = typeof row?.bean_name === 'string' ? row.bean_name.trim() : '';
  return row?.beverage_type === undefined && name && teaName.test(name) && !coffeeOrFlavorName.test(name)
    ? { ...row, beverage_type: 'tea' }
    : row;
}

export function isBeverageType(value: unknown): value is BeverageType {
  return BEVERAGE_TYPES.some(type => type === value);
}

export function beverageTypeOf(row?: { beverage_type?: BeverageType } | null): BeverageType {
  return row?.beverage_type ?? 'coffee';
}
