import type { BeanLabelRow, BeanRow, BrewRow, GrinderParticleSizeRow, GrinderRow } from '../types';
import { isBeverageType } from '../utils/beverage';

export type LocalData = {
  beans: BeanRow[];
  brews: BrewRow[];
  grinders: GrinderRow[];
  particleSizes: GrinderParticleSizeRow[];
  beanLabels: BeanLabelRow[];
};

/** Full writable rows, not field patches. Omitted collections are unchanged except legacy orphan-label repair. */
export type LocalSaveData = {
  [K in keyof LocalData]?: Omit<LocalData[K][number], 'user_uid'>[];
};

export type LocalDataErrorCode =
  | 'INVALID_BACKUP'
  | 'UNSUPPORTED_BACKUP_VERSION'
  | 'INVALID_DATA'
  | 'DUPLICATE_ID'
  | 'INVALID_REFERENCE'
  | 'STORAGE_READ_FAILED'
  | 'STORAGE_WRITE_FAILED'
  | 'STORAGE_ROLLBACK_FAILED'
  | 'MIGRATION_FAILED'
  | 'MIGRATION_CLEANUP_FAILED';

/** UI callers should localize `code`; `path` and `cause` are diagnostic only. */
export class LocalDataError extends Error {
  constructor(
    public readonly code: LocalDataErrorCode,
    public readonly path?: string,
    public readonly cause?: unknown,
  ) {
    super(code);
    this.name = 'LocalDataError';
  }
}

export const COLLECTIONS = ['beans', 'brews', 'grinders', 'particleSizes', 'beanLabels'] as const;
const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

export function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

export function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4}-\d{2}-\d{2})[Tt ]([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,6})?(?:[Zz]|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  return Boolean(match && isDate(match[1]) && Number.isFinite(Date.parse(value)));
}

type Rule = (value: unknown) => boolean;
const string: Rule = (value) => typeof value === 'string';
const finite: Rule = (value) => typeof value === 'number' && Number.isFinite(value);
const nullable = (rule: Rule): Rule => (value) => value === null || rule(value);
const flavorNotes: Rule = (value) => Array.isArray(value) && Array.from(value).every((note) =>
  isRecord(note) && Object.keys(note).length === 2 &&
  Array.isArray(note.path) && note.path.length >= 1 && note.path.length <= 3 &&
  Array.from(note.path).every((part) => typeof part === 'string' && part.trim().length > 0) &&
  typeof note.color === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(note.color),
);
const owned = { uid: isUuid, user_uid: (value: unknown) => value === 'guest' || isUuid(value) };
const beverageDetails: Rule = value => isRecord(value) &&
  Object.values(value).every(item => string(item) || finite(item));
const optionalFields = new Set(['beverage_type', 'beverage_details']);
const fields: Record<keyof LocalData, Record<string, Rule>> = {
  beans: {
    ...owned,
    bean_name: nullable(string), roastery: nullable(string), producer: nullable(string),
    origin_location: nullable(string), origin_country: nullable(string), process: nullable(string),
    varietal: nullable(string), cup_notes: nullable(string), cup_flavor_notes: nullable(flavorNotes),
    roasted_on: nullable(isDate),
    beverage_type: isBeverageType, beverage_details: beverageDetails,
  },
  brews: {
    ...owned,
    brew_date: (value) => isDate(value) || isTimestamp(value),
    bean_uid: isUuid, grinder_uid: nullable(isUuid), grinder_setting: nullable(string),
    recipe: nullable(string), coffee_dose_g: nullable(finite), coffee_yield_g: nullable(finite),
    coffee_tds: nullable(finite), water: nullable(string), water_temp_c: nullable(finite),
    grind_median_um: nullable(finite), rating: nullable(finite), extraction_note: nullable(string),
    taste_note: nullable(string), taste_flavor_notes: nullable(flavorNotes),
    beverage_details: beverageDetails,
  },
  grinders: { ...owned, maker: nullable(string), model: nullable(string) },
  particleSizes: { ...owned, grinder_uid: isUuid, grinder_setting: string, particle_median_um: finite },
  beanLabels: { uid: isUuid, bean_uid: isUuid, grams: nullable(finite) },
};

export function validateCollections(value: unknown, partial = false): asserts value is Record<keyof LocalData, unknown[]> {
  if (!isRecord(value) || Object.keys(value).some((key) => !COLLECTIONS.includes(key as keyof LocalData))) {
    throw new LocalDataError('INVALID_DATA');
  }
  for (const collection of COLLECTIONS) {
    if (partial && !hasOwn(value, collection)) continue;
    if (!Array.isArray(value[collection])) throw new LocalDataError('INVALID_DATA', collection);
  }
}

export function validateLocalData(
  value: unknown,
  { allowOrphanLabels = false }: { allowOrphanLabels?: boolean } = {},
): asserts value is LocalData {
  validateCollections(value);
  const ids = new Map<keyof LocalData, Set<string>>();
  for (const collection of COLLECTIONS) {
    const seen = new Set<string>();
    ids.set(collection, seen);
    for (const [index, row] of value[collection].entries()) {
      const path = `${collection}[${index}]`;
      if (!isRecord(row)) throw new LocalDataError('INVALID_DATA', path);
      const rules = fields[collection];
      for (const [field, rule] of Object.entries(rules)) {
        if (optionalFields.has(field) && !hasOwn(row, field)) continue;
        if (!hasOwn(row, field) || !rule(row[field])) {
          throw new LocalDataError('INVALID_DATA', `${path}.${field}`);
        }
      }
      if (Object.keys(row).some((key) => key !== 'created_at' && !hasOwn(rules, key)) ||
          (hasOwn(row, 'created_at') && !isTimestamp(row.created_at))) {
        throw new LocalDataError('INVALID_DATA', path);
      }
      const uid = (row.uid as string).toLowerCase();
      if (seen.has(uid)) throw new LocalDataError('DUPLICATE_ID', `${path}.uid`);
      seen.add(uid);
    }
  }

  for (const collection of COLLECTIONS) {
    for (const [index, row] of value[collection].entries()) {
      const record = row as Record<string, unknown>;
      for (const [field, target] of [['bean_uid', 'beans'], ['grinder_uid', 'grinders']] as const) {
        if (allowOrphanLabels && collection === 'beanLabels') continue;
        const reference = record[field];
        if (typeof reference === 'string' && !ids.get(target)!.has(reference.toLowerCase())) {
          throw new LocalDataError('INVALID_REFERENCE', `${collection}[${index}].${field}`);
        }
      }
    }
  }
}
