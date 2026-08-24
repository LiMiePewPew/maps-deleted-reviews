#!/usr/bin/env bash
set -euo pipefail

CITY="${1:-}"
COUNTRY="${2:-Germany}"
if [[ -z "$CITY" ]]; then
  echo "Usage: bash scripts/hybrid-gastro-scan.sh <city> [country]" >&2
  exit 2
fi

GOSOM_BIN="${GOSOM_BIN:-google-maps-scraper}"
GOSOM_CONCURRENCY="${GOSOM_CONCURRENCY:-4}"
GOSOM_DEPTH="${GOSOM_DEPTH:-2}"
GOSOM_GRID_BBOX="${GOSOM_GRID_BBOX:-}"
GOSOM_GRID_CELL="${GOSOM_GRID_CELL:-1.0}"
GOSOM_ZOOM="${GOSOM_ZOOM:-16}"
NOTICE_HEADLESS="${NOTICE_HEADLESS:-0}"

mkdir -p output
SAFE_CITY=$(python3 - "$CITY" <<'PY'
import re
import sys
import unicodedata
value = unicodedata.normalize('NFKD', sys.argv[1])
value = ''.join(ch for ch in value if not unicodedata.combining(ch)).lower()
print(re.sub(r'[^a-z0-9]+', '-', value).strip('-'))
PY
)
QUERY_FILE="output/gosom-${SAFE_CITY}-queries.txt"
DISCOVERY_FILE="output/gosom-${SAFE_CITY}-discovery.csv"

terms=(
  restaurant Cafe bar Hotel Imbiss Pizza Döner Sushi Burger Frühstück
  Bäckerei Eiscafe italienisch griechisch indisch asiatisch vegan Steakhouse Pub Cocktailbar
)

: > "$QUERY_FILE"
for term in "${terms[@]}"; do
  printf '%s %s %s\n' "$term" "$CITY" "$COUNTRY" >> "$QUERY_FILE"
done

echo "== Stage 1: gosom discovery =="
echo "Queries: $QUERY_FILE"
echo "Output:  $DISCOVERY_FILE"

gosom_args=(
  -input "$QUERY_FILE"
  -results "$DISCOVERY_FILE"
  -depth "$GOSOM_DEPTH"
  -c "$GOSOM_CONCURRENCY"
  -lang de
  -exit-on-inactivity 3m
)
if [[ -n "$GOSOM_GRID_BBOX" ]]; then
  echo "Grid bbox: $GOSOM_GRID_BBOX (${GOSOM_GRID_CELL} km cells, zoom $GOSOM_ZOOM)"
  gosom_args+=(
    -grid-bbox "$GOSOM_GRID_BBOX"
    -grid-cell "$GOSOM_GRID_CELL"
    -zoom "$GOSOM_ZOOM"
  )
fi

"$GOSOM_BIN" "${gosom_args[@]}"

echo
echo "== Stage 2: deletion-notice verification =="
notice_mode=(--headed)
if [[ "$NOTICE_HEADLESS" == "1" ]]; then
  notice_mode=(--headless)
fi

npm start -- \
  --city "$CITY" \
  --country "$COUNTRY" \
  --places-file "$DISCOVERY_FILE" \
  "${notice_mode[@]}"

echo
echo "Hybrid scan complete."
echo "Discovery: $DISCOVERY_FILE"
echo "Notice results: output/deleted-reviews-${SAFE_CITY}-places.csv"
echo "Positive notices: output/deleted-reviews-${SAFE_CITY}-places-positive.csv"
