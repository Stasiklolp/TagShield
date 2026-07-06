import type { CookieCategory, CookieRule } from './types';

const isWildcard = (r: CookieRule) => r.wildcard === true || r.pattern.endsWith('*');

/**
 * Deterministically categorize a cookie by name (no LLM). Exact matches win; otherwise the
 * longest matching wildcard prefix wins; otherwise 'unclassified' (surfaced in the dashboard for
 * a one-click manual assignment). Feed it the Open Cookie Database rules for broad coverage.
 */
export function categorize(
  name: string,
  rules: CookieRule[],
): { category: CookieCategory; vendor?: string } {
  const n = name.toLowerCase();

  for (const r of rules) {
    if (!isWildcard(r) && r.pattern.toLowerCase() === n) {
      return { category: r.category, vendor: r.vendor };
    }
  }

  let best: CookieRule | undefined;
  let bestLen = -1;
  for (const r of rules) {
    if (!isWildcard(r)) continue;
    const prefix = r.pattern.toLowerCase().replace(/\*+$/, '');
    if (n.startsWith(prefix) && prefix.length > bestLen) {
      best = r;
      bestLen = prefix.length;
    }
  }
  return best ? { category: best.category, vendor: best.vendor } : { category: 'unclassified' };
}
