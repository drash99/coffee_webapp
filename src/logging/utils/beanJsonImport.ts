import { beverageFlavorWheels } from '../beverageFlavorWheels';
import type { FlavorWheelNode } from '../scaFlavorWheel';
import type { BeanInput, BeanRow, BeverageDetails, BeverageType, FlavorNote } from '../types';
import { beverageTypeOf, type NonCoffeeBeverage } from './beverage';
import { beverageItemFields, detailKey } from './beverageFields';
import { unique } from './formatting';

export type BeanImportSavedBean = {
  bean_name?: string | null;
  roastery?: string | null;
  producer?: string | null;
  origin_location?: string | null;
  origin_country?: string | null;
  process?: string | null;
  varietal?: string | null;
  cup_notes?: string | null;
  roasted_on?: string | null;
};

type JsonRecord = Record<string, unknown>;

const MAX_REFERENCE_ITEMS = 80;
const MAX_REFERENCE_BEANS = 120;
const MAX_FLAVOR_NOTES = 5;

const BEAN_IMPORT_JSON_FORMAT = {
  bean_name: '',
  roastery: '',
  origin_country: '',
  origin_location: '',
  producer: '',
  process: '',
  varietal: '',
  roasted_on: '',
  cup_notes: '',
  cup_flavor_notes: [
    {
      path: ['Fruity', 'Berry', 'Blueberry'],
      color: '#f97316',
    },
  ],
};

const EMPTY_BEAN_IMPORT: BeanInput = {
  bean_name: '',
  roastery: '',
  producer: '',
  origin_location: '',
  origin_country: '',
  process: '',
  varietal: '',
  cup_notes: '',
  cup_flavor_notes: [],
  roasted_on: '',
};

const flavorPaths = {
  coffee: flattenFlavorPaths(beverageFlavorWheels.coffee),
  tea: flattenFlavorPaths(beverageFlavorWheels.tea),
  wine: flattenFlavorPaths(beverageFlavorWheels.wine),
};

function toCleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function limitedUnique(values: Array<string | null | undefined>): string[] {
  return unique(values.map((value) => (value ?? '').trim())).slice(0, MAX_REFERENCE_ITEMS);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compactBeanReference(bean: BeanImportSavedBean) {
  return {
    bean_name: bean.bean_name ?? '',
    roastery: bean.roastery ?? '',
    origin_country: bean.origin_country ?? '',
    origin_location: bean.origin_location ?? '',
    producer: bean.producer ?? '',
    process: bean.process ?? '',
    varietal: bean.varietal ?? '',
  };
}

function normalizeDate(value: unknown): string {
  const raw = toCleanString(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  const date = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10) === raw ? raw : '';
}

function flattenFlavorPaths(nodes: FlavorWheelNode[], prefix: string[] = []): string[][] {
  return nodes.flatMap(node => {
    const path = [...prefix, node.name];
    return [path, ...flattenFlavorPaths(node.children ?? [], path)];
  });
}

function samePath(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((part, index) => part.toLowerCase() === b[index].toLowerCase());
}

function hasSuffix(path: string[], suffix: string[]): boolean {
  if (suffix.length > path.length) return false;
  const offset = path.length - suffix.length;
  return suffix.every((part, index) => part.toLowerCase() === path[index + offset].toLowerCase());
}

function normalizeFlavorPath(rawPath: unknown, paths: string[][]): string[] | null {
  const parts = Array.isArray(rawPath)
    ? rawPath.map(toCleanString).filter(Boolean).slice(0, 3)
    : toCleanString(rawPath)
        .split(/[>/,|]+/)
        .map((part) => part.trim())
        .filter(Boolean)
        .slice(0, 3);

  if (parts.length === 0) return null;

  const exact = paths.find((path) => samePath(path, parts));
  if (exact) return exact;

  const suffixMatches = paths.filter((path) => hasSuffix(path, parts));
  return suffixMatches.length === 1 ? suffixMatches[0] : null;
}

function normalizeFlavorNotes(value: unknown, category: BeverageType): FlavorNote[] {
  if (!Array.isArray(value)) return [];

  const notes: FlavorNote[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    const path = normalizeFlavorPath(isRecord(item) ? item.path ?? [item.l1, item.l2, item.l3] : item, flavorPaths[category]);
    if (!path) continue;

    const key = path.join('>');
    if (seen.has(key)) continue;

    seen.add(key);
    notes.push({
      path,
      color: beverageFlavorWheels[category].find(node => node.name === path[0])?.color ?? '#888888',
    });

    if (notes.length >= MAX_FLAVOR_NOTES) break;
  }

  return notes;
}

function parseJsonCandidate(raw: string): unknown {
  const trimmed = raw.trim();
  const candidates = [trimmed];
  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fenceMatch = fencePattern.exec(trimmed);

  while (fenceMatch) {
    candidates.push(fenceMatch[1].trim());
    fenceMatch = fencePattern.exec(trimmed);
  }

  const objectStart = trimmed.indexOf('{');
  const objectEnd = trimmed.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    candidates.push(trimmed.slice(objectStart, objectEnd + 1));
  }

  const arrayStart = trimmed.indexOf('[');
  const arrayEnd = trimmed.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    candidates.push(trimmed.slice(arrayStart, arrayEnd + 1));
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next likely JSON span.
    }
  }

  throw new Error('Invalid JSON');
}

