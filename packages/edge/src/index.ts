/**
 * Tagshield edge Worker.
 *
 * Routes:
 *   GET  /b.js            -> the static, edge-cached banner bundle (served from KV/R2)
 *   GET  /config/:key     -> resolve the visitor's region and return a SiteConfig (edge-cacheable)
 *   POST /c               -> consent beacon: validate + enqueue (returns instantly, never blocks)
 *   GET  /verify/:key     -> walk a site's hash chain and report integrity (admin/proof use)
 *
 * Queue consumer: drains consent events, computes the per-site hash chain, persists to Postgres.
 *
 * The hot path (banner + beacon) NEVER touches the relational DB synchronously — that's how this
 * stays cheap and fast at scale.
 */
import type { SiteConfig } from '@tagshield/banner/src/types';
import { resolveRegime } from './geo';
import { appendToChain, GENESIS, verifyChain, type ChainedRecord } from './hashchain';

export interface Env {
  BANNER: KVNamespace; // holds the built b.js bundle under key "b.js"
  SITES: KVNamespace; // per-site compiled config + chain heads
  CONSENT_QUEUE: Queue<ConsentEvent>;
  DB_URL: string; // Postgres (via Hyperdrive binding in production)
}

interface ConsentEvent {
  v: 1;
  key: string;
  cats: Record<string, boolean>;
  signals: Record<string, string>;
  source: string;
  gpc: boolean;
  ts: number;
  cfgv: string;
  // attached at the edge:
  region?: string;
  country?: string;
  ua_hash?: string;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

const cors = (origin: string | null): Record<string, string> => ({
  // CMPs are embedded cross-origin on customer sites; allow any origin for the public endpoints.
  'access-control-allow-origin': origin || '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
});

async function hashUA(ua: string, ip: string): Promise<string> {
  // Salted pseudonymous visitor id — never store raw IP/UA. (Salt should come from a secret.)
  const data = new TextEncoder().encode(`${ua}|${ip}|tagshield-salt`);
  const d = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(d)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const origin = req.headers.get('origin');

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: cors(origin) });
    }

    // --- GET /b.js : static banner bundle (long cache) ---
    if (url.pathname === '/b.js') {
      const js = await env.BANNER.get('b.js');
      if (!js) return new Response('// banner not deployed', { status: 503 });
      return new Response(js, {
        headers: {
          'content-type': 'application/javascript; charset=utf-8',
          'cache-control': 'public, max-age=300, s-maxage=86400',
          ...cors(origin),
        },
      });
    }

    // --- GET /config/:key : per-visitor resolved config ---
    const cfgMatch = url.pathname.match(/^\/config\/([A-Za-z0-9_-]+)$/);
    if (cfgMatch && req.method === 'GET') {
      const key = cfgMatch[1];
      const cf = (req as unknown as { cf?: IncomingRequestCfProperties }).cf;
      const geo = resolveRegime({ country: cf?.country, region: (cf as { regionCode?: string })?.regionCode });
      const cfg = await buildSiteConfig(env, key, geo);
      if (!cfg) return new Response('{"error":"unknown site"}', { status: 404, headers: { ...JSON_HEADERS, ...cors(origin) } });
      return new Response(JSON.stringify(cfg), {
        headers: {
          ...JSON_HEADERS,
          // Cache per-region at the edge; short TTL so config edits propagate fast.
          'cache-control': 'public, max-age=60',
          ...cors(origin),
        },
      });
    }

    // --- POST /c : consent beacon -> enqueue ---
    if (url.pathname === '/c' && req.method === 'POST') {
      let body: ConsentEvent;
      try {
        body = (await req.json()) as ConsentEvent;
      } catch {
        return new Response('bad request', { status: 400, headers: cors(origin) });
      }
      if (!body || body.v !== 1 || !body.key) {
        return new Response('bad request', { status: 400, headers: cors(origin) });
      }
      const cf = (req as unknown as { cf?: IncomingRequestCfProperties }).cf;
      const ip = req.headers.get('cf-connecting-ip') || '';
      const ua = req.headers.get('user-agent') || '';
      // TODO: drop known-bot UAs here so they never count as a billable visitor or pollute the vault.
      body.country = cf?.country;
      body.region = (cf as { regionCode?: string })?.regionCode;
      body.ua_hash = await hashUA(ua, ip);
      await env.CONSENT_QUEUE.send(body);
      // 204, fire-and-forget. The visitor's page never waits on persistence.
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    // --- GET /verify/:key : integrity check (admin/proof) ---
    const verMatch = url.pathname.match(/^\/verify\/([A-Za-z0-9_-]+)$/);
    if (verMatch && req.method === 'GET') {
      // In production this reads the ordered chain from Postgres. Stubbed for the skeleton.
      const records: ChainedRecord[] = []; // load from DB ordered by id ASC
      const result = await verifyChain(records);
      return new Response(JSON.stringify(result), { headers: { ...JSON_HEADERS, ...cors(origin) } });
    }

    // --- GET /scan?url= : free Consent Mode v2 checker (server-side fetch + heuristics) ---
    if (url.pathname === '/scan' && req.method === 'GET') {
      const result = await scanUrl(url.searchParams.get('url') || '');
      return new Response(JSON.stringify(result), {
        headers: { ...JSON_HEADERS, 'cache-control': 'no-store', ...cors(origin) },
      });
    }

    return new Response('not found', { status: 404, headers: cors(origin) });
  },

  // --- Queue consumer: build the per-site hash chain and persist ---
  async queue(batch: MessageBatch<ConsentEvent>, env: Env): Promise<void> {
    // Group by site so each site's chain is appended in order.
    const bySite = new Map<string, ConsentEvent[]>();
    for (const msg of batch.messages) {
      const arr = bySite.get(msg.body.key) || [];
      arr.push(msg.body);
      bySite.set(msg.body.key, arr);
    }

    for (const [key, events] of bySite) {
      // Per-site chain head. NOTE: KV is eventually consistent — for strict ordering under high
      // concurrency, use a Durable Object per site as the head authority. KV is fine to start.
      const headKey = `head:${key}`;
      let head = (await env.SITES.get(headKey)) || GENESIS;

      const rows: ChainedRecord[] = [];
      for (const e of events) {
        const record = {
          site_key: e.key,
          visitor_pseudo_id: e.ua_hash,
          consent_state: e.signals,
          signal_source: e.source,
          gpc_present: e.gpc,
          banner_config_version: e.cfgv,
          region_code: e.region,
          ip_country: e.country,
          created_at: new Date(e.ts).toISOString(),
        };
        const { chained, head: newHead } = await appendToChain(record, head);
        rows.push(chained);
        head = newHead;
      }

      await persistConsentRows(env, key, rows);
      await env.SITES.put(headKey, head);
    }
  },
} satisfies ExportedHandler<Env>;

