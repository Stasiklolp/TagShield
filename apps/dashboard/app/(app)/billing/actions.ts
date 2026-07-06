'use server';

import { redirect } from 'next/navigation';
import { requireOrg } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { stripe } from '@/lib/stripe';
import { planById, priceIdFor, type PlanId } from '@/lib/plans';

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
}

export async function startCheckout(planId: PlanId) {
  const { org, email } = await requireOrg();
  const plan = planById(planId);
  const price = priceIdFor(plan);
  if (!price) redirect('/billing?error=' + encodeURIComponent(`No Stripe price configured for ${plan.name}`));

  const s = stripe();
  let customerId = org.stripe_customer_id;
  if (!customerId) {
    const customer = await s.customers.create({ email, metadata: { org_id: org.id } });
    customerId = customer.id;
    await adminClient().from('organizations').update({ stripe_customer_id: customerId }).eq('id', org.id);
  }

  const session = await s.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price, quantity: 1 }],
    success_url: `${appUrl()}/billing?success=1`,
    cancel_url: `${appUrl()}/billing?canceled=1`,
    metadata: { org_id: org.id, plan: plan.id },
    subscription_data: { metadata: { org_id: org.id, plan: plan.id } },
  });
  if (session.url) redirect(session.url);
}

export async function openPortal() {
  const { org } = await requireOrg();
  if (!org.stripe_customer_id) redirect('/billing?error=' + encodeURIComponent('No subscription yet'));
  const session = await stripe().billingPortal.sessions.create({
    customer: org.stripe_customer_id,
    return_url: `${appUrl()}/billing`,
  });
  redirect(session.url);
}
