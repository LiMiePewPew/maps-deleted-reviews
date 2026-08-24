import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chromium, type BrowserContext, type Locator, type Page } from 'playwright';
import { writeCsv } from './output.js';
import {
  calculateMetrics,
  normalizeWhitespace,
  parseDeletedReviews,
  parseReviewCount,
  parseStarRating,
} from './parsers.js';
import {
  getReviewPanelEvidence,
  isNegativeReviewPanelReady,
  isReviewPanelOpenEvidence,
} from './reviewPanelEvidence.js';
import type { ScrapedVenue, ScraperConfig, Venue } from './types.js';
import { venueIdentityKey } from './venueIdentity.js';

const PIPELINE_STATE_VERSION = 3;
const NAVIGATION_ATTEMPTS = 2;
const VENUE_READY_TIMEOUT_MS = 12_000;
const REVIEWS_READY_TIMEOUT_MS = 12_000;
const NEGATIVE_NOTICE_SETTLE_MS = 4_000;
const VENUE_POLL_MS = 180;
const REVIEWS_POLL_MS = 200;
const STATE_CHECKPOINT_EVERY = 5;
const CSV_CHECKPOINT_EVERY = 25;
const MAX_WORKERS = 8;

interface PipelineVenue extends Venue {
  searchTerms: string[];
}

interface PipelineState {
  version: number;
  city: string;
  country: string;
  completedSearchTerms: string[];
  discoveryRawByTerm: Record<string, number>;
  venues: PipelineVenue[];
  completedVenueKeys: string[];
  rows: ScrapedVenue[];
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
}

export interface PipelineV3Options {
  noticeWorkers?: number;
  discoveryWorkers?: number;
}

export interface PipelineV3Summary {
  city: string;
  country: string;
  searchTerms: number;
  rawDiscoverySlots: number;
  discoveredVenues: number;
  dedupeSavings: number;
  checkedVenues: number;
  noticeVenues: number;
  partialVenues: number;
  failedVenues: number;
  noticeWorkers: number;
  discoveryWorkers: number;
  headed: boolean;
  outputPath: string;
  positivePath: string;
  statePath: string;
  discoveryDurationMs: number;
  noticeDurationMs: number;
  durationMs: number;
}

