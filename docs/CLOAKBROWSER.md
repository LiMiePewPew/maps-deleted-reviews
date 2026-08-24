# CloakBrowser runtime

The crawler uses CloakBrowser 0.5.8 as its Chromium runtime.

The existing Playwright locator and page APIs remain in place, but persistent browser launches are routed through CloakBrowser. This keeps the scraper implementation stable while changing the actual Chromium binary/runtime used for Google Maps.

## Install

```bash
npm install
```

The first CloakBrowser launch downloads its patched Chromium binary and caches it under the user's CloakBrowser cache directory. A separate `npx playwright install chromium` is not required for the CloakBrowser runtime.

## Runtime policy

The crawler launches a persistent profile with:

```text
humanize = true
persistent user data directory
configured headed/headless mode
configured locale
configured viewport
```

The crawler does not add proxy rotation, CAPTCHA solvers, or automatic challenge bypass. Existing blocker detection remains authoritative and a challenge is treated as a failed/blocked scrape rather than something to defeat.

## Verification

Run the known Osnabrück positive-control scan after installing dependencies:

```bash
npm test
npm run typecheck

npm start -- \
  --city Osnabrück \
  --country Germany \
  --full-gastro-scan \
  --depth 1 \
  --discovery-workers 4 \
  --workers 2
```

The previous headed reference contained 19 unique venues, 6 removal notices, 0 partial rows and 0 failed rows. Google can change live notices, so individual notice ranges are controls rather than immutable fixtures.

The CLI prints `Browser: CloakBrowser` at startup when the runtime is active.
