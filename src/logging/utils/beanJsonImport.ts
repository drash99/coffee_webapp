import { getTopLevelColor, SCA_FLAVOR_WHEEL } from '../scaFlavorWheel';
import type { BeanInput, FlavorNote } from '../types';
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

const ALL_FLAVOR_PATHS = flattenFlavorPaths();

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

function flattenFlavorPaths(): string[][] {
  const paths: string[][] = [];

  for (const top of SCA_FLAVOR_WHEEL) {
    paths.push([top.name]);
    for (const mid of top.children ?? []) {
      paths.push([top.name, mid.name]);
      for (const leaf of mid.children ?? []) {
        paths.push([top.name, mid.name, leaf.name]);
      }
    }
  }

  return paths;
}

function samePath(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((part, index) => part.toLowerCase() === b[index].toLowerCase());
}

function hasSuffix(path: string[], suffix: string[]): boolean {
  if (suffix.length > path.length) return false;
  const offset = path.length - suffix.length;
  return suffix.every((part, index) => part.toLowerCase() === path[index + offset].toLowerCase());
}

function normalizeFlavorPath(rawPath: unknown): string[] | null {
  const parts = Array.isArray(rawPath)
    ? rawPath.map(toCleanString).filter(Boolean).slice(0, 3)
    : toCleanString(rawPath)
        .split(/[>/,|]+/)
        .map((part) => part.trim())
        .filter(Boolean)
        .slice(0, 3);

  if (parts.length === 0) return null;

  const exact = ALL_FLAVOR_PATHS.find((path) => samePath(path, parts));
  if (exact) return exact;

  const suffixMatches = ALL_FLAVOR_PATHS.filter((path) => hasSuffix(path, parts));
  return suffixMatches.length === 1 ? suffixMatches[0] : null;
}

function normalizeFlavorNotes(value: unknown): FlavorNote[] {
  if (!Array.isArray(value)) return [];

  const notes: FlavorNote[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    const path = isRecord(item) ? normalizeFlavorPath(item.path ?? [item.l1, item.l2, item.l3]) : normalizeFlavorPath(item);
    if (!path) continue;

    const key = path.join('>');
    if (seen.has(key)) continue;

    seen.add(key);
    notes.push({
      path,
      color: getTopLevelColor(path[0] ?? ''),
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
    allowed_sca_flavor_wheel: SCA_FLAVOR_WHEEL,
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

  return {
    ...EMPTY_BEAN_IMPORT,
    bean_name: toCleanString(record.bean_name),
    roastery: toCleanString(record.roastery),
    producer: toCleanString(record.producer),
    origin_location: toCleanString(record.origin_location),
    origin_country: toCleanString(record.origin_country),
    process: toCleanString(record.process),
    varietal: toCleanString(record.varietal),
    cup_notes: Array.isArray(record.cup_notes)
      ? record.cup_notes.map(toCleanString).filter(Boolean).join(', ')
      : toCleanString(record.cup_notes),
    cup_flavor_notes: normalizeFlavorNotes(record.cup_flavor_notes),
    roasted_on: normalizeDate(record.roasted_on),
  };
}