export async function runCityPipelineV3(
  configs: ScraperConfig[],
  options: PipelineV3Options = {},
): Promise<PipelineV3Summary> {
  if (configs.length === 0) {
    throw new Error('Pipeline V3 requires at least one scraper config.');
  }

  const first = configs[0];
  if (!first) {
    throw new Error('Pipeline V3 config missing.');
  }

  const city = first.city;
  const country = first.country;
  if (configs.some((config) => config.city !== city || config.country !== country)) {
    throw new Error('Pipeline V3 supports one city/country pair per invocation.');
  }

  const noticeWorkers = clampWorkerCount(options.noticeWorkers ?? 1);
  const discoveryWorkers = clampWorkerCount(options.discoveryWorkers ?? 1);
  const startedAtMs = Date.now();
  const slug = slugify(city);
  const outputPath = first.mergeCsvPath ?? `output/deleted-reviews-${slug}-gastro-all.csv`;
  const positivePath = outputPath.replace(/\.csv$/i, '-positive.csv');
  const statePath = `output/state-${slug}-gastro-v3.json`;
  let state = await loadPipelineState(statePath, city, country);

  if (state.finishedAt) {
    state = createPipelineState(city, country);
    await savePipelineState(statePath, state);
  }

  const context = await chromium.launchPersistentContext(first.browserProfileDir, {
    headless: !first.headed,
    locale: first.locale,
    viewport: { width: 1440, height: 1100 },
    reducedMotion: 'reduce',
  });

  await resetPersistentContextPages(context);
  await installResourceBlocking(context);

  let discoveryDurationMs = 0;
  let noticeDurationMs = 0;

  try {
    const discoveryStartedAt = Date.now();
    console.log(`\n=== PHASE 1: DISCOVERY (${discoveryWorkers} worker${discoveryWorkers === 1 ? '' : 's'}) ===`);
    await runDiscoveryPool(context, configs, first, state, statePath, discoveryWorkers);
    discoveryDurationMs = Date.now() - discoveryStartedAt;

    const rawDiscoverySlots = totalRawDiscoverySlots(state);
    console.log(`\nRaw discovery slots: ${rawDiscoverySlots}`);
    console.log(`Unique venues discovered: ${state.venues.length}`);
    console.log(`Dedupe saved detail checks: ${Math.max(0, rawDiscoverySlots - state.venues.length)}`);

    const noticeStartedAt = Date.now();
    console.log(`=== PHASE 2: NOTICE CHECK (${noticeWorkers} worker${noticeWorkers === 1 ? '' : 's'}) ===`);
    await runNoticePool(context, first, state, statePath, outputPath, noticeWorkers);
    noticeDurationMs = Date.now() - noticeStartedAt;

    const partialVenues = state.rows.filter((row) => row.status === 'partial').length;
    const failedVenues = state.rows.filter((row) => row.status === 'failed').length;
    if (partialVenues === 0 && failedVenues === 0) {
      state.finishedAt = new Date().toISOString();
    } else {
      delete state.finishedAt;
    }

    await savePipelineState(statePath, state);
    await writeCsv(outputPath, state.rows, first.sortCsv);
    const positiveRows = state.rows.filter((row) => row.deletedReviewNotice !== null);
    await writeCsv(positivePath, positiveRows, first.sortCsv);
  } finally {
    await context.close().catch(() => undefined);
  }

  const rawDiscoverySlots = totalRawDiscoverySlots(state);
  const noticeVenues = state.rows.filter((row) => row.deletedReviewNotice !== null).length;
  const partialVenues = state.rows.filter((row) => row.status === 'partial').length;
  const failedVenues = state.rows.filter((row) => row.status === 'failed').length;

  return {
    city,
    country,
    searchTerms: configs.length,
    rawDiscoverySlots,
    discoveredVenues: state.venues.length,
    dedupeSavings: Math.max(0, rawDiscoverySlots - state.venues.length),
    checkedVenues: state.rows.length,
    noticeVenues,
    partialVenues,
    failedVenues,
    noticeWorkers,
    discoveryWorkers,
    headed: first.headed,
    outputPath,
    positivePath,
    statePath,
    discoveryDurationMs,
    noticeDurationMs,
    durationMs: Date.now() - startedAtMs,
  };
}

async function runDiscoveryPool(
  context: BrowserContext,
  configs: ScraperConfig[],
  baseConfig: ScraperConfig,
  state: PipelineState,
  statePath: string,
  requestedWorkers: number,
): Promise<void> {
  for (const config of configs) {
    if (state.completedSearchTerms.includes(config.searchTerm)) {
      console.log(`Discovery cached: ${config.searchTerm}`);
    }
  }

  const pending = configs.filter((config) => !state.completedSearchTerms.includes(config.searchTerm));
  if (pending.length === 0) {
    return;
  }

  const venueIndex = buildVenueIndex(state.venues);
  const workerCount = Math.min(requestedWorkers, pending.length);
  const pages = await createPagePool(context, workerCount, baseConfig.navigationTimeoutMs, true);
  let queueIndex = 0;
  let persistenceChain: Promise<void> = Promise.resolve();

  const persist = (): Promise<void> => {
    persistenceChain = persistenceChain.then(() => savePipelineState(statePath, state));
    return persistenceChain;
  };

  try {
    await Promise.all(
      pages.map(async (page) => {
        while (true) {
          const index = queueIndex;
          queueIndex += 1;
          const config = pending[index];
          if (!config) {
            break;
          }

          try {
            const venues = await discoverSearchTerm(page, config);
            mergeDiscoveredVenuesFast(state, venueIndex, venues, config.searchTerm);
            state.discoveryRawByTerm[config.searchTerm] = venues.length;
            if (!state.completedSearchTerms.includes(config.searchTerm)) {
              state.completedSearchTerms.push(config.searchTerm);
            }
            console.log(
              `Discovery ${config.searchTerm}: ${venues.length} raw, ${state.venues.length} unique total`,
            );
            await persist();
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`Discovery failed for ${config.searchTerm}: ${message}`);
            console.warn('Continuing; this search term remains resumable.');
          }
        }
      }),
    );
    await persistenceChain;
  } finally {
    await Promise.all(pages.map((page) => page.close().catch(() => undefined)));
  }
}

