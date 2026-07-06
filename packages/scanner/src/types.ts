export type CookieCategory =
  | 'necessary'
  | 'analytics'
  | 'marketing'
  | 'functional'
  | 'unclassified';

export interface CookieRule {
  /** Cookie name, or a `prefix*` pattern when `wildcard` is set (or the pattern ends with `*`). */
  pattern: string;
  category: CookieCategory;
  vendor?: string;
  wildcard?: boolean;
}

export interface CapturedCookie {
  name: string;
  domain: string;
}

export interface CategorizedCookie extends CapturedCookie {
  category: CookieCategory;
  vendor?: string;
}

export interface CrawlResult {
  cookies: CapturedCookie[];
  localStorageKeys: string[];
  networkDomains: string[];
}
