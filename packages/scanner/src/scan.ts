import { crawl } from './crawl';
import { categorize } from './categorize';
import { DEFAULT_RULES } from './rules';
import { persistScan } from './persist';
import type { CategorizedCookie, CookieCategory } from './types';

function tally(cookies: CategorizedCookie[]): Record<CookieCategory, number> {
  const t = { necessary: 0, analytics: 0, marketing: 0, functional: 0, unclassified: 0 };
  for (const c of cookies) t[c.category]++;
  return t;
}

/** CLI: tsx src/scan.ts <site_id> <url> [url...] */
async function main() {
  const [siteId, ...urls] = process.argv.slice(2);
  if (!siteId || urls.length === 0) {
    console.error('usage: tsx src/scan.ts <site_id> <url> [url ...]');
    process.exit(2);
  }

  console.log(`Scanning ${urls.length} URL(s) for site ${siteId}…`);
  const result = await crawl(urls);
  const cookies: CategorizedCookie[] = result.cookies.map((c) => ({
    ...c,
    ...categorize(c.name, DEFAULT_RULES),
  }));

  const { newCount } = await persistScan(siteId, urls.length, cookies);
  console.log(
    `Done: ${cookies.length} cookies (${newCount} new since last scan), ` +
      `${result.networkDomains.length} network domains, ${result.localStorageKeys.length} localStorage keys.`,
  );
  console.table(tally(cookies));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