async function runNoticePool(
  context: BrowserContext,
  config: ScraperConfig,
  state: PipelineState,
  statePath: string,
  outputPath: string,
  requestedWorkers: number,
): Promise<void> {
  const completed = new Set(state.completedVenueKeys);
  const pending = state.venues.filter((venue) => !completed.has(venueIdentityKey(venue)));
  if (pending.length === 0) {
    return;
  }

  const workerCount = Math.min(requestedWorkers, pending.length);
  const pages = await createPagePool(context, workerCount, config.navigationTimeoutMs, false);
  const rowIndex = buildRowIndex(state.rows);
  const throttle = new SharedThrottle();
  let queueIndex = 0;
  let processedThisRun = 0;
  let sinceStateCheckpoint = 0;
  let sinceCsvCheckpoint = 0;
  let persistenceChain: Promise<void> = Promise.resolve();

  const persist = (force = false): Promise<void> => {
    sinceStateCheckpoint += 1;
    sinceCsvCheckpoint += 1;
    const writeState = force || sinceStateCheckpoint >= STATE_CHECKPOINT_EVERY;
    const writeCsvNow = force || sinceCsvCheckpoint >= CSV_CHECKPOINT_EVERY;
    if (writeState) {
      sinceStateCheckpoint = 0;
    }
    if (writeCsvNow) {
      sinceCsvCheckpoint = 0;
    }
    if (!writeState && !writeCsvNow) {
      return persistenceChain;
    }

    persistenceChain = persistenceChain.then(async () => {
      if (writeState) {
        await savePipelineState(statePath, state);
      }
      if (writeCsvNow) {
        await writeCsv(outputPath, state.rows, config.sortCsv);
      }
    });
    return persistenceChain;
  };

  try {
    await Promise.all(
      pages.map(async (page) => {
        while (true) {
          const index = queueIndex;
          queueIndex += 1;
          const venue = pending[index];
          if (!venue) {
            break;
          }

          const row = await scrapeVenueCertified(page, config, venue, throttle);
          upsertRowFast(state.rows, rowIndex, row);
          const key = venueIdentityKey(venue);
          if (row.status === 'ok' && !completed.has(key)) {
            completed.add(key);
            state.completedVenueKeys.push(key);
          }

          processedThisRun += 1;
          const done = state.venues.length - pending.length + processedThisRun;
          console.log(formatPipelineProgress(done, state.venues.length, row));
          await persist(row.status !== 'ok');
        }
      }),
    );
    await persist(true);
    await persistenceChain;
  } finally {
    await Promise.all(pages.map((page) => page.close().catch(() => undefined)));
  }
}

async function createPagePool(
  context: BrowserContext,
  count: number,
  timeoutMs: number,
  reuseExistingPage: boolean,
): Promise<Page[]> {
  const pages: Page[] = [];
  const existing = reuseExistingPage ? context.pages()[0] : undefined;

  if (existing) {
    configurePage(existing, timeoutMs);
    pages.push(existing);
  }

  while (pages.length < count) {
    const page = await context.newPage();
    configurePage(page, timeoutMs);
    pages.push(page);
  }

  return pages;
}

