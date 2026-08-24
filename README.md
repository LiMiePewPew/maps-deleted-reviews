# Google Maps Deleted Reviews Scraper

A resumable Google Maps crawler for collecting public review-removal transparency notices from venues in a city.

The crawler searches Google Maps, opens venue pages, visits the reviews section, and extracts the German transparency notice Google may show for reviews removed following complaints regarding defamation. Results are written to CSV together with visible review counts, rating data, the observed removal range, run state, and diagnostics.

## Project status

The crawler is currently a **stable candidate**, not a finished production crawler.

What is working well:

- real Google Maps removal notices are being detected and parsed
- headed CloakBrowser has performed better than stock Playwright in current local A/B validation
- batch scans continue after individual search-term failures
- transient browser and navigation failures are retried during full gastro scans
- state and CSV output are saved throughout a run
- batch output can be merged and deduplicated

What is not yet fully certified:

- a missing notice is not a guaranteed zero
- Google Maps can hydrate review content differently between runs
- Google search results are ranked and capped, so a large city scan is broad coverage rather than a guaranteed complete inventory
- the current deletion-notice parser is designed for the German Google Maps wording

The reference CloakBrowser baseline is preserved on:

```text
baseline/cloak-stable-candidate-2026-08-24
```

New improvements are developed on `main` so the known-good reference remains available for comparison.

## Important interpretation

A positive result means the crawler observed Google's public transparency notice for that venue during that run.

For example:

```text
21 bis 50 Bewertungen aufgrund von Beschwerden wegen Diffamierung entfernt
```

This should be described neutrally, for example:

> Google Maps displayed a notice indicating that 21–50 reviews were removed following complaints regarding defamation.

It does **not** prove that the business manipulated reviews, that every complaint was justified, or that the business itself directly deleted reviews.

Likewise, a row containing `0` for the deletion fields currently means **no removal notice was observed in that scrape**. It must not be interpreted as proof that zero reviews were removed. Improving negative-result confidence is one of the next reliability goals.

## Requirements

- Node.js 20 or newer
- npm
- a desktop environment for headed browser runs

## Installation

Install the normal project dependencies and Playwright Chromium:

```bash
npm install
npx playwright install chromium
```

### Optional: CloakBrowser

CloakBrowser is currently the recommended backend for local validation, but it is still intentionally kept as an opt-in experiment rather than a pinned production dependency.

Install the tested version locally with:

```bash
npm install cloakbrowser@0.5.8 --no-save
```

The default backend remains Playwright unless `--browser cloak` is supplied.

## Quick start

Copy the example configuration:

```bash
cp config.example.json config.json
```

For a small CloakBrowser smoke test:

```bash
npm start -- \
  --browser cloak \
  --city Osnabrück \
  --country Germany \
  --search-term Burger \
  --depth 1
```

For a broad Osnabrück gastro crawl:

```bash
npm start -- \
  --browser cloak \
  --city Osnabrück \
  --country Germany \
  --full-gastro-scan \
  --depth 50
```

A full gastro scan runs these 20 Google Maps searches sequentially:

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

`depth` is the maximum number of venues requested from each search term. Because the same venue may appear under multiple terms, the raw number of search hits can be much larger than the final number of unique venues.

For a first large run, `--depth 50` is recommended before increasing to 75 or 100.

## Browser backends

Two browser backends are available.

### CloakBrowser

```bash
npm start -- --browser cloak --city Osnabrück --country Germany --search-term Burger --depth 1
```

The current integration deliberately changes only the browser launch. Discovery, review-tab interaction, text extraction, parsing, CSV output, and state handling continue to use the existing Playwright-based crawler logic.

This isolation is intentional: browser changes and review-extraction changes should not be mixed in the same experiment.

### Playwright Chromium

```bash
npm start -- --browser playwright --city Osnabrück --country Germany --search-term Burger --depth 1
```

Playwright is still the default and remains useful as an A/B reference backend.

## Full gastro scan output

A full scan writes individual CSV/state/summary files per search term and then creates merged output.

For Osnabrück the important combined files are:

```text
output/deleted-reviews-osnabruck-gastro-all.csv
output/deleted-reviews-osnabruck-gastro-all-positive.csv
```

The `-positive.csv` file contains venues where a removal notice was actually observed.

The merged file is deduplicated using the crawler's venue identity logic so venues found under several search terms do not need to remain duplicated in the final dataset.

## Navigation recovery

Google Maps and Chromium can occasionally abort or close a navigation even when the crawler itself is otherwise healthy.

During `--full-gastro-scan`, the runner treats these failures as transient:

```text
net::ERR_ABORTED
net::ERR_NETWORK_CHANGED
net::ERR_CONNECTION_RESET
net::ERR_CONNECTION_CLOSED
net::ERR_TIMED_OUT
browser/page/context closed
```

For a transient failure, the current search term is retried with a fresh browser after a short delay. Two recovery retries are available, using increasing waits before the next attempt.

If the term still fails, the failure is recorded and the full gastro scan continues with the remaining search terms.

## Configuration

The example `config.example.json` includes an `_annotations` object explaining every setting. It is ignored by the scraper.

Example:

```json
{
  "city": "Bonn",
  "country": "Germany",
  "searchTerm": "restaurant",
  "depth": 50,
  "locale": "de-DE",
  "googleMapsUrl": "https://www.google.de/maps",
  "headed": true,
  "resumeMode": "pause"
}
```

Important fields:

