#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

interface WebVenue {
  searchTerm: string;
  googleCategory: string | null;
  name: string;
  totalReviews: number | null;
  noticeRangeKey: string | null;
  noticeMin: number | null;
  noticeMax: number | null;
  noticeOpenEnded: boolean;
  reviewNotice: string | null;
  url: string;
  address: string;
  status: string;
  scrapedAt: string | null;
  hasNotice: boolean;
}

interface WebDataset {
  schemaVersion: 2;
  city: string;
  generatedAt: string;
  source: string;
  sourceCsv: string;
  summary: {
    candidateProfiles: number;
    observedVenues: number;
    noticesFound: number;
    noNoticeObserved: number;
    uncertain: number;
    failed: number;
    firstScrapedAt: string | null;
    lastScrapedAt: string | null;
    excludedOutsideArea: number;
    excludedClearlyNonGastro: number;
  };
  venues: WebVenue[];
}

const DEFAULT_SOURCE = 'output/deleted-reviews-osnabruck-gastro-all.csv';
const DEFAULT_OUTPUT = 'docs/data/osnabruck.json';
const DEFAULT_CITY = 'Osnabrück';

const OSNABRUECK_CENTER = { lat: 52.27, lon: 8.05 };
const OSNABRUECK_MAX_DISTANCE_KM = 12.5;
const OSNABRUECK_POSTCODES = new Set([
  '49074',
  '49076',
  '49078',
  '49080',
  '49082',
  '49084',
  '49086',
  '49088',
  '49090',
]);
const NEARBY_MUNICIPALITY_PATTERN =
  /\b(?:belm|bissendorf|georgsmarienh(?:ü|u)tte|hasbergen|lotte|wallenhorst|bramsche|hagen\s+(?:am|a\.)\s+teutoburger\s+wald)\b/i;

const CLEARLY_NON_GASTRO_NAME_PATTERN =
  /\b(?:thai[- ]?massage|massage|nagelstudio|nails?|lashes?|tattoo|piercing|sprachschule|parkplatz|bahnhof|eventagentur|mädchenzentrum|fitnessstudio|fahrschule)\b|design\s+in\s+stein/i;
const CLEARLY_NON_GASTRO_CATEGORY_PATTERN =
  /\b(?:massage|massage spa|nail salon|beautician|eyelash salon|tattoo|piercing|parking|railway|train station|language school|beauty salon|fitness center|driving school)\b/i;
const CLEARLY_LODGING_NAME_PATTERN =
  /\b(?:hotel|pension|boardinghouse|hostel|jugendherberge|monteurzimmer|ferienwohnung|ferienhaus|apartment|appartement|campingplatz|campground|limehome|stayery)\b/i;
const CLEARLY_LODGING_CATEGORY_PATTERN =
  /\b(?:hotel|hostel|lodging|guest house|bed\s*(?:&|and)\s*breakfast|campground|camping|holiday apartment|serviced apartment)\b/i;
const GASTRO_SIGNAL_PATTERN =
  /\b(?:restaurant|cafe|café|bar|bistro|gasthaus|gaststätte|brauerei|weinbar|grill|küche|kitchen|frühstück|breakfast|eventrooms?)\b/i;
const CLEARLY_NON_GASTRO_EXACT_NAMES = new Set(
  [
    'MariJing Thai Massage & Asia Wellness',
    'Ha Beauty Nails, Lashes & More',
    'Studio Royal Osnabrück',
    'Italienisches Design in Stein',
    'Sprachschule inlingua',
    'Osnabrück Hbf',
    'Casino werk',
    'LOTTA - DEINE EVENTAGENTUR',
  ].map(normalizeText),
);

