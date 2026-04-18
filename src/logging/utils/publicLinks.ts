export type RouteLocation = Pick<Location, 'pathname' | 'search' | 'hash'>;
const DEFAULT_PUBLIC_WEB_BASE_URL = 'https://drash99.github.io/';
const LABEL_PUBLIC_BASE_URL_KEY = 'beanlog.labels.publicBaseUrl';

export function parseSharedTokenFromLocation(loc: RouteLocation): string | null {
  const fromQuery = new URLSearchParams(loc.search).get('share')?.trim() ?? '';
  if (fromQuery) return fromQuery;

  const fromHash = new URLSearchParams(loc.hash.startsWith('#') ? loc.hash.slice(1) : loc.hash).get('share')?.trim() ?? '';
  if (fromHash) return fromHash;

  const match = loc.pathname.match(/^\/share\/([^/]+)\/?$/);
  return match?.[1] ?? null;
}

export function parseLabelUidFromLocation(loc: RouteLocation): string | null {
  const fromQuery = new URLSearchParams(loc.search).get('label')?.trim() ?? '';
  if (fromQuery) return fromQuery;

  const fromHash = new URLSearchParams(loc.hash.startsWith('#') ? loc.hash.slice(1) : loc.hash).get('label')?.trim() ?? '';
  if (fromHash) return fromHash;

  const match = loc.pathname.match(/^\/(?:label|l)\/([^/]+)\/?$/);
  return match?.[1] ?? null;
}

export function buildPublicBrewShareUrl(shareToken: string): string {
  return buildPublicPageUrl('share.html', 'share', shareToken);
}

export function buildPublicBeanLabelUrl(labelUid: string): string {
  return buildPublicPageUrl('label.html', 'label', labelUid);
}

function buildPublicPageUrl(pageName: string, queryKey: string, rawValue: string): string {
  const value = rawValue.trim();
  const baseUrl = getPublicWebBaseUrl();

  try {
    const url = new URL(pageName, ensureTrailingSlash(baseUrl));
    url.searchParams.set(queryKey, value);
    return url.toString();
  } catch {
    return `${DEFAULT_PUBLIC_WEB_BASE_URL.replace(/\/+$/, '')}/${pageName}?${queryKey}=${encodeURIComponent(value)}`;
  }
}

function getPublicWebBaseUrl(): string {
  try {
    const stored = normalizeBaseUrl(localStorage.getItem(LABEL_PUBLIC_BASE_URL_KEY) || '');
    return stored || DEFAULT_PUBLIC_WEB_BASE_URL;
  } catch {
    return DEFAULT_PUBLIC_WEB_BASE_URL;
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return ensureTrailingSlash(new URL(ensureTrailingSlash(trimmed)).toString());
  } catch {
    return '';
  }
}
