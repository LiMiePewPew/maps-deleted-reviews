import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { chromium, type BrowserContext, type Locator, type Page } from 'playwright';
import { writeCsv } from './output.js';
import {
  calculateMetrics,
  normalizeWhitespace,
  parseDeletedReviews,
  parseReviewCount,
  parseStarRating,
} from './parsers.js';
import { formatVenueProgress, formatVenuesDetected } from './progress.js';
import {
  createInitialState,
  loadOrCreateState,
  markVenueCompleted,
  markVenueFailed,
  saveState,
  upsertDiscoveredVenue,
} from './state.js';
import type { RunSummary, ScrapedVenue, ScraperConfig, ScraperState, Venue } from './types.js';
import { venueIdentityKey } from './venueIdentity.js';

type BlockerKind = 'rate-limit' | 'sign-in';

const RATE_LIMIT_USER_WAIT_MS = 60_000;
const NAVIGATION_ATTEMPTS = 2;
const NOTICE_POLL_TIMEOUT_MS = 6_000;
const NOTICE_POLL_INTERVAL_MS = 500;
const batchVenueCache = new Map<string, ScrapedVenue>();

interface Blocker {
  kind: BlockerKind;
  message: string;
}

export function resetBatchVenueCache(): void {
  batchVenueCache.clear();
}

