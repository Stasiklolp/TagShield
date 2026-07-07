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
import { isBot } from './bots';
import {
  chainStats,
  dbConfigured,
  insertConsentLogs,
  loadChain,
  resolveSiteId,
  upsertAnchor,
  type ConsentLogRow,
} from './db';
import { buildProofBundle, bundleToCsv, VERIFIER_JS } from './export';
import { resolveRegime } from './geo';
import { rateLimited } from './guard';
import { appendToChain, GENESIS, verifyCanonicalChain } from './hashchain';

export interface Env {
  BANNER: KVNamespace; // holds the built b.js bundle under key "b.js"
  SITES: KVNamespace; // per-site compiled config + chain heads
  CONSENT_QUEUE: Queue<ConsentEvent>;
  VAULT?: R2Bucket; // immutable daily anchor objects (object-lock)
  // Vault storage (Supabase PostgREST). Set as Worker secrets; see src/db.ts.
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
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

const json = (data: unknown, status: number, origin: string | null): Response =>
  new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...cors(origin) } });

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
      // Bots never saw a banner and never chose — keep them out of billing and the vault.
      // Return the same 204 so a crawler gets no signal that it was filtered.
      if (isBot(ua)) {
        return new Response(null, { status: 204, headers: cors(origin) });
      }
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
      if (!dbConfigured(env)) {
        return json({ ok: false, error: 'vault storage not configured' }, 503, origin);
      }
      const siteId = await resolveSiteId(env, verMatch[1]);
      if (!siteId) return json({ ok: false, error: 'unknown site' }, 404, origin);
      const rows = await loadChain(env, siteId);
      const result = await verifyCanonicalChain(rows);
      return json({ site: verMatch[1], count: rows.length, ...result }, result.ok ? 200 : 422, origin);
    }

    // --- GET /export/:key[/verifier.js] : portable Consent Proof bundle + offline verifier ---
    const expMatch = url.pathname.match(/^\/export\/([A-Za-z0-9_-]+)(?:\/(verifier\.js))?$/);
    if (expMatch && req.method === 'GET') {
      if (expMatch[2] === 'verifier.js') {
        return new Response(VERIFIER_JS, {
          headers: {
            'content-type': 'application/javascript; charset=utf-8',
            'content-disposition': 'attachment; filename="verify.js"',
            ...cors(origin),
          },
        });
      }
      if (!dbConfigured(env)) {
        return json({ ok: false, error: 'vault storage not configured' }, 503, origin);
      }
      const siteId = await resolveSiteId(env, expMatch[1]);
      if (!siteId) return json({ ok: false, error: 'unknown site' }, 404, origin);
      const rows = await loadChain(env, siteId);
      const bundle = await buildProofBundle(expMatch[1], rows, new Date().toISOString());
      if (url.searchParams.get('format') === 'csv') {
        return new Response(bundleToCsv(bundle), {
          headers: {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': `attachment; filename="tagshield-consent-proof-${expMatch[1]}.csv"`,
            ...cors(origin),
          },
        });
      }
      return new Response(JSON.stringify(bundle, null, 2), {
        headers: {
          ...JSON_HEADERS,
          'content-disposition': `attachment; filename="tagshield-consent-proof-${expMatch[1]}.json"`,
          ...cors(origin),
        },
      });
    }

    // --- GET /scan?url= : free Consent Mode v2 checker (server-side fetch + heuristics) ---
    if (url.pathname === '/scan' && req.method === 'GET') {
      const ip = req.headers.get('cf-connecting-ip') || '';
      if (await rateLimited(env.SITES, 'scan', ip, 10, 60)) {
        return json({ error: 'Too many scans — please try again in a minute.' }, 429, origin);
      }
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
      const siteId = await resolveSiteId(env, key);
      if (!siteId) {
        // Unknown site key: nothing to attribute the chain to. Drop rather than corrupt a chain.
        console.warn(`[vault] unknown site key "${key}" — ${events.length} event(s) dropped`);
        continue;
      }
      // Per-site chain head, keyed by internal uuid. NOTE: KV is eventually consistent — for strict
      // ordering under high concurrency, promote the head to a Durable Object per site.
      const headKey = `head:${siteId}`;
      let head = (await env.SITES.get(headKey)) || GENESIS;

      const rows: ConsentLogRow[] = [];
      for (const e of events) {
        // The exact object the hash commits to; typed columns are stored alongside for querying.
        const record = {
          site_id: siteId,
          visitor_pseudo_id: e.ua_hash ?? '',
          consent_state: e.signals,
          signal_source: e.source,
          gpc_present: e.gpc,
          banner_config_version: e.cfgv,
          region_code: e.region ?? null,
          ip_country: e.country ?? null,
          created_at: new Date(e.ts).toISOString(),
        };
        const { chained, head: newHead, canonical } = await appendToChain(record, head);
        rows.push({
          ...record,
          user_agent_hash: e.ua_hash ?? null,
          prev_hash: chained.prev_hash,
          record_hash: chained.record_hash,
          canonical,
        });
        head = newHead;
      }

      await insertConsentLogs(env, rows);
      await env.SITES.put(headKey, head);
    }
  },

  // --- Cron: snapshot every active site's chain head into an immutable daily anchor ---
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const date = new Date(controller.scheduledTime).toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    let cursor: string | undefined;
    do {
      const list = await env.SITES.list({ prefix: 'head:', cursor });
      for (const k of list.keys) {
        await anchorSite(env, k.name.slice('head:'.length), date);
      }
      cursor = list.list_complete ? undefined : list.cursor;
    } while (cursor);
  },
} satisfies ExportedHandler<Env>;

/**
 * Write one site's daily anchor: an immutable R2 object recording the chain head + record count,
 * plus a row in vault_anchors. With R2 Object Lock enabled on the bucket, the object cannot be
 * altered or deleted for its retention period — so even the operator can't silently rewrite
 * history. This is the external witness that makes "tamper-proof" true, not just "tamper-evident".
 */
async function anchorSite(env: Env, siteId: string, date: string): Promise<void> {
  const head = (await env.SITES.get(`head:${siteId}`)) || GENESIS;
  let count = 0;
  if (dbConfigured(env)) {
    try {
      count = (await chainStats(env, siteId)).count;
    } catch {
      /* best-effort: still anchor the head even if the count read fails */
    }
  }

  const objectKey = `anchors/${siteId}/${date}.json`;
  const anchor = { site_id: siteId, anchor_date: date, chain_head_hash: head, record_count: count };
  if (env.VAULT) {
    await env.VAULT.put(objectKey, JSON.stringify(anchor), {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: { chain_head_hash: head, record_count: String(count) },
    });
  }
  await upsertAnchor(env, { ...anchor, r2_object_key: env.VAULT ? objectKey : null });
}

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
