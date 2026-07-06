import { describe, it, expect } from 'vitest';
import { isBot } from '../src/bots';

describe('isBot', () => {
  it('flags common crawlers, monitors, and HTTP clients', () => {
    const bots = [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
      'curl/8.4.0',
      'python-requests/2.31.0',
      'Mozilla/5.0 (Macintosh) HeadlessChrome/120.0.0.0 Safari/537.36',
      'Chrome-Lighthouse',
      'TagshieldScanner/1.0 (+https://tagshield.io)',
    ];
    for (const ua of bots) expect(isBot(ua), ua).toBe(true);
  });

  it('treats a missing or empty User-Agent as non-human', () => {
    expect(isBot('')).toBe(true);
    expect(isBot(null)).toBe(true);
    expect(isBot(undefined)).toBe(true);
  });

  it('lets real desktop and mobile browsers through', () => {
    const humans = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
    ];
    for (const ua of humans) expect(isBot(ua), ua).toBe(false);
  });
});
