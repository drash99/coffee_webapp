/**
 * Consistent bean display label used across all pages (New brew, History, Bean history).
 *
 * Priority: bean_name → roastery → origin_location → origin_country → fallback.
 * Appends roastery and/or origin in parentheses when available.
 */
export function beanDisplayLabel(
  bean: {
    bean_name?: string | null;
    roastery?: string | null;
    origin_location?: string | null;
    origin_country?: string | null;
  },
  fallback: string
): string {
  const title =
    bean.bean_name?.trim() ||
    bean.roastery?.trim() ||
    bean.origin_location?.trim() ||
    bean.origin_country?.trim() ||
    fallback;
  const origin = [bean.origin_location, bean.origin_country].filter(Boolean).join(', ');
  const roastery = bean.roastery?.trim();
  if (roastery && origin) return `${title} — ${roastery} (${origin})`;
  if (roastery) return `${title} — ${roastery}`;
  if (origin) return `${title} (${origin})`;
  return title;
}

