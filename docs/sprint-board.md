# Tagshield — 8-Week MVP Sprint Board

**Goal:** ship a *paid, installable* CMP in 8 weeks, solo. The MVP does exactly one job:
*keep a Google Ads/GA4 SMB's consent signals valid, load fast, log proof, and bill them.*
Anything not serving that sentence is cut from v1 (see "Out of scope").

**Definition of done (v1):** a stranger can sign up, paste one line into their `<head>`, watch the
banner appear, see Consent Mode v2 signals fire correctly in Google Tag Assistant, get a verifiable
consent log they can export, and pay you monthly — all self-serve.

**Standing rules**
- The banner bundle has a **CI size gate that fails the build > 10KB gzipped.** Wire it in Week 1, never disable it.
- Test Consent Mode v2 ordering in **real Google Tag Assistant in Week 2**, not Week 8.
- All marketing/app copy is linted for the banned strings `"certified"` and `"guarantees compliance"`.

---

## Week 1 — Foundations + banner skeleton
- [ ] Monorepo + CI (lint, typecheck, **`size-limit` gate < 10KB gzip** on `@tagshield/banner`).
- [ ] Cloudflare Worker serving `GET /b.js` (static banner) from KV/R2 with a long cache header.
- [ ] Vanilla-TS banner renders: accept / reject / preferences, reserves its own space (no CLS).
- [ ] Inline `<head>` install snippet finalized (sets Consent Mode defaults + loads `b.js`).
- **Accept:** `pnpm build:banner` passes and prints a gzip size < 10KB; banner shows on a test page with 0 CLS.

## Week 2 — Consent Mode v2 + GPC
- [ ] Wire `gtag('consent','default' → 'update')` with all four params (`ad_storage`, `analytics_storage`, `ad_user_data`, `ad_personalization`), denied-by-default.
- [ ] Read `navigator.globalPrivacyControl`; render California "Opt-Out Request Honored" text when processed.
- [ ] Persist the visitor's decision in `localStorage`; re-apply on repeat visits (no re-prompt).
- **Accept:** in Google Tag Assistant / GA4 DebugView, a real GA4 + Ads tag shows `denied` before consent and `granted` after Accept; GPC visitors auto-opt-out and the banner says so.

## Week 3 — Geo rule engine
- [ ] Edge resolves region from `request.cf.country` / `request.cf.regionCode`.
- [ ] 3-bucket logic: EEA/UK/CH = opt-in; GPC opt-out US states = opt-out + GPC; rest-of-US = notice-only.
- [ ] Per-site config compiles to a small JSON blob in KV; `GET /config/:key` returns the *resolved* behavior.
- **Accept:** loading the test page from an EEA IP shows a blocking opt-in banner; from a non-CA US IP shows a notice; from CA with GPC auto-opts-out.

## Week 4 — Consent logging + tamper-evident vault
- [ ] `POST /c` consent beacon → Cloudflare Queue → consumer.
- [ ] Consumer computes `record_hash = SHA-256(canonical(record) + prev_hash)` per site; writes to `consent_logs`.
- [ ] Daily job anchors each site's chain head into `vault_anchors` (+ R2 object-lock).
- [ ] "Verify integrity" endpoint re-walks the chain and reports breaks.
- **Accept:** 1,000 synthetic consents write with an intact chain; tampering with one row fails verification.

## Week 5 — Cookie auto-scan
- [ ] Scan worker (Browserless/Playwright) crawls 5–20 customer URLs; captures cookies + `Set-Cookie` + localStorage + network domains.
- [ ] Categorize via the **Open Cookie Database** (no LLM); unmatched → "unclassified" with a one-click assign.
- [ ] Scheduled re-scans + a diff view ("3 new trackers since last scan").
- **Accept:** scanning a real WordPress/Shopify site returns a categorized cookie table in < 60s.

## Week 6 — Dashboard
- [ ] Auth (Supabase Auth or Clerk — **decide here**), org/site model, RLS.
- [ ] Add-site flow → **copy-paste install snippet + install verification ping**.
- [ ] Consent stats view, trigger scan, 2–3 banner presets + accent-color picker (no full WYSIWYG yet).
- **Accept:** a new account goes from signup → installed → "✅ Tagshield is live" in under 10 minutes.

## Week 7 — Stripe billing + proof export
- [ ] Stripe Checkout + Customer Portal; **flat per-visitor metering** (count unique `visitor_pseudo_id`/mo → report usage). Have a flat-monthly fallback tier ready if metering slips.
- [ ] Plan gating (Free / Starter / Pro / Business). Soft-cap on overage, **never hard-cut the banner.**
- [ ] Export = signed CSV/JSON + the hash chain + a verifier script (the "Consent Proof Report").
- **Accept:** a test customer subscribes, hits the visitor meter, and downloads a verifiable proof bundle.

## Week 8 — Hardening, perf, launch
- [ ] Lighthouse pass on a test site — capture a **before/after screenshot** (your #1 marketing asset).
- [ ] A11y (keyboard + ARIA on the banner), edge fail-safe (cached config + queued events on outage).
- [ ] 3–5 design-partner installs; docs/install guide; daily anchor job live.
- [ ] Landing page + "fix your post-cutoff CMP" page live; **Google CMP cert application queued.**
- **Accept:** ship. First external signup completes the DoD end-to-end.

---

## Out of scope for v1 (deliberately delayed)
| Delayed | Why it's safe to cut |
|---|---|
| IAB TCF / IAB membership (€1,575 publisher track) | Advertiser Consent Mode track only — solo-buildable, "Google-ready" without the gate. |
| Google CMP **Gold certification** | Recruitment window + 90% accuracy + 3 integrations + track record. Queue it; don't block launch. Market "Consent Mode v2 native, on the certification path." |
| Full agency white-label / sub-accounts / reseller billing | Ship single-org multi-site first; white-label is the Phase-2 Enzuzo fight. |
| Mobile SDKs | Beachhead is web (`<script>`). |
| A/B testing, consent-rate optimization, full WYSIWYG theming | Zero bearing on "valid signals + proof." |
| Per-state fine-tuning of all 20 laws | Ship 3 buckets; refine state-by-state post-launch via the `jurisdiction_rules` data file. |
| SSO, team roles, SOC 2 | Solo SMB buyers don't gate on these. |

## Critical-path risks inside the 8 weeks
1. **The <10KB budget** — enforce in CI from Week 1; push heavy logic to the edge, ship a thin client.
2. **Consent Mode v2 ordering** — defaults must be set *before* Google tags; verify in Tag Assistant Week 2.
3. **Stripe per-visitor metering** — fiddly; reserve a full half-week (W7) and keep a flat-tier fallback.