function getBeanRecord(parsed: unknown): JsonRecord {
  if (Array.isArray(parsed) && isRecord(parsed[0])) return parsed[0];

  if (isRecord(parsed)) {
    if (isRecord(parsed.bean)) return parsed.bean;
    if (Array.isArray(parsed.beans) && isRecord(parsed.beans[0])) return parsed.beans[0];
    return parsed;
  }

  throw new Error('Invalid bean JSON');
}

export function buildBeanImportPrompt(savedBeans: BeanImportSavedBean[]): string {
  const references = {
    existing_lists: {
      bean_names: limitedUnique(savedBeans.map((bean) => bean.bean_name)),
      roasteries: limitedUnique(savedBeans.map((bean) => bean.roastery)),
      origin_countries: limitedUnique(savedBeans.map((bean) => bean.origin_country)),
      origin_locations: limitedUnique(savedBeans.map((bean) => bean.origin_location)),
      producers: limitedUnique(savedBeans.map((bean) => bean.producer)),
      processes: limitedUnique(savedBeans.map((bean) => bean.process)),
      varietals: limitedUnique(savedBeans.map((bean) => bean.varietal)),
    },
    existing_beans: savedBeans.slice(0, MAX_REFERENCE_BEANS).map(compactBeanReference),
    allowed_sca_flavor_wheel: beverageFlavorWheels.coffee,
  };

  return [
    'You are extracting structured specialty coffee bean information from a coffee bag, label, roaster page screenshot, or product photo.',
    '',
    'Return JSON only. Do not wrap it in prose. Do not use Markdown unless the user explicitly asks for a code block.',
    '',
    'Rules:',
    '- Populate only the JSON fields shown in the required format.',
    '- If a detected roastery, bean name, country, region/location, producer, process, or varietal already appears in the provided existing lists, copy the exact spelling and casing from the list.',
    '- If the detected value is not in the existing lists, output the new value as written on the image.',
    '- Do not invent details that are not visible or strongly implied. Use an empty string for unknown fields.',
    '- roasted_on must be YYYY-MM-DD. If the image has only a partial or ambiguous roast date, leave roasted_on empty and mention the ambiguity in cup_notes.',
    '- cup_notes is free text for tasting notes and extra useful label details.',
    '- cup_flavor_notes must contain at most 5 notes from allowed_sca_flavor_wheel. Each note path can have 1 to 3 levels. Use the top-level color from the wheel.',
    '',
    'Required JSON format:',
    JSON.stringify(BEAN_IMPORT_JSON_FORMAT, null, 2),
    '',
    'Existing BeanLog reference data:',
    JSON.stringify(references, null, 2),
  ].join('\n');
}

export function parseBeanImportJson(raw: string): BeanInput {
  const record = getBeanRecord(parseJsonCandidate(raw));
  if (record.beverage_type != null && record.beverage_type !== 'coffee') throw new Error('Invalid coffee JSON');

  return {
    ...EMPTY_BEAN_IMPORT,
    roastery: toCleanString(record.roastery),
    ...commonFields(record, 'coffee'),
    roasted_on: normalizeDate(record.roasted_on),
  };
}

