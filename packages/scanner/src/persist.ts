import type { CategorizedCookie } from './types';

/**
 * Persist a scan and its categorized cookies to Supabase (PostgREST), and diff against the site's
 * previously-seen cookies to report "N new trackers since last scan". Degrades to a dry run when
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.
 */
function config(): { base: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { base: url.replace(/\/$/, '') + '/rest/v1', key };
}

function headers(key: string): Record<string, string> {
  return { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' };
}

export async function persistScan(
  siteId: string,
  pagesCrawled: number,
  cookies: CategorizedCookie[],
): Promise<{ newCount: number }> {
  const cfg = config();
  if (!cfg) {
    console.log('[scan] SUPABASE_* not set — dry run, nothing persisted');
    return { newCount: cookies.length };
  }
  const { base, key } = cfg;
  const now = new Date().toISOString();

  const scanRes = await fetch(`${base}/scans`, {
    method: 'POST',
    headers: { ...headers(key), prefer: 'return=representation' },
    body: JSON.stringify({
      site_id: siteId,
      status: 'done',
      pages_crawled: pagesCrawled,
      cookies_found: cookies.length,
      started_at: now,
      finished_at: now,
    }),
  });
  if (!scanRes.ok) throw new Error(`scans insert failed: ${scanRes.status} ${await scanRes.text()}`);
  const scan = ((await scanRes.json()) as { id: string }[])[0];

  const existRes = await fetch(
    `${base}/site_cookies?site_id=eq.${siteId}&select=cookie_name,domain`,
    { headers: headers(key) },
  );
  const existing = new Set(
    ((await existRes.json()) as { cookie_name: string; domain: string }[]).map(
      (r) => `${r.cookie_name}|${r.domain}`,
    ),
  );

  let newCount = 0;
  const rows = cookies.map((c) => {
    if (!existing.has(`${c.name}|${c.domain}`)) newCount++;
    return {
      site_id: siteId,
      scan_id: scan?.id,
      cookie_name: c.name,
      domain: c.domain,
      category: c.category,
      last_seen: now,
    };
  });

  if (rows.length) {
    const up = await fetch(`${base}/site_cookies?on_conflict=site_id,cookie_name,domain`, {
      method: 'POST',
      headers: { ...headers(key), prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows),
    });
    if (!up.ok) throw new Error(`site_cookies upsert failed: ${up.status} ${await up.text()}`);
  }

  if (scan?.id) {
    await fetch(`${base}/scans?id=eq.${scan.id}`, {
      method: 'PATCH',
      headers: { ...headers(key), prefer: 'return=minimal' },
      body: JSON.stringify({ new_count: newCount }),
    });
  }

  return { newCount };
}
