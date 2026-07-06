import type { CookieRule } from './types';

/**
 * Seed cookie rules covering the highest-frequency trackers. In production, import the full
 * Open Cookie Database (https://github.com/jkwakman/Open-Cookie-Database) into this shape and/or
 * the `cookie_definitions` table — this seed is the deterministic fallback, no LLM involved.
 */
export const DEFAULT_RULES: CookieRule[] = [
  // Google Analytics / GA4
  { pattern: '_ga', category: 'analytics', vendor: 'Google Analytics' },
  { pattern: '_ga_*', category: 'analytics', vendor: 'Google Analytics 4' },
  { pattern: '_gid', category: 'analytics', vendor: 'Google Analytics' },
  { pattern: '_gat*', category: 'analytics', vendor: 'Google Analytics' },
  { pattern: '_gac_*', category: 'marketing', vendor: 'Google Ads' },
  { pattern: '__utm*', category: 'analytics', vendor: 'Google Analytics (legacy)' },
  // Google Ads / DoubleClick
  { pattern: '_gcl_*', category: 'marketing', vendor: 'Google Ads' },
  { pattern: 'IDE', category: 'marketing', vendor: 'Google DoubleClick' },
  { pattern: 'test_cookie', category: 'marketing', vendor: 'Google DoubleClick' },
  { pattern: 'NID', category: 'marketing', vendor: 'Google' },
  { pattern: '1P_JAR', category: 'marketing', vendor: 'Google' },
  // Meta / Facebook
  { pattern: '_fbp', category: 'marketing', vendor: 'Meta Pixel' },
  { pattern: 'fr', category: 'marketing', vendor: 'Meta' },
  { pattern: '_fbc', category: 'marketing', vendor: 'Meta Pixel' },
  // Analytics vendors
  { pattern: '_hjSession*', category: 'analytics', vendor: 'Hotjar' },
  { pattern: '_hj*', category: 'analytics', vendor: 'Hotjar' },
  { pattern: 'ajs_*', category: 'analytics', vendor: 'Segment' },
  { pattern: 'mp_*', category: 'analytics', vendor: 'Mixpanel' },
  { pattern: 'amplitude_*', category: 'analytics', vendor: 'Amplitude' },
  { pattern: '_clck', category: 'analytics', vendor: 'Microsoft Clarity' },
  { pattern: '_clsk', category: 'analytics', vendor: 'Microsoft Clarity' },
  // Marketing / other
  { pattern: 'li_*', category: 'marketing', vendor: 'LinkedIn' },
  { pattern: 'personalization_id', category: 'marketing', vendor: 'Twitter/X' },
  { pattern: 'ttp', category: 'marketing', vendor: 'TikTok' },
  // Necessary / session / security
  { pattern: 'PHPSESSID', category: 'necessary', vendor: 'PHP' },
  { pattern: 'JSESSIONID', category: 'necessary', vendor: 'Java' },
  { pattern: 'ASP.NET_SessionId', category: 'necessary', vendor: 'ASP.NET' },
  { pattern: 'csrftoken', category: 'necessary' },
  { pattern: 'XSRF-TOKEN', category: 'necessary' },
  { pattern: '__cf_bm', category: 'necessary', vendor: 'Cloudflare' },
  { pattern: 'cf_clearance', category: 'necessary', vendor: 'Cloudflare' },
  { pattern: 'wordpress_*', category: 'necessary', vendor: 'WordPress' },
  { pattern: 'wp-settings-*', category: 'functional', vendor: 'WordPress' },
  { pattern: 'woocommerce_*', category: 'functional', vendor: 'WooCommerce' },
  // Functional
  { pattern: 'ts:*', category: 'functional', vendor: 'Tagshield' },
];
