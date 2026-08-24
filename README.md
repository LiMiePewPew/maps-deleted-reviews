# Google Maps Deleted Reviews Scraper

High-performance Node.js scraper for collecting Google Maps transparency notices about reviews removed after complaints regarding defamation.

The current large-scan path uses **CloakBrowser's patched Chromium**, the Playwright page/locator API, parallel Google Maps discovery, venue deduplication, resumable state, and a conservative review-notice certification step.

> **Important:** a Google removal notice is not an exact count of every review ever removed from a business. Treat the displayed range as Google-provided transparency information for the notice shown in the current Maps UI.

## Current Status

The project has two execution paths:

- **Pipeline V3** for `--full-gastro-scan` / `--large-list`. This is the current high-performance path.
- **Legacy single/batch search** for `--search-term`, `--search-terms`, and older config-driven runs.

Current V3 browser stack:

```text
crawler
  -> Playwright page/locator API
  -> CloakBrowser launch options
  -> CloakBrowser patched Chromium
  -> Google Maps
```

Verified during the CloakBrowser migration:

- CloakBrowser Pro Chromium 150 starts successfully on Apple Silicon macOS.
- Four parallel discovery workers successfully completed the 20-term Osnabrück depth-1 discovery scan.
- The 20 searches produced 19 unique venues from 20 raw discovery slots in about 12 seconds in one observed run.
- Rating and visible review-count extraction worked for all 19 discovered venues in that run.

**Removal-notice parity is currently being re-certified after the browser migration.** The latest review-panel settle implementation uses short Node-side polling rather than a long-running browser-side MutationObserver. Do not treat a V3 run as fully certified unless it finishes with `Partial: 0`, `Failed: 0`, and known positive controls still reproduce their Google notices.

## What the Google Notice Means

On Google Maps in Germany, Google may display wording indicating that a range of reviews was removed following complaints regarding defamation.

Observed ranges include values such as:

```text
1
2-5
6-10
11-20
21-50
51-100
101-150
151-200
201-250
over 250
```

Safe interpretation:

> Google currently displays a notice that 101-150 reviews were removed following complaints regarding defamation.

Do **not** automatically interpret this as:

- the business personally deleted that number of reviews;
- an exact deletion count;
- every review Google has ever moderated;
- evidence that a business or reviewer acted unlawfully.

A missing notice should be described as **"no Google removal notice observed"**, not as proof that zero reviews were removed.

## Requirements

- Node.js 20 or newer
- npm
- macOS, Linux, or another CloakBrowser-supported desktop environment
- a desktop session for the currently recommended headed mode

The project currently pins:

```text
cloakbrowser 0.5.8
```

Playwright remains installed because the crawler uses its Page, Locator, BrowserContext, routing, and navigation APIs. The browser binary itself is CloakBrowser's patched Chromium.

## Installation

Clone the repository and install dependencies:

```bash
npm install
```

You do not need `npx playwright install chromium` for the CloakBrowser path.

### CloakBrowser key

CloakBrowser can manage the key outside the repository:

```bash
npx cloakbrowser login YOUR_KEY
```

Then inspect the installation:

```bash
npx cloakbrowser info
```

The default key location is:

```text
~/.cloakbrowser/license.key
```

You can alternatively provide a key through the environment:

```bash
export CLOAKBROWSER_LICENSE_KEY="YOUR_KEY"
```

Never commit the key to this repository, `config.json`, source files, or Git history.

## Recommended Smoke Test

Before a large scan:

```bash
npm test
npm run typecheck
```

Then run a small headed V3 scan:

```bash
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
Browser: CloakBrowser
CloakBrowser: launching headed (..., pro, direct Playwright integration)...
CloakBrowser: started

=== PHASE 1: DISCOVERY (4 workers) ===
```

A healthy completed scan should have:

```text
Partial: 0
Failed: 0
```

If either value is non-zero, inspect the printed per-venue error before using the output as data.

## Pipeline V3

`--full-gastro-scan` enables the high-performance city pipeline.

Architecture:

```text
20 search terms
      |
      +--> discovery worker 1
      +--> discovery worker 2
      +--> discovery worker 3
      +--> discovery worker 4
                    |
                    v
           Maps venue identities
                    |
                    v
          canonicalize + dedupe
                    |
                    v
             unique venue queue
                    |
             +------+------+
             |             |
       notice worker 1  notice worker 2 ...
             |             |
             +------+------+
                    |
                    v
          certified result rows
                    |
        +-----------+-----------+
        |                       |
      all CSV               positive CSV
```

