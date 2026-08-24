# Hybrid discovery + deletion-notice checking

The crawler can now use a fast external Google Maps discovery result as its input instead of discovering every venue itself.

Recommended architecture:

```text
gosom/google-maps-scraper
  -> broad parallel place discovery
  -> CSV/JSON place list
  -> normalized URL dedupe
  -> maps-deleted-reviews notice checker
  -> full result CSV + positive-only CSV
```

## Why this split

The removal notice is a niche UI signal. General-purpose Google Maps scrapers are much better at discovering large place lists, while this project remains specialized in opening the reviews UI and parsing the German deletion notice.

The checker treats a venue as `ok` only when rating/review data is available and the reviews panel could be opened. Incomplete pages stay `partial` and are retried instead of silently being treated as zero notices.

## Install gosom on macOS

Current upstream build requirements are Go 1.26.5+.

```bash
brew install go
git clone https://github.com/gosom/google-maps-scraper.git
cd google-maps-scraper
go mod download
go build -o google-maps-scraper
```

Keep the resulting binary somewhere convenient or point `GOSOM_BIN` at it.

## One-command city scan

From this repository:

```bash
GOSOM_BIN=/path/to/google-maps-scraper \
  bash scripts/hybrid-gastro-scan.sh Osnabrück Germany
```

Defaults:

- 20 gastro-related search terms
- gosom concurrency: 4
- gosom search depth: 2
- notice checker: headed mode

Override discovery tuning:

```bash
GOSOM_BIN=/path/to/google-maps-scraper \
GOSOM_CONCURRENCY=8 \
GOSOM_DEPTH=3 \
  bash scripts/hybrid-gastro-scan.sh Osnabrück Germany
```

Do not raise concurrency blindly. Google blocking can make a nominally faster configuration slower or less complete.

## Stronger city coverage with grid discovery

Normal Google Maps searches return ranked result sets and do not guarantee every business in a city. gosom can optionally split a geographic bounding box into cells and run discovery across the grid.

```bash
GOSOM_BIN=/path/to/google-maps-scraper \
GOSOM_GRID_BBOX="minLat,minLon,maxLat,maxLon" \
GOSOM_GRID_CELL=1.0 \
GOSOM_ZOOM=16 \
  bash scripts/hybrid-gastro-scan.sh Osnabrück Germany
```

The hybrid script passes these values to gosom's `-grid-bbox`, `-grid-cell`, and `-zoom` options. Grid discovery improves coverage but gosom documents that results are not strictly clipped to the supplied box, so downstream deduplication remains necessary.

## Feed an existing gosom file directly

CSV:

```bash
npm start -- \
  --city Osnabrück \
  --country Germany \
  --places-file output/gosom-osnabruck-discovery.csv \
  --headed
```

`--gosom-results` is an alias for `--places-file`.

The importer accepts:

- gosom CSV (`link`, `title`, `address`)
- JSON arrays
- JSONL
- generic `name,url,address` files

Google Maps URLs are normalized and deduplicated before the notice check.

## Outputs

For an Osnabrück places-file run:

```text
output/deleted-reviews-osnabruck-places.csv
output/deleted-reviews-osnabruck-places-positive.csv
```

The positive file contains only rows where the official Google deletion notice was observed.

## Headless status

Headless is supported but should be treated as experimental until parity is measured against headed mode on a fixed venue sample. The checker now waits for rendered rating/review data and retries incomplete pages, fixing the earlier failure mode where headless runs could print `unknown total reviews` too early.

For initial certification, use headed mode. After parity is confirmed:

```bash
NOTICE_HEADLESS=1 \
GOSOM_BIN=/path/to/google-maps-scraper \
  bash scripts/hybrid-gastro-scan.sh Osnabrück Germany
```

## Coverage

A large query list improves coverage but does not mathematically guarantee every business in a city. Grid discovery is the preferred next step when coverage matters more than a quick ranked sample.