export async function runScraper(config: ScraperConfig): Promise<RunSummary> {
  const startedAt = new Date();
  const runKey = getRunKey(config);
  let state = await loadOrCreateState(config.statePath, runKey);
  let rows = await loadExistingRows(config.outputCsvPath);
  if (reconcileStateWithRows(state, rows)) {
    await saveState(config.statePath, state);
  }
  if (shouldStartFreshRun(state, rows, config.depth)) {
    state = createInitialState(runKey);
    rows = [];
    await saveState(config.statePath, state);
  }

  for (const row of rows) {
    cacheSuccessfulVenue(row);
  }

  const context = await chromium.launchPersistentContext(config.browserProfileDir, {
    headless: !config.headed,
    locale: config.locale,
    viewport: { width: 1440, height: 1100 },
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    page.setDefaultTimeout(config.navigationTimeoutMs);
    page.setDefaultNavigationTimeout(config.navigationTimeoutMs);

    await discoverVenues(page, config, state);
    await scrapeVenues(page, config, state, rows);
    await refetchSuspectRows(page, config, state, rows);
  } finally {
    await context.close().catch(() => undefined);
  }

  return createRunSummary(config, state, rows, startedAt);
}

function getRunKey(config: ScraperConfig): string {
  return [config.city, config.country, config.searchTerm]
    .map((part) => part.trim().toLowerCase())
    .join('::');
}

function createRunSummary(
  config: ScraperConfig,
  state: ScraperState,
  rows: ScrapedVenue[],
  startedAt: Date,
): RunSummary {
  const finishedAt = new Date();
  return {
    city: config.city,
    country: config.country,
    searchTerm: config.searchTerm,
    depth: config.depth,
    outputCsvPath: config.outputCsvPath,
    statePath: config.statePath,
    summaryPath: config.summaryPath,
    discoveredVenues: state.discoveredVenues.length,
    completedVenues: state.completedUrls.length,
    failedVenues: state.failedUrls.length,
    csvRows: rows.length,
    okRows: rows.filter((row) => row.status === 'ok').length,
    partialRows: rows.filter((row) => row.status === 'partial').length,
    failedRows: rows.filter((row) => row.status === 'failed').length,
    deletionNoticesFound: rows.filter((row) => row.deletedReviewNotice).length,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };
}

async function discoverVenues(
  page: Page,
  config: ScraperConfig,
  state: ScraperState,
): Promise<void> {
  if (state.discoveredVenues.length >= config.depth) {
    return;
  }

  const searchUrl = `${config.googleMapsUrl}/search/${encodeURIComponent(
    `${config.searchTerm} ${config.city} ${config.country}`,
  )}`;

  await navigateWithRetry(page, searchUrl, config, `search for ${config.searchTerm}`);
  await maybeAcceptConsent(page);
  await handleBlocker(page, config, state);

  const directVenue = await extractDirectVenue(page);
  if (directVenue) {
    upsertDiscoveredVenue(state, directVenue);
    await saveState(config.statePath, state);
    console.log(formatVenuesDetected(state.discoveredVenues.length));
    return;
  }

  await waitForFirstSearchResult(page);

  let unchangedScrolls = 0;
  for (let scrolls = 0; scrolls < config.maxResultScrolls; scrolls += 1) {
    const before = state.discoveredVenues.length;
    const venues = await extractVisibleSearchResults(page);
    for (const venue of venues) {
      upsertDiscoveredVenue(state, venue);
      if (state.discoveredVenues.length >= config.depth) {
        break;
      }
    }

    await saveState(config.statePath, state);
    if (state.discoveredVenues.length !== before) {
      console.log(formatVenuesDetected(state.discoveredVenues.length));
    }
    if (state.discoveredVenues.length >= config.depth) {
      return;
    }

    unchangedScrolls = state.discoveredVenues.length === before ? unchangedScrolls + 1 : 0;
    if (unchangedScrolls >= 4) {
      return;
    }

    const visibleLinkCount = await getPlaceLinkCount(page);
    await scrollResultsPanel(page);
    await waitForResultListChange(page, visibleLinkCount, config.resultScrollDelayMs);
  }
}

async function scrapeVenues(
  page: Page,
  config: ScraperConfig,
  state: ScraperState,
  rows: ScrapedVenue[],
): Promise<void> {
  for (let index = state.cursor; index < state.discoveredVenues.length; index += 1) {
    const venue = state.discoveredVenues[index];
    if (!venue || state.completedUrls.includes(venue.url)) {
      continue;
    }

    const cached = batchVenueCache.get(venueIdentityKey(venue));
    if (cached && shouldCacheBatchVenue(cached)) {
      const reused = reuseCachedVenue(cached, venue, config.searchTerm);
      upsertScrapedRow(rows, reused);
      markVenueCompleted(state, venue.url);
      await saveState(config.statePath, state);
      await writeCsv(config.outputCsvPath, rows, config.sortCsv);
      console.log(`${formatVenueProgress(reused)} ⎸ cached`);
      continue;
    }

    try {
      const scraped = await scrapeVenueWithRateLimitRetry(page, config, state, venue);
      upsertScrapedRow(rows, scraped);
      cacheSuccessfulVenue(scraped);
      console.log(formatVenueProgress(scraped));

      if (scraped.status === 'failed') {
        markVenueFailed(state, venue.url);
      } else {
        markVenueCompleted(state, venue.url);
      }
      await saveState(config.statePath, state);
      await writeCsv(config.outputCsvPath, rows, config.sortCsv);
    } catch (error) {
      markVenueFailed(state, venue.url);
      await saveState(config.statePath, state);

      const message = error instanceof Error ? error.message : String(error);
      upsertScrapedRow(rows, toFailedRow(venue, message, config.searchTerm));
      await writeCsv(config.outputCsvPath, rows, config.sortCsv);

      if (config.resumeMode === 'stop') {
        throw new Error(
          `Stopped after failure at ${venue.name}. State saved to ${config.statePath}. Cause: ${message}`,
        );
      }

      await promptManualResume(
        `Could not scrape "${venue.name}". Resolve the issue in the browser if possible, then press Enter to continue.`,
      );
    }
  }
}

async function refetchSuspectRows(
  page: Page,
  config: ScraperConfig,
  state: ScraperState,
  rows: ScrapedVenue[],
): Promise<void> {
  const suspectRows = rows.filter(shouldRefetchScrapedRow);
  if (suspectRows.length === 0) {
    return;
  }

  for (const row of suspectRows) {
    const venue = state.discoveredVenues.find((candidate) => candidate.url === row.url) ?? row;
    const cached = batchVenueCache.get(venueIdentityKey(venue));
    if (cached && shouldCacheBatchVenue(cached)) {
      const reused = reuseCachedVenue(cached, venue, config.searchTerm);
      upsertScrapedRow(rows, reused);
      markVenueCompleted(state, venue.url);
      await saveState(config.statePath, state);
      await writeCsv(config.outputCsvPath, rows, config.sortCsv);
      continue;
    }

    try {
      const scraped = await scrapeVenueWithRateLimitRetry(page, config, state, venue);
      upsertScrapedRow(rows, scraped);
      cacheSuccessfulVenue(scraped);
      console.log(formatVenueProgress(scraped));
      if (scraped.status === 'failed') {
        markVenueFailed(state, venue.url);
      } else {
        markVenueCompleted(state, venue.url);
      }
      await saveState(config.statePath, state);
      await writeCsv(config.outputCsvPath, rows, config.sortCsv);
    } catch (error) {
      markVenueFailed(state, venue.url);
      await saveState(config.statePath, state);

      const message = error instanceof Error ? error.message : String(error);
      upsertScrapedRow(rows, toFailedRow(venue, message, config.searchTerm));
      await writeCsv(config.outputCsvPath, rows, config.sortCsv);

      if (config.resumeMode === 'stop') {
        throw new Error(
          `Stopped after refetch failure at ${venue.name}. State saved to ${config.statePath}. Cause: ${message}`,
        );
      }

      await promptManualResume(
        `Could not refetch "${venue.name}". Resolve the issue in the browser if possible, then press Enter to continue.`,
      );
    }
  }
}

async function scrapeVenueWithRateLimitRetry(
  page: Page,
  config: ScraperConfig,
  state: ScraperState,
  venue: Venue,
): Promise<ScrapedVenue> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await navigateWithRetry(page, venue.url, config, venue.name);
    await maybeAcceptConsent(page);
    const blocker = await detectBlocker(page);
    if (blocker?.kind === 'rate-limit') {
      await waitForRateLimitPage(page);
      if (attempt === 0) {
        continue;
      }

      return toFailedRow(venue, blocker.message, config.searchTerm);
    }

    await handleBlocker(page, config, state, blocker);
    await waitForVenueShell(page, venue);
    return scrapeVenue(page, venue, config.searchTerm);
  }

  return toFailedRow(venue, 'Google rate-limit challenge persisted after retry', config.searchTerm);
}

