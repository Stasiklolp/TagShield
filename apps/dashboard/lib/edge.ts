/**
 * Compile a site's banner settings into the config blob the edge Worker serves, and push it to
 * the Cloudflare SITES KV under `cfg:<key>`. The shape MUST match the Worker's `buildSiteConfig`
 * merge (packages/edge/src/index.ts): it reads `site_id`, `cfgv`, `copy`, `theme`, `categories`,
 * and `showBadge`. `site_id` is what the Worker uses to resolve the key to the vault chain.
 */
export interface BannerSettings {
  title: string;
  body: string;
  accept: string;
  reject: string;
  prefs: string;
  save: string;
  accent: string;
  bg: string;
  fg: string;
  position: 'bottom' | 'top' | 'corner';
  radius: number;
  categories: string[];
  showBadge: boolean;
}

export const DEFAULT_SETTINGS: BannerSettings = {
  title: 'We value your privacy',
  body: 'We use cookies to run ads and measure traffic. Choose what you allow.',
  accept: 'Accept all',
  reject: 'Reject all',
  prefs: 'Preferences',
  save: 'Save choices',
  accent: '#3b82f6',
  bg: '#0f1115',
  fg: '#f4f5f7',
  position: 'bottom',
  radius: 10,
  categories: ['necessary', 'analytics', 'marketing', 'functional'],
  showBadge: true,
};

export function compileConfigBlob(siteId: string, cfgv: string, s: BannerSettings) {
  return {
    site_id: siteId,
    cfgv,
    copy: {
      title: s.title,
      body: s.body,
      accept: s.accept,
      reject: s.reject,
      prefs: s.prefs,
      save: s.save,
      optOutHonored: 'Opt-Out Request Honored',
      doNotSellLabel: 'Do Not Sell or Share My Info',
    },
    theme: { bg: s.bg, fg: s.fg, accent: s.accent, position: s.position, radius: s.radius },
    categories: s.categories,
    showBadge: s.showBadge,
  };
}

export async function pushConfigToEdge(siteKey: string, blob: unknown): Promise<boolean> {
  const acct = process.env.CF_ACCOUNT_ID;
  const ns = process.env.CF_SITES_KV_NAMESPACE_ID;
  const token = process.env.CF_API_TOKEN;
  if (!acct || !ns || !token) {
    console.log(`[edge] cfg:${siteKey} not pushed (Cloudflare API not configured)`);
    return false;
  }
  const endpoint =
    `https://api.cloudflare.com/client/v4/accounts/${acct}/storage/kv/namespaces/${ns}` +
    `/values/cfg:${encodeURIComponent(siteKey)}`;
  const res = await fetch(endpoint, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(blob),
  });
  if (!res.ok) throw new Error(`edge KV push failed: ${res.status} ${await res.text()}`);
  return true;
}
