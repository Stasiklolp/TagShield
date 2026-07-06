export type PlanId = 'free' | 'starter' | 'pro' | 'business';

export interface Plan {
  id: PlanId;
  name: string;
  price: string;
  /** Included monthly unique visitors (the flat per-visitor meter). */
  quota: number;
  blurb: string;
  /** Env var holding the Stripe Price ID for this plan (paid plans only). */
  priceEnv?: 'STRIPE_PRICE_STARTER' | 'STRIPE_PRICE_PRO' | 'STRIPE_PRICE_BUSINESS';
}

export const PLANS: Plan[] = [
  { id: 'free', name: 'Free', price: '$0', quota: 5_000, blurb: '1 site, Tagshield badge.' },
  { id: 'starter', name: 'Starter', price: '$19/mo', quota: 50_000, blurb: 'Remove badge, all regions.', priceEnv: 'STRIPE_PRICE_STARTER' },
  { id: 'pro', name: 'Pro', price: '$49/mo', quota: 250_000, blurb: 'Multi-site, proof exports.', priceEnv: 'STRIPE_PRICE_PRO' },
  { id: 'business', name: 'Business', price: '$149/mo', quota: 2_000_000, blurb: 'High volume, priority support.', priceEnv: 'STRIPE_PRICE_BUSINESS' },
];

export function planById(id: string): Plan {
  return PLANS.find((p) => p.id === id) ?? PLANS[0];
}

export function priceIdFor(plan: Plan): string | undefined {
  return plan.priceEnv ? process.env[plan.priceEnv] : undefined;
}
