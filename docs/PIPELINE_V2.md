# Pipeline V2

Pipeline V2 is the large-city scan path used by `--full-gastro-scan`.

It is intentionally different from the legacy per-query crawler.

## Architecture

```text
search terms
    |
    v
Google Maps discovery
    |
    v
normalized venue identities
    |
    v
deduplicated venue queue
    |
    v
certified notice checker
    |
    +--> all rows CSV
    +--> positive notice CSV
    +--> resumable JSON state
```

The discovery phase completes all configured search terms before venue detail checks begin. A place returned by several queries is therefore checked only once.

## Osnabrück full scan

Start conservatively with one worker:

```bash
npm start -- \
  --city Osnabrück \
  --country Germany \
  --full-gastro-scan \
  --depth 50 \
  --workers 1
```

The default mode remains headed unless `--headless` is supplied.

After headed correctness is certified, a controlled two-worker run can be tested:

```bash
npm start -- \
  --city Osnabrück \
  --country Germany \
  --full-gastro-scan \
  --depth 50 \
  --workers 2
```

Do not increase worker count just because the CLI permits it. Google-side throttling can make higher concurrency slower and less reliable.

## Headless

Pipeline V2 does not treat `domcontentloaded` as sufficient evidence that a venue is ready.

Before a venue can be `ok`, it waits for:

1. a parseable star rating,
2. a parseable visible review count,
3. a successfully opened reviews panel.

If the review panel cannot be certified, the row is `partial` rather than being reported as a zero-notice result.

This specifically prevents the earlier failure mode where headless runs printed `unknown total reviews` while still appearing successful.

## Performance choices

Pipeline V2:

- discovers first and scrapes second;
- deduplicates venues before detail navigation;
- blocks images, media and fonts;
- writes durable JSON state after each processed venue;
- checkpoints the CSV every 10 venues and writes a final CSV at completion;
- supports a bounded worker count via `--workers`.

The expensive part remains Google Maps/Chromium navigation, not TypeScript computation.

## Outputs

For Osnabrück:

```text
output/deleted-reviews-osnabruck-gastro-all.csv
output/deleted-reviews-osnabruck-gastro-all-positive.csv
output/state-osnabruck-gastro-v2.json
```

`*-positive.csv` contains only rows where the Google removal notice text was actually observed.

A zero notice on an `ok` row means no supported removal notice was observed during that certified scrape. It does not mean Google has never removed another review for another reason.

## Verification

Before using the results as data:

```bash
npm test
npm run typecheck
```

Then run a headed scan first. Headless should only be treated as certified after its counts and notice rows match a headed reference run on the same venue set.
