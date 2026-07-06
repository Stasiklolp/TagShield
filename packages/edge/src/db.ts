/**
 * Vault storage for the edge Worker.
 *
 * The consent log lives in Postgres (Supabase). From a Cloudflare Worker we reach it over
 * Supabase's PostgREST HTTP API using plain `fetch` — no TCP, no `nodejs_compat`, no driver
 * dependency, so the Worker stays tiny and cold-starts fast. The Worker is a trusted backend,
 * so it uses the service-role key (bypasses RLS). Configure as secrets:
 *
 *   wrangler secret put SUPABASE_URL                 # https://<ref>.supabase.co
 *   wrangler secret put SUPABASE_SERVICE_ROLE_KEY    # service_role JWT (server-only, never shipped)
 *
 * If unset, storage calls degrade to a logged no-op so the skeleton still runs locally.
 */
import type { StoredChainRow } from './hashchain';

export interface DbEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SITES: KVNamespace;
}

/** Stable sentinel so the built-in `demo` key has a valid uuid without a dashboard row. */
export const DEMO_SITE_ID = '00000000-0000-0000-0000-0000000000de';

export function dbConfigured(env: DbEnv): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

function restUrl(env: DbEnv, path: string): string {
  return `${env.SUPABASE_URL!.replace(/\/$/, '')}/rest/v1/${path}`;
}

function restHeaders(env: DbEnv): Record<string, string> {
  const key = env.SUPABASE_SERVICE_ROLE_KEY!;
  return { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' };
}

/**
 * Resolve a public site key to its internal uuid via the compiled config blob in KV
 * (`cfg:<key>`, written by the dashboard). The `demo` key resolves to a fixed sentinel so the
 * end-to-end path works without any dashboard-provisioned site.
 */
export async function resolveSiteId(env: DbEnv, siteKey: string): Promise<string | null> {
  const blob = (await env.SITES.get(`cfg:${siteKey}`, 'json')) as { site_id?: string } | null;
  if (blob?.site_id) return blob.site_id;
  return siteKey === 'demo' ? DEMO_SITE_ID : null;
}

/** One row as written to the partitioned `consent_logs` table (see db/schema.sql). */
export interface ConsentLogRow {
  site_id: string;
  visitor_pseudo_id: string;
  consent_state: Record<string, string>;
  signal_source: string;
  banner_config_version: string;
  gpc_present: boolean;
  region_code: string | null;
  ip_country: string | null;
  user_agent_hash: string | null;
  prev_hash: string;
  record_hash: string;
  canonical: string;
  created_at: string;
}

/** Batched, single-round-trip insert of chained consent rows. */
export async function insertConsentLogs(env: DbEnv, rows: ConsentLogRow[]): Promise<void> {
  if (!rows.length) return;
  if (!dbConfigured(env)) {
    console.log(`[vault] ${rows.length} rows for ${rows[0].site_id} (storage not configured — skipped)`);
    return;
  }
  const res = await fetch(restUrl(env, 'consent_logs'), {
    method: 'POST',
    headers: { ...restHeaders(env), prefer: 'return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    throw new Error(`consent_logs insert failed: ${res.status} ${await res.text()}`);
  }
}

/** Load a site's full chain in insertion order for verification / export. */
export async function loadChain(env: DbEnv, siteId: string): Promise<StoredChainRow[]> {
  const path =
    `consent_logs?site_id=eq.${encodeURIComponent(siteId)}` +
    `&select=prev_hash,record_hash,canonical&order=id.asc`;
  const res = await fetch(restUrl(env, path), { headers: restHeaders(env) });
  if (!res.ok) {
    throw new Error(`consent_logs read failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as StoredChainRow[];
}

/** The current chain head + record count for a site — used by the daily anchor job. */
export async function chainStats(
  env: DbEnv,
  siteId: string,
): Promise<{ head: string; count: number }> {
  const path =
    `consent_logs?site_id=eq.${encodeURIComponent(siteId)}` +
    `&select=record_hash&order=id.desc&limit=1`;
  const res = await fetch(restUrl(env, path), {
    headers: { ...restHeaders(env), prefer: 'count=exact' },
  });
  if (!res.ok) throw new Error(`chain head read failed: ${res.status}`);
  const rows = (await res.json()) as { record_hash: string }[];
  // PostgREST returns the exact count in the Content-Range header (e.g. "0-0/1234").
  const range = res.headers.get('content-range') || '';
  const count = Number(range.split('/')[1] || rows.length);
  return { head: rows[0]?.record_hash || '0'.repeat(64), count };
}

/** Record a daily anchor (idempotent per site+date via the unique constraint). */
export async function upsertAnchor(
  env: DbEnv,
  anchor: {
    site_id: string;
    anchor_date: string;
    chain_head_hash: string;
    record_count: number;
    r2_object_key: string | null;
  },
): Promise<void> {
  if (!dbConfigured(env)) {
    console.log(`[vault] anchor ${anchor.site_id}@${anchor.anchor_date} (storage not configured — skipped)`);
    return;
  }
  const res = await fetch(restUrl(env, 'vault_anchors?on_conflict=site_id,anchor_date'), {
    method: 'POST',
    headers: { ...restHeaders(env), prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(anchor),
  });
  if (!res.ok) {
    throw new Error(`vault_anchors upsert failed: ${res.status} ${await res.text()}`);
  }
}

/** All site uuids that have consent rows — the set the daily anchor job iterates. */
export async function listSiteIds(env: DbEnv): Promise<string[]> {
  if (!dbConfigured(env)) return [];
  // Distinct site_ids currently tracked in KV chain heads is cheaper than a DB scan; the anchor
  // job reads heads from KV (see the Worker's scheduled handler), so this is a DB fallback.
  const res = await fetch(restUrl(env, 'sites?select=id&status=eq.active'), {
    headers: restHeaders(env),
  });
  if (!res.ok) return [];
  return ((await res.json()) as { id: string }[]).map((r) => r.id);
}
