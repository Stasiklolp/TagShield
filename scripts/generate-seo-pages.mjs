#!/usr/bin/env node
/**
 * Programmatic SEO page generator.
 *
 * Builds three page sets that rank on intent-rich, low-competition queries the incumbents ignore:
 *   1. per US state    -> apps/web/seo/states/<code>.html   ("[State] cookie consent law requirements")
 *   2. per platform    -> apps/web/seo/platforms/<slug>.html ("Cookie consent for [Platform]")
 *   3. per competitor  -> apps/web/seo/vs/<slug>.html        ("[Competitor] alternative")
 *
 * Dependency-free (Node 18+ built-ins only). Edit scripts/data/*.json to expand coverage
 * (all 20 states, all platforms, all 9 competitors), then re-run:  node scripts/generate-seo-pages.mjs
 *
 * The single states.json file IS your law-tracking discipline: update it once, every page + the
 * edge rule engine stay consistent.
 */
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA = join(__dirname, 'data');
const OUT = join(ROOT, 'apps', 'web', 'seo');

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const read = (f) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));

function page({ title, description, h1, bodyHtml, canonical }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${esc(canonical)}" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/styles.css" />
</head>
<body>
<header class="nav"><div class="container nav-inner">
<a class="brand" href="/">⚡ Tagshield</a>
<nav class="nav-links"><a href="/#features">Features</a><a href="/#how">How it works</a><a href="/#security">Security</a><a href="/#pricing">Pricing</a></nav>
<div class="nav-cta"><a class="btn btn-primary" href="/#scan">Start for free</a></div>
</div></header>
<main>
<section class="hero" style="padding:52px 0 8px">
<div class="container"><span class="pill pill-soft">Google Consent Mode v2 native</span>
<h1 style="font-size:clamp(28px,4.4vw,44px);margin-top:16px;max-width:820px">${esc(h1)}</h1></div>
</section>
${bodyHtml}
<section class="scan">
<div class="container scan-inner">
<h2>Check your site in 30 seconds</h2>
<p>See whether your Consent Mode v2 signals are firing and a CMP is detected — free, no signup.</p>
<a class="btn btn-primary btn-lg" href="/#scan" style="margin-top:18px">Scan my site free →</a>
</div>
</section>
</main>
<footer class="foot">
<div class="container foot-legal"><p class="muted">© 2026 Tagshield — consent that keeps your ads running. A tool, not legal advice; always confirm your obligations with counsel.</p></div>
</footer>
</body></html>`;
}

function writePage(rel, html) {
  const full = join(OUT, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, html);
}

// ---- 1. states ----
function buildStates() {
  const states = read('states.json');
  for (const s of states) {
    const basis = s.gpc ? 'opt-out (you must honor the Global Privacy Control)' : 'opt-out';
    const body = `
<section class="how"><div class="container" style="max-width:820px">
<p class="sub" style="max-width:none">The <strong>${esc(s.law)}</strong> took effect on <strong>${esc(s.effective)}</strong>. If you run
Google Ads or analytics for visitors in ${esc(s.name)}, here's what your cookie banner must do.</p>
<ul class="ticks" style="margin:8px 0 0">
<li><strong>Consent basis:</strong> ${esc(basis)}.</li>
<li><strong>Global Privacy Control (GPC):</strong> ${s.gpc ? 'binding — you must detect it and opt the visitor out automatically.' : 'not explicitly binding, but honoring it is best practice.'}</li>
<li><strong>"Do Not Sell or Share" link:</strong> ${s.doNotSell ? 'required.' : 'recommended.'}</li>
${s.optOutHonored ? '<li><strong>Display requirement:</strong> as of Jan 1 2026 you must visibly confirm an honored opt-out ("Opt-Out Request Honored").</li>' : ''}
<li><strong>Google Consent Mode v2:</strong> set <code>ad_storage</code>, <code>analytics_storage</code>, <code>ad_user_data</code>, <code>ad_personalization</code> to safe defaults before any tag fires.</li>
</ul>
<p class="muted" style="margin-top:18px">Tagshield resolves the ${esc(s.name)} rules at the edge automatically, honors GPC, and logs every
decision to a tamper-evident vault you can export.</p>
</div></section>`;
    writePage(`states/${s.code.toLowerCase()}.html`, page({
      title: `${s.name} Cookie Consent Law (${s.law}) — Website Requirements 2026`,
      description: `What ${s.law} requires for cookie banners and Google Consent Mode v2 in ${s.name}, and how to comply.`,
      h1: `${s.name} cookie consent requirements (${s.law})`,
      canonical: `https://tagshield.io/seo/states/${s.code.toLowerCase()}`,
      bodyHtml: body,
    }));
  }
  return states.length;
}

