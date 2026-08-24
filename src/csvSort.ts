#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ScrapedVenue } from './types.js';
import { venueIdentityKey } from './venueIdentity.js';

export function sortScrapedRows(rows: ScrapedVenue[]): ScrapedVenue[] {
  return [...rows].sort((left, right) =>
    compareNullableNumbersDesc(left.percentageDeleted, right.percentageDeleted) ||
    left.name.localeCompare(right.name, 'de', { sensitivity: 'base' }) ||
    compareNullableNumbersDesc(left.deletedReviewsMax, right.deletedReviewsMax),
  );
}

export async function sortCsvFile(path: string): Promise<void> {
  const raw = await readFile(path, 'utf8');
  const sorted = sortCsvText(raw);
  await writeFile(path, sorted, 'utf8');
}

export async function mergeCsvFiles(outputPath: string, inputPaths: string[]): Promise<number> {
  const merged = await mergeCsvTexts(
    await Promise.all(inputPaths.map((path) => readFile(path, 'utf8'))),
  );
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, merged, 'utf8');
  return countCsvRows(merged);
}

export async function writePositiveCsvFile(sourcePath: string, outputPath: string): Promise<number> {
  const raw = await readFile(sourcePath, 'utf8');
  const [headerLine, ...rowLines] = raw.trim().split('\n');
  if (!headerLine) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, '', 'utf8');
    return 0;
  }

  const headers = parseCsvLine(headerLine);
  const deletedMaxIndex = headers.indexOf('deleted_reviews_max');
  const noticeIndex = headers.indexOf('review_notice');
  const positiveRows = rowLines.filter(Boolean).filter((line) => {
    const cells = parseCsvLine(line);
    const deletedMax = parseNullableNumber(cells[deletedMaxIndex]) ?? 0;
    const notice = noticeIndex >= 0 ? (cells[noticeIndex] ?? '').trim() : '';
    return deletedMax > 0 || notice.length > 0;
  });

  const positiveCsv = sortCsvText(`${[headerLine, ...positiveRows].join('\n')}\n`);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, positiveCsv, 'utf8');
  return positiveRows.length;
}

export async function mergeCsvTexts(rawFiles: string[]): Promise<string> {
  let headerLine = '';
  const rowsByVenue = new Map<string, { line: string; cells: string[]; headers: string[] }>();

  for (const raw of rawFiles) {
    const [currentHeaderLine, ...rowLines] = raw.trim().split('\n');
    if (!currentHeaderLine) {
      continue;
    }

    headerLine ||= currentHeaderLine;
    const headers = parseCsvLine(currentHeaderLine);
    for (const rowLine of rowLines.filter(Boolean)) {
      const cells = parseCsvLine(rowLine);
      const key = csvVenueIdentity(headers, cells);
      if (!key) {
        continue;
      }

      const existing = rowsByVenue.get(key);
      if (!existing || shouldPreferCsvRow(existing.headers, existing.cells, headers, cells)) {
        rowsByVenue.set(key, { line: rowLine, cells, headers });
      }
    }
  }

  return headerLine ? `${[headerLine, ...[...rowsByVenue.values()].map((row) => row.line)].join('\n')}\n` : '';
}

export function sortCsvText(raw: string): string {
  const [headerLine, ...rowLines] = raw.trim().split('\n');
  if (!headerLine) {
    return raw;
  }

  const headers = parseCsvLine(headerLine);
  const rows = rowLines.filter(Boolean).map((line) => ({
    line,
    cells: parseCsvLine(line),
  }));

  const indexOf = (header: string): number => headers.indexOf(header);
  const percentageIndex = indexOf('percentage_deleted');
  const nameIndex = indexOf('name');
  const deletedMaxIndex = indexOf('deleted_reviews_max');

  rows.sort((left, right) =>
    compareNullableNumbersDesc(
      parseNullableNumber(left.cells[percentageIndex]),
      parseNullableNumber(right.cells[percentageIndex]),
    ) ||
    (left.cells[nameIndex] ?? '').localeCompare(right.cells[nameIndex] ?? '', 'de', {
      sensitivity: 'base',
    }) ||
    compareNullableNumbersDesc(
      parseNullableNumber(left.cells[deletedMaxIndex]),
      parseNullableNumber(right.cells[deletedMaxIndex]),
    ),
  );

  return `${[headerLine, ...rows.map((row) => row.line)].join('\n')}\n`;
}

function csvVenueIdentity(headers: string[], cells: string[]): string {
  const cell = (header: string): string => {
    const index = headers.indexOf(header);
    return index >= 0 ? (cells[index] ?? '') : '';
  };

  const name = cell('name').trim();
  if (!name) {
    return '';
  }

  return venueIdentityKey({
    name,
    url: cell('url').trim(),
    address: cell('address').trim() || undefined,
  });
}

function shouldPreferCsvRow(
  existingHeaders: string[],
  existingCells: string[],
  candidateHeaders: string[],
  candidateCells: string[],
): boolean {
  const existingStatus = getCell(existingHeaders, existingCells, 'status');
  const candidateStatus = getCell(candidateHeaders, candidateCells, 'status');
  const existingRank = statusRank(existingStatus);
  const candidateRank = statusRank(candidateStatus);
  if (candidateRank !== existingRank) {
    return candidateRank > existingRank;
  }

  const existingTime = Date.parse(getCell(existingHeaders, existingCells, 'scraped_at'));
  const candidateTime = Date.parse(getCell(candidateHeaders, candidateCells, 'scraped_at'));
  if (Number.isFinite(existingTime) && Number.isFinite(candidateTime) && candidateTime !== existingTime) {
    return candidateTime > existingTime;
  }

  return false;
}

function getCell(headers: string[], cells: string[], header: string): string {
  const index = headers.indexOf(header);
  return index >= 0 ? (cells[index] ?? '') : '';
}

function statusRank(status: string): number {
  if (status === 'ok') {
    return 3;
  }
  if (status === 'partial') {
    return 2;
  }
  if (status === 'failed') {
    return 1;
  }
  return 0;
}

function countCsvRows(raw: string): number {
  if (!raw.trim()) {
    return 0;
  }
  return Math.max(0, raw.trim().split('\n').length - 1);
}

function compareNullableNumbersDesc(left: number | null, right: number | null): number {
  if (left === null && right === null) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }

  return right - left;
}

function parseNullableNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}

if (process.argv[1]?.endsWith('csvSort.ts') || process.argv[1]?.endsWith('csvSort.js')) {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.error('Usage: npm run sort-csv -- <file.csv> [more-files.csv]');
    process.exitCode = 1;
  } else {
    for (const path of paths) {
      await sortCsvFile(path);
      console.log(`Sorted ${path}`);
    }
  }
}
