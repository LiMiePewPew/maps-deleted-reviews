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
import type { ScrapedVenue, ScraperConfig, Venue } from './types.js';
import { venueIdentityKey } from './venueIdentity.js';

const PIPELINE_VERSION = 2;
const NAVIGATION_ATTEMPTS = 2;
const VENUE_READY_TIMEOUT_MS = 12_000;
const REVIEWS_READY_TIMEOUT_MS = 8_000;
const CHECKPOINT_EVERY = 10;

interface PipelineVenue extends Venue {
  searchTerms: string[];
}

interface PipelineState {
  version: number;
  city: string;
  country: string;
  completedSearchTerms: string[];
  venues: PipelineVenue[];
  completedVenueKeys: string[];
  rows: ScrapedVenue[];
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
}

export interface PipelineSummary {
  city: string;
  country: string;
  searchTerms: number;
  discoveredVenues: number;
  checkedVenues: number;
  noticeVenues: number;
  partialVenues: number;
  failedVenues: number;
  workers: number;
  headed: boolean;
  outputPath: string;
  positivePath: string;
  statePath: string;
  durationMs: number;
}

export async function runCityPipeline(
  configs: ScraperConfig[],
  workers = 1,
): Promise<PipelineSummary> {
  if (configs.length === 0) {
    throw new Error('Pipeline requires at least one scraper config.');
  }

  const first = configs[0];
  if (!first) {
    throw new Error('Pipeline config missing.');
  }

  const city = first.city;
  const country = first.country;
  if (configs.some((config) => config.city !== city || config.country !== country)) {
    throw new Error('Pipeline V2 supports one city/country pair per invocation.');
  }

  const startedAtMs = Date.now();
  const slug = slugify(city);
  const outputPath = first.mergeCsvPath ?? `output/deleted-reviews-${slug}-gastro-all.csv`;
  const positivePath = outputPath.replace(/\.csv$/i, '-positive.csv');
  const statePath = `output/state-${slug}-gastro-v2.json`;
  let state = await loadPipelineState(statePath, city, country);

  // A completed run is a snapshot. Starting the command again creates a new snapshot,
  // while interrupted runs remain resumable.
  if (state.finishedAt) {
    state = createPipelineState(city, country);
    await savePipelineState(statePath, state);
  }

  const context = await chromium.launchPersistentContext(first.browserProfileDir, {
    headless: !first.headed,
    locale: first.locale,
    viewport: { width: 1440, height: 1100 },
  });

  await installResourceBlocking(context);

  try {
    const discoveryPage = context.pages()[0] ?? (await context.newPage());
    configurePage(discoveryPage, first.navigationTimeoutMs);

    console.log('\n=== PHASE 1: DISCOVERY ===');
    for (const config of configs) {
      if (state.completedSearchTerms.includes(config.searchTerm)) {
        console.log(`Discovery cached: ${config.searchTerm}`);
        continue;
      }

      try {
        const venues = await discoverSearchTerm(discoveryPage, config);
        for (const venue of venues) {
          mergeDiscoveredVenue(state, venue, config.searchTerm);
        }
        state.completedSearchTerms.push(config.searchTerm);
        await savePipelineState(statePath, state);
        console.log(
          `Discovery ${config.searchTerm}: ${venues.length} raw, ${state.venues.length} unique total`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Discovery failed for ${config.searchTerm}: ${message}`);
        console.warn('Continuing with the next search term; this term remains resumable.');
      }
    }

    console.log(`\nUnique venues discovered: ${state.venues.length}`);
    console.log(`=== PHASE 2: NOTICE CHECK (${workers} worker${workers === 1 ? '' : 's'}) ===`);

    const completed = new Set(state.completedVenueKeys);
    const pending = state.venues.filter((venue) => !completed.has(venueIdentityKey(venue)));
    let queueIndex = 0;
    let processedSinceCheckpoint = 0;
    let persistenceChain: Promise<void> = Promise.resolve();

    const persist = (forceCsv = false): Promise<void> => {
      processedSinceCheckpoint += 1;
      const shouldWriteCsv = forceCsv || processedSinceCheckpoint >= CHECKPOINT_EVERY;
      if (shouldWriteCsv) {
        processedSinceCheckpoint = 0;
      }

      persistenceChain = persistenceChain.then(async () => {
        await savePipelineState(statePath, state);
        if (shouldWriteCsv) {
          await writeCsv(outputPath, state.rows, first.sortCsv);
        }
      });
      return persistenceChain;
    };

    const workerTasks = Array.from({ length: Math.min(workers, Math.max(1, pending.length)) }, async (_, workerIndex) => {
      const page = workerIndex === 0 ? discoveryPage : await context.newPage();
      configurePage(page, first.navigationTimeoutMs);

      while (true) {
        const itemIndex = queueIndex;
        queueIndex += 1;
        const venue = pending[itemIndex];
        if (!venue) {
          break;
        }

        const row = await scrapeVenueCertified(page, first, venue);
        upsertRow(state.rows, row);
        const key = venueIdentityKey(venue);
        if (!state.completedVenueKeys.includes(key)) {
          state.completedVenueKeys.push(key);
        }

        const done = state.completedVenueKeys.length;
        console.log(formatPipelineProgress(done, state.venues.length, row));
        await persist(false);
      }

      if (workerIndex !== 0) {
        await page.close().catch(() => undefined);
      }
    });

    await Promise.all(workerTasks);
    await persist(true);
    await persistenceChain;

    state.finishedAt = new Date().toISOString();
    await savePipelineState(statePath, state);
    await writeCsv(outputPath, state.rows, first.sortCsv);
    const positiveRows = state.rows.filter((row) => row.deletedReviewNotice !== null);
    await writeCsv(positivePath, positiveRows, first.sortCsv);
  } finally {
    await context.close().catch(() => undefined);
  }

  const noticeVenues = state.rows.filter((row) => row.deletedReviewNotice !== null).length;
  const partialVenues = state.rows.filter((row) => row.status === 'partial').length;
  const failedVenues = state.rows.filter((row) => row.status === 'failed').length;

  return {
    city,
    country,
    searchTerms: configs.length,
    discoveredVenues: state.venues.length,
    checkedVenues: state.rows.length,
    noticeVenues,
    partialVenues,
    failedVenues,
    workers,
    headed: first.headed,
    outputPath,
    positivePath,
    statePath,
    durationMs: Date.now() - startedAtMs,
  };
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
    const visible = await extractVisibleSearchResults(page);
    for (const venue of visible) {
      found.set(venueIdentityKey(venue), venue);
      if (found.size >= config.depth) {
        break;
      }
    }

    if (found.size >= config.depth) {
      break;
    }

    unchangedScrolls = found.size === before ? unchangedScrolls + 1 : 0;
    if (unchangedScrolls >= 4) {
      break;
    }

    await scrollResultsPanel(page);
    await page.waitForTimeout(Math.max(config.resultScrollDelayMs, 250)).catch(() => undefined);
  }

  return [...found.values()].slice(0, config.depth);
}

async function scrapeVenueCertified(
  page: Page,
  config: ScraperConfig,
  venue: PipelineVenue,
): Promise<ScrapedVenue> {
  let lastError = 'Venue data did not become ready';

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await navigateWithRetry(page, venue.url, config.navigationTimeoutMs, venue.name);
      await acceptConsentIfPresent(page);

      if (await isRateLimited(page)) {
        lastError = 'Google rate-limit or CAPTCHA challenge detected';
        if (attempt < 2) {
          await page.waitForTimeout(8_000).catch(() => undefined);
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

      const reviewsOpened = await openReviewsPanel(page);
      if (!reviewsOpened) {
        lastError = 'Reviews panel could not be opened; removal notice is not certified';
        if (attempt < 2) {
          continue;
        }
        return partialRow(venue, overviewText, lastError);
      }

      const reviewsText = await waitForReviewsData(page, overviewReviewCount, REVIEWS_READY_TIMEOUT_MS);
      const deleted = parseDeletedReviews(reviewsText);
      const totalReviews = parseReviewCount(reviewsText) ?? overviewReviewCount;
      const rating = overviewRating ?? parseStarRating(reviewsText);
      const metrics = calculateMetrics({
        rating,
        visibleReviews: totalReviews,
        deletedReviewsEstimate: deleted?.estimate ?? 0,
      });

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
        await page.waitForTimeout(750).catch(() => undefined);
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
    latest = await getExtractionText(page);
    if (parseReviewCount(latest) !== null && parseStarRating(latest) !== null) {
      return latest;
    }
    await page.waitForTimeout(300).catch(() => undefined);
  }

  return latest;
}

async function waitForReviewsData(
  page: Page,
  expectedReviewCount: number,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let latest = '';

  while (Date.now() < deadline) {
    latest = await getExtractionText(page);
    const reviewCount = parseReviewCount(latest);
    const panelVisible = await hasReviewsPanel(page);
    if (panelVisible && (reviewCount === expectedReviewCount || reviewCount !== null)) {
      return latest;
    }
    await page.waitForTimeout(250).catch(() => undefined);
  }

  return latest;
}

async function openReviewsPanel(page: Page): Promise<boolean> {
  const candidates = [
    page.getByRole('tab', { name: /Rezensionen|Bewertungen|Reviews/i }).first(),
    page.getByRole('button', { name: /Rezensionen|Bewertungen|Reviews/i }).first(),
    page.locator('[aria-label*="Rezensionen"], [aria-label*="Bewertungen"], [aria-label*="Reviews"]').first(),
    page.getByText(/^Rezensionen$|^Bewertungen$|^Reviews$/i).first(),
  ];

  for (let attempt = 0; attempt < 3; attempt += 1) {
    for (const candidate of candidates) {
      if ((await candidate.count()) === 0 || !(await candidate.isVisible().catch(() => false))) {
        continue;
      }
      await candidate.click().catch(() => undefined);
      if (await waitForReviewsPanelMarker(page, 2_500)) {
        return true;
      }
    }
    await page.waitForTimeout(400).catch(() => undefined);
  }

  return hasReviewsPanel(page);
}

async function waitForReviewsPanelMarker(page: Page, timeoutMs: number): Promise<boolean> {
  return page
    .getByText(/Bewertungen aufgrund von Beschwerden wegen Diffamierung entfernt|Sortieren|Neueste|Relevanteste/i)
    .first()
    .waitFor({ state: 'attached', timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
}

async function hasReviewsPanel(page: Page): Promise<boolean> {
  return page
    .getByText(/Bewertungen aufgrund von Beschwerden wegen Diffamierung entfernt|Sortieren|Neueste|Relevanteste/i)
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
}

async function getExtractionText(page: Page): Promise<string> {
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const ariaLabels = await page
    .locator('[aria-label]')
    .evaluateAll((elements) =>
      elements
        .map((element) => element.getAttribute('aria-label'))
        .filter((label): label is string => Boolean(label)),
    )
    .catch(() => [] as string[]);

  return [...new Set([bodyText, ...ariaLabels].map(normalizeWhitespace).filter(Boolean))].join(' ');
}

async function extractVisibleSearchResults(page: Page): Promise<Venue[]> {
  const anchors = page.locator(placeLinkSelector());
  const count = await anchors.count();
  const venues: Venue[] = [];

  for (let index = 0; index < count; index += 1) {
    const anchor = anchors.nth(index);
    const href = await anchor.getAttribute('href');
    const name = await extractVenueName(anchor);
    if (!href || !name || isUtilityMapsLink(name)) {
      continue;
    }
    venues.push({ name, url: href });
  }

  return venues;
}

async function extractDirectVenue(page: Page): Promise<Venue | null> {
  if (!page.url().includes('/maps/place/')) {
    return null;
  }
  const heading = page.locator('h1').first();
  const name = normalizeWhitespace(await heading.innerText({ timeout: 5_000 }).catch(() => ''));
  return name ? { name, url: page.url() } : null;
}

async function extractVenueName(anchor: Locator): Promise<string | null> {
  const aria = await anchor.getAttribute('aria-label');
  if (aria) {
    return normalizeWhitespace(aria);
  }
  const text = normalizeWhitespace(await anchor.innerText().catch(() => ''));
  return text ? (text.split('\n')[0] ?? text) : null;
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
        await page.waitForTimeout(750 * attempt).catch(() => undefined);
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
      await page.waitForTimeout(200).catch(() => undefined);
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

async function installResourceBlocking(context: BrowserContext): Promise<void> {
  await context.route('**/*', async (route) => {
    const type = route.request().resourceType();
    if (shouldBlockResourceType(type)) {
      await route.abort().catch(() => undefined);
      return;
    }
    await route.continue().catch(() => undefined);
  });
}

export function shouldBlockResourceType(type: string): boolean {
  return type === 'image' || type === 'media' || type === 'font';
}

export function mergeDiscoveredVenue(
  state: Pick<PipelineState, 'venues'>,
  venue: Venue,
  searchTerm: string,
): void {
  const key = venueIdentityKey(venue);
  const existing = state.venues.find((candidate) => venueIdentityKey(candidate) === key);
  if (existing) {
    if (!existing.searchTerms.includes(searchTerm)) {
      existing.searchTerms.push(searchTerm);
    }
    return;
  }
  state.venues.push({ ...venue, searchTerms: [searchTerm] });
}

function upsertRow(rows: ScrapedVenue[], row: ScrapedVenue): void {
  const key = venueIdentityKey(row);
  const index = rows.findIndex((candidate) => venueIdentityKey(candidate) === key);
  if (index === -1) {
    rows.push(row);
  } else {
    rows[index] = row;
  }
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
      : row.status;
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
    version: PIPELINE_VERSION,
    city,
    country,
    completedSearchTerms: [],
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
      parsed.version !== PIPELINE_VERSION ||
      parsed.city !== city ||
      parsed.country !== country ||
      !Array.isArray(parsed.venues) ||
      !Array.isArray(parsed.rows)
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

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
