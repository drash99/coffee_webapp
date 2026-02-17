/**
 * Shared formatting and conversion utilities for the logging module.
 *
 * These are pure functions with no side effects or React dependencies.
 * Import from here instead of re-declaring in each page component.
 */

/** Parse a string to a finite number, or return null if empty / invalid. */
export function toNullableNumber(input: string): number | null {
  const v = input.trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Format an ISO date string for display using the browser locale. Returns '' for null/undefined. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

/** Return today's date as `YYYY-MM-DD`. */
export function todayYMD(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Convert an ISO timestamp string to `YYYY-MM-DD`. Returns '' for invalid input. */
export function isoToYmd(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Convert Fahrenheit to Celsius. */
export function fToC(f: number): number {
  return ((f - 32) * 5) / 9;
}

/**
 * Deduplicate strings (case-insensitive), keep the first casing encountered,
 * and sort alphabetically.
 */
export function unique(values: string[]): string[] {
  const map = new Map<string, string>();
  for (const v of values) {
    if (!v) continue;
    const key = v.toLowerCase();
    if (!map.has(key)) map.set(key, v);
  }
  return Array.from(map.values()).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );
}

