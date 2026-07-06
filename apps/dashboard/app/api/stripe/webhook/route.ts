import { NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { adminClient } from '@/lib/supabase/admin';
import { planById } from '@/lib/plans';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Stripe webhook: keep organizations.plan / quota / stripe_customer_id in sync with the
 * subscription lifecycle. Point a Stripe webhook endpoint at /api/stripe/webhook and set
 * STRIPE_WEBHOOK_SECRET.
 */
export async function POST(req: Request) {
  const sig = req.headers.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !secret) return NextResponse.json({ error: 'not configured' }, { status: 400 });

  const body = await req.text();
  let event;
  try {
    event = stripe().webhooks.constructEvent(body, sig, secret);
  } catch {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  const relevant =
    event.type === 'checkout.session.completed' || event.type.startsWith('customer.subscription');
  if (relevant) {
    const obj = event.data.object as {
      metadata?: Record<string, string>;
      customer?: string | { id: string };
    };
    const orgId = obj.metadata?.org_id;
    const customerId = typeof obj.customer === 'string' ? obj.customer : obj.customer?.id;
    const plan = event.type === 'customer.subscription.deleted' ? 'free' : obj.metadata?.plan || 'starter';

    const update: Record<string, unknown> = {
      plan,
      billing_visitor_quota: planById(plan).quota,
    };
    if (customerId) update.stripe_customer_id = customerId;

    const db = adminClient();
    if (orgId) await db.from('organizations').update(update).eq('id', orgId);
    else if (customerId) await db.from('organizations').update(update).eq('stripe_customer_id', customerId);
  }

  return NextResponse.json({ received: true });
}
