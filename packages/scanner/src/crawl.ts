import { chromium } from 'playwright';
import type { CrawlResult } from './types';

/**
 * Crawl up to `maxPages` customer URLs with a real headless browser, capturing the cookies actually
 * set, the localStorage keys written, and every third-party domain contacted. Deterministic inputs
 * for categorization — no network heuristics, no LLM.
 */
export async function crawl(urls: string[], maxPages = 20): Promise<CrawlResult> {
  const browser = await chromium.launch();
  const context = await browser.newContext();

  const networkDomains = new Set<string>();
  context.on('request', (req) => {
    try {
      networkDomains.add(new URL(req.url()).hostname);
    } catch {
      /* ignore non-URL requests */
    }
  });

  const localStorageKeys = new Set<string>();
  for (const url of urls.slice(0, maxPages)) {
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
      const keys = await page.evaluate(() => Object.keys(window.localStorage));
      keys.forEach((k) => localStorageKeys.add(k));
    } catch {
      /* skip pages that fail to load; keep crawling the rest */
    } finally {
      await page.close();
    }
  }

  const cookies = await context.cookies();
  await browser.close();

  return {
    cookies: cookies.map((c) => ({ name: c.name, domain: c.domain })),
    localStorageKeys: [...localStorageKeys],
    networkDomains: [...networkDomains],
  };
}
