import Stripe from 'stripe';

let client: Stripe | null = null;

/** Lazily-constructed Stripe client. Throws if the secret key is not configured. */
export function stripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
    // apiVersion omitted on purpose: pin to the account default so this compiles across
    // stripe-node releases without chasing the version literal.
    client = new Stripe(key);
  }
  return client;
}

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}
