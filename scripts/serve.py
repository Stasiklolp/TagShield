#!/usr/bin/env python3
"""Static file server for apps/web + a working /scan endpoint for the Consent Mode v2 checker.

    python3 scripts/serve.py        # http://127.0.0.1:4187  (serves the site AND /scan)

/scan?url=<site> fetches the target server-side (no CORS limits), inspects the HTML for Google
tags, Consent Mode v2 signals, and a CMP, and returns a JSON verdict the landing page renders.
This mirrors the production Cloudflare Worker route in packages/edge/src/index.ts.
"""
import http.server
import socketserver
import os
import json
import re
import ssl
import urllib.request
from urllib.parse import urlparse, parse_qs

PORT = 4187
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "apps", "web"))

VENDORS = [
    ("cookiebot", "Cookiebot"), ("otSDKStub", "OneTrust"), ("onetrust", "OneTrust"),
    ("usercentrics", "Usercentrics"), ("cookieyes", "CookieYes"), ("termly", "Termly"),
    ("iubenda", "iubenda"), ("osano", "Osano"), ("enzuzo", "Enzuzo"), ("didomi", "Didomi"),
    ("trustarc", "TrustArc"), ("quantcast", "Quantcast"), ("complianz", "Complianz"),
    ("klaro", "Klaro"), ("cookieconsent", "CookieConsent"), ("tagshield", "Tagshield"),
]


def analyze(url, html):
    h = html.lower()
    norm = re.sub(r"\s+", "", h).replace('"', "'")
    has_google = any(s in h for s in ["googletagmanager.com/gtm.js", "gtag/js", "google-analytics.com", "gtag("])
    has_consent = any(s in norm for s in ["gtag('consent','default'", "gtag('consent','update'",
                                          "'consent','default'", "'consent','update'", "consentmode"])
    has_v2 = ("ad_user_data" in h) and ("ad_personalization" in h)
    vendor = next((label for key, label in VENDORS if key.lower() in h), None)

    checks = []
    checks.append({
        "id": "https", "label": "HTTPS",
        "status": "pass" if url.startswith("https://") else "warn",
        "detail": "Served securely." if url.startswith("https://") else "Not secure — HTTPS is required for modern cookies.",
    })
    if has_google:
        checks.append({"id": "google", "label": "Google tags detected", "status": "pass",
                       "detail": "Google Ads / GA4 / Tag Manager found on the page."})
    else:
        checks.append({"id": "google", "label": "Google Ads / GA4", "status": "info",
                       "detail": "No Google tags detected — Consent Mode may not apply here."})

    if has_google and has_consent:
        checks.append({"id": "consent", "label": "Consent Mode active", "status": "pass",
                       "detail": "A Consent Mode default/update was detected."})
    elif has_google and not has_consent:
        checks.append({"id": "consent", "label": "Consent Mode missing", "status": "fail",
                       "detail": "Google tags fire with no Consent Mode — EU ads/measurement may be degraded or non-compliant."})

    if has_consent and has_v2:
        checks.append({"id": "v2", "label": "Consent Mode v2 parameters", "status": "pass",
                       "detail": "ad_user_data and ad_personalization are present."})
    elif has_consent and not has_v2:
        checks.append({"id": "v2", "label": "Consent Mode v2 parameters", "status": "warn",
                       "detail": "ad_user_data / ad_personalization not found — upgrade to v2."})

    checks.append({
        "id": "cmp", "label": "Consent banner (CMP)",
        "status": "pass" if vendor else "warn",
        "detail": (f"Detected: {vendor}." if vendor else "No consent banner / CMP detected on the page."),
    })
    return {"url": url, "checks": checks}


def scan(url):
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    try:
        ctx = ssl.create_default_context()
        req = urllib.request.Request(url, headers={"User-Agent": "TagshieldScanner/1.0 (+https://tagshield.io)"})
        with urllib.request.urlopen(req, timeout=8, context=ctx) as resp:
            final = resp.geturl()
            raw = resp.read(700_000)
            charset = resp.headers.get_content_charset() or "utf-8"
            html = raw.decode(charset, errors="replace")
        return analyze(final, html)
    except Exception as ex:  # network / TLS / DNS errors -> a renderable verdict, not a 500
        return {"url": url, "checks": [
            {"id": "reach", "label": "Couldn't load the site", "status": "fail",
             "detail": f"We couldn't fetch this URL ({type(ex).__name__}). Check the address and try again."}
        ]}


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/scan":
            params = parse_qs(parsed.query)
            url = (params.get("url") or [""])[0]
            body = json.dumps(scan(url)).encode() if url else b'{"error":"missing url"}'
            self.send_response(200 if url else 400)
            self.send_header("content-type", "application/json; charset=utf-8")
            self.send_header("access-control-allow-origin", "*")
            self.send_header("cache-control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()


os.chdir(ROOT)
with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
    print(f"serving {ROOT} (+/scan) at http://127.0.0.1:{PORT}")
    httpd.serve_forever()
