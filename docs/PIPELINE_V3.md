# Pipeline V3

Pipeline V3 is the high-performance large-city scan path used by `--full-gastro-scan`.

It combines parallel discovery, indexed deduplication, resumable state, and conservative removal-notice certification. The current default browser runtime is Playwright Chromium, matching the known-working upstream architecture.

## Architecture

```text
search terms
   |
   +--> discovery worker 1
   +--> discovery worker 2
   +--> discovery worker 3
   +--> discovery worker 4
              |
              v
      indexed place dedupe
              |
              v
       unique venue queue
              |
   +--> notice worker 1
   +--> notice worker 2
   +--> notice worker 3
              |
              v
    certified removal notice
              |
       CSV + positive CSV
```

Discovery and notice checking use separate page pools inside one persistent Playwright browser context.

## Browser Runtime

The current stack is:

```text
Pipeline V3
  -> Playwright Page / Locator API
  -> Playwright chromium.launchPersistentContext()
  -> persistent Chromium profile
```

This restores the browser lifecycle used by the known-working upstream implementation. No Playwright browser method is monkeypatched.

CloakBrowser remains available only as an explicit experimental backend in `src/browserRuntime.ts`. It is not wired into the normal CLI path and must prove A/B parity against the Playwright baseline before promotion.

## What is faster

Pipeline V3 adds:

- parallel discovery;
- a single browser evaluation for each visible search-result batch instead of one Playwright round trip per link;
- O(1) indexed venue deduplication during discovery;
- O(1) indexed row updates during notice checking;
- targeted venue/review text extraction;
- immediate completion when positive removal evidence appears;
- strict negative evidence requiring a real review sort control plus hydrated review-card content;
- a conservative 4 second stable-review-panel window before a negative notice is accepted;
- images, media and fonts blocked;
- reduced-motion browser rendering;
- state checkpoints every 5 processed venues instead of every successful venue;
- CSV checkpoints every 25 processed venues;
- a shared rate-limit cooldown across detail workers;
- separate discovery and notice timing metrics.

The current removal-notice settle loop runs on the Node side with short DOM snapshots every 200 ms. A previous long-running browser-side MutationObserver implementation was removed after it failed to settle reliably during the browser migration.

A generic `Sortieren`, `Relevanteste`, or review count elsewhere on the venue page is not enough to certify a negative result. If Google visibly renders a defamation-removal notice that the parser cannot understand, the venue remains `partial` rather than degrading to a false negative.

The hot path never marks a venue `ok` unless rating, review count and strict reviews-panel evidence were successfully observed.

## Current Certification Status

The known-good Playwright reference was:

```text
Osnabrück, depth 1
19 unique venues
6 removal notices
0 partial
0 failed
```

Known positive controls included:

```text
Made in Berlin Döner Osnabrück  51-100
Kakkoii Sushi Grill & Bar       201-250
The Mill Burger & Pizza         21-50
Welcome to Napoli               21-50
Taste of India                  6-10
HasAntep ÇiğKöfte Osnabrück     2-5
```

During later V3 work, four discovery workers completed the 20-term depth-1 Osnabrück discovery in about 12 seconds in one observed run, producing 19 unique venues from 20 raw slots.

A browser-migration run exposed a false-negative certification bug: all 19 venues returned `ok` while all known positive controls disappeared. Pipeline state version 2 invalidates those earlier results, and the negative-certification path now requires hydrated review-panel evidence instead of generic page text.

The current task is to re-certify V3 on the restored Playwright runtime. Do not consider V3 fully certified until a clean live run returns `Partial: 0`, `Failed: 0`, and positive controls are reproduced subject to legitimate changes in Google's live notices.

## Commands

Current validation command:

```bash
npm start -- \
  --city Osnabrück \
  --country Germany \
  --full-gastro-scan \
  --depth 1 \
  --discovery-workers 4 \
  --workers 2
```

Conservative worker configuration:

```bash
npm start -- \
  --city Osnabrück \
  --country Germany \
  --full-gastro-scan \
  --depth 1 \
  --discovery-workers 1 \
  --workers 2
```

`--turbo` is shorthand for:

```text
discovery workers = 4
notice workers    = 3
```

It does not enable headless mode.

Explicit worker flags override the turbo defaults.

## Metrics

V3 prints:

```text
Raw discovery slots
Unique venues
Dedupe saved detail checks
Checked venues
Removal notices
Partial
Failed
Discovery runtime
Notice runtime
Total runtime
```

This makes worker-count decisions benchmarkable rather than speculative.

## Resume Semantics

V3 persists a city-specific JSON state file. Completed discovery terms are reused on an unfinished rerun.

A venue is only added to `completedVenueKeys` after an `ok` detail result. Partial and failed rows remain retryable.

The state schema is versioned. Changes that alter certification semantics can increment the state version so older `ok` rows are not reused as trusted evidence.

Once a run finishes with no partial or failed rows, it is marked complete. Invoking the same scan again starts a fresh snapshot.

## Large Scan

Only after the small positive-control scan is clean:

```bash
npm start -- \
  --city Osnabrück \
  --country Germany \
  --full-gastro-scan \
  --depth 50 \
  --discovery-workers 4 \
  --workers 2
```

Move to `--turbo` only after the higher notice-worker count preserves data parity.

If Google challenges the browser, V3 coordinates a shared cooldown so all notice workers do not immediately retry at once.

## Headless

Headless remains opt-in:

```bash
... --headless
```

Do not treat headless as certified until a headed and headless run on the same venue set produce matching review counts and removal-notice rows.

## Verification

Always run:

```bash
npm test
npm run typecheck
```

before using V3 output as data.

## Next Frontier

The largest possible future speedup is to determine whether Google exposes the removal notice in a structured Maps network/RPC response. If the same notice can be reproduced from a stable structured response for known positive controls, detail-page rendering could potentially be reduced or removed.

This is deliberately not used as production evidence until parity is demonstrated.
