# Google Maps Deleted Reviews Scraper

A resumable Google Maps crawler for collecting public review-removal transparency notices from profiles discovered in local searches.

The crawler searches Google Maps, opens profile pages, visits the reviews section and extracts the German transparency notice Google may show for reviews removed following complaints regarding defamation. The raw crawl is written to CSV together with visible review counts, the observed notice range, state and diagnostics. A separate web export produces a deliberately smaller public dataset for the GitHub Pages dashboard.

## Project status

The crawler is a **stable candidate**, not a finished production crawler.

What is working well:

- real German Google Maps transparency notices are detected and parsed
- the open-ended `Über 250` bucket is modeled separately from an exact count
- missing notices are reported as `no notice observed`, never as proven zero
- review-panel failures are marked `partial` instead of silently becoming negative results
- positive notice evidence can be reused across duplicate search hits in the same batch
- headed CloakBrowser has performed better than stock Playwright in current local A/B validation
- state and CSV output are saved throughout a run and support resume
- full gastro scans use category-specific discovery caps unless an explicit `--depth` override is supplied
- merged output is deduplicated before public export
- the public web export filters obvious out-of-area and clearly non-gastro false positives conservatively

Important remaining limitations:

- Google Maps search is ranked and is not a complete business inventory
- a missing notice is not proof that zero reviews were removed
- Google can hydrate the review UI differently between runs
- the notice parser is currently designed for the tested German wording
- location filtering is conservative, not an exact municipal-boundary GIS classification
- Google category/address metadata is best effort and may be missing on older crawls

The preserved reference branch is:

```text
baseline/cloak-stable-candidate-2026-08-24
```

Do not modify that branch. Current improvements live on `main`.

## What the Google notice means

A positive result means the crawler observed Google's public transparency notice for that profile during that run.

Examples include:

```text
21 bis 50 Bewertungen aufgrund von Beschwerden wegen Diffamierung entfernt.
Über 250 Bewertungen aufgrund von Beschwerden wegen Diffamierung entfernt.
```

Google describes these values as approximate ranges. The transparency display concerns removals following defamation complaints that were processed within the last 365 days and were not later restored. It does not represent every possible reason a review may have been removed.

Official Google explanation:

https://support.google.com/contributionpolicy/answer/16997273?hl=de

A positive notice must be described neutrally. It does **not** prove that a business manipulated reviews, that every complaint was justified, or that the business itself directly deleted reviews.

Likewise, zero-valued deletion columns in the raw CSV mean only **no matching transparency notice was observed in that scrape**.

## Requirements

- Node.js 20 or newer
- npm
- a desktop environment for headed browser runs

Install dependencies and Playwright Chromium:

```bash
npm install
npx playwright install chromium
```

### Optional: CloakBrowser

CloakBrowser is currently the recommended backend for local validation, but remains an opt-in local dependency:

```bash
npm install cloakbrowser@0.5.8 --no-save
```

The default backend remains Playwright unless `--browser cloak` is supplied.

## Small smoke test

```bash
npm start -- \
  --browser cloak \
  --city Osnabrück \
  --country Germany \
  --search-term Sushi \
  --depth 1
```

## Broad Osnabrück gastro scan

For the normal broad scan, **do not pass `--depth`**:

```bash
npm start -- \
  --browser cloak \
  --city Osnabrück \
  --country Germany \
  --full-gastro-scan
```

The full-gastro preset applies a category-specific maximum to each search. Current caps are intentionally generous and act as ceilings rather than guaranteed result counts:

```text
restaurant    200
Cafe          180
bar           140
Hotel         100
Imbiss        180
Pizza         160
Döner         120
Sushi         100
Burger        120
Frühstück     120
Bäckerei      160
Eiscafe       100
italienisch   140
griechisch    100
indisch        60
asiatisch     160
vegan         100
Steakhouse     80
Pub           100
Cocktailbar    80
```

Google may naturally stop returning new profiles before a cap is reached.

### Explicit depth override

Passing `--depth N` is still supported, but it deliberately overrides every adaptive category cap. This is useful for controlled tests, not the recommended full-city scan:

```bash
npm start -- \
  --browser cloak \
  --city Osnabrück \
  --country Germany \
  --full-gastro-scan \
  --depth 3
```

Do not use `--depth 50` for the normal broad Osnabrück crawl; it recreates the coverage ceiling that the adaptive preset was added to remove.

## Full scan output

A full scan writes separate CSV/state/summary files per search term and then creates merged output.

For Osnabrück the important raw files are:

```text
output/deleted-reviews-osnabruck-gastro-all.csv
output/deleted-reviews-osnabruck-gastro-all-positive.csv
```

The positive CSV contains profiles where a notice was observed. The merged file is deduplicated using normalized Google Maps profile identity.

A Google search term is a **discovery query**, not a reliable business classification. For example, Google can occasionally return non-gastro profiles for broad terms such as `asiatisch` or `italienisch`.

## Public dashboard export

The GitHub Pages dashboard is generated from the merged raw CSV:

```bash
npm run export-web-data
```

Default output:

```text
docs/data/osnabruck.json
```

The web export intentionally differs from the raw crawl:

- obvious profiles outside the Osnabrück target area are excluded
- clearly non-gastro false positives are excluded conservatively
- exclusions are counted separately in the public summary
- legacy `250 / 250` observations are migrated to the open-ended `Über 250` bucket
- star ratings, hypothetical adjusted scores, deletion percentages and raw browser errors are not exported
- missing address/category data stays missing rather than being invented