export function shouldRefetchScrapedRow(row: ScrapedVenue): boolean {
  return (
    row.status === 'failed' ||
    row.status === 'partial' ||
    row.totalReviews === null ||
    (row.currentStarRating !== null && row.currentStarRating > 5) ||
    row.totalReviews === 0
  );
}

export function shouldStartFreshRun(
  state: ScraperState,
  rows: ScrapedVenue[],
  depth: number,
): boolean {
  if (state.discoveredVenues.length < depth) {
    return false;
  }

  const completedUrls = new Set(state.completedUrls);
  const rowUrls = new Set(rows.map((row) => row.url));
  const requestedVenues = state.discoveredVenues.slice(0, depth);

  return requestedVenues.every(
    (venue) => completedUrls.has(venue.url) && rowUrls.has(venue.url),
  );
}

export function shouldCacheBatchVenue(row: ScrapedVenue): boolean {
  return row.status === 'ok' && row.deletedReviewNotice !== null && row.deletedReviewsMax > 0;
}

export function upsertScrapedRow(rows: ScrapedVenue[], row: ScrapedVenue): void {
  const key = venueIdentityKey(row);
  const index = rows.findIndex((candidate) => venueIdentityKey(candidate) === key);
  if (index === -1) {
    rows.push(row);
    return;
  }

  rows[index] = row;
}