async function discoverSearchTerm(page: Page, config: ScraperConfig): Promise<Venue[]> {
  const searchUrl = `${config.googleMapsUrl}/search/${encodeURIComponent(
    `${config.searchTerm} ${config.city} ${config.country}`,
  )}`;

  await navigateWithRetry(page, searchUrl, config.navigationTimeoutMs, `search ${config.searchTerm}`);
  await acceptConsentIfPresent(page);

  const direct = await extractDirectVenue(page);
  if (direct) {
    return [direct];
  }

  const firstResult = page.locator(placeLinkSelector()).first();
  const hasResults = await firstResult
    .waitFor({ state: 'attached', timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (!hasResults) {
    return [];
  }

  const found = new Map<string, Venue>();
  let unchangedScrolls = 0;

  for (let scroll = 0; scroll < config.maxResultScrolls; scroll += 1) {
    const before = found.size;
    const visible = await extractVisibleSearchResultsBatch(page);
    for (const venue of visible) {
      found.set(venueIdentityKey(venue), venue);
      if (found.size >= config.depth) {
        break;
      }
    }

    if (found.size >= config.depth || (await isEndOfResults(page))) {
      break;
    }

    unchangedScrolls = found.size === before ? unchangedScrolls + 1 : 0;
    if (unchangedScrolls >= 4) {
      break;
    }

    const linkCount = await getPlaceLinkCount(page);
    await scrollResultsPanel(page);
    await waitForSearchResultGrowth(page, linkCount, config.resultScrollDelayMs);
  }

  return [...found.values()].slice(0, config.depth);
}

async function scrapeVenueCertified(
  page: Page,
  config: ScraperConfig,
  venue: PipelineVenue,
  throttle: SharedThrottle,
): Promise<ScrapedVenue> {
  let lastError = 'Venue data did not become ready';

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await throttle.wait();
      await navigateWithRetry(page, venue.url, config.navigationTimeoutMs, venue.name);
      await acceptConsentIfPresent(page);

      if (await isRateLimited(page)) {
        lastError = 'Google rate-limit or CAPTCHA challenge detected';
        throttle.penalize(attempt === 1 ? 10_000 : 20_000);
        if (attempt < 2) {
          await throttle.wait();
          continue;
        }
        return failedRow(venue, lastError);
      }

      const overviewText = await waitForVenueData(page, VENUE_READY_TIMEOUT_MS);
      const overviewRating = parseStarRating(overviewText);
      const overviewReviewCount = parseReviewCount(overviewText);

      if (overviewRating === null || overviewReviewCount === null) {
        lastError = 'Rating/review count did not become ready';
        if (attempt < 2) {
          continue;
        }
        return partialRow(venue, overviewText, lastError);
      }

      const reviewsOpened = await openReviewsPanel(page, venue.url);
      if (!reviewsOpened) {
        lastError = isContributorUrl(page.url())
          ? 'Review control navigated to a contributor profile; removal notice is not certified'
          : 'Reviews panel could not be opened; removal notice is not certified';
        if (attempt < 2) {
          continue;
        }
        return partialRow(venue, overviewText, lastError);
      }

      const reviewsText = await waitForCertifiedReviewsText(page, REVIEWS_READY_TIMEOUT_MS);
      if (reviewsText === null) {
        lastError = 'Reviews panel opened but did not settle; negative notice result is not certified';
        if (attempt < 2) {
          continue;
        }
        return partialRow(venue, overviewText, lastError);
      }

      const deleted = parseDeletedReviews(reviewsText);
      const totalReviews = parseReviewCount(reviewsText) ?? overviewReviewCount;
      const rating = overviewRating ?? parseStarRating(reviewsText);
      const metrics = calculateMetrics({
        rating,
        visibleReviews: totalReviews,
        deletedReviewsEstimate: deleted?.estimate ?? 0,
      });

      throttle.reward();
      return {
        name: venue.name,
        url: venue.url,
        address: await extractAddress(page),
        venueType: venue.searchTerms.join('|'),
        totalReviews,
        deletedReviewsMin: deleted?.min ?? 0,
        deletedReviewsMax: deleted?.max ?? 0,
        deletedReviewsEstimate: deleted?.estimate ?? 0,
        currentStarRating: rating,
        percentageDeleted: metrics.percentageDeleted,
        realScoreIfDeletedAreOneStar: metrics.realScoreIfDeletedAreOneStar,
        deletedReviewNotice: deleted?.rawText ?? null,
        scrapedAt: new Date().toISOString(),
        status: 'ok',
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < 2 && !page.isClosed()) {
        await page.waitForTimeout(500).catch(() => undefined);
        continue;
      }
    }
  }

  return failedRow(venue, lastError);
}

async function waitForVenueData(page: Page, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let latest = '';

  while (Date.now() < deadline) {
    latest = await getRelevantExtractionText(page);
    if (parseReviewCount(latest) !== null && parseStarRating(latest) !== null) {
      return latest;
    }
    await page.waitForTimeout(VENUE_POLL_MS).catch(() => undefined);
  }

  return latest;
}

