# Tagshield

[![CI](https://github.com/Stasiklolp/TagShield/actions/workflows/ci.yml/badge.svg)](https://github.com/Stasiklolp/TagShield/actions/workflows/ci.yml)

> A sub-10KB, Google-Consent-Mode-v2-native cookie-consent banner with a tamper-evident,
> exportable consent-proof vault — sold self-serve to ad-dependent SMBs and the agencies that serve them.

**One-liner:** *A fast, flat-priced cookie-consent banner that keeps your Google Ads running and
gives you a tamper-proof log to prove you obeyed privacy law.*

The wedge: since the **June 15, 2026** Consent Mode v2 cutoff, Google Ads relies *solely* on the
CMP's consent signals. Any site without a correctly-wired CMP is silently losing conversion tracking
and remarketing. Tagshield restores that in one line of code — and, unlike the incumbents, it doesn't
tank Core Web Vitals, doesn't charge per-domain, and gives you a cryptographically verifiable consent log.

---

## The three things this repo proves (the moat)

1. **Performance** — the banner is hand-written vanilla TS, edge-delivered, with a CI size gate that
   **fails the build above 10KB gzipped**. Incumbent scripts are 100KB+ and structurally can't slim down.
2. **Flat per-visitor pricing** — no per-domain, no per-subpage tiers. (Billing lives in the dashboard app,
   not in this scaffold.)
3. **Tamper-evident consent vault** — every consent event is hash-chained (`record_hash = SHA-256(canonical(record) + prev_hash)`),
   anchored daily, and exportable. Ripping Tagshield out means abandoning the audit trail. That's the switching cost.

---

## Repo map

```
tagshield/
├─ packages/
│  ├─ banner/          # The <10KB vanilla-TS banner runtime (the product core)
│  │  ├─ src/banner.ts       # Consent Mode v2 + GPC + geo + beacon logging
│  │  ├─ install-snippet.html# What the customer pastes in <head>
│  │  └─ build.mjs           # esbuild + hard 10KB gzip size gate
│  ├─ edge/            # Cloudflare Worker: config + consent ingest + hash-chain + anchors + proof
│  │  ├─ src/index.ts        # routes: /b.js, /config/:key, POST /c, /verify, /export, /scan; queue + cron
│  │  ├─ src/hashchain.ts    # canonical JSON + SHA-256 chaining + verify (Web Crypto)
│  │  ├─ src/db.ts           # Supabase PostgREST: persist chain, load, anchor
│  │  ├─ src/export.ts       # portable Consent Proof bundle + standalone offline verifier
│  │  ├─ src/bots.ts         # bot filter (keeps crawlers out of billing + the vault)
│  │  ├─ src/geo.ts          # region -> consent regime resolution
│  │  └─ test/               # vitest: tamper-evidence, geo, bots, proof export
│  └─ scanner/         # Playwright cookie auto-scan + deterministic categorization (Open Cookie DB)
├─ apps/
│  ├─ web/             # Static landing page (dogfoods the banner) + generated SEO pages
│  └─ dashboard/       # Next.js + Supabase: auth, add-site, install verify, banner builder, billing
│     ├─ app/(app)/          # sites list, site detail, billing
│     ├─ app/api/stripe/     # Stripe webhook
│     └─ lib/                # supabase, auth, edge-config push, stripe, plans
├─ db/
│  ├─ schema.sql       # Postgres schema incl. partitioned consent_logs (+ canonical) + vault_anchors
│  ├─ rls.sql          # Row-Level Security policies (tenant isolation)
│  └─ functions.sql    # helper RPCs (monthly unique-visitor meter)
├─ scripts/            # programmatic SEO generator + data + dev server with a working /scan
└─ docs/
   └─ sprint-board.md  # the 8-week MVP build plan as actionable tickets
```

## Architecture (the hot path)

```
Visitor browser
  │  1. inline <head> snippet sets Consent Mode v2 defaults = denied  (before ANY tag fires)
  │  2. async-loads  cdn.tagshield.io/b.js   (static, edge-cached, <10KB)
  ▼
b.js (banner runtime)
  │  reads window.__tagshield.key + navigator.globalPrivacyControl
  │  GET /config/{key}  ──►  Cloudflare Worker resolves region via request.cf.* and returns
  │                          { regime, categories, copy, theme, gpcBinding, doNotSell }
  │  renders banner (inline CSS, no layout shift) OR auto-decides (notice/opt-out regions)
  │  on decision:  gtag('consent','update',{...})   +   navigator.sendBeacon('/c', payload)
  ▼
POST /c  ──►  Cloudflare Queue  ──►  consumer computes record_hash (per-site chain)  ──►  consent_logs
                                                                          └─ daily head ──► vault_anchors (R2 object-lock)
```

## Prerequisites

- **Node 20+** and **pnpm** (or npm) — *not installed in the environment this scaffold was generated in;
  install locally before building.*
- **Cloudflare account** + `wrangler` (`npm i -g wrangler`) for the edge worker, KV, Queues, R2.
- **Postgres** (Supabase/Neon) for the relational + consent-log store.
- **Stripe** account for billing (dashboard app — not in this scaffold yet).

## Quickstart

```bash
# 1. install
pnpm install            # or: npm install

# 2. build the banner and verify the size gate
pnpm --filter @tagshield/banner build      # fails if > 10KB gzipped

# 2b. run the edge core tests (hash-chain tamper-evidence, geo, bot filter, proof export)
pnpm --filter @tagshield/edge test         # vitest — 25 tests

# 3. run the edge worker locally
pnpm --filter @tagshield/edge dev          # wrangler dev

# 4. create the database
psql "$DATABASE_URL" -f db/schema.sql

# 5. generate the programmatic SEO pages
node scripts/generate-seo-pages.mjs        # writes apps/web/seo/**

# 6. preview the landing page + the WORKING Consent Mode v2 checker
python3 scripts/serve.py                    # http://127.0.0.1:4187  (serves the site AND /scan)

# 7. run the dashboard (Next.js + Supabase) — copy apps/dashboard/.env.example to .env.local first
pnpm --filter @tagshield/dashboard dev      # http://localhost:3000
```

> Open the site via the dev server (step 6), not `file://` — the free checker calls a `/scan`
> endpoint that `scripts/serve.py` (and, in production, the Cloudflare Worker) implements.

## Status

**The core is wired and tested, not just sketched.** As of this build the edge Worker actually:
persists the consent chain to Postgres (Supabase over PostgREST — set `SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY` as Worker secrets), verifies integrity live at `GET /verify/:key`,
filters bots off the billable/vault path, anchors each site's chain head to immutable R2 daily
(`crons` in `wrangler.toml`), and exports a portable **Consent Proof** bundle with a standalone
offline verifier at `GET /export/:key`. A 25-test vitest suite proves the chain is tamper-evident
(tampering and splicing both fail verification) and runs in CI.

**The app layer is built** (Next.js + Supabase, `apps/dashboard`): email auth, add-site with a
copy-paste snippet and an install-verification ping, a banner builder that compiles per-site config
to the edge KV, consent stats, and Stripe billing (checkout, customer portal, plan gating, and a
per-visitor usage meter). `@tagshield/scanner` crawls a site with Playwright and categorizes cookies
deterministically via the Open Cookie Database.

**What's left is yours** — accounts, deploy, and go-to-market, not code: create the Supabase project
and set the env/secrets; provision Cloudflare KV/Queues/R2 + the `cdn.tagshield.io` domain and
`wrangler deploy`; create the Stripe products/prices. Then the business/legal items — tech E&O
insurance, a licensed privacy-law feed (don't hand-maintain the rules), scrubbing "certified" /
"guarantees compliance" from copy, and queuing the Google CMP certification. See
[`docs/sprint-board.md`](docs/sprint-board.md).

**Before your first paying customer:** buy tech E&O insurance, license a privacy-law feed (don't
hand-maintain `jurisdiction_rules`), and scrub all copy of the words "certified" and "guarantees
compliance" until Google CMP Gold actually lands. See the Risks section of the strategy doc.