export function reconcileStateWithRows(state: ScraperState, rows: ScrapedVenue[]): boolean {
  const rowUrls = new Set(rows.map((row) => row.url));
  const completedUrls = state.completedUrls.filter((url) => rowUrls.has(url));
  const failedUrls = state.failedUrls.filter((url) => rowUrls.has(url));
  const changed =
    completedUrls.length !== state.completedUrls.length ||
    failedUrls.length !== state.failedUrls.length;

  state.completedUrls = completedUrls;
  state.failedUrls = failedUrls;
  state.cursor = 0;
  while (
    state.cursor < state.discoveredVenues.length &&
    state.completedUrls.includes(state.discoveredVenues[state.cursor]?.url ?? '')
  ) {
    state.cursor += 1;
  }

  return changed;
}

async function scrapeVenue(
  page: Page,
  venue: Venue,
  venueType: string,
): Promise<ScrapedVenue> {
  let overviewText = await getExtractionText(page);
  if (parseStarRating(overviewText) === null && parseReviewCount(overviewText) === null) {
    await page.waitForTimeout(700);
    overviewText = await getExtractionText(page);
  }

  const overviewRating = parseStarRating(overviewText);
  const overviewReviewCount = parseReviewCount(overviewText);

  const openedReviews = await openReviewsTab(page);
  if (openedReviews) {
    await waitForReviewsPanel(page);
  }

  let pageText = openedReviews ? await getExtractionText(page) : overviewText;
  if (openedReviews && parseReviewCount(pageText) === null) {
    await page.waitForTimeout(700);
    pageText = await getExtractionText(page);
  }

  let deleted = parseDeletedReviews(pageText);
  if (openedReviews && deleted === null) {
    const pollStartedAt = Date.now();
    while (deleted === null && Date.now() - pollStartedAt < NOTICE_POLL_TIMEOUT_MS) {
      await page.waitForTimeout(NOTICE_POLL_INTERVAL_MS);
      pageText = await getExtractionText(page);
      deleted = parseDeletedReviews(pageText);
    }
  }

  const totalReviews = parseReviewCount(pageText) ?? overviewReviewCount;
  const rating = overviewRating ?? parseStarRating(pageText);
  const metrics = calculateMetrics({
    rating,
    visibleReviews: totalReviews,
    deletedReviewsEstimate: deleted?.estimate ?? 0,
  });

  const status: ScrapedVenue['status'] =
    totalReviews === null || rating === null || (!openedReviews && deleted === null)
      ? 'partial'
      : 'ok';

  return {
    ...venue,
    venueType,
    totalReviews,
    deletedReviewsMin: deleted?.min ?? 0,
    deletedReviewsMax: deleted?.max ?? 0,
    deletedReviewsEstimate: deleted?.estimate ?? 0,
    currentStarRating: rating,
    percentageDeleted: metrics.percentageDeleted,
    realScoreIfDeletedAreOneStar: metrics.realScoreIfDeletedAreOneStar,
    deletedReviewNotice: deleted?.rawText ?? null,
    scrapedAt: new Date().toISOString(),
    status,
  };
}

async function waitForFirstSearchResult(page: Page): Promise<void> {
  await page
    .locator('a[href*="/maps/place"], a[href*="google."][href*="/maps/place"]')
    .first()
    .waitFor({ state: 'attached', timeout: 10_000 })
    .catch(() => undefined);
}

async function waitForResultListChange(
  page: Page,
  previousLinkCount: number,
  minimumDelayMs: number,
): Promise<void> {
  const timeoutMs = Math.max(minimumDelayMs, 1_500);
  await page
    .waitForFunction(
      (count) =>
        document.querySelectorAll('a[href*="/maps/place"], a[href*="google."][href*="/maps/place"]').length >
        count,
      previousLinkCount,
      { timeout: timeoutMs },
    )
    .catch(async () => {
      await page.waitForTimeout(minimumDelayMs).catch(() => undefined);
    });
}