function commonFields(record: JsonRecord, category: BeverageType) {
  return {
    bean_name: toCleanString(record.bean_name),
    producer: toCleanString(record.producer),
    origin_location: toCleanString(record.origin_location),
    origin_country: toCleanString(record.origin_country),
    process: toCleanString(record.process),
    varietal: toCleanString(record.varietal),
    cup_notes: Array.isArray(record.cup_notes)
      ? record.cup_notes.map(toCleanString).filter(Boolean).join(', ')
      : toCleanString(record.cup_notes),
    cup_flavor_notes: normalizeFlavorNotes(record.cup_flavor_notes, category),
  };
}

export function buildBeverageImportPrompt(category: NonCoffeeBeverage, savedItems: BeanRow[]): string {
  const items = savedItems.filter(row => beverageTypeOf(row) === category);
  const fields = beverageItemFields[category];
  const wheel = beverageFlavorWheels[category];
  const example = wheel[0];
  const textKeys = ['bean_name', 'producer', 'origin_country', 'origin_location', 'varietal'] as const;
  const referenceKeys = category === 'tea' ? [...textKeys, 'process' as const] : textKeys;
  const references = {
    existing_lists: Object.fromEntries(referenceKeys.map(key => [key, limitedUnique(items.map(item => item[key]))])),
    existing_products: items.slice(0, MAX_REFERENCE_BEANS).map(item =>
      Object.fromEntries(referenceKeys.map(key => [key, item[key] ?? '']))),
    allowed_detail_options: Object.fromEntries(fields.flatMap(field => field.options ? [[detailKey(field), field.options]] : [])),
    allowed_flavor_wheel: wheel,
  };
  const format = {
    beverage_type: category,
    ...Object.fromEntries(referenceKeys.map(key => [key, ''])),
    beverage_details: Object.fromEntries(fields.map(field => [detailKey(field), field.numeric ? null : ''])),
    cup_notes: '',
    cup_flavor_notes: [{ path: [example.name, example.children![0].name], color: example.color }],
  };

  return [
    `Extract one ${category} product from the attached photo of its packaging or label. Return one JSON object only, with exactly the fields shown and beverage_type set to "${category}".`,
    '- Put the product name printed on the label in bean_name, and the brand, producer, or estate in producer. Use origin_location for the named region or appellation, not a bottler address.',
    '- If a detected value refers to the same product, producer, origin, variety, or process in the existing lists, copy that spelling and casing. Otherwise use the new value as written on the label. Do not match on similarity alone.',
    '- Extract only information visible in the photo. Leave unknown text empty, unknown numbers null, and cup_flavor_notes as [] when no notes are visible. If the product name is unreadable, leave it empty.',
    category === 'tea'
      ? '- varietal is the tea cultivar, process is the processing method, teaStyle must be an allowed value, and harvest is text as printed (e.g. Spring 2026 or First Flush).'
      : '- varietal is the grape variety or varieties. wineStyle must be an allowed value. Vintage is a 4-digit harvest year; use null for non-vintage or unclear. abv is the printed alcohol percentage as a number without the percent sign.',
    `- cup_notes contains tasting descriptors printed on the label. Map at most ${MAX_FLAVOR_NOTES} of them to paths from allowed_flavor_wheel, using the top-level color. Omit unmappable structured notes; do not invent flavors or copy the example.`,
    '',
    'Required JSON format:',
    JSON.stringify(format, null, 2),
    '',
    'Existing BeanLog reference data:',
    JSON.stringify(references, null, 2),
  ].join('\n');
}

export function parseBeverageImportJson(raw: string, category: NonCoffeeBeverage) {
  const record = getBeanRecord(parseJsonCandidate(raw));
  if (record.beverage_type !== category || !toCleanString(record.bean_name)) throw new Error('Invalid beverage JSON');
  const details: BeverageDetails = {};
  const source = isRecord(record.beverage_details) ? record.beverage_details : {};
  for (const field of beverageItemFields[category]) {
    const key = detailKey(field);
    const rawValue = source[key];
    const value = toCleanString(rawValue);
    if (field.options) {
      const option = field.options.find(candidate => candidate.toLowerCase() === value.toLowerCase());
      if (option) details[key] = option;
    } else if (field.numeric) {
      const [min, max, step] = field.numeric;
      const number = typeof rawValue === 'number' ? rawValue : /^\d+(\.\d+)?$/.test(value) ? Number(value) : NaN;
      if (Number.isFinite(number) && number >= min && number <= max && (step !== 1 || Number.isInteger(number))) details[key] = number;
    } else if (value) details[key] = value;
  }
  const common = commonFields(record, category);
  return { ...common, process: category === 'tea' ? common.process : '', beverage_details: details };
}
