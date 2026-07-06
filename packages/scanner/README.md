# @tagshield/scanner

Headless cookie auto-scan. Crawls a customer's URLs with Playwright, captures the cookies/localStorage/
network domains actually set, and categorizes them deterministically (no LLM) via the Open Cookie
Database rules in `src/rules.ts`. Results + a diff ("N new trackers since last scan") are written to
the `scans` / `site_cookies` tables.

```bash
pnpm --filter @tagshield/scanner install     # also runs `playwright install chromium`
pnpm --filter @tagshield/scanner test        # unit tests for the categorizer

# scan a site (writes to Supabase if SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set)
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  pnpm --filter @tagshield/scanner scan <site_id> https://example.com https://example.com/pricing
```

**Extend coverage:** import the full [Open Cookie Database](https://github.com/jkwakman/Open-Cookie-Database)
into the `CookieRule[]` shape (or the `cookie_definitions` table). The seed in `src/rules.ts` covers
the highest-frequency trackers as a fallback.

For a serverless deployment, swap `src/crawl.ts` to call **Browserless** (`chromium.connectOverCDP`)
instead of launching a local browser, and trigger `scan.ts` from a queue.
