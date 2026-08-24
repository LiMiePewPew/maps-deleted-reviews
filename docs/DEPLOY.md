# Publishing the Review Transparency dashboard

The public dashboard is a fully static site in `docs/`. It does not run the crawler on GitHub Pages and does not need a server.

## 1. Enable GitHub Pages once

In the repository on GitHub:

1. Open **Settings**.
2. Open **Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select branch **main**.
5. Select folder **/docs**.
6. Save.

For this repository the expected project-site URL is:

```text
https://limiepewpew.github.io/maps-deleted-reviews/
```

No custom GitHub Actions workflow is required for this setup.

## 2. Crawl Osnabrück

Example large local run:

```bash
npm start -- \
  --browser cloak \
  --city Osnabrück \
  --country Germany \
  --full-gastro-scan \
  --depth 50
```

The dashboard uses the merged output:

```text
output/deleted-reviews-osnabruck-gastro-all.csv
```

## 3. Export the public JSON

Run:

```bash
npm run export-web-data
```

This converts the merged CSV into:

```text
docs/data/osnabruck.json
```

The exporter intentionally publishes the observed Google notice range rather than turning missing notices into certified zero values.

## 4. Preview locally

Because the dashboard loads JSON with `fetch()`, open it through a small local HTTP server instead of double-clicking `index.html`.

For example:

```bash
python3 -m http.server 8080 --directory docs
```

Then open:

```text
http://localhost:8080
```

## 5. Publish updated results

After checking the page locally:

```bash
git add docs/data/osnabruck.json
git commit -m "publish latest Osnabrück review transparency data"
git push origin main
```

GitHub Pages will then serve the updated static dataset.

## Public interpretation

The dashboard uses these semantics:

```text
notice observed     -> Google displayed a public removal notice during the crawl
no notice observed  -> no notice was seen during this crawl; not a certified zero
partial/failed      -> incomplete evidence
```

A removal notice is a transparency signal. It is not proof that a venue manipulated reviews, that a complaint was justified, or that the venue directly deleted a review.
