import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOrg } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import CopyButton from '@/components/CopyButton';
import { DEFAULT_SETTINGS } from '@/lib/edge';
import { verifyInstall, saveBanner } from './actions';

export const dynamic = 'force-dynamic';

function installSnippet(key: string): string {
  return `<script>
(function (w, d) {
  w.__tagshield = { key: "${key}" };
  w.dataLayer = w.dataLayer || [];
  w.gtag = w.gtag || function () { w.dataLayer.push(arguments); };
  gtag("consent", "default", {
    ad_storage: "denied", analytics_storage: "denied",
    ad_user_data: "denied", ad_personalization: "denied", wait_for_update: 500
  });
  var s = d.createElement("script"); s.async = true;
  s.src = "https://cdn.tagshield.io/b.js";
  (d.head || d.documentElement).appendChild(s);
})(window, document);
</script>`;
}

function CategoryBadge({ category }: { category: string }) {
  const map: Record<string, string> = {
    necessary: 'pill-ok',
    functional: 'pill-ok',
    analytics: 'pill-pending',
    marketing: 'pill-paused',
    unclassified: 'pill-pending',
  };
  return <span className={`pill ${map[category] ?? 'pill-pending'}`}>{category}</span>;
}

export default async function SiteDetail({ params }: { params: { id: string } }) {
  const { org } = await requireOrg();
  const db = adminClient();

  const { data: site } = await db
    .from('sites')
    .select('*')
    .eq('id', params.id)
    .eq('org_id', org.id)
    .maybeSingle();
  if (!site) notFound();

  const { data: cfg } = await db
    .from('banner_configs')
    .select('*')
    .eq('site_id', site.id)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  const theme = (cfg?.theme_json ?? {}) as { accent?: string };
  const copy = (cfg?.copy_json ?? {}) as { title?: string; body?: string };

  // Consent stats — last 30 days (head+count queries; no rows transferred).
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const countBy = async (source?: string) => {
    let q = db
      .from('consent_logs')
      .select('*', { count: 'exact', head: true })
      .eq('site_id', site.id)
      .gte('created_at', since);
    if (source) q = q.eq('signal_source', source);
    const { count } = await q;
    return count ?? 0;
  };
  const [total, accepts, rejects, gpc] = await Promise.all([
    countBy(),
    countBy('banner_accept'),
    countBy('banner_reject'),
    countBy('gpc'),
  ]);

  // Cookie scan results (populated by @tagshield/scanner).
  const { data: lastScan } = await db
    .from('scans')
    .select('pages_crawled,cookies_found,new_count,finished_at')
    .eq('site_id', site.id)
    .order('finished_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: cookieRows } = await db
    .from('site_cookies')
    .select('cookie_name,domain,category')
    .eq('site_id', site.id)
    .order('category', { ascending: true })
    .order('cookie_name', { ascending: true });
  const cookies = (cookieRows ?? []) as { cookie_name: string; domain: string | null; category: string }[];

  const snippet = installSnippet(site.public_site_key);
  const isLive = site.status === 'active';
  const exportUrl = `https://cdn.tagshield.io/export/${site.public_site_key}`;
  const verifyUrl = `https://cdn.tagshield.io/verify/${site.public_site_key}`;

  return (
    <>
      <p style={{ marginTop: 24 }}>
        <Link href="/" className="muted">← All sites</Link>
      </p>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>{site.domain}</h1>
        <span className={`pill ${isLive ? 'pill-ok' : 'pill-pending'}`}>
          {isLive ? 'Live' : 'Pending install'}
        </span>
      </div>

      <div className="stack" style={{ marginTop: 20 }}>
        {/* Install */}
        <div className="card stack">
          <h2>1 · Install</h2>
          <p className="muted">
            Paste this as the <strong>first</strong> tag in your <code>&lt;head&gt;</code>, before
            Google Tag Manager or gtag.js.
          </p>
          <pre>{snippet}</pre>
          <div className="row">
            <CopyButton text={snippet} label="Copy snippet" />
            <form action={verifyInstall.bind(null, site.id)}>
              <button className="btn btn-primary" type="submit">Verify install</button>
            </form>
            {isLive ? (
              <span className="muted">✅ Tagshield is live and logging consent.</span>
            ) : (
              <span className="muted">We’ll check your homepage for the snippet.</span>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="card stack">
          <h2>2 · Consent (last 30 days)</h2>
          <div className="grid-stats">
            <div className="stat"><div className="n">{total.toLocaleString()}</div><div className="l">Total decisions</div></div>
            <div className="stat"><div className="n">{accepts.toLocaleString()}</div><div className="l">Accept all</div></div>
            <div className="stat"><div className="n">{rejects.toLocaleString()}</div><div className="l">Reject all</div></div>
            <div className="stat"><div className="n">{gpc.toLocaleString()}</div><div className="l">GPC auto opt-out</div></div>
          </div>
          <div className="row">
            <a className="btn" href={verifyUrl} target="_blank" rel="noopener">Verify chain integrity ↗</a>
            <a className="btn" href={exportUrl} target="_blank" rel="noopener">Export Consent Proof ↗</a>
          </div>
          <p className="muted" style={{ fontSize: 12 }}>
            These call your deployed edge Worker. Stats populate once the site is live and receiving traffic.
          </p>
        </div>

        {/* Banner builder */}
        <div className="card stack">
          <h2>3 · Banner</h2>
          <form action={saveBanner.bind(null, site.id)} className="stack">
            <div>
              <label>Title</label>
              <input name="title" defaultValue={copy.title ?? DEFAULT_SETTINGS.title} />
            </div>
            <div>
              <label>Body</label>
              <textarea name="body" defaultValue={copy.body ?? DEFAULT_SETTINGS.body} />
            </div>
            <div className="row">
              <div style={{ flex: '1 1 140px' }}>
                <label>Accent color</label>
                <input name="accent" type="color" defaultValue={theme.accent ?? DEFAULT_SETTINGS.accent} style={{ height: 42, padding: 4 }} />
              </div>
              <div style={{ flex: '1 1 160px' }}>
                <label>Position</label>
                <select name="position" defaultValue={(cfg?.layout as string) ?? DEFAULT_SETTINGS.position}>
                  <option value="bottom">Bottom bar</option>
                  <option value="top">Top bar</option>
                  <option value="corner">Corner card</option>
                </select>
              </div>
            </div>
            <div>
              <button className="btn btn-primary" type="submit">Save &amp; publish to edge</button>
            </div>
          </form>
          <p className="muted" style={{ fontSize: 12 }}>
            Saving bumps the config version and pushes it to the edge KV so <code>/config/{site.public_site_key}</code> serves it. The version is stamped into every consent record.
          </p>
        </div>

        {/* Cookies */}
        <div className="card stack">
          <h2>
            4 · Cookies{' '}
            {cookies.length > 0 && (
              <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>({cookies.length})</span>
            )}
          </h2>
          {lastScan ? (
            <p className="muted">
              Last scan: {lastScan.cookies_found} cookies across {lastScan.pages_crawled} page(s)
              {lastScan.new_count > 0 && (
                <> · <span style={{ color: 'var(--warn)' }}>{lastScan.new_count} new since previous</span></>
              )}
            </p>
          ) : (
            <p className="muted">
              No scan yet — run{' '}
              <code>pnpm --filter @tagshield/scanner scan {site.id} https://{site.domain}</code>.
            </p>
          )}
          {cookies.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--ink-2)' }}>
                    <th style={{ padding: '6px 8px' }}>Cookie</th>
                    <th style={{ padding: '6px 8px' }}>Domain</th>
                    <th style={{ padding: '6px 8px' }}>Category</th>
                  </tr>
                </thead>
                <tbody>
                  {cookies.map((c, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--line)' }}>
                      <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace' }}>{c.cookie_name}</td>
                      <td style={{ padding: '6px 8px' }} className="muted">{c.domain || '—'}</td>
                      <td style={{ padding: '6px 8px' }}><CategoryBadge category={c.category} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