async function waitForCertifiedReviewsText(page: Page, timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  let panelReadySince: number | null = null;
  const snapshots: string[] = [];

  while (Date.now() < deadline) {
    const latest = await getRelevantExtractionText(page);
    if (latest && !snapshots.includes(latest)) {
      snapshots.push(latest);
      if (snapshots.length > 6) {
        snapshots.shift();
      }
    }

    const combined = normalizeWhitespace([...new Set(snapshots)].join(' '));
    if (combined && parseDeletedReviews(combined) !== null) {
      return combined;
    }

    const evidence = await getReviewPanelEvidence(page);
    if (evidence.positiveNoticeVisible) {
      // A visible Google notice that our parser does not understand must never
      // degrade into a negative result. Keep waiting so the venue becomes partial
      // on timeout instead of producing a false negative.
      panelReadySince = null;
    } else if (isNegativeReviewPanelReady(evidence)) {
      panelReadySince ??= Date.now();
      if (Date.now() - panelReadySince >= NEGATIVE_NOTICE_SETTLE_MS) {
        return combined;
      }
    } else {
      panelReadySince = null;
    }

    await page.waitForTimeout(REVIEWS_POLL_MS).catch(() => undefined);
  }

  return null;
}

async function openReviewsPanel(page: Page, expectedVenueUrl: string): Promise<boolean> {
  if (!isPlaceDetailUrl(page.url())) {
    return false;
  }

  if (await hasReviewsPanelOpenMarker(page)) {
    return true;
  }

  const candidateGroups: Locator[] = [
    page.getByRole('tab', { name: /^(?:Rezensionen|Bewertungen|Reviews)(?:\s.*)?$/i }),
    page.getByRole('button', { name: /^(?:Rezensionen|Bewertungen|Reviews)(?:\s.*)?$/i }),
    page.locator(
      '[role="tab"][aria-label*="Rezension"], [role="tab"][aria-label*="Bewertung"], [role="tab"][aria-label*="Review"]',
    ),
  ];

  for (let attempt = 0; attempt < 3; attempt += 1) {
    for (const group of candidateGroups) {
      const count = Math.min(await group.count().catch(() => 0), 12);
      for (let index = 0; index < count; index += 1) {
        const candidate = group.nth(index);
        if (!(await candidate.isVisible().catch(() => false))) {
          continue;
        }

        await candidate.scrollIntoViewIfNeeded().catch(() => undefined);
        const existingPages = new Set(page.context().pages());
        await candidate.click({ timeout: 1_500 }).catch(() => undefined);
        await page.waitForTimeout(100).catch(() => undefined);
        await closeNewContributorPages(page.context(), existingPages, page);

        if (!isPlaceDetailUrl(page.url())) {
          return false;
        }
        if (await waitForReviewsPanelMarker(page, 2_500)) {
          return true;
        }
      }
    }

    const existingPages = new Set(page.context().pages());
    const clickedViaDom = await clickVisibleReviewsControlViaDom(page);
    if (clickedViaDom) {
      await page.waitForTimeout(100).catch(() => undefined);
      await closeNewContributorPages(page.context(), existingPages, page);
      if (!isPlaceDetailUrl(page.url())) {
        return false;
      }
      if (await waitForReviewsPanelMarker(page, 2_500)) {
        return true;
      }
    }

    await page.waitForTimeout(300).catch(() => undefined);
  }

  // Keep the expected URL in the signature intentionally: a caller always
  // supplies the canonical venue URL, making accidental contributor navigation
  // visible in diagnostics instead of silently treating that profile as a venue.
  void expectedVenueUrl;
  return isPlaceDetailUrl(page.url()) && hasReviewsPanelOpenMarker(page);
}

async function clickVisibleReviewsControlViaDom(page: Page): Promise<boolean> {
  return page
    .evaluate(() => {
      const labelPattern = /^(?:Rezensionen|Bewertungen|Reviews)(?:\s+[\d.\s]+)?$/i;
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>('button, [role="tab"]'),
      );
      const visible = candidates.filter((element) => {
        const label = `${element.getAttribute('aria-label') ?? ''} ${element.textContent ?? ''}`
          .replace(/\s+/g, ' ')
          .trim();
        if (!labelPattern.test(label)) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.pointerEvents !== 'none'
        );
      });

      const candidate = visible[0];
      if (!candidate) {
        return false;
      }
      candidate.scrollIntoView({ block: 'center', inline: 'center' });
      candidate.click();
      return true;
    })
    .catch(() => false);
}