- `city`: city used in the Google Maps query.
- `cities`: optional batch array such as `["Bonn", "Köln"]`.
- `country`: country context for the query.
- `searchTerm`: one Google Maps search term.
- `searchTerms`: optional batch array of search terms.
- `depth`: maximum number of venues to discover for each search.
- `locale`: keep `de-DE` for the current German notice parser.
- `googleMapsUrl`: `https://www.google.de/maps` is recommended for the German UI.
- `headed`: a visible browser is currently recommended.
- `resumeMode`: `pause` allows manual intervention; `stop` saves state and exits on blockers.
- `outputCsvPath`: optional CSV path override.
- `summaryPath`: optional JSON summary path override.
- `statePath`: optional checkpoint path override.
- `browserProfileDir`: browser profile directory used by the Playwright-style persistent launcher.
- `navigationTimeoutMs`: timeout for browser navigation/actions.
- `actionDelay`: optional randomized action delay.
- `resultScrollDelayMs`: delay after result-list scrolling.
- `maxResultScrolls`: discovery scrolling safety limit.
- `sortCsv`: controls automatic CSV sorting.

For full gastro scans, the CLI raises the navigation timeout to 60 seconds unless a custom value is supplied.

## Other running modes

Run with the config file:

```bash
npm run dev
```

or:

```bash
npm start -- --config config.json
```

Override values from the CLI:

```bash
npm start -- --city Köln --country Germany --search-term Hotel --depth 100 --headed
```

Run several search terms sequentially:

```bash
npm start -- --city Bonn --country Germany --search-terms restaurant,Cafe,Hotel --depth 50
```

Create a custom merged CSV:

```bash
npm start -- \
  --city Bonn \
  --country Germany \
  --search-terms restaurant,Cafe,Hotel \
  --depth 50 \
  --merge-csv-path output/deleted-reviews-bonn-merged.csv
```

Run several cities sequentially:

```bash
npm start -- --cities Bonn,Köln,Düsseldorf --country Germany --search-term Hotel --depth 50
```

You can combine `--cities` and `--search-terms`; every city/search-term combination gets separate CSV, state, and summary files.

## Resume behavior

Progress is saved after venue discovery and after completed venue scrapes. If a run stops, rerun the same command with the same state/output paths.

With `resumeMode: "pause"`, the scraper can wait for manual action when Google presents a blocker. Resolve the issue in the browser, then press Enter in the terminal.

With `resumeMode: "stop"`, state is saved and the run stops instead.

The crawler does not implement CAPTCHA solving, proxy bypass, or challenge circumvention.

## CSV columns

The generated CSV contains:

- `venue_type`
- `name`
- `total_reviews`
- `deleted_reviews_min`
- `deleted_reviews_max`
- `percentage_deleted`
- `current_star_rating`
- `real_score`
- `review_notice`
- `url`
- `address`
- `deleted_reviews_estimate`
- `status`
- `error`
- `scraped_at`

For a parsed range such as `21 bis 50`, `deleted_reviews_estimate` uses the midpoint of the observed range.

`percentage_deleted` is therefore an estimate derived from the observed Google notice, not an exact deletion percentage.

### Hypothetical adjusted score

`real_score` is only a hypothetical calculation that assumes every removed review would have been a one-star review:

```text
((current_star_rating * total_reviews) + deleted_reviews_estimate)
/ (total_reviews + deleted_reviews_estimate)
```

It must not be presented as the venue's true historical rating.

## Selector and extraction strategy

The crawler avoids relying on Google Maps' obfuscated CSS class names where possible. It uses:

- accessible roles such as tabs, buttons, feeds, and links
- visible German review UI text
- Google Maps place URLs
- page body text and `aria-label` values
- regex parsing for German review counts, ratings, and removal notices

The current notice parser recognizes the German wording used by the tested Google Maps UI. English notice parsing is not yet implemented.

Google can change its UI at any time, so this remains best-effort browser automation.

## Current reliability model

The most important distinction is:

```text
notice observed     -> useful positive evidence
no notice observed  -> not yet a certified zero
failed/partial      -> incomplete scrape
```

A future reliability pass should add longer notice-hydration polling and explicit `notice_found`, `no_notice_observed`, `uncertain`, and `failed` semantics instead of treating a missing notice like a proven zero.

## Coverage limitations

`--full-gastro-scan --depth 50` is a broad scan, but it does not guarantee every restaurant or hospitality venue in a city.

Google Maps search results are ranked and may cap or reorder results. Higher coverage will require combining category searches with geographic/grid discovery and canonical venue identity before detail scraping.

## Existing CSV utilities

Sort CSV files generated by older versions:

```bash
npm run sort-csv -- output/deleted-reviews-berlin-doner.csv
```

Merge existing CSV files:

```bash
npm run merge-csv -- \
  output/deleted-reviews-merged.csv \
  output/deleted-reviews-berlin-doner.csv \
  output/deleted-reviews-berlin-kebab.csv
```

## Development

Run the local checks before accepting crawler changes:

```bash
npm test
npm run typecheck
npm run build
```

Source files live in `src/`; parser and CSV behavior is covered by tests in `test/`.

`npm run build` emits the CLI into `dist/`.

For crawler development, prefer one isolated change at a time and compare it against the preserved baseline. In particular, avoid changing browser backend, review-panel detection, and parsing logic simultaneously.

## Responsible use

This project automates the public Google Maps web UI. Google may change the interface, throttle traffic, request manual interaction, or block automation. Review the applicable terms before running large scans and keep crawl rates conservative.

The collected removal notice is a Google-provided transparency signal. It should be reported as such and should not be used on its own to accuse a venue of wrongdoing.
