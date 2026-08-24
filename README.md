# Google Maps Deleted Reviews Scraper

High-performance Node.js scraper for collecting Google Maps transparency notices about reviews removed after complaints regarding defamation.

The current certified runtime is **Playwright Chromium**, matching the known-working upstream architecture. Pipeline V3 adds parallel discovery, venue deduplication, resumable state, worker pools, and conservative review-notice certification without replacing Playwright globally.

CloakBrowser remains in the repository as an **experimental backend only**. It is not wired into the default CLI path and no longer monkeypatches Playwright.

> **Important:** a Google removal notice is not an exact count of every review ever removed from a business. Treat the displayed range as Google-provided transparency information for the notice shown in the current Maps UI.

## Current Status

The project has two execution paths:

- **Pipeline V3** for `--full-gastro-scan` / `--large-list`. This is the high-performance city-scan path.
- **Legacy single/batch search** for `--search-term`, `--search-terms`, and config-driven runs.

Current default browser stack:

```text
crawler
  -> Playwright page/locator API
  -> Playwright chromium.launchPersistentContext()
  -> persistent Chromium profile
  -> Google Maps
```

This intentionally returns the browser lifecycle to the working upstream model. CloakBrowser experiments are isolated in `src/browserRuntime.ts` and must prove parity before being promoted into the normal crawler path.

A V3 run is not considered notice-certified unless it finishes with `Partial: 0`, `Failed: 0`, and known positive controls still reproduce their Google notices.

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
- Playwright Chromium
- a desktop session for the currently recommended headed validation mode

The project currently includes:

```text
playwright ^1.59.1
cloakbrowser 0.5.8 (experimental only)
```

## Installation

```bash
npm install
```

If Chromium is not already installed for Playwright:

```bash
npx playwright install chromium
```

CloakBrowser is not required for the default crawler path.

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
Browser: Playwright Chromium

=== PHASE 1: DISCOVERY (4 workers) ===
```

A healthy completed scan should have:

```text
Partial: 0
Failed: 0
```

The stronger requirement is positive-control parity. A clean technical summary is not enough if known notices unexpectedly disappear.

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

V3 prints metrics including raw discovery slots, unique venues, dedupe savings, checked venues, removal notices, partial/failed counts, worker counts, and phase runtimes.

## Known Positive Controls

The certified pre-Cloak Osnabrück depth-1 baseline contained 19 unique venues, 6 removal notices, 0 partial rows, and 0 failed rows.

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

Do not assume headless parity until headed and headless runs over the same venue set reproduce the same review counts, notice rows, partial count, and failed count.

## Legacy / Targeted Search

For a targeted query:

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

These commands use the older config/batch orchestration and retain the upstream-style Playwright persistent-context lifecycle.

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

`status` can be `ok`, `partial`, or `failed`. A `partial` row must not be interpreted as a confirmed negative removal-notice result.

## Deleted Review Estimate

Google commonly exposes ranges rather than exact values. The scraper stores the parsed minimum and maximum and may calculate an estimate for derived metrics.

Any metric based on `deleted_reviews_estimate` is therefore derived, not an official exact Google count.

## Theoretical Adjusted Score

`real_score` is a hypothetical calculation that assumes every estimated removed review would have been a one-star review:

```text
((current_star_rating * total_reviews) + deleted_reviews_estimate)
/ (total_reviews + deleted_reviews_estimate)
```

This is a scenario calculation only. It is **not** Google's hidden rating, proof of manipulation, or a factual reconstruction of removed reviews.

## CloakBrowser Experiments

CloakBrowser is deliberately isolated from the default runtime after the migration produced browser-lifecycle regressions and a recursive persistent-launch loop.

`src/browserRuntime.ts` exposes an explicit experimental launcher. It does not modify Playwright globally. Any future CloakBrowser promotion should be based on an A/B test using the same venues, same review interaction, same parser, and the Playwright positive-control baseline.

See:

```text
docs/CLOAKBROWSER.md
```

## Rate Limits and Challenges

The crawler detects common Google challenge/rate-limit text and does not include CAPTCHA solving or automatic challenge bypass logic.

When scaling worker counts, monitor partial results, failures, challenge errors, and positive-control parity. More workers are only useful if data quality remains stable.

## Performance Notes

Moving CPU-bound code to Rust is unlikely to be the main performance lever. Most runtime is browser navigation, Google Maps rendering, result discovery, and review-panel hydration.

A future high-value research direction is structured network/RPC extraction, but it should not replace the browser evidence path until it proves parity with known positive controls.

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

Further notes:

```text
docs/PIPELINE_V3.md
docs/LARGE_SCAN.md
docs/CLOAKBROWSER.md
```

## License

This project is available under the [MIT License](LICENSE).

This repository is derived from `mb4umi/maps-deleted-reviews`, whose `package.json` also declares the project as MIT licensed. The current fork retains that permissive licensing model and adds its own modifications under the same MIT license.