// ─────────────────────────────────────────────────────────────────────────────
// Free Consent Mode v2 checker: fetch a URL server-side (no CORS) and run heuristics.
// Mirrors scripts/serve.py's /scan so the local dev server and production behave the same.
// ─────────────────────────────────────────────────────────────────────────────
interface ScanCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail' | 'info';
  detail: string;
}

const CMP_VENDORS: [string, string][] = [
  ['cookiebot', 'Cookiebot'], ['otsdkstub', 'OneTrust'], ['onetrust', 'OneTrust'],
  ['usercentrics', 'Usercentrics'], ['cookieyes', 'CookieYes'], ['termly', 'Termly'],
  ['iubenda', 'iubenda'], ['osano', 'Osano'], ['enzuzo', 'Enzuzo'], ['didomi', 'Didomi'],
  ['trustarc', 'TrustArc'], ['quantcast', 'Quantcast'], ['complianz', 'Complianz'],
  ['klaro', 'Klaro'], ['cookieconsent', 'CookieConsent'], ['tagshield', 'Tagshield'],
];

function analyzeHtml(finalUrl: string, html: string): { url: string; checks: ScanCheck[] } {
  const h = html.toLowerCase();
  const norm = h.replace(/\s+/g, '').replace(/"/g, "'");
  const hasGoogle = ['googletagmanager.com/gtm.js', 'gtag/js', 'google-analytics.com', 'gtag('].some((s) => h.includes(s));
  const hasConsent = ["gtag('consent','default'", "gtag('consent','update'", "'consent','default'", "'consent','update'", 'consentmode'].some((s) => norm.includes(s));
  const hasV2 = h.includes('ad_user_data') && h.includes('ad_personalization');
  const vendor = CMP_VENDORS.find(([k]) => h.includes(k));
  const secure = finalUrl.startsWith('https://');

  const checks: ScanCheck[] = [];
  checks.push({ id: 'https', label: 'HTTPS', status: secure ? 'pass' : 'warn', detail: secure ? 'Served securely.' : 'Not secure — HTTPS is required for modern cookies.' });
  checks.push(hasGoogle
    ? { id: 'google', label: 'Google tags detected', status: 'pass', detail: 'Google Ads / GA4 / Tag Manager found on the page.' }
    : { id: 'google', label: 'Google Ads / GA4', status: 'info', detail: 'No Google tags detected — Consent Mode may not apply here.' });
  if (hasGoogle && hasConsent) checks.push({ id: 'consent', label: 'Consent Mode active', status: 'pass', detail: 'A Consent Mode default/update was detected.' });
  else if (hasGoogle && !hasConsent) checks.push({ id: 'consent', label: 'Consent Mode missing', status: 'fail', detail: 'Google tags fire with no Consent Mode — EU ads/measurement may be degraded or non-compliant.' });
  if (hasConsent && hasV2) checks.push({ id: 'v2', label: 'Consent Mode v2 parameters', status: 'pass', detail: 'ad_user_data and ad_personalization are present.' });
  else if (hasConsent && !hasV2) checks.push({ id: 'v2', label: 'Consent Mode v2 parameters', status: 'warn', detail: 'ad_user_data / ad_personalization not found — upgrade to v2.' });
  checks.push(vendor
    ? { id: 'cmp', label: 'Consent banner (CMP)', status: 'pass', detail: `Detected: ${vendor[1]}.` }
    : { id: 'cmp', label: 'Consent banner (CMP)', status: 'warn', detail: 'No consent banner / CMP detected on the page.' });
  return { url: finalUrl, checks };
}

async function scanUrl(target: string): Promise<{ url: string; checks: ScanCheck[] }> {
  if (!target) return { url: '', checks: [{ id: 'reach', label: 'Missing URL', status: 'fail', detail: 'Provide a ?url= to scan.' }] };
  let u = target;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try {
    new URL(u);
  } catch {
    return { url: target, checks: [{ id: 'reach', label: 'Invalid URL', status: 'fail', detail: "That doesn't look like a valid website address." }] };
  }
  try {
    const res = await fetch(u, { headers: { 'user-agent': 'TagshieldScanner/1.0 (+https://tagshield.io)' }, redirect: 'follow' });
    const html = (await res.text()).slice(0, 700_000);
    return analyzeHtml(res.url || u, html);
  } catch {
    return { url: u, checks: [{ id: 'reach', label: "Couldn't load the site", status: 'fail', detail: "We couldn't fetch this URL. Check the address and try again." }] };
  }
}

/**
 * Compose the SiteConfig returned to the banner. In production, the per-site copy/theme/categories
 * come from the compiled blob in KV (SITES.get(`cfg:${key}`)); the regime is resolved live. Here we
 * merge a sensible default so the skeleton works end-to-end.
 */
async function buildSiteConfig(
  env: Env,
  key: string,
  geo: ReturnType<typeof resolveRegime>,
): Promise<SiteConfig | null> {
  const blob = await env.SITES.get(`cfg:${key}`, 'json');
  if (blob === null && key !== 'demo') {
    // Unknown site (and not the built-in demo key).
    return null;
  }
  const site = (blob as Partial<SiteConfig> | null) || {};
  const cfg: SiteConfig = {
    key,
    regime: geo.regime,
    gpcBinding: geo.gpcBinding,
    doNotSell: geo.doNotSell,
    showOptOutHonored: geo.showOptOutHonored,
    copy: {
      title: 'We value your privacy',
      body: 'We use cookies to run ads and measure traffic. Choose what you allow.',
      accept: 'Accept all',
      reject: 'Reject all',
      prefs: 'Preferences',
      save: 'Save choices',
      optOutHonored: 'Opt-Out Request Honored',
      doNotSellLabel: 'Do Not Sell or Share My Info',
      ...(site.copy || {}),
    },
    theme: {
      bg: '#0f1115',
      fg: '#f4f5f7',
      accent: '#3b82f6',
      position: 'bottom',
      radius: 10,
      ...(site.theme || {}),
    },
    categories: site.categories || ['necessary', 'analytics', 'marketing', 'functional'],
    showBadge: site.showBadge ?? true,
  };
  // Stamp the config version so the consent record can prove which banner text was shown.
  (cfg as unknown as { cfgv: string }).cfgv = (site as { cfgv?: string }).cfgv || '1';
  return cfg;
}

/**
 * Persist chained consent rows to Postgres (partitioned consent_logs). Wire this to your Postgres
 * client over a Hyperdrive binding. Left as a clearly-marked stub so the skeleton compiles without
 * a DB driver. See db/schema.sql for the target table.
 */
async function persistConsentRows(_env: Env, _siteKey: string, rows: ChainedRecord[]): Promise<void> {
  // Example (pseudo): INSERT INTO consent_logs (...) VALUES ... using a batched multi-row insert.
  // For Workers, use a Postgres-over-HTTP driver (Neon serverless / Supabase) or Hyperdrive + pg.
  if (rows.length) {
    // eslint-disable-next-line no-console
    console.log(`persist ${rows.length} consent rows for ${_siteKey}`);
  }
}
