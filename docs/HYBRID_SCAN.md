# Hybrid city scan

The hybrid mode separates broad Google Maps discovery from the specialized deletion-notice check.

## Architecture

```text
20 gastro queries
      |
      v
gosom/google-maps-scraper
      |
      v
raw discovery CSV
      |
      v
place_id / data_id / cid / URL dedupe
      |
      v
unique direct Google Maps places
      |
      v
maps-deleted-reviews notice checker
      |
      v
all results + positive-only CSV
```

The gosom stage is used only for discovery. It does not decide whether a Google deletion notice exists. The existing specialized Playwright parser remains the authority for the notice fields.

## Requirements

- Node.js and npm
- Playwright dependencies already used by this project
- Docker Desktop running

The first hybrid run may need to pull the `gosom/google-maps-scraper` Docker image.

## Osnabrück

```bash
npm run hybrid -- \
  --city Osnabrück \
  --country Germany
```

By default the command:

- uses the full gastro search-term preset;
- runs gosom discovery with concurrency 4;
- uses gosom result depth 10;
- deduplicates by `place_id`, then `data_id`, then `cid`, then normalized Maps URL;
- runs the specialized notice checker in headed mode;
- preserves the existing resumable state behavior.

## Output

For Osnabrück:

```text
output/hybrid-osnabruck/queries.txt
output/hybrid-osnabruck/gosom-discovery.csv
output/hybrid-osnabruck/venues.json
output/deleted-reviews-osnabruck-hybrid.csv
output/deleted-reviews-osnabruck-hybrid-positive.csv
output/state-osnabruck-hybrid.json
output/summary-osnabruck-hybrid.json
```

`venues.json` is the normalized discovery manifest and retains gosom identifiers and basic discovery metadata.

The `*-hybrid-positive.csv` file contains only rows where the specialized checker observed a Google removal notice.

## Tuning discovery

```bash
npm run hybrid -- \
  --city Osnabrück \
  --country Germany \
  --gosom-concurrency 6 \
  --gosom-depth 12
```

Higher gosom concurrency can improve discovery throughput but can also increase resource use or blocking. The notice stage is intentionally not aggressively parallelized yet.

Custom terms:

```bash
npm run hybrid -- \
  --city Osnabrück \
  --country Germany \
  --terms restaurant,Cafe,bar,Pizza,Sushi,Döner
```

## Resume and refresh

An interrupted notice pass uses the existing state file on the next run.

To force a fresh notice pass while keeping the new discovery stage:

```bash
npm run hybrid -- \
  --city Osnabrück \
  --country Germany \
  --refresh-notices
```

## Headless

The hybrid notice stage defaults to headed mode because headed Playwright has already produced correct live Osnabrück review counts and deletion notices.

Headless remains available for parity testing:

```bash
npm run hybrid -- \
  --city Osnabrück \
  --country Germany \
  --headless
```

Do not treat headless output as certified until its review counts and deletion notices match a headed control run.
