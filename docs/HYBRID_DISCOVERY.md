# Hybrid discovery with Pipeline V2

For large city scans, discovery and deletion-notice verification are separate jobs:

```text
gosom/google-maps-scraper
  -> broad parallel Google Maps discovery
  -> CSV/JSON place list
  -> normalized URL dedupe
  -> Pipeline V2 certified notice checker
  -> all-results CSV + positive-only CSV + resumable state
```

Pipeline V2 remains the only notice-checking implementation used by large scans. Imported discovery results do not fall back to the legacy per-query checker.

## Why use gosom for discovery

gosom is designed for high-throughput Google Maps place discovery and exposes structured fields including `link`, `title`, `address`, `review_count`, `review_rating`, `cid`, and `place_id`. Our project remains specialized in opening the reviews UI and certifying the German deletion notice.

## Install gosom on macOS

Current upstream source builds require Go 1.26.6+.

```bash
brew install go
git clone https://github.com/gosom/google-maps-scraper.git
cd google-maps-scraper
go mod download
go build
```

The resulting binary is `google-maps-scraper` in that checkout. Point `GOSOM_BIN` at it from this project.

## One-command Osnabrück scan

From this repository:

```bash
GOSOM_BIN=/path/to/google-maps-scraper/google-maps-scraper \
  bash scripts/hybrid-gastro-scan.sh Osnabrück Germany
```

Defaults:

- 20 gastro-related discovery terms
- gosom concurrency: 4
- gosom depth: 2
- Pipeline V2 notice workers: 1
- notice checker: headed mode

The script creates:

```text
output/gosom-osnabruck-queries.txt
output/gosom-osnabruck-discovery.csv
output/deleted-reviews-osnabruck-places.csv
output/deleted-reviews-osnabruck-places-positive.csv
output/state-osnabruck-places-v2.json
```

## Tune discovery and verification separately

```bash
GOSOM_BIN=/path/to/google-maps-scraper/google-maps-scraper \
GOSOM_CONCURRENCY=8 \
GOSOM_DEPTH=3 \
NOTICE_WORKERS=2 \
  bash scripts/hybrid-gastro-scan.sh Osnabrück Germany
```

Do not increase concurrency or notice workers blindly. Google-side throttling can make higher concurrency slower or less complete.

## Stronger geographic coverage

Normal Maps queries are ranked result sets and do not guarantee every venue in a city. gosom supports grid discovery over a bounding box:

```bash
GOSOM_BIN=/path/to/google-maps-scraper/google-maps-scraper \
GOSOM_GRID_BBOX="minLat,minLon,maxLat,maxLon" \
GOSOM_GRID_CELL=1.0 \
GOSOM_ZOOM=16 \
  bash scripts/hybrid-gastro-scan.sh Osnabrück Germany
```

Grid results still need deduplication, which happens before Pipeline V2 checks the venue queue.

## Check an existing discovery file

```bash
npm start -- \
  --city Osnabrück \
  --country Germany \
  --places-file output/gosom-osnabruck-discovery.csv \
  --workers 1 \
  --headed
```

`--gosom-results` is an alias for `--places-file`.

Accepted input formats:

- gosom CSV using `link`, `title`, `address`
- JSON array
- JSONL
- generic CSV using `url`, `name`, `address`

Use `--depth N` with `--places-file` to certify only the first N deduplicated imported venues for a smoke test.

## Resume and refresh

Interrupted Pipeline V2 runs resume from `state-<city>-places-v2.json`. A fully completed invocation is treated as a snapshot; starting the command again creates a new snapshot and rechecks the current imported list.

If an interrupted run is resumed with a changed discovery file, stale venues, rows, and completed keys that are no longer present are removed from the active queue.

## Headless status

Pipeline V2 only marks a venue `ok` after it has a parseable rating, a parseable visible review count, and a successfully opened reviews panel. This prevents the earlier `unknown total reviews` failure from becoming a false zero-notice result.

Even so, certify headed mode first. Headless should only be considered equivalent after a fixed-sample parity run shows matching review counts and notice rows.
