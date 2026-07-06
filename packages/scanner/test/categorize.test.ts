import { describe, it, expect } from 'vitest';
import { categorize } from '../src/categorize';
import { DEFAULT_RULES } from '../src/rules';

describe('categorize', () => {
  it('matches an exact analytics cookie', () => {
    expect(categorize('_gid', DEFAULT_RULES).category).toBe('analytics');
  });

  it('matches a GA4 wildcard cookie (_ga_XXXX)', () => {
    const r = categorize('_ga_AB12CD34', DEFAULT_RULES);
    expect(r.category).toBe('analytics');
    expect(r.vendor).toBe('Google Analytics 4');
  });

  it('classifies a marketing pixel', () => {
    expect(categorize('_fbp', DEFAULT_RULES).category).toBe('marketing');
  });

  it('classifies session/security cookies as necessary', () => {
    expect(categorize('PHPSESSID', DEFAULT_RULES).category).toBe('necessary');
    expect(categorize('__cf_bm', DEFAULT_RULES).category).toBe('necessary');
  });

  it('exact match wins over a shorter wildcard', () => {
    // "_ga" exact is analytics; ensure it is not shadowed by any prefix rule.
    expect(categorize('_ga', DEFAULT_RULES).vendor).toBe('Google Analytics');
  });

  it('is case-insensitive', () => {
    expect(categorize('phpsessid', DEFAULT_RULES).category).toBe('necessary');
  });

  it('returns unclassified for unknown cookies (for one-click manual assignment)', () => {
    expect(categorize('some_random_app_cookie', DEFAULT_RULES).category).toBe('unclassified');
  });
});
