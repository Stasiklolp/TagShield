/**
 * Known-bot detection for the consent beacon (POST /c).
 *
 * A bot never saw a banner and never made a choice, so it must never:
 *   - count as a billable visitor (per-visitor pricing integrity), or
 *   - enter the tamper-evident consent vault (it isn't a real consent record).
 *
 * This matcher is deliberately CONSERVATIVE about the *browser* side: it errs toward
 * letting a real visitor through rather than dropping one, because the consent log is a
 * compliance artifact and under-counting real consents is worse than over-counting a few
 * bots. It matches the substring tokens crawlers, monitors, previewers, and HTTP libraries
 * put in their User-Agent. Case-insensitive.
 */
const BOT_RE =
  /bot\b|bot\/|crawl|spider|slurp|mediapartners|facebookexternalhit|whatsapp|telegram|slackbot|discord|pinterest|embedly|outbrain|ia_archiver|headlesschrome|phantomjs|puppeteer|playwright|selenium|lighthouse|pagespeed|gtmetrix|pingdom|uptimerobot|statuscake|monitis|newrelicpinger|python-requests|curl\/|wget\/|go-http-client|okhttp|libwww|scrapy|apachebench|axios\/|node-fetch|tagshieldscanner/i;

/**
 * Returns true if the User-Agent should be treated as a non-human hit and dropped from
 * billing + the vault. A missing/empty UA is treated as non-human: a real browser always
 * sends one, so an absent UA is almost always a script or health check.
 */
export function isBot(ua: string | null | undefined): boolean {
  if (!ua) return true;
  return BOT_RE.test(ua);
}
