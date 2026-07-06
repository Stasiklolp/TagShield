import Link from 'next/link';
import { requireOrg } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { createSite } from './sites/new/actions';

export const dynamic = 'force-dynamic';

interface SiteRow {
  id: string;
  domain: string;
  public_site_key: string;
  status: string;
}

function StatusPill({ status }: { status: string }) {
  const cls = status === 'active' ? 'pill-ok' : status === 'paused' ? 'pill-paused' : 'pill-pending';
  const label = status === 'active' ? 'Live' : status === 'paused' ? 'Paused' : 'Pending install';
  return <span className={`pill ${cls}`}>{label}</span>;
}

export default async function Home() {
  const { org } = await requireOrg();
  const db = adminClient();
  const { data } = await db
    .from('sites')
    .select('id,domain,public_site_key,status')
    .eq('org_id', org.id)
    .order('created_at', { ascending: false });
  const sites = (data ?? []) as SiteRow[];

  return (
    <>
      <h1>Your sites</h1>
      <p className="muted">
        Plan: {org.plan} · visitor quota {org.billing_visitor_quota.toLocaleString()}/mo
      </p>
      <div className="stack" style={{ marginTop: 20 }}>
        {sites.length === 0 && (
          <div className="card muted">No sites yet — add your first one below.</div>
        )}
        {sites.map((s) => (
          <Link
            key={s.id}
            href={`/sites/${s.id}`}
            className="card row"
            style={{ justifyContent: 'space-between' }}
          >
            <div>
              <strong>{s.domain}</strong>
              <div className="muted" style={{ fontSize: 12 }}>{s.public_site_key}</div>
            </div>
            <StatusPill status={s.status} />
          </Link>
        ))}
        <form action={createSite} className="card stack">
          <h2>Add a site</h2>
          <div>
            <label>Domain</label>
            <input name="domain" placeholder="example.com" required />
          </div>
          <div>
            <button className="btn btn-primary" type="submit">Create site</button>
          </div>
        </form>
      </div>
    </>
  );
}
