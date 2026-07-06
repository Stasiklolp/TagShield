/**
 * Install verification: fetch the customer's homepage and confirm the Tagshield snippet is present
 * with their site key. A lightweight heuristic (mirrors the edge /scan checker) — good enough to
 * flip a site from "pending_install" to "active" and give the "✅ Tagshield is live" moment.
 */
export async function checkInstalled(
  domain: string,
  siteKey: string,
): Promise<{ ok: boolean; detail: string }> {
  const url = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'TagshieldInstallCheck/1.0 (+https://tagshield.io)' },
      redirect: 'follow',
    });
    const html = (await res.text()).slice(0, 500_000);
    const hasBoot = html.includes('__tagshield');
    const hasKey = html.includes(siteKey);
    if (hasBoot && hasKey) return { ok: true, detail: 'Snippet detected with your site key.' };
    if (hasBoot && !hasKey) {
      return { ok: false, detail: 'Found a Tagshield snippet, but not this site key — check the key.' };
    }
    return { ok: false, detail: 'No Tagshield snippet found on the homepage yet.' };
  } catch {
    return { ok: false, detail: "Couldn't load the site. Is it public and reachable?" };
  }
}
