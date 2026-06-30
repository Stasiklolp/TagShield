/**
 * Tagshield banner runtime.
 *
 * Design constraints (do not violate without re-running the size gate):
 *  - Vanilla TS, no framework, no web fonts, inline critical CSS, no extra network requests
 *    beyond ONE edge-cached config fetch and ONE sendBeacon on decision.
 *  - Consent Mode v2 *defaults* are set DENIED by the inline <head> snippet BEFORE this script
 *    runs (see install-snippet.html). This file only ever calls gtag('consent','update', ...).
 *  - No layout shift: the banner is position:fixed and never reflows page content.
 *
 * Served statically as /b.js (edge-cached for every site). The site key is passed by the
 * inline snippet via window.__tagshield = { key, api }.
 */
import type {
  Category,
  ConsentDecision,
  ConsentModeSignals,
  SiteConfig,
} from './types';

declare global {
  interface Window {
    __tagshield?: { key: string; api?: string };
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
  interface Navigator {
    globalPrivacyControl?: boolean;
  }
}

const boot = window.__tagshield;
if (boot && boot.key) {
  // Default API origin; overridable for self-hosting / staging.
  const API = boot.api || 'https://cdn.tagshield.io';
  const KEY = boot.key;
  const STORE = `ts:${KEY}`;
  const gpc = navigator.globalPrivacyControl === true;

  const gtag = (...a: unknown[]) => {
    (window.dataLayer = window.dataLayer || []).push(arguments_(a));
  };
  // gtag pushes the raw `arguments` object, not an array — preserve that shape.
  function arguments_(a: unknown[]): unknown {
    return a.length === 1 ? a[0] : a;
  }

  const ALL_GRANTED: ConsentModeSignals = {
    ad_storage: 'granted',
    analytics_storage: 'granted',
    ad_user_data: 'granted',
    ad_personalization: 'granted',
  };
  const ALL_DENIED: ConsentModeSignals = {
    ad_storage: 'denied',
    analytics_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  };

  const catsToSignals = (c: Record<Category, boolean>): ConsentModeSignals => ({
    ad_storage: c.marketing ? 'granted' : 'denied',
    ad_user_data: c.marketing ? 'granted' : 'denied',
    ad_personalization: c.marketing ? 'granted' : 'denied',
    analytics_storage: c.analytics ? 'granted' : 'denied',
  });

  const apply = (signals: ConsentModeSignals) => {
    // The ONLY Google call this script makes. Defaults were set denied in <head>.
    window.gtag
      ? window.gtag('consent', 'update', signals)
      : gtag('consent', 'update', signals);
  };

  const readStored = (): ConsentDecision | null => {
    try {
      const raw = localStorage.getItem(STORE);
      return raw ? (JSON.parse(raw) as ConsentDecision) : null;
    } catch {
      return null;
    }
  };

  const persistAndLog = (d: ConsentDecision) => {
    try {
      localStorage.setItem(STORE, JSON.stringify(d));
    } catch {
      /* private mode — proceed, just don't persist */
    }
    // Fire-and-forget: never block the UI or the page.
    try {
      const body = JSON.stringify(d);
      if (navigator.sendBeacon) {
        navigator.sendBeacon(`${API}/c`, body);
      } else {
        fetch(`${API}/c`, { method: 'POST', body, keepalive: true });
      }
    } catch {
      /* logging is best-effort */
    }
  };

  const decide = (
    cfg: SiteConfig,
    cats: Record<Category, boolean>,
    source: ConsentDecision['source'],
  ) => {
    const signals = catsToSignals(cats);
    apply(signals);
    persistAndLog({
      v: 1,
      key: KEY,
      cats,
      signals,
      source,
      gpc,
      ts: Date.now(),
      cfgv: (cfg as unknown as { cfgv?: string }).cfgv || '0',
    });
  };

  // ---- main flow -------------------------------------------------------------
  const main = (cfg: SiteConfig) => {
    const allCats = (granted: boolean): Record<Category, boolean> => ({
      necessary: true,
      analytics: granted,
      marketing: granted,
      functional: granted,
    });

    // 1) Returning visitor: re-apply their stored choice, no prompt.
    const stored = readStored();
    if (stored) {
      apply(stored.signals);
      return;
    }

    // 2) GPC present + binding region: auto opt-out before anything renders.
    if (gpc && cfg.gpcBinding) {
      decide(cfg, allCats(false), 'gpc');
      // In opt-out regions we still surface the (non-blocking) "Opt-Out Honored" notice.
      if (cfg.showOptOutHonored) renderBanner(cfg, /*noticeOnly*/ true, /*gpcHonored*/ true);
      return;
    }

    // 3) Notice-only regions (rest-of-US): default-allow, show a dismissible notice.
    if (cfg.regime === 'notice') {
      decide(cfg, allCats(true), 'auto_notice');
      renderBanner(cfg, true, false);
      return;
    }

    // 4) Opt-out states (no GPC): default-allow but offer easy opt-out + Do-Not-Sell.
    if (cfg.regime === 'opt_out_gpc') {
      decide(cfg, allCats(true), 'auto_notice');
      renderBanner(cfg, false, false); // show real choices
      return;
    }

    // 5) Opt-in regions (EEA/UK/CH/...): block, defaults stay denied, require a choice.
    renderBanner(cfg, false, false);
  };

  // ---- UI (inline-styled, fixed-position, no CLS, no web fonts) ---------------
  let root: HTMLElement | null = null;

  const renderBanner = (cfg: SiteConfig, noticeOnly: boolean, gpcHonored: boolean) => {
    if (root) return;
    const t = cfg.theme;
    root = document.createElement('div');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', cfg.copy.title);
    root.setAttribute('aria-live', 'polite');
    const pos =
      t.position === 'top'
        ? 'top:0;left:0;right:0;'
        : t.position === 'corner'
          ? 'bottom:16px;right:16px;max-width:420px;'
          : 'bottom:0;left:0;right:0;';
    root.style.cssText =
      `position:fixed;z-index:2147483647;${pos}` +
      `background:${t.bg};color:${t.fg};font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;` +
      `box-shadow:0 -2px 16px rgba(0,0,0,.18);border-radius:${t.radius}px;padding:16px 18px;` +
      `box-sizing:border-box;`;

    const btn = (label: string, primary: boolean) =>
      `<button data-ts="${label}" style="cursor:pointer;border:0;border-radius:${t.radius}px;` +
      `padding:9px 16px;margin:6px 6px 0 0;font:inherit;font-weight:600;` +
      (primary
        ? `background:${t.accent};color:#fff;`
        : `background:transparent;color:${t.fg};border:1px solid ${t.fg};`) +
      `">${label}</button>`;

    const honored = gpcHonored && cfg.showOptOutHonored
      ? `<div style="margin-bottom:8px;font-weight:600">✓ ${cfg.copy.optOutHonored}</div>`
      : '';
    const dns = cfg.doNotSell
      ? `<a href="#" data-ts="dns" style="color:${t.accent};text-decoration:underline;margin-left:8px">${cfg.copy.doNotSellLabel}</a>`
      : '';
    const badge = cfg.showBadge
      ? `<a href="https://tagshield.io" target="_blank" rel="noopener" style="opacity:.6;color:${t.fg};font-size:11px;text-decoration:none;margin-left:8px">⚡ by Tagshield</a>`
      : '';

    // Equal-prominence Accept/Reject (2026 enforcement requires Reject as easy as Accept).
    const actions = noticeOnly
      ? btn('OK', true)
      : btn(cfg.copy.accept, true) + btn(cfg.copy.reject, true) + btn(cfg.copy.prefs, false);

    root.innerHTML =
      `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:12px;justify-content:space-between">` +
      `<div style="flex:1 1 280px;min-width:240px">${honored}` +
      `<strong style="display:block;margin-bottom:2px">${cfg.copy.title}</strong>` +
      `<span>${cfg.copy.body}</span>${dns}${badge}</div>` +
      `<div style="flex:0 0 auto">${actions}</div></div>` +
      `<div data-ts-prefs style="display:none;margin-top:12px;border-top:1px solid rgba(127,127,127,.3);padding-top:12px"></div>`;

    document.body.appendChild(root);
    wire(cfg, noticeOnly);
  };

  const wire = (cfg: SiteConfig, noticeOnly: boolean) => {
    if (!root) return;
    const close = () => {
      root?.remove();
      root = null;
    };
    root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-ts]') as HTMLElement | null;
      if (!el) return;
      const action = el.getAttribute('data-ts');
      const all = (g: boolean): Record<Category, boolean> => ({
        necessary: true,
        analytics: g,
        marketing: g,
        functional: g,
      });
      if (action === cfg.copy.accept || action === 'OK') {
        decide(cfg, all(true), action === 'OK' ? 'auto_notice' : 'banner_accept');
        close();
      } else if (action === cfg.copy.reject) {
        decide(cfg, all(false), 'banner_reject');
        close();
      } else if (action === cfg.copy.prefs) {
        e.preventDefault();
        renderPrefs(cfg);
      } else if (action === 'dns') {
        e.preventDefault();
        decide(cfg, all(false), 'banner_reject');
        close();
      }
    });
  };

  const renderPrefs = (cfg: SiteConfig) => {
    const panel = root?.querySelector('[data-ts-prefs]') as HTMLElement | null;
    if (!panel) return;
    if (panel.style.display === 'block') {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = 'block';
    panel.innerHTML =
      cfg.categories
        .map((c) => {
          const locked = c === 'necessary';
          return (
            `<label style="display:flex;align-items:center;gap:8px;margin:6px 0">` +
            `<input type="checkbox" data-cat="${c}" ${locked ? 'checked disabled' : ''}/>` +
            `<span style="text-transform:capitalize">${c}</span></label>`
          );
        })
        .join('') +
      `<button data-ts="${cfg.copy.save}" style="cursor:pointer;border:0;border-radius:${cfg.theme.radius}px;` +
      `padding:9px 16px;margin-top:8px;font:inherit;font-weight:600;background:${cfg.theme.accent};color:#fff">${cfg.copy.save}</button>`;
    panel.querySelector(`[data-ts="${cfg.copy.save}"]`)?.addEventListener('click', () => {
      const cats: Record<Category, boolean> = {
        necessary: true,
        analytics: false,
        marketing: false,
        functional: false,
      };
      panel.querySelectorAll<HTMLInputElement>('input[data-cat]').forEach((i) => {
        cats[i.getAttribute('data-cat') as Category] = i.checked;
      });
      decide(cfg, cats, 'banner_save');
      root?.remove();
      root = null;
    });
  };

  // ---- fetch resolved config from the edge, with a fail-safe ------------------
  const start = () => {
    fetch(`${API}/config/${encodeURIComponent(KEY)}`, { credentials: 'omit' })
      .then((r) => r.json() as Promise<SiteConfig>)
      .then((cfg) => {
        try {
          localStorage.setItem(`${STORE}:cfg`, JSON.stringify(cfg));
        } catch {
          /* ignore */
        }
        main(cfg);
      })
      .catch(() => {
        // Edge unreachable: use last-known-good config; if none, fail safe to opt-in (block).
        let cfg: SiteConfig | null = null;
        try {
          const c = localStorage.getItem(`${STORE}:cfg`);
          cfg = c ? (JSON.parse(c) as SiteConfig) : null;
        } catch {
          /* ignore */
        }
        if (cfg) main(cfg);
        // No config + no cache: defaults already denied in <head>, so we simply do nothing
        // (tags stay blocked = the safe failure mode). The next page load retries the edge.
      });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}
