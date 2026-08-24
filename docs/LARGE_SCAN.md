# Large city scans

This fork adds a resilient preset for building a broad, deduplicated gastro list for one city.

## Full gastro scan

```bash
npm start -- \
  --city Osnabrück \
  --country Germany \
  --full-gastro-scan \
  --depth 50
```

The preset searches these venue terms sequentially:

- restaurant
- Cafe
- bar
- Hotel
- Imbiss
- Pizza
- Döner
- Sushi
- Burger
- Frühstück
- Bäckerei
- Eiscafe
- italienisch
- griechisch
- indisch
- asiatisch
- vegan
- Steakhouse
- Pub
- Cocktailbar

A single failed search term no longer aborts the remaining batch. The process records the failure, continues with the other terms, and still merges any CSVs that were produced.

## Outputs

For Osnabrück the preset creates:

```text
output/deleted-reviews-osnabruck-gastro-all.csv
output/deleted-reviews-osnabruck-gastro-all-positive.csv
```

The first file contains the deduplicated venue list. The second contains only rows where a Google deletion notice was observed.

## Performance behavior

Within one CLI invocation, successfully scraped venues are cached by a normalized venue identity. If the same Google Maps place appears under multiple search terms, later terms can reuse the existing scrape instead of reopening and reparsing the place.

Google Maps place URLs are normalized before deduplication so query-string differences such as `?entry=ttu` do not create duplicate venues.

## Resilience behavior

Navigation gets a retry before a search term fails. Direct Google Maps place pages are supported in addition to normal result-list pages. State and CSV files remain resumable.

The full gastro preset uses a 60 second navigation timeout by default. Override it when necessary:

```bash
npm start -- \
  --city Osnabrück \
  --country Germany \
  --full-gastro-scan \
  --depth 50 \
  --navigation-timeout-ms 90000
```

## Verification before a large live run

```bash
npm test
npm run typecheck
```

Then run a small live smoke test if the browser profile or Google UI changed:

```bash
npm start -- \
  --city Osnabrück \
  --country Germany \
  --search-term restaurant \
  --depth 3
```