export function buildWebDataset(rawCsv: string, city = DEFAULT_CITY, sourceCsv = DEFAULT_SOURCE): WebDataset {
  const records = parseCsv(rawCsv);
  const candidates = records.map(toWebVenue).filter((venue) => venue.name.length > 0);
  const insideArea = candidates.filter((venue) => !isClearlyOutsideTargetArea(venue, city));
  const venues = insideArea.filter((venue) => !isClearlyNonGastroProfile(venue));
  const excludedOutsideArea = candidates.length - insideArea.length;
  const excludedClearlyNonGastro = insideArea.length - venues.length;
  const notices = venues.filter((venue) => venue.hasNotice);
  const timestamps = venues
    .map((venue) => Date.parse(venue.scrapedAt ?? ''))
    .filter((value) => Number.isFinite(value));

  return {
    schemaVersion: 2,
    city,
    generatedAt: new Date().toISOString(),
    source: 'Google Maps public review-removal transparency notices',
    sourceCsv,
    summary: {
      candidateProfiles: candidates.length,
      observedVenues: venues.length,
      noticesFound: notices.length,
      noNoticeObserved: venues.filter((venue) => venue.status === 'ok' && !venue.hasNotice).length,
      uncertain: venues.filter((venue) => venue.status === 'partial').length,
      failed: venues.filter((venue) => venue.status === 'failed').length,
      firstScrapedAt: timestamps.length ? new Date(Math.min(...timestamps)).toISOString() : null,
      lastScrapedAt: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null,
      excludedOutsideArea,
      excludedClearlyNonGastro,
    },
    venues: [...venues].sort(
      (left, right) =>
        Number(right.hasNotice) - Number(left.hasNotice) ||
        noticeSortValue(right) - noticeSortValue(left) ||
        left.name.localeCompare(right.name, 'de', { sensitivity: 'base' }),
    ),
  };
}

export function isClearlyOutsideTargetArea(
  venue: Pick<WebVenue, 'name' | 'address' | 'url'>,
  city = DEFAULT_CITY,
): boolean {
  if (normalizeCity(city) !== 'osnabruck') {
    return false;
  }

  const nameAndAddress = `${venue.name} ${venue.address}`;
  if (NEARBY_MUNICIPALITY_PATTERN.test(nameAndAddress)) {
    return true;
  }

  const postcode = venue.address.match(/\b\d{5}\b/)?.[0];
  if (postcode) {
    return !OSNABRUECK_POSTCODES.has(postcode);
  }

  if (/\bosnabr(?:ü|u)ck\b/i.test(venue.address)) {
    return false;
  }

  const coordinates = parseGoogleMapsCoordinates(venue.url);
  if (!coordinates) {
    return false;
  }

  return haversineDistanceKm(OSNABRUECK_CENTER, coordinates) > OSNABRUECK_MAX_DISTANCE_KM;
}

export function isClearlyNonGastroProfile(
  venue: Pick<WebVenue, 'name' | 'googleCategory'>,
): boolean {
  const normalizedName = normalizeText(venue.name);
  if (CLEARLY_NON_GASTRO_EXACT_NAMES.has(normalizedName)) {
    return true;
  }

  if (CLEARLY_NON_GASTRO_NAME_PATTERN.test(venue.name)) {
    return true;
  }

  if (venue.googleCategory && CLEARLY_NON_GASTRO_CATEGORY_PATTERN.test(venue.googleCategory)) {
    return true;
  }

  const classificationText = `${venue.name} ${venue.googleCategory ?? ''}`;
  const looksLikeLodging =
    CLEARLY_LODGING_NAME_PATTERN.test(venue.name) ||
    Boolean(
      venue.googleCategory && CLEARLY_LODGING_CATEGORY_PATTERN.test(venue.googleCategory),
    );

  // Keep mixed hospitality profiles such as "Hotel-Restaurant" or "Hotel ... Cafe".
  // Only obvious lodging-only profiles are removed from the public gastro dataset.
  return looksLikeLodging && !GASTRO_SIGNAL_PATTERN.test(classificationText);
}

export function parseGoogleMapsCoordinates(url: string): { lat: number; lon: number } | null {
  if (!url) {
    return null;
  }

  const decoded = decodeURIComponent(url);

  // !3d/!4d identify the actual place in common Maps URLs. The @lat,lon pair can
  // merely describe the viewport, so it is only a fallback for area filtering.
  const dataMatch = decoded.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (dataMatch) {
    return { lat: Number(dataMatch[1]), lon: Number(dataMatch[2]) };
  }

  const atMatch = decoded.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,|\/|$)/);
  if (atMatch) {
    return { lat: Number(atMatch[1]), lon: Number(atMatch[2]) };
  }

  return null;
}

