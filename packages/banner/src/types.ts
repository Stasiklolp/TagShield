// Shared contract between the banner runtime and the edge Worker (GET /config/:key).
// Keep this tiny and stable — it is the wire format served from the edge cache.

/** The consent regime resolved server-side from the visitor's region. */
export type Regime =
  | 'opt_in' // EEA/UK/CH, Brazil, etc. — block non-essential tags until explicit opt-in
  | 'opt_out_gpc' // US states with binding GPC (CA, CO, CT, ...) — default allow, honor opt-out/GPC
  | 'notice'; // rest-of-US — notice only, default allow

/** Cookie/processing categories the banner can toggle. */
export type Category = 'necessary' | 'analytics' | 'marketing' | 'functional';

/** Google Consent Mode v2 signal map. */
export interface ConsentModeSignals {
  ad_storage: 'granted' | 'denied';
  analytics_storage: 'granted' | 'denied';
  ad_user_data: 'granted' | 'denied';
  ad_personalization: 'granted' | 'denied';
}

/** Per-site config compiled at the edge and returned by GET /config/:key. */
export interface SiteConfig {
  key: string;
  /** Resolved for THIS visitor by the edge (so the client ships no 50-state logic). */
  regime: Regime;
  /** Whether GPC is legally binding for this visitor's region. */
  gpcBinding: boolean;
  /** Show a "Do Not Sell or Share" link (US opt-out states). */
  doNotSell: boolean;
  /** Show the California Jan-1-2026 "Opt-Out Request Honored" acknowledgement. */
  showOptOutHonored: boolean;
  /** Banner copy (already localized at the edge). */
  copy: {
    title: string;
    body: string;
    accept: string;
    reject: string;
    prefs: string;
    save: string;
    optOutHonored: string;
    doNotSellLabel: string;
  };
  /** Theme tokens (kept minimal — the perf budget is sacred). */
  theme: {
    bg: string;
    fg: string;
    accent: string;
    position: 'bottom' | 'top' | 'corner';
    radius: number;
  };
  /** Categories offered in the preferences panel. */
  categories: Category[];
  /** Branding badge shown on the free tier (removable on paid). */
  showBadge: boolean;
}

/** What the banner stores in localStorage and beacons to POST /c. */
export interface ConsentDecision {
  v: 1;
  key: string;
  /** category -> granted? */
  cats: Record<Category, boolean>;
  signals: ConsentModeSignals;
  source: 'banner_accept' | 'banner_reject' | 'banner_save' | 'gpc' | 'auto_notice';
  gpc: boolean;
  ts: number;
  /** banner config version the visitor actually saw (for the audit trail). */
  cfgv: string;
}