V3 currently includes:

- parallel discovery;
- separate discovery and notice page pools;
- batched search-result extraction;
- Maps identity-based deduplication;
- O(1) venue and result indexes;
- images, media, and fonts blocked;
- reduced-motion rendering;
- persistent resumable JSON state;
- batched state and CSV checkpoints;
- shared cooldown when Google presents a rate limit or challenge;
- separate discovery and notice timings;
- immediate acceptance of a positive removal notice;
- a conservative settle window before a negative result is accepted.

### Full gastro search terms

The current full scan searches:

```text
restaurant
Cafe
bar
Hotel
Imbiss
Pizza
Döner
Sushi
Burger
Frühstück
Bäckerei
Eiscafe
italienisch
griechisch
indisch
asiatisch
vegan
Steakhouse
Pub
Cocktailbar
```

This is a broad Google Maps search strategy, **not an exhaustive inventory of every venue in a city**. Google ranking, localization, query interpretation, result caps, and UI behavior determine what is discoverable.

## Worker Controls

Notice/detail workers:

```bash
--workers 2
```

Discovery workers:

```bash
--discovery-workers 4
```

Both accept integer values from 1 to 8.

Current performance shorthand:

```bash
--turbo
```

`--turbo` currently means:

```text
discovery workers = 4
notice workers    = 3
```

It does **not** automatically enable headless mode.

For data-quality validation, use the explicit `4 + 2` command first before increasing notice concurrency.

## Large Scan

Only move to a large scan after the small positive-control run is clean:

```bash
npm start -- \
  --city Osnabrück \
  --country Germany \
  --full-gastro-scan \
  --depth 50 \
  --discovery-workers 4 \
  --workers 2
```

Or, after the current turbo settings have been validated:

```bash
npm start -- \
  --city Osnabrück \
  --country Germany \
  --full-gastro-scan \
  --depth 50 \
  --turbo
```

`depth` is the maximum number of venues requested **per search term**, before cross-term deduplication.

## Resume Behavior

Pipeline V3 writes a city-specific state file, for example:

```text
output/state-osnabruck-gastro-v3.json
```

Discovery terms already completed are reused on the next invocation:

```text
Discovery cached: restaurant
Discovery cached: Cafe
...
```

Venues are only added to the completed set after an `ok` detail result. `partial` and `failed` rows remain eligible for another detail attempt when the same unfinished state is resumed.

A fully successful finished run represents a completed snapshot. Running the same command again starts a fresh snapshot rather than silently treating the old scan as current.

## V3 Output

Default Osnabrück full-scan files:

```text
output/deleted-reviews-osnabruck-gastro-all.csv
output/deleted-reviews-osnabruck-gastro-all-positive.csv
output/state-osnabruck-gastro-v3.json
```

The positive CSV contains only rows where a Google removal notice was actually parsed.

V3 prints metrics including:

```text
Raw discovery slots
Unique venues
Dedupe saved detail checks
Checked venues
Removal notices
Partial
Failed
Discovery workers
Notice workers
Discovery runtime
Notice runtime
Total runtime
```

## Known Positive Controls

Before the CloakBrowser migration, the certified Osnabrück depth-1 baseline contained 19 unique venues, 6 removal notices, 0 partial rows, and 0 failed rows.

Known positive controls included:

```text
Made in Berlin Döner Osnabrück  51-100
Kakkoii Sushi Grill & Bar       201-250
The Mill Burger & Pizza         21-50
Welcome to Napoli               21-50
Taste of India                  6-10
HasAntep ÇiğKöfte Osnabrück     2-5
```

Google may legitimately change these ranges over time. Their purpose is to detect obvious extraction regressions, not to freeze Google's live data forever.

## Headless Mode

Headed mode is currently the recommended validation mode.

Headless remains opt-in:

```bash
--headless
```

Do not assume headless parity until a headed and headless run over the same venue set reproduce the same review counts, notice rows, partial count, and failed count.

## Legacy / Targeted Search

For a targeted query instead of the full V3 gastro pipeline:

```bash
npm start -- \
  --city Osnabrück \
  --country Germany \
  --search-term "Kakkoii Sushi Grill & Bar" \
  --depth 1
```