export function parseCsv(raw: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const next = raw[index + 1];

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
      row.push(cell);
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      row.push(cell);
      cell = '';
      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((value) => value.length > 0)) {
      rows.push(row);
    }
  }

  const [headers, ...dataRows] = rows;
  if (!headers) {
    return [];
  }

  return dataRows.map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header.trim(), cells[index] ?? ''])),
  );
}

function toWebVenue(record: Record<string, string>): WebVenue {
  const legacyMin = numberOrZero(record.deleted_reviews_min);
  const legacyMax = numberOrZero(record.deleted_reviews_max);
  const reviewNotice = emptyToNull(record.review_notice);
  const hasNotice = legacyMax > 0 || legacyMin > 0 || Boolean(reviewNotice);
  const noticeOpenEnded =
    hasNotice &&
    (isOver250Notice(reviewNotice) || (legacyMin === 250 && legacyMax === 250));
  const noticeMin = hasNotice ? (noticeOpenEnded ? 251 : legacyMin) : null;
  const noticeMax = hasNotice ? (noticeOpenEnded ? null : legacyMax) : null;

  return {
    searchTerm: record.venue_type?.trim() ?? '',
    googleCategory: emptyToNull(record.google_category),
    name: record.name?.trim() ?? '',
    totalReviews: nullableNumber(record.total_reviews),
    noticeRangeKey: hasNotice ? buildNoticeRangeKey(noticeMin, noticeMax, noticeOpenEnded) : null,
    noticeMin,
    noticeMax,
    noticeOpenEnded,
    reviewNotice,
    url: record.url?.trim() ?? '',
    address: record.address?.trim() ?? '',
    status: record.status?.trim() || 'partial',
    scrapedAt: emptyToNull(record.scraped_at),
    hasNotice,
  };
}

function isOver250Notice(value: string | null): boolean {
  return Boolean(value && /(?:über|ueber)\s+250/i.test(value));
}

function buildNoticeRangeKey(
  min: number | null,
  max: number | null,
  openEnded: boolean,
): string {
  if (openEnded) {
    return 'over-250';
  }
  if (min === null || max === null) {
    return 'unknown';
  }
  return min === max ? String(min) : `${min}-${max}`;
}

function noticeSortValue(venue: WebVenue): number {
  if (!venue.hasNotice) {
    return 0;
  }
  if (venue.noticeOpenEnded) {
    return 1_000_000;
  }
  return venue.noticeMax ?? venue.noticeMin ?? 0;
}

function normalizeCity(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

function normalizeText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('de-DE').replace(/\s+/g, ' ').trim();
}

function haversineDistanceKm(
  left: { lat: number; lon: number },
  right: { lat: number; lon: number },
): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const deltaLat = radians(right.lat - left.lat);
  const deltaLon = radians(right.lon - left.lon);
  const leftLat = radians(left.lat);
  const rightLat = radians(right.lat);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(leftLat) * Math.cos(rightLat) * Math.sin(deltaLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(a));
}

function nullableNumber(value: string | undefined): number | null {
  if (!value || value.trim() === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberOrZero(value: string | undefined): number {
  return nullableNumber(value) ?? 0;
}

function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

async function main(): Promise<void> {
  const [sourcePath = DEFAULT_SOURCE, outputPath = DEFAULT_OUTPUT, city = DEFAULT_CITY] = process.argv.slice(2);
  const rawCsv = await readFile(sourcePath, 'utf8');
  const dataset = buildWebDataset(rawCsv, city, sourcePath);

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');

  console.log(`Web data: ${outputPath}`);
  console.log(`City: ${dataset.city}`);
  console.log(`Candidate profiles: ${dataset.summary.candidateProfiles}`);
  console.log(`Observed profiles after public filters: ${dataset.summary.observedVenues}`);
  console.log(`Excluded outside target area: ${dataset.summary.excludedOutsideArea}`);
  console.log(`Excluded clearly non-gastro: ${dataset.summary.excludedClearlyNonGastro}`);
  console.log(`Notices found: ${dataset.summary.noticesFound}`);
  console.log(`Uncertain/failed: ${dataset.summary.uncertain + dataset.summary.failed}`);
}

if (process.argv[1]?.endsWith('exportWebData.ts') || process.argv[1]?.endsWith('exportWebData.js')) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
