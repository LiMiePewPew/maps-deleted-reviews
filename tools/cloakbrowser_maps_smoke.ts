import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { normalizeWhitespace, parseDeletedReviews, parseReviewCount, parseStarRating } from '../src/parsers.js';

const TARGET_NAME = 'Kakkoii Sushi Grill & Bar';
const SEARCH_URL = `https://www.google.de/maps/search/${encodeURIComponent(`${TARGET_NAME} Osnabrück Germany`)}`;
const PROFILE_DIR = resolve('output/cloakbrowser-google-profile');
const BLOCK_RE = /ungewöhnlichen traffic|ungewöhnliche aktivität|unusual traffic|unusual activity|captcha|ich bin kein roboter|verify you are human|access denied/i;

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function extractionText(page: any): Promise<string> {
  const raw = await page.evaluate(() => {
    const body = document.body?.innerText ?? '';
    const labels = Array.from(document.querySelectorAll('[aria-label]'))
      .map((element) => element.getAttribute('aria-label') ?? '')
      .filter(Boolean);
    return [body, ...labels].join(' ');
  });
  return normalizeWhitespace(String(raw ?? ''));
}

async function openTarget(page: any): Promise<void> {
  await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await sleep(1_500);

  if (page.url().includes('/maps/place/')) {
    return;
  }

  const target = page.getByRole('link', { name: new RegExp(TARGET_NAME, 'i') }).first();
  if (await target.isVisible({ timeout: 8_000 }).catch(() => false)) {
    const href = await target.getAttribute('href');
    if (href) {
      await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 90_000 });
      return;
    }
  }

  const firstPlace = page.locator('a[href*="/maps/place"]').first();
  const href = await firstPlace.getAttribute('href', { timeout: 8_000 }).catch(() => null);
  if (!href) {
    throw new Error('No Google Maps place result found for positive control');
  }
  await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 90_000 });
}

async function openReviews(page: any): Promise<boolean> {
  const candidates = [
    page.getByRole('tab', { name: /Rezensionen|Bewertungen|Reviews/i }).first(),
    page.getByRole('button', { name: /Rezensionen|Bewertungen|Reviews/i }).first(),
    page.locator('[aria-label*="Rezensionen"], [aria-label*="Bewertungen"], [aria-label*="Reviews"]').first(),
    page.getByText(/^Rezensionen$|^Bewertungen$|^Reviews$/i).first(),
  ];

  for (const candidate of candidates) {
    if (!(await candidate.isVisible({ timeout: 1_500 }).catch(() => false))) {
      continue;
    }
    await candidate.click().catch(() => undefined);
    await sleep(750);
    return true;
  }

  return false;
}

async function main(): Promise<void> {
  await mkdir(PROFILE_DIR, { recursive: true });

  let launchPersistentContext: any;
  try {
    ({ launchPersistentContext } = await import('cloakbrowser'));
  } catch (error) {
    console.error('CloakBrowser is not installed.');
    console.error('Run: npm install --no-save --package-lock=false cloakbrowser playwright-core');
    throw error;
  }

  const context = await launchPersistentContext({
    userDataDir: PROFILE_DIR,
    headless: false,
    humanize: true,
    locale: 'de-DE',
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await openTarget(page);

    let overview = '';
    for (let attempt = 0; attempt < 30; attempt += 1) {
      overview = await extractionText(page);
      if (BLOCK_RE.test(overview)) {
        console.log('block_detected=yes');
        console.log('verdict=BLOCKED');
        return;
      }
      if (parseReviewCount(overview) !== null && parseStarRating(overview) !== null) {
        break;
      }
      await sleep(250);
    }

    console.log(`final_url=${page.url()}`);
    console.log(`review_count=${parseReviewCount(overview) ?? 'unknown'}`);
    console.log(`rating=${parseStarRating(overview) ?? 'unknown'}`);

    const opened = await openReviews(page);
    console.log(`reviews_panel_opened=${opened ? 'yes' : 'no'}`);
    if (!opened) {
      console.log('verdict=PARTIAL');
      return;
    }

    let reviewsText = '';
    let deleted = null;
    const startedAt = Date.now();
    while (Date.now() - startedAt < 8_000) {
      reviewsText = await extractionText(page);
      if (BLOCK_RE.test(reviewsText)) {
        console.log('block_detected=yes');
        console.log('verdict=BLOCKED');
        return;
      }
      deleted = parseDeletedReviews(reviewsText);
      if (deleted) {
        break;
      }
      await sleep(200);
    }

    if (deleted) {
      console.log(`notice=${deleted.min}-${deleted.max}`);
      console.log(`notice_raw=${deleted.rawText}`);
      console.log('block_detected=no');
      console.log('verdict=PASS');
      return;
    }

    console.log('notice=none');
    console.log('block_detected=no');
    console.log('verdict=FAIL_POSITIVE_CONTROL');
  } finally {
    await context.close().catch(() => undefined);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`runtime_error=${message}`);
  process.exitCode = 1;
});