async function waitForVenueShell(page: Page, venue: Venue): Promise<void> {
  await page
    .waitForFunction(
      (name) => document.body.innerText.includes(name) && /[1-5],[0-9]|Rezension/.test(document.body.innerText),
      venue.name,
      { timeout: 1_300 },
    )
    .catch(() => undefined);
}

async function waitForReviewsPanel(page: Page): Promise<void> {
  await page
    .getByText(/Bewertungen aufgrund von Beschwerden wegen Diffamierung entfernt|Rezensionen|Sortieren/i)
    .first()
    .waitFor({ state: 'attached', timeout: 2_500 })
    .catch(() => undefined);
}

async function getExtractionText(page: Page): Promise<string> {
  const bodyText = await page.locator('body').innerText();
  const ariaLabels = await page.locator('[aria-label]').evaluateAll((elements) =>
    elements
      .map((element) => element.getAttribute('aria-label'))
      .filter((label): label is string => Boolean(label)),
  );

  return combineExtractionText(bodyText, ariaLabels);
}

export function combineExtractionText(bodyText: string, ariaLabels: string[]): string {
  const fragments = [bodyText, ...ariaLabels]
    .map((fragment) => normalizeWhitespace(fragment))
    .filter(Boolean);

  return [...new Set(fragments)].join(' ');
}

async function extractVisibleSearchResults(page: Page): Promise<Venue[]> {
  const anchors = page.locator('a[href*="/maps/place"], a[href*="google."][href*="/maps/place"]');
  const count = await anchors.count();
  const venues: Venue[] = [];

  for (let index = 0; index < count; index += 1) {
    const anchor = anchors.nth(index);
    const href = await anchor.getAttribute('href');
    const name = await extractVenueName(anchor);
    if (!href || !name || isUtilityMapsLink(name)) {
      continue;
    }

    venues.push({
      name,
      url: href,
    });
  }

  return venues;
}

async function extractDirectVenue(page: Page): Promise<Venue | null> {
  if (!page.url().includes('/maps/place/')) {
    return null;
  }

  const heading = page.locator('h1').first();
  await heading.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
  const name = normalizeWhitespace(await heading.innerText().catch(() => ''));
  if (!name) {
    return null;
  }

  return {
    name,
    url: page.url(),
  };
}

async function extractVenueName(anchor: Locator): Promise<string | null> {
  const aria = await anchor.getAttribute('aria-label');
  if (aria) {
    return normalizeWhitespace(aria);
  }

  const text = normalizeWhitespace(await anchor.innerText().catch(() => ''));
  return text.length > 0 ? text.split('\n')[0] ?? text : null;
}

async function openReviewsTab(page: Page): Promise<boolean> {
  const candidates = [
    page.getByRole('tab', { name: /Rezensionen|Bewertungen|Reviews/i }).first(),
    page.getByRole('button', { name: /^Rezensionen$|^Bewertungen$|^Reviews$/i }).first(),
    page.locator('[aria-label*="Rezensionen"], [aria-label*="Bewertungen"], [aria-label*="Reviews"]').first(),
    page.getByText(/^Rezensionen$|^Bewertungen$|^Reviews$/i).first(),
  ];

  for (let attempt = 0; attempt < 3; attempt += 1) {
    for (const candidate of candidates) {
      if ((await candidate.count()) === 0 || !(await candidate.isVisible().catch(() => false))) {
        continue;
      }

      await candidate.click().catch(() => undefined);
      await waitForReviewsPanel(page);
      if (await hasReviewsPanel(page)) {
        return true;
      }
    }

    await page.waitForTimeout(700);
  }

  return false;
}

