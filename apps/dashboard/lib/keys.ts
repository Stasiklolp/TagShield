/** Generate an unguessable public site key (safe to embed in a customer's <head>). */
export function generateSiteKey(): string {
  return 'ts_' + crypto.randomUUID().replace(/-/g, '');
}
