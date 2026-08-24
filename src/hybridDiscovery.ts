import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export interface GosomPlace {
  name: string;
  url: string;
  address?: string;
  category?: string;
  placeId?: string;
  dataId?: string;
  cid?: string;
  reviewCount?: number;
  reviewRating?: number;
  latitude?: number;
  longitude?: number;
}

export interface GosomDiscoveryOptions {
  city: string;
  country: string;
  terms: readonly string[];
  workDir: string;
  concurrency?: number;
  depth?: number;
  image?: string;
}

export interface GosomDiscoveryResult {
  places: GosomPlace[];
  rawCsvPath: string;
  queriesPath: string;
  normalizedJsonPath: string;
}

export async function runGosomDiscovery(
  options: GosomDiscoveryOptions,
): Promise<GosomDiscoveryResult> {
  const workDir = resolve(options.workDir);
  const queriesPath = resolve(workDir, 'queries.txt');
  const rawCsvPath = resolve(workDir, 'gosom-discovery.csv');
  const normalizedJsonPath = resolve(workDir, 'venues.json');
  await mkdir(workDir, { recursive: true });

  const queries = options.terms
    .map((term) => `${term.trim()} ${options.city.trim()} ${options.country.trim()}`)
    .filter(Boolean);
  await writeFile(queriesPath, `${queries.join('\n')}\n`, 'utf8');

  await runGosomDocker({
    queriesPath,
    rawCsvPath,
    concurrency: options.concurrency ?? 4,
    depth: options.depth ?? 10,
    image: options.image ?? process.env.GOSOM_IMAGE ?? 'gosom/google-maps-scraper',
  });

  const places = dedupeGosomPlaces(parseGosomCsv(await readFile(rawCsvPath, 'utf8')));
  await writeFile(normalizedJsonPath, `${JSON.stringify(places, null, 2)}\n`, 'utf8');

  return { places, rawCsvPath, queriesPath, normalizedJsonPath };
}

export function parseGosomCsv(raw: string): GosomPlace[] {
  const rows = parseCsv(raw);
  const header = rows.shift()?.map((cell) => cell.trim()) ?? [];
  if (header.length === 0) {
    return [];
  }

  const indexOf = (name: string): number => header.indexOf(name);
  const value = (row: string[], name: string): string => {
    const index = indexOf(name);
    return index >= 0 ? (row[index] ?? '').trim() : '';
  };

  return rows
    .map((row): GosomPlace | null => {
      const name = value(row, 'title');
      const placeId = value(row, 'place_id') || undefined;
      const directLink = value(row, 'link');
      const url = directLink || buildPlaceIdUrl(placeId, name);
      if (!name || !url) {
        return null;
      }

      return {
        name,
        url,
        address: value(row, 'address') || undefined,
        category: value(row, 'category') || undefined,
        placeId,
        dataId: value(row, 'data_id') || undefined,
        cid: value(row, 'cid') || undefined,
        reviewCount: parseOptionalNumber(value(row, 'review_count')),
        reviewRating: parseOptionalNumber(value(row, 'review_rating')),
        latitude: parseOptionalNumber(value(row, 'latitude')),
        longitude: parseOptionalNumber(value(row, 'longitude')),
      };
    })
    .filter((place): place is GosomPlace => place !== null);
}

export function dedupeGosomPlaces(places: GosomPlace[]): GosomPlace[] {
  const byIdentity = new Map<string, GosomPlace>();

  for (const place of places) {
    const key = gosomIdentityKey(place);
    const existing = byIdentity.get(key);
    if (!existing || completenessScore(place) > completenessScore(existing)) {
      byIdentity.set(key, place);
    }
  }

  return [...byIdentity.values()];
}

export function gosomIdentityKey(place: GosomPlace): string {
  if (place.placeId) {
    return `place:${place.placeId}`;
  }
  if (place.dataId) {
    return `data:${place.dataId}`;
  }
  if (place.cid) {
    return `cid:${place.cid}`;
  }

  const url = normalizeMapsUrl(place.url);
  if (url) {
    return `url:${url}`;
  }

  return `name:${normalizeText(place.name)}|address:${normalizeText(place.address ?? '')}`;
}

function runGosomDocker({
  queriesPath,
  rawCsvPath,
  concurrency,
  depth,
  image,
}: {
  queriesPath: string;
  rawCsvPath: string;
  concurrency: number;
  depth: number;
  image: string;
}): Promise<void> {
  const outputDir = dirname(rawCsvPath);
  const outputName = rawCsvPath.slice(outputDir.length + 1);
  const args = [
    'run',
    '--rm',
    '-v',
    `${queriesPath}:/queries.txt:ro`,
    '-v',
    `${outputDir}:/out`,
    image,
    '-input',
    '/queries.txt',
    '-results',
    `/out/${outputName}`,
    '-depth',
    String(depth),
    '-c',
    String(concurrency),
    '-pages-per-browser',
    '2',
    '-browser-pool-size',
    '2',
    '-lang',
    'de',
    '-exit-on-inactivity',
    '3m',
  ];

  return new Promise((resolvePromise, reject) => {
    console.log(`Starting gosom discovery with concurrency ${concurrency} and depth ${depth}.`);
    const child = spawn('docker', args, { stdio: 'inherit' });

    child.once('error', (error) => {
      const hint = (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? ' Docker was not found. Install/start Docker Desktop and retry.'
        : '';
      reject(new Error(`Could not start gosom discovery: ${error.message}.${hint}`));
    });

    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(
        new Error(
          `gosom discovery exited with ${signal ? `signal ${signal}` : `code ${String(code)}`}.`,
        ),
      );
    });
  });
}

function parseCsv(raw: string): string[][] {
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
      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }
      row = [];
      cell = '';
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

  return rows;
}

function buildPlaceIdUrl(placeId: string | undefined, name: string): string {
  if (!placeId) {
    return '';
  }
  const params = new URLSearchParams({
    api: '1',
    query: name || 'Google Maps place',
    query_place_id: placeId,
  });
  return `https://www.google.com/maps/search/?${params.toString()}`;
}

function normalizeMapsUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl, 'https://www.google.com');
    return decodeURIComponent(url.pathname)
      .replace(/\/+$/, '')
      .replace(/\/+/g, '/')
      .normalize('NFKC')
      .toLowerCase();
  } catch {
    return null;
  }
}

function normalizeText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function parseOptionalNumber(value: string): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function completenessScore(place: GosomPlace): number {
  return [
    place.address,
    place.category,
    place.placeId,
    place.dataId,
    place.cid,
    place.reviewCount,
    place.reviewRating,
    place.latitude,
    place.longitude,
  ].filter((value) => value !== undefined && value !== '').length;
}