async function hasReviewsPanel(page: Page): Promise<boolean> {
  return page
    .getByText(/Bewertungen aufgrund von Beschwerden wegen Diffamierung entfernt|Sortieren|Neueste|Relevanteste/i)
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
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

  await page.mouse.wheel(0, 2_500);
}

async function getPlaceLinkCount(page: Page): Promise<number> {
  return page
    .locator('a[href*="/maps/place"], a[href*="google."][href*="/maps/place"]')
    .count();
}

async function maybeAcceptConsent(page: Page): Promise<void> {
  const consentButtons = [
    page.getByRole('button', { name: /Alle akzeptieren|Akzeptieren|Accept all|I agree/i }).first(),
    page.locator('button:has-text("Alle akzeptieren")').first(),
  ];

  for (const button of consentButtons) {
    if ((await button.count()) > 0 && (await button.isVisible().catch(() => false))) {
      await button.click();
      await page.waitForTimeout(250);
      return;
    }
  }
}

async function navigateWithRetry(
  page: Page,
  url: string,
  config: ScraperConfig,
  label: string,
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= NAVIGATION_ATTEMPTS; attempt += 1) {
    await randomDelay(config);
    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: config.navigationTimeoutMs,
      });
      return;
    } catch (error) {
      lastError = error;
      if (page.isClosed()) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Browser page closed while navigating to ${label}: ${message}`);
      }

      if (attempt < NAVIGATION_ATTEMPTS) {
        console.warn(`Navigation retry ${attempt}/${NAVIGATION_ATTEMPTS - 1} for ${label}.`);
        await page.waitForTimeout(1_000 * attempt).catch(() => undefined);
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Navigation failed for ${label} after ${NAVIGATION_ATTEMPTS} attempts: ${message}`);
}

async function handleBlocker(
  page: Page,
  config: ScraperConfig,
  state: ScraperState,
  knownBlocker?: Blocker | null,
): Promise<void> {
  const blocker = knownBlocker ?? (await detectBlocker(page));
  if (!blocker) {
    return;
  }

  if (blocker.kind === 'rate-limit') {
    await waitForRateLimitPage(page);
    if (!(await detectBlocker(page))) {
      return;
    }
  }

  await saveState(config.statePath, state);
  if (config.resumeMode === 'stop') {
    throw new Error(`${blocker.message}. State saved to ${config.statePath}.`);
  }

  await promptManualResume(`${blocker.message}. Resolve it in the browser, then press Enter to continue.`);
}

async function detectBlocker(page: Page): Promise<Blocker | null> {
  const text = normalizeWhitespace(await page.locator('body').innerText().catch(() => ''));
  const kind = detectBlockerKind(text);
  const message = detectBlockerText(text);
  return kind && message ? { kind, message } : null;
}

export function detectBlockerKind(text: string): BlockerKind | null {
  if (
    /ungewöhnlichen traffic|ungewöhnliche aktivität|unusual traffic|unusual activity|captcha|ich bin kein roboter/i.test(
      text,
    )
  ) {
    return 'rate-limit';
  }
  if (
    /accounts\.google\.com|myaccount\.google\.com/i.test(text) ||
    (/Anmelden|Sign in/i.test(text) && /Passwort|password|E-Mail|email/i.test(text))
  ) {
    return 'sign-in';
  }

  return null;
}

export function detectBlockerText(text: string): string | null {
  if (
    /ungewöhnlichen traffic|ungewöhnliche aktivität|unusual traffic|unusual activity|captcha|ich bin kein roboter/i.test(
      text,
    )
  ) {
    return 'Google appears to be throttling or challenging the session';
  }
  if (
    /accounts\.google\.com|myaccount\.google\.com/i.test(text) ||
    (/Anmelden|Sign in/i.test(text) && /Passwort|password|E-Mail|email/i.test(text))
  ) {
    return 'Google is asking for sign-in or manual account interaction';
  }

  return null;
}

