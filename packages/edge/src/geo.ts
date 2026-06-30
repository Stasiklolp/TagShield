/**
 * Region -> consent regime resolution, done at the EDGE so the client ships zero 50-state logic.
 *
 * Cloudflare provides request.cf.country (ISO-3166-1 alpha-2) for free, and request.cf.regionCode
 * (e.g. "CA", "TX") for many countries including the US. We resolve a coarse regime here and let
 * the per-site config + jurisdiction_rules table carry the detail.
 *
 * This is a deliberately CONSERVATIVE default: unknown -> opt_in (strictest), so an omission fails
 * safe toward over-compliance, never under. Keep the law detail in the DB `jurisdiction_rules`
 * table (and ideally a licensed legal feed) — this file is just the bucket router.
 */
import type { Regime } from '@tagshield/banner/src/types';

// EEA + UK + Switzerland + a few opt-in-style regimes (GDPR/LGPD-like prior consent).
const OPT_IN_COUNTRIES = new Set([
  // EEA
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IS', 'IE',
  'IT', 'LV', 'LI', 'LT', 'LU', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  // UK + Switzerland + Brazil (LGPD treated opt-in-ish, conservative)
  'GB', 'CH', 'BR',
]);

// US states with comprehensive privacy laws + binding universal opt-out (GPC) as of 2026.
// (Expand from the jurisdiction_rules table; this set drives the coarse regime only.)
const US_GPC_OPT_OUT_STATES = new Set([
  'CA', 'CO', 'CT', 'OR', 'TX', 'MT', 'DE', 'NE', 'NH', 'NJ', 'MN', 'MD',
]);

export interface GeoInput {
  country?: string; // request.cf.country
  region?: string; // request.cf.regionCode (US state code, etc.)
}

export function resolveRegime(geo: GeoInput): {
  regime: Regime;
  gpcBinding: boolean;
  doNotSell: boolean;
  showOptOutHonored: boolean;
} {
  const country = (geo.country || '').toUpperCase();
  const region = (geo.region || '').toUpperCase();

  if (OPT_IN_COUNTRIES.has(country)) {
    return { regime: 'opt_in', gpcBinding: false, doNotSell: false, showOptOutHonored: false };
  }

  if (country === 'US') {
    if (US_GPC_OPT_OUT_STATES.has(region)) {
      return {
        regime: 'opt_out_gpc',
        gpcBinding: true,
        doNotSell: true,
        // California requires visibly confirming an honored opt-out (Jan 1 2026).
        showOptOutHonored: region === 'CA',
      };
    }
    // Rest of the US: notice-only.
    return { regime: 'notice', gpcBinding: false, doNotSell: false, showOptOutHonored: false };
  }

  // Unknown / everywhere else: fail safe to strictest (opt-in/block).
  return { regime: 'opt_in', gpcBinding: false, doNotSell: false, showOptOutHonored: false };
}