async function waitForReviewsPanelMarker(page: Page, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPlaceDetailUrl(page.url())) {
      return false;
    }
    if (await hasReviewsPanelOpenMarker(page)) {
      return true;
    }
    await page.waitForTimeout(100).catch(() => undefined);
  }
  return false;
}

async function hasReviewsPanelOpenMarker(page: Page): Promise<boolean> {
  const evidence = await getReviewPanelEvidence(page);
  return isReviewPanelOpenEvidence(evidence);
}

async function getRelevantExtractionText(page: Page): Promise<string> {
  const text = await page
    .evaluate(() => {
      const bodyText = document.body?.innerText ?? '';
      const labels = Array.from(document.querySelectorAll('[aria-label]'))
        .map((element) => element.getAttribute('aria-label') ?? '')
        .filter((label) =>
          /Rezension|Bewertung|Sterne|Reviews?|Stars?|Diffamierung/i.test(label),
        );
      return [bodyText, ...labels].filter(Boolean).join(' ');
    })
    .catch(() => '');
  return normalizeWhitespace(text);
}

async function extractVisibleSearchResultsBatch(page: Page): Promise<Venue[]> {
  const raw = await page
    .locator(placeLinkSelector())
    .evaluateAll((elements) =>
      elements.map((element) => {
        const anchor = element as HTMLAnchorElement;
        const aria = anchor.getAttribute('aria-label') ?? '';
        const text = (anchor.innerText ?? '').split('\n')[0] ?? '';
        return {
          href: anchor.href || anchor.getAttribute('href') || '',
          name: aria || text,
        };
      }),
    )
    .catch(() => [] as Array<{ href: string; name: string }>);

  return raw
    .map(({ href, name }) => ({ url: href, name: normalizeWhitespace(name) }))
    .filter((venue) => Boolean(venue.url && venue.name) && !isUtilityMapsLink(venue.name));
}

async function extractDirectVenue(page: Page): Promise<Venue | null> {
  if (!page.url().includes('/maps/place/')) {
    return null;
  }
  const heading = page.locator('h1').first();
  const name = normalizeWhitespace(await heading.innerText({ timeout: 5_000 }).catch(() => ''));
  return name ? { name, url: page.url() } : null;
}

async function extractAddress(page: Page): Promise<string | undefined> {
  const address = page.locator('[data-item-id="address"]').first();
  if ((await address.count()) === 0) {
    return undefined;
  }
  const aria = await address.getAttribute('aria-label');
  const text = normalizeWhitespace(aria ?? (await address.innerText().catch(() => '')));
  return text.replace(/^Adresse:\s*/i, '') || undefined;
}

async function scrollResultsPanel(page: Page): Promise<void> {
  const feed = page.getByRole('feed').first();
  if ((await feed.count()) > 0) {
    await feed.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    return;
  }
  await page.mouse.wheel(0, 3_000);
}

async function waitForSearchResultGrowth(
  page: Page,
  previousLinkCount: number,
  minimumDelayMs: number,
): Promise<void> {
  const timeoutMs = Math.max(700, minimumDelayMs);
  await page
    .waitForFunction(
      ({ selector, count }) => document.querySelectorAll(selector).length > count,
      { selector: placeLinkSelector(), count: previousLinkCount },
      { timeout: timeoutMs },
    )
    .catch(async () => {
      await page.waitForTimeout(Math.min(Math.max(minimumDelayMs, 150), 500)).catch(() => undefined);
    });
}

async function getPlaceLinkCount(page: Page): Promise<number> {
  return page.locator(placeLinkSelector()).count();
}

