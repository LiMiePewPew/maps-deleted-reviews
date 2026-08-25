#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

interface WebVenue {
  venueType: string;
  name: string;
  totalReviews: number | null;
  deletedReviewsMin: number;
  deletedReviewsMax: number;
  percentageDeleted: number | null;
  reviewNotice: string | null;
  url: string;
  address: string;
  status: string;
  error: string | null;
  scrapedAt: string | null;
  hasNotice: boolean;
}

interface WebDataset {
  schemaVersion: 1;
  city: string;
  generatedAt: string;
  source: string;
  sourceCsv: string;
  summary: {
    observedVenues: number;
    noticesFound: number;
    noNoticeObserved: number;
    uncertain: number;
    failed: number;
    visibleReviews: number;
    largestNoticeMax: number;
    lastScrapedAt: string | null;
  };
  venues: WebVenue[];
}

const DEFAULT_SOURCE = 'output/deleted-reviews-osnabruck-gastro-all.csv';
const DEFAULT_OUTPUT = 'docs/data/osnabruck.json';
const DEFAULT_CITY = 'Osnabrück';

export function buildWebDataset(rawCsv: string, city = DEFAULT_CITY, sourceCsv = DEFAULT_SOURCE): WebDataset {
  const records = parseCsv(rawCsv);
  const venues = records.map(toWebVenue).filter((venue) => venue.name.length > 0);
  const notices = venues.filter((venue) => venue.hasNotice);
  const timestamps = venues
    .map((venue) => Date.parse(venue.scrapedAt ?? ''))
    .filter((value) => Number.isFinite(value));

  return {
    schemaVersion: 1,
    city,
    generatedAt: new Date().toISOString(),
    source: 'Google Maps public review-deletion notices',
    sourceCsv,
    summary: {
      observedVenues: venues.length,
      noticesFound: notices.length,
      noNoticeObserved: venues.filter((venue) => venue.status === 'ok' && !venue.hasNotice).length,
      uncertain: venues.filter((venue) => venue.status === 'partial').length,
      failed: venues.filter((venue) => venue.status === 'failed').length,
      visibleReviews: venues.reduce((sum, venue) => sum + (venue.totalReviews ?? 0), 0),
      largestNoticeMax: Math.max(0, ...notices.map((venue) => venue.deletedReviewsMax)),
      lastScrapedAt: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null,
    },
    venues: [...venues].sort(
      (left, right) =>
        Number(right.hasNotice) - Number(left.hasNotice) ||
        right.deletedReviewsMax - left.deletedReviewsMax ||
        left.name.localeCompare(right.name, 'de', { sensitivity: 'base' }),
    ),
  };
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
  const deletedReviewsMin = numberOrZero(record.deleted_reviews_min);
  const deletedReviewsMax = numberOrZero(record.deleted_reviews_max);
  const reviewNotice = emptyToNull(record.review_notice);

  return {
    venueType: record.venue_type?.trim() ?? '',
    name: record.name?.trim() ?? '',
    totalReviews: nullableNumber(record.total_reviews),
    deletedReviewsMin,
    deletedReviewsMax,
    percentageDeleted: nullableNumber(record.percentage_deleted),
    reviewNotice,
    url: record.url?.trim() ?? '',
    address: record.address?.trim() ?? '',
    status: record.status?.trim() || 'partial',
    error: emptyToNull(record.error),
    scrapedAt: emptyToNull(record.scraped_at),
    hasNotice: deletedReviewsMax > 0 || Boolean(reviewNotice),
  };
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
  console.log(`Observed venues: ${dataset.summary.observedVenues}`);
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
