import { requireOrg } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { PLANS, planById } from '@/lib/plans';
import { stripeConfigured } from '@/lib/stripe';
import { startCheckout, openPortal } from './actions';

export const dynamic = 'force-dynamic';

export default async function BillingPage({
  searchParams,
}: {
  searchParams: { error?: string; success?: string; canceled?: string };
}) {
  const { org } = await requireOrg();
  const db = adminClient();

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  let uniques = 0;
  const { data } = await db.rpc('org_month_uniques', {
    p_org: org.id,
    p_since: monthStart.toISOString(),
  });
  if (typeof data === 'number') uniques = data;

  const current = planById(org.plan);
  const pct = Math.min(100, Math.round((uniques / current.quota) * 100));

  return (
    <>
      <h1>Billing</h1>
      {searchParams.success && (
        <div className="notice" style={{ borderColor: 'var(--ok)' }}>Subscription updated — thank you!</div>
      )}
      {searchParams.error && <div className="notice">{searchParams.error}</div>}
      {!stripeConfigured() && (
        <div className="notice" style={{ marginTop: 12 }}>
          Stripe isn’t configured yet. Set <code>STRIPE_SECRET_KEY</code> and the plan price IDs to enable checkout.
        </div>
      )}

      <div className="card stack" style={{ marginTop: 20 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: 0 }}>Current plan: {current.name}</h2>
            <p className="muted">This month: {uniques.toLocaleString()} / {current.quota.toLocaleString()} unique visitors</p>
          </div>
          <form action={openPortal}>
            <button className="btn" type="submit" disabled={!org.stripe_customer_id}>Manage subscription</button>
          </form>
        </div>
        <div style={{ height: 10, background: 'var(--panel-2)', borderRadius: 999, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? 'var(--err)' : 'var(--accent)' }} />
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          Over-quota never hard-cuts the banner — it keeps protecting the site while we flag the overage.
        </p>
      </div>

      <div className="grid-stats" style={{ marginTop: 20 }}>
        {PLANS.map((p) => {
          const isCurrent = p.id === current.id;
          return (
            <div key={p.id} className="card stack" style={{ borderColor: isCurrent ? 'var(--accent)' : undefined }}>
              <div>
                <h2 style={{ margin: 0 }}>{p.name}</h2>
                <div className="muted">{p.price}</div>
              </div>
              <div className="muted" style={{ fontSize: 13 }}>{p.blurb}</div>
              <div className="muted" style={{ fontSize: 13 }}>{p.quota.toLocaleString()} visitors/mo</div>
              {isCurrent ? (
                <button className="btn" disabled>Current plan</button>
              ) : p.id === 'free' ? (
                <span className="muted" style={{ fontSize: 12 }}>Downgrade via “Manage”.</span>
              ) : (
                <form action={startCheckout.bind(null, p.id)}>
                  <button className="btn btn-primary" type="submit" disabled={!stripeConfigured()}>
                    Choose {p.name}
                  </button>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
