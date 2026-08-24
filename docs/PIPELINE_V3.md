# Pipeline V3

Pipeline V3 is the high-performance large-city scan path used by `--full-gastro-scan`.

It preserves the certified V2 notice semantics while reducing browser and filesystem overhead.

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

Discovery and notice checking use separate page pools. Search pages are closed before detail checking starts.

## What is faster

Pipeline V3 adds:

- parallel discovery;
- a single browser evaluation for each visible search-result batch instead of one Playwright round trip per link;
- O(1) indexed venue deduplication during discovery;
- O(1) indexed row updates during notice checking;
- one browser evaluation for relevant venue/review text;
- MutationObserver-assisted notice settling;
- immediate completion when positive removal evidence appears;
- the same conservative 1.8 second settle window before a negative notice is accepted;
- images, media and fonts blocked;
- reduced-motion browser rendering;
- state checkpoints every 5 processed venues instead of every successful venue;
- CSV checkpoints every 25 processed venues;
- a shared rate-limit cooldown across detail workers;
- separate discovery and notice timing metrics.

The hot path never marks a venue `ok` unless rating, review count and the reviews panel were all successfully observed.

## Safe baseline

The known good V2 reference was:

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

V3 should not be considered certified until the same live control run reproduces those results (subject to Google changing the notices themselves).

## Commands

Conservative V3:

```bash
npm start -- \
  --city Osnabrück \
  --country Germany \
  --full-gastro-scan \
  --depth 1 \
  --discovery-workers 1 \
  --workers 2
```

Performance test:

```bash
npm start -- \
  --city Osnabrück \
  --country Germany \
  --full-gastro-scan \
  --depth 1 \
  --discovery-workers 4 \
  --workers 3
```

`--turbo` is shorthand for the current performance defaults:

```text
discovery workers = 4
notice workers    = 3
```

It does not enable headless mode.

```bash
npm start -- \
  --city Osnabrück \
  --country Germany \
  --full-gastro-scan \
  --depth 1 \
  --turbo
```

Explicit worker flags override the turbo defaults.

## Metrics

V3 prints:

```text
Raw discovery slots
Unique venues
Dedupe saved checks
Discovery runtime
Notice runtime
Total runtime
```

This makes worker-count decisions benchmarkable rather than speculative.

## Large scan

Only after the small positive-control scan is clean:

```bash
npm start -- \
  --city Osnabrück \
  --country Germany \
  --full-gastro-scan \
  --depth 50 \
  --turbo
```

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

## Next frontier: browserless notice extraction

The largest possible future speedup is to determine whether Google exposes the removal notice in a structured Maps network/RPC response. If the same notice can be reproduced from a stable structured response for known positive controls, detail-page rendering could potentially be reduced or removed. This is deliberately not used by V3 until parity is demonstrated.