async function isEndOfResults(page: Page): Promise<boolean> {
  return page
    .locator('body')
    .innerText()
    .then((text) => /Das ist alles|Ende der Liste|You've reached the end|end of the list/i.test(text))
    .catch(() => false);
}

async function navigateWithRetry(
  page: Page,
  url: string,
  timeoutMs: number,
  label: string,
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= NAVIGATION_ATTEMPTS; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      return;
    } catch (error) {
      lastError = error;
      if (page.isClosed()) {
        throw error;
      }
      if (attempt < NAVIGATION_ATTEMPTS) {
        console.warn(`Navigation retry for ${label}`);
        await page.waitForTimeout(500 * attempt).catch(() => undefined);
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Navigation failed for ${label}: ${message}`);
}

async function acceptConsentIfPresent(page: Page): Promise<void> {
  const candidates = [
    page.getByRole('button', { name: /Alle akzeptieren|Akzeptieren|Accept all|I agree/i }).first(),
    page.locator('button:has-text("Alle akzeptieren")').first(),
  ];

  for (const candidate of candidates) {
    if ((await candidate.count()) > 0 && (await candidate.isVisible().catch(() => false))) {
      await candidate.click().catch(() => undefined);
      await page.waitForTimeout(150).catch(() => undefined);
      return;
    }
  }
}

async function isRateLimited(page: Page): Promise<boolean> {
  const text = normalizeWhitespace(await page.locator('body').innerText().catch(() => ''));
  return /ungewöhnlichen traffic|ungewöhnliche aktivität|unusual traffic|unusual activity|captcha|ich bin kein roboter/i.test(
    text,
  );
}

async function resetPersistentContextPages(context: BrowserContext): Promise<void> {
  const pages = context.pages();
  const keeper = pages[0] ?? (await context.newPage());

  for (const page of pages.slice(1)) {
    await page.close().catch(() => undefined);
  }

  if (!keeper.isClosed() && keeper.url() !== 'about:blank') {
    await keeper.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 5_000 }).catch(() => undefined);
  }
}

async function closeNewContributorPages(
  context: BrowserContext,
  existingPages: Set<Page>,
  activePage: Page,
): Promise<void> {
  for (const candidate of context.pages()) {
    if (candidate === activePage || existingPages.has(candidate)) {
      continue;
    }
    if (isContributorUrl(candidate.url())) {
      await candidate.close().catch(() => undefined);
    }
  }
}

function isContributorUrl(url: string): boolean {
  return /\/maps\/contrib\//i.test(url);
}

function isPlaceDetailUrl(url: string): boolean {
  return /\/maps\/place\//i.test(url) && !isContributorUrl(url);
}

async function installResourceBlocking(context: BrowserContext): Promise<void> {
  await context.route('**/*', async (route) => {
    if (shouldBlockResourceType(route.request().resourceType())) {
      await route.abort().catch(() => undefined);
      return;
    }
    await route.continue().catch(() => undefined);
  });
}

export function shouldBlockResourceType(type: string): boolean {
  return type === 'image' || type === 'media' || type === 'font';
}

export function mergeDiscoveredVenuesFast(
  state: Pick<PipelineState, 'venues'>,
  venueIndex: Map<string, PipelineVenue>,
  venues: Venue[],
  searchTerm: string,
): void {
  for (const venue of venues) {
    const key = venueIdentityKey(venue);
    const existing = venueIndex.get(key);
    if (existing) {
      if (!existing.searchTerms.includes(searchTerm)) {
        existing.searchTerms.push(searchTerm);
      }
      continue;
    }

    const added: PipelineVenue = { ...venue, searchTerms: [searchTerm] };
    state.venues.push(added);
    venueIndex.set(key, added);
  }
}

function buildVenueIndex(venues: PipelineVenue[]): Map<string, PipelineVenue> {
  return new Map(venues.map((venue) => [venueIdentityKey(venue), venue]));
}

function buildRowIndex(rows: ScrapedVenue[]): Map<string, number> {
  return new Map(rows.map((row, index) => [venueIdentityKey(row), index]));
}

function upsertRowFast(rows: ScrapedVenue[], rowIndex: Map<string, number>, row: ScrapedVenue): void {
  const key = venueIdentityKey(row);
  const index = rowIndex.get(key);
  if (index === undefined) {
    rowIndex.set(key, rows.length);
    rows.push(row);
    return;
  }
  rows[index] = row;
}

function partialRow(venue: PipelineVenue, text: string, error: string): ScrapedVenue {
  const totalReviews = parseReviewCount(text);
  const rating = parseStarRating(text);
  const metrics = calculateMetrics({ rating, visibleReviews: totalReviews, deletedReviewsEstimate: 0 });
  return {
    name: venue.name,
    url: venue.url,
    venueType: venue.searchTerms.join('|'),
    totalReviews,
    deletedReviewsMin: 0,
    deletedReviewsMax: 0,
    deletedReviewsEstimate: 0,
    currentStarRating: rating,
    percentageDeleted: metrics.percentageDeleted,
    realScoreIfDeletedAreOneStar: metrics.realScoreIfDeletedAreOneStar,
    deletedReviewNotice: null,
    scrapedAt: new Date().toISOString(),
    status: 'partial',
    error,
  };
}

function failedRow(venue: PipelineVenue, error: string): ScrapedVenue {
  return {
    name: venue.name,
    url: venue.url,
    venueType: venue.searchTerms.join('|'),
    totalReviews: null,
    deletedReviewsMin: 0,
    deletedReviewsMax: 0,
    deletedReviewsEstimate: 0,
    currentStarRating: null,
    percentageDeleted: null,
    realScoreIfDeletedAreOneStar: null,
    deletedReviewNotice: null,
    scrapedAt: new Date().toISOString(),
    status: 'failed',
    error,
  };
}

function formatPipelineProgress(done: number, total: number, row: ScrapedVenue): string {
  const reviews = row.totalReviews === null ? 'unknown reviews' : `${row.totalReviews} reviews`;
  const notice = row.deletedReviewNotice
    ? `${row.deletedReviewsMin}-${row.deletedReviewsMax} notice`
    : row.status === 'ok'
      ? 'no notice observed'
      : `${row.status}${row.error ? ` (${row.error})` : ''}`;
  return `[${done}/${total}] ${row.name} | ${reviews} | ${notice}`;
}

function placeLinkSelector(): string {
  return 'a[href*="/maps/place"], a[href*="google."][href*="/maps/place"]';
}

function isUtilityMapsLink(name: string): boolean {
  return /Route|Speichern|Teilen|Website|Anrufen|Directions|Save|Share|Call/i.test(name);
}

function configurePage(page: Page, timeoutMs: number): void {
  page.setDefaultTimeout(timeoutMs);
  page.setDefaultNavigationTimeout(timeoutMs);
}

function createPipelineState(city: string, country: string): PipelineState {
  const now = new Date().toISOString();
  return {
    version: PIPELINE_STATE_VERSION,
    city,
    country,
    completedSearchTerms: [],
    discoveryRawByTerm: {},
    venues: [],
    completedVenueKeys: [],
    rows: [],
    startedAt: now,
    updatedAt: now,
  };
}

async function loadPipelineState(
  path: string,
  city: string,
  country: string,
): Promise<PipelineState> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as PipelineState;
    if (
      parsed.version !== PIPELINE_STATE_VERSION ||
      parsed.city !== city ||
      parsed.country !== country ||
      !Array.isArray(parsed.venues) ||
      !Array.isArray(parsed.rows) ||
      !Array.isArray(parsed.completedSearchTerms) ||
      !Array.isArray(parsed.completedVenueKeys) ||
      !parsed.discoveryRawByTerm
    ) {
      return createPipelineState(city, country);
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    return createPipelineState(city, country);
  }
}

async function savePipelineState(path: string, state: PipelineState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function totalRawDiscoverySlots(state: PipelineState): number {
  return Object.values(state.discoveryRawByTerm).reduce((sum, value) => sum + value, 0);
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function clampWorkerCount(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_WORKERS) {
    throw new Error(`Worker count must be an integer between 1 and ${MAX_WORKERS}`);
  }
  return value;
}

class SharedThrottle {
  private cooldownUntil = 0;
  private penaltyMs = 0;

  async wait(): Promise<void> {
    const delay = this.cooldownUntil - Date.now();
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  penalize(milliseconds: number): void {
    this.penaltyMs = Math.max(this.penaltyMs, milliseconds);
    this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + this.penaltyMs);
  }

  reward(): void {
    this.penaltyMs = Math.floor(this.penaltyMs / 2);
    if (this.penaltyMs === 0) {
      this.cooldownUntil = 0;
    }
  }
}