Multiple terms:

```bash
npm start -- \
  --city Bonn \
  --country Germany \
  --search-terms restaurant,Cafe,Hotel \
  --depth 50
```

Multiple cities:

```bash
npm start -- \
  --cities Bonn,Köln,Düsseldorf \
  --country Germany \
  --search-term Hotel \
  --depth 50
```

These commands use the older config/batch orchestration rather than the V3 full-gastro city pipeline.

## Configuration File

The legacy/config-driven path can still use `config.json`:

```bash
cp config.example.json config.json
```

Example:

```json
{
  "city": "Bonn",
  "country": "Germany",
  "searchTerm": "restaurant",
  "depth": 50,
  "resumeMode": "pause"
}
```

Run it with:

```bash
npm start -- --config config.json
```

CLI values override the config file where applicable.

Useful flags include:

```text
--city
--cities
--country
--search-term
--search-terms
--full-gastro-scan
--large-list
--depth
--workers
--discovery-workers
--turbo
--navigation-timeout-ms
--max-result-scrolls
--headed
--headless
--output-csv-path
--merge-csv-path
--state-path
--summary-path
--sort-csv
--no-sort-csv
```

## CSV Columns

The standard CSV includes:

```text
venue_type
name
total_reviews
deleted_reviews_min
deleted_reviews_max
percentage_deleted
current_star_rating
real_score
review_notice
url
address
deleted_reviews_estimate
status
error
scraped_at
```

`status` can include:

```text
ok
partial
failed
```

A `partial` row must not be interpreted as a confirmed negative removal-notice result.

## Deleted Review Estimate

Google commonly exposes ranges rather than exact values. The scraper stores the parsed minimum and maximum and may calculate an estimate for metrics.

Any metric based on `deleted_reviews_estimate` is therefore derived, not an official exact Google count.

## Theoretical Adjusted Score

`real_score` is a hypothetical calculation that assumes every estimated removed review would have been a one-star review:

```text
((current_star_rating * total_reviews) + deleted_reviews_estimate)
/ (total_reviews + deleted_reviews_estimate)
```

This is a scenario calculation only. It is **not** Google's hidden rating, proof of manipulation, or a factual reconstruction of removed reviews.

## Selector Strategy

The crawler avoids depending primarily on Google Maps' obfuscated CSS class names.

It prefers:

- accessible roles such as tabs, buttons, feeds, and links;
- visible German/English labels;
- Maps place URLs and stable identity tokens where available;
- targeted DOM extraction;
- regex parsing for review counts, ratings, and removal notices.

Google can change its UI at any time. A clean browser launch is not sufficient evidence that extraction is still correct; positive-control parity remains important.

## Rate Limits and Challenges

The crawler detects common Google challenge/rate-limit text and does not include CAPTCHA solving or automatic challenge bypass logic.

When scaling worker counts, monitor:

```text
Partial
Failed
CAPTCHA/rate-limit errors
notice parity
```

More workers are only useful if data quality remains stable.

## Performance Notes

Moving CPU-bound code to Rust is unlikely to be the main performance lever here. Most runtime is browser navigation, Google Maps rendering, result discovery, and review-panel hydration.

The main implemented speedups are therefore browser/pipeline changes rather than language changes.

A future high-value research direction is structured network/RPC extraction: if the same Google removal notice can be reliably reproduced from a stable Maps response, detail-page rendering may be reduced substantially. This is not used as production evidence until it proves parity with known positive controls.

## Responsible Use

This project automates the public Google Maps web UI. Google may change the interface, throttle traffic, require manual interaction, or restrict automated access under its terms.

Before operating the crawler at scale or republishing collected data:

- review the applicable Google terms and policies;
- minimize collection of unnecessary personal data;
- avoid collecting review text, reviewer names, or photos unless genuinely required;
- distinguish Google-provided notices from your own estimates or observations;
- do not present approximate notice ranges as exact deletion counts;
- do not infer wrongdoing from the existence of a notice alone.

## Development

Run locally before relying on output:

```bash
npm test
npm run typecheck
npm run build
```

The project intentionally does not require heavy GitHub Actions usage for routine local crawler validation.

Source code lives in `src/` and tests in `test/`.

Further pipeline notes are in:

```text
docs/PIPELINE_V3.md
docs/LARGE_SCAN.md
```

## License

MIT
