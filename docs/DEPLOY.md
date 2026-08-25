# Publishing the Review Transparency dashboard

The public dashboard is a fully static site in `docs/`. It does not run the crawler on GitHub Pages and does not need a server or a custom GitHub Actions workflow.

## 1. Enable GitHub Pages once

In the repository on GitHub:

1. Open **Settings**.
2. Open **Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select branch **main**.
5. Select folder **/docs**.
6. Save.

Expected project-site URL:

```text
https://limiepewpew.github.io/maps-deleted-reviews/
```

## 2. Crawl Osnabrück

For the normal broad crawl, omit `--depth` so the adaptive per-category caps are used:

```bash
npm start -- \
  --browser cloak \
  --city Osnabrück \
  --country Germany \
  --full-gastro-scan
```

Passing an explicit `--depth N` overrides every adaptive category cap and is intended mainly for controlled tests.

The dashboard source is the merged raw output:

```text
output/deleted-reviews-osnabruck-gastro-all.csv
```

## 3. Run local checks and export the public JSON

```bash
npm test
npm run typecheck
npm run export-web-data
```

The exporter writes:

```text
docs/data/osnabruck.json
```

The public export is intentionally stricter than the raw crawl. It:

- preserves `no notice observed` instead of inventing zero removals
- converts legacy `250/250` observations to Google's open-ended `Über 250` bucket
- removes obvious out-of-area profiles
- removes clearly non-gastro false positives conservatively
- reports both kinds of exclusions in the summary
- does not publish rating-derived metrics or raw browser errors

Always inspect the export summary printed in the terminal before publishing.

## 4. Preview locally

Because the dashboard loads JSON with `fetch()`, use a local HTTP server:

```bash
python3 -m http.server 8080 --directory docs
```

Then open:

```text
http://localhost:8080
```

Check at least:

- `Über 250` is displayed as open-ended, never as exact 250
- obvious foreign places such as Alexanderplatz are absent
- obvious non-gastro false positives are absent
- incomplete checks are labeled `Nicht vollständig`
- the `≥51` and `≥101` filters use the lower bound of the Google range
- unknown addresses are not replaced with a made-up Osnabrück address

## 5. Publish updated results

After checking the page locally:

```bash
git add docs/data/osnabruck.json
git commit -m "publish latest Osnabrück review transparency data"
git push origin main
```

GitHub Pages will then serve the updated static dataset.

## Public interpretation

Use these semantics:

```text
notice observed     -> Google displayed the transparency notice during the crawl
no notice observed  -> no matching notice was seen; not a certified zero
partial/failed      -> incomplete evidence
```

The Google notice concerns review removals following defamation complaints under Google's published transparency rules. A notice is not proof that a profile manipulated reviews, that every complaint was justified, or that the profile directly deleted reviews.

The published ratio is descriptive only for the profiles in the crawl dataset. It must not be generalized to all gastronomy businesses in Osnabrück.
