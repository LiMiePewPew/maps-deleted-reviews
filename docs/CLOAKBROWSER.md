# CloakBrowser runtime

The crawler uses CloakBrowser 0.5.8 as its Chromium runtime.

The existing Playwright locator and page APIs remain in place. The runtime uses CloakBrowser's patched Chromium binary and official launch/context options, then calls Playwright's original `launchPersistentContext()` directly.

This keeps the crawler implementation stable, preserves a real persistent browser profile, and avoids the higher-level CloakBrowser launch wrapper that caused a Node heap OOM during the macOS migration.

## Install

```bash
npm install
```

The first CloakBrowser launch downloads its patched Chromium binary and caches it under the user's CloakBrowser cache directory. A separate `npx playwright install chromium` is not required for the CloakBrowser runtime.

## Runtime policy

The crawler currently launches with:

```text
CloakBrowser patched Chromium
Playwright persistent user data directory
humanize = false
configured headed/headless mode
configured locale
1440x1100 headed browser window
```

The persistent profile stores normal browser state such as Google consent cookies between runs. A consent screen may still appear on the first run for a new profile.

Pipeline V3 also keeps one unused `about:blank` page alive for the lifetime of the browser context. Discovery and notice worker pages are closed between phases, and Cloak Chromium on macOS was observed to terminate when the final browser window disappeared. The spare page prevents that phase-transition shutdown and is closed only when the complete browser context closes.

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

Expected startup now includes:

```text
Browser: CloakBrowser
CloakBrowser: launching headed (..., persistent Playwright integration)...
CloakBrowser: persistent profile enabled
CloakBrowser: started
```

The previous headed reference contained 19 unique venues, 6 removal notices, 0 partial rows and 0 failed rows. Google can change live notices, so individual notice ranges are controls rather than immutable fixtures.

The CLI prints `Browser: CloakBrowser` at startup when the runtime is active.