async function waitForRateLimitPage(page: Page): Promise<void> {
  await page.waitForLoadState('load', { timeout: 5_000 }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
  console.log('Google challenge detected. Waiting 60 seconds for manual captcha resolution...');
  await page.waitForTimeout(RATE_LIMIT_USER_WAIT_MS);
}

async function promptManualResume(message: string): Promise<void> {
  const readline = createInterface({ input, output });
  try {
    await readline.question(`${message}\n`);
  } finally {
    readline.close();
  }
}

async function randomDelay(config: ScraperConfig): Promise<void> {
  if (config.actionDelay.maxMs === 0) {
    return;
  }

  const spread = config.actionDelay.maxMs - config.actionDelay.minMs;
  const delay = config.actionDelay.minMs + Math.floor(Math.random() * (spread + 1));
  await new Promise((resolve) => setTimeout(resolve, delay));
}

function cacheSuccessfulVenue(row: ScrapedVenue): void {
  if (!shouldCacheBatchVenue(row)) {
    return;
  }
  batchVenueCache.set(venueIdentityKey(row), row);
}

function reuseCachedVenue(cached: ScrapedVenue, venue: Venue, venueType: string): ScrapedVenue {
  return {
    ...cached,
    ...venue,
    address: venue.address ?? cached.address,
    venueType,
  };
}

async function loadExistingRows(outputCsvPath: string): Promise<ScrapedVenue[]> {
  try {
    const raw = await readFile(outputCsvPath, 'utf8');
    const [, ...lines] = raw.trim().split('\n');
    const headers = raw.trim().split('\n')[0]?.split(',') ?? [];
    const usesPercentValue = headers[0] === 'venue_type';

    return lines.filter(Boolean).map((line) => {
      const cells = parseCsvLine(line);
      const cell = (header: string): string | undefined => {
        const index = headers.indexOf(header);
        return index >= 0 ? cells[index] : undefined;
      };
      const percentageDeleted = parseNullableNumber(cell('percentage_deleted') ?? cells[8]);

      return {
        venueType: cell('venue_type') ?? '',
        name: cell('name') ?? cells[0] ?? '',
        address: cell('address') || cells[1] || undefined,
        url: cell('url') ?? cells[2] ?? '',
        totalReviews: parseNullableNumber(cell('total_reviews') ?? cells[3]),
        deletedReviewsMin: Number(cell('deleted_reviews_min') ?? cells[4] ?? 0),
        deletedReviewsMax: Number(cell('deleted_reviews_max') ?? cells[5] ?? 0),
        deletedReviewsEstimate: Number(cell('deleted_reviews_estimate') ?? cells[6] ?? 0),
        currentStarRating: parseNullableNumber(cell('current_star_rating') ?? cells[7]),
        percentageDeleted:
          percentageDeleted === null
            ? null
            : usesPercentValue
              ? percentageDeleted / 100
              : percentageDeleted,
        realScoreIfDeletedAreOneStar: parseNullableNumber(
          cell('real_score') ?? cell('real_score_if_deleted_are_1star') ?? cells[9],
        ),
        deletedReviewNotice:
          (cell('review_notice') ?? cell('deleted_review_notice') ?? cells[10]) || null,
        status: ((cell('status') ?? cells[11]) as ScrapedVenue['status']) || 'partial',
        error: (cell('error') ?? cells[12]) || undefined,
        scrapedAt: cell('scraped_at') ?? cells[13] ?? new Date().toISOString(),
      };
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      cells.push(cell);
      cell = '';
      continue;
    }

    cell += char;
  }

  cells.push(cell);
  return cells;
}

function parseNullableNumber(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isUtilityMapsLink(name: string): boolean {
  return /Route|Speichern|Teilen|Website|Anrufen|Directions|Save|Share|Call/i.test(name);
}

function toFailedRow(venue: Venue, error: string, venueType: string): ScrapedVenue {
  return {
    ...venue,
    venueType,
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
