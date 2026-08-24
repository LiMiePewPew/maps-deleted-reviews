# CloakBrowser experimental backend

The default crawler runtime is **Playwright Chromium**. This matches the known-working upstream architecture and is the runtime that should be used for current data-quality certification.

CloakBrowser 0.5.8 remains installed as an **experimental backend** for isolated A/B testing. It is no longer installed globally behind Playwright and it does not monkeypatch `chromium.launchPersistentContext()`.

## Why the global patch was removed

During the macOS migration, the global CloakBrowser integration introduced browser lifecycle failures and eventually a recursive persistent-context launch loop. The recursive loop happened because CloakBrowser's persistent launcher delegates into Playwright internally while the crawler had replaced that same Playwright method globally.

The default runtime is therefore intentionally simple again:

```text
crawler
  -> Playwright chromium.launchPersistentContext()
  -> persistent Playwright profile
  -> Google Maps
```

The experimental Cloak path is explicit instead:

```text
launchExperimentalCloakPersistentContext(...)
  -> CloakBrowser launchPersistentContext(...)
  -> CloakBrowser patched Chromium
```

No global browser method is modified.

## Current validation policy

Use the default Playwright runtime for the positive-control scan:

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

Expected startup:

```text
Browser: Playwright Chromium
```

A crawler run is not considered notice-certified unless it also reproduces known positive controls and finishes without partial or failed detail rows.

## CloakBrowser experiment policy

`src/browserRuntime.ts` exposes `launchExperimentalCloakPersistentContext()` for future controlled tests. It is intentionally not wired into the normal CLI path yet.

When CloakBrowser is tested again, compare the same venue set, same review interaction, same parser, and same output semantics against the Playwright baseline before considering promotion.

The crawler does not add proxy rotation, CAPTCHA solvers, or automatic challenge bypass logic. Challenges remain a failed/blocked scrape rather than something to defeat.