The public JSON uses schema version 2. Important notice fields are:

```text
noticeRangeKey
noticeMin
noticeMax
noticeOpenEnded
reviewNotice
```

For `Über 250`, the public representation is:

```json
{
  "noticeRangeKey": "over-250",
  "noticeMin": 251,
  "noticeMax": null,
  "noticeOpenEnded": true
}
```

This means only `more than 250`; it does not invent an upper bound.

## Dashboard preview

After a completed crawl:

```bash
npm test
npm run typecheck
npm run export-web-data
python3 -m http.server 8080 --directory docs
```

Open:

```text
http://localhost:8080
```

The dashboard deliberately avoids rankings that imply wrongdoing. It reports range distribution, notice-check completeness, public filtering and a searchable profile list.

The `≥51` and `≥101` filters use the **lower bound** of Google's observed range. A `21–50` notice therefore does not count as `≥51`, and a `51–100` notice does not count as `≥101`.

Only the first 50 matching profile cards are rendered initially; more can be loaded on demand.

## GitHub Pages

No GitHub Actions workflow is required. Configure Pages manually:

```text
Settings → Pages → Deploy from a branch → main → /docs
```

Then publish the generated `docs/data/osnabruck.json` only after reviewing the current export counts and known limitations.

## Browser backends

### CloakBrowser

```bash
npm start -- --browser cloak --city Osnabrück --country Germany --search-term Burger --depth 1
```

The integration changes browser launch behavior while keeping the crawler's Playwright-style interaction, extraction, parsing, CSV and state logic.

### Playwright Chromium

```bash
npm start -- --browser playwright --city Osnabrück --country Germany --search-term Burger --depth 1
```

Playwright remains the default and is useful as an A/B reference backend.

## Resume behavior

Progress is saved after discovery and after completed profile checks. If a run stops, rerun the same command with the same state/output files.

With `resumeMode: "pause"`, the crawler can wait for manual action on a blocker. With `resumeMode: "stop"`, state is saved and the run exits.

The crawler does not implement CAPTCHA solving, proxy bypass or challenge circumvention.

Failed and partial rows are refetched. A valid star rating is **not** required for a complete transparency-notice check; rating parsing is diagnostic/internal metadata and is independent of notice confidence.

## Raw CSV columns

Current raw CSV columns include:

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
google_category
deleted_reviews_estimate
status
error
scraped_at
```

`venue_type` is the search term that discovered the profile. `google_category`, when successfully extracted, is separate metadata from the Google profile itself.

Raw rating/percentage fields are retained for research compatibility but are not part of the public dashboard dataset.

## `Über 250` compatibility

Older crawl files may contain:

```text
deleted_reviews_min = 250
deleted_reviews_max = 250
```

For this dataset, that legacy representation means Google's `Über 250` bucket, not an exact count of 250. The current parser recognizes the literal wording before the single-count regex, and the web exporter also migrates existing legacy `250/250` observations to the open-ended representation.

## Notice-check reliability

The current semantics are:

```text
notice observed     -> positive evidence
no notice observed  -> no notice was seen in this check; not a certified zero
partial             -> notice check was not complete enough
failed              -> profile check failed
```

After the reviews UI opens, a missing notice is polled for several seconds before the row is accepted as a clean no-notice observation. Clean negatives are deliberately not reused across unrelated search terms in the batch; confirmed positives can be reused.

## Location and business-scope filtering

Google can return distant or irrelevant results even when a city is part of the query.

The public Osnabrück export therefore uses available evidence in this order:

- explicit neighboring municipality / postcode evidence
- actual Google Maps place coordinates (`!3d...!4d...`) when present
- `@lat,lon` viewport coordinates only as a fallback

The filter is conservative. Unknown locations remain in the dataset instead of being deleted on guesswork.

New detail crawls also try to persist the Google profile address and primary category where the current Maps UI exposes them. These fields may be absent in older crawl data.

Clearly non-gastro results can also be removed from the **public** dataset using category evidence and a small conservative false-positive list. The raw crawl remains unchanged for auditability.

## Coverage limitations

Even with adaptive caps, `--full-gastro-scan` does not prove complete coverage of every gastronomy profile in Osnabrück.

Google Maps search results are ranked, may reorder between runs and can include nearby or irrelevant profiles. Near-complete inventory coverage would require a stronger discovery layer such as geographic/grid search plus canonical place identity.

Public wording should therefore say:

> X of Y profiles in the published crawl dataset showed the Google transparency notice.

Do not generalize that ratio to all Osnabrück businesses.

## Existing CSV utilities

Sort existing CSV files:

```bash
npm run sort-csv -- output/example.csv
```

Merge existing CSV files:

```bash
npm run merge-csv -- \
  output/merged.csv \
  output/first.csv \
  output/second.csv
```

## Development

Run local checks before accepting crawler changes:

```bash
npm test
npm run typecheck
npm run build
```

Prefer one isolated behavior change at a time and compare browser/extraction changes against the preserved baseline when useful. Avoid unnecessary GitHub Actions runs for local crawler validation.

## Responsible use

This project automates the public Google Maps web UI. Google may change the interface, throttle traffic, request manual interaction or block automation. Review applicable terms before running large scans and keep crawl rates conservative.

The collected notice is a Google-provided transparency signal. It should be reported as such and should not be used on its own to accuse a profile or business of wrongdoing.