// ---- 2. platforms ----
function buildPlatforms() {
  const platforms = read('platforms.json');
  for (const p of platforms) {
    const body = `
<section class="how"><div class="container" style="max-width:820px">
<p class="sub" style="max-width:none">Add a Google Consent Mode v2 cookie banner to your ${esc(p.name)} site in about 10 minutes.</p>
<ol style="color:var(--ink-2);line-height:1.9"><li>${esc(p.install)}</li>
<li>Replace <code>YOUR_SITE_KEY</code> with your Tagshield site key.</li>
<li>Confirm in Google Tag Assistant that consent defaults to <code>denied</code> before tags fire.</li></ol>
<div class="install" style="padding:8px 0"><pre><code>&lt;script&gt;
  window.__tagshield = { key: "YOUR_SITE_KEY" };
  // sets Consent Mode v2 defaults, then loads the &lt;10KB banner
&lt;/script&gt;</code></pre></div>
<p class="muted">Because the banner is sub-10KB and edge-delivered, it won't move your ${esc(p.name)} Core Web Vitals.</p>
</div></section>`;
    writePage(`platforms/${p.slug}.html`, page({
      title: `Cookie Consent for ${p.name} — Google Consent Mode v2 Setup`,
      description: `Install a fast, Consent Mode v2-native cookie consent banner on ${p.name}. Step-by-step, sub-10KB, GPC-ready.`,
      h1: `Cookie consent for ${p.name}`,
      canonical: `https://tagshield.io/seo/platforms/${p.slug}`,
      bodyHtml: body,
    }));
  }
  return platforms.length;
}

// ---- 3. competitor alternative / vs pages ----
function buildVs() {
  const comps = read('competitors.json');
  for (const c of comps) {
    const weak = c.weaknesses.map((w) => `<li>${esc(w)}</li>`).join('');
    const edge = c.tsEdge.map((e) => `<li>${esc(e)}</li>`).join('');
    const body = `
<section class="features"><div class="container">
<div class="cards" style="grid-template-columns:1fr 1fr;max-width:840px;margin:0 auto">
<article class="card"><h4>${esc(c.name)} <span class="muted" style="font-weight:500">(${esc(c.pricing)})</span></h4>
<ul class="muted" style="margin:12px 0 0;padding-left:18px;line-height:1.7">${weak}</ul></article>
<article class="card"><h4>Tagshield</h4><ul class="ticks" style="margin-top:12px">${edge}</ul></article>
</div>
<p class="muted" style="text-align:center;max-width:680px;margin:24px auto 0">Switching from ${esc(c.name)}? Tagshield offers free migration and flat per-visitor
pricing across every site, with a tamper-evident consent vault you can export. No quote call, no Core Web Vitals hit.</p>
</div></section>`;
    writePage(`vs/${c.slug}.html`, page({
      title: `${c.name} Alternative — Tagshield (Faster, Flat-Priced CMP)`,
      description: `Looking for a ${c.name} alternative? Tagshield is a sub-10KB, flat-priced Consent Mode v2 CMP with a tamper-proof consent vault.`,
      h1: `${c.name} alternative: Tagshield`,
      canonical: `https://tagshield.io/seo/vs/${c.slug}`,
      bodyHtml: body,
    }));
  }
  return comps.length;
}

// ---- run ----
rmSync(OUT, { recursive: true, force: true });
const nStates = buildStates();
const nPlatforms = buildPlatforms();
const nVs = buildVs();
const total = nStates + nPlatforms + nVs;
console.log(`Generated ${total} SEO pages → apps/web/seo/`);
console.log(`  states:    ${nStates}  (states/*.html)`);
console.log(`  platforms: ${nPlatforms}  (platforms/*.html)`);
console.log(`  vs:        ${nVs}  (vs/*.html)`);
console.log('Expand coverage by editing scripts/data/*.json (target: 20 states, ~10 platforms, 9 competitors).');
