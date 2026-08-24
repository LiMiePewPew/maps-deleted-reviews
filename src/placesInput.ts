import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import {
  createInitialState,
  loadOrCreateState,
  saveState,
  upsertDiscoveredVenue,
} from './state.js';
import type { ScraperConfig, Venue } from './types.js';
import { venueIdentityKey } from './venueIdentity.js';

export async function loadVenuesFromFile(path: string): Promise<Venue[]> {
  const raw = await readFile(path, 'utf8');
  return parsePlacesText(raw, extname(path).toLowerCase());
}

export async function seedScraperState(config: ScraperConfig, venues: Venue[]): Promise<void> {
  const runKey = [config.city, config.country, config.searchTerm]
    .map((part) => part.trim().toLowerCase())
    .join('::');
  let state = await loadOrCreateState(config.statePath, runKey);
  for (const venue of venues) upsertDiscoveredVenue(state, venue);

  const completed = new Set(state.completedUrls);
  const fullyCompleted = venues.length > 0 && venues.every((venue) => completed.has(venue.url));
  if (fullyCompleted) {
    state = createInitialState(runKey);
    for (const venue of venues) upsertDiscoveredVenue(state, venue);
  }

  await saveState(config.statePath, state);
}

export function parsePlacesText(raw: string, extension = '.csv'): Venue[] {
  const venues = extension === '.json' || extension === '.jsonl'
    ? parseJsonVenues(raw)
    : parseCsvVenues(raw);

  const unique = new Map<string, Venue>();
  for (const venue of venues) {
    if (!venue.name || !venue.url) continue;
    unique.set(venueIdentityKey(venue), venue);
  }
  return [...unique.values()];
}

function parseJsonVenues(raw: string): Venue[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  let values: unknown[];
  if (trimmed.startsWith('[')) {
    values = JSON.parse(trimmed) as unknown[];
  } else {
    values = trimmed.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  }

  return values.map(toVenue).filter((venue): venue is Venue => venue !== null);
}

function parseCsvVenues(raw: string): Venue[] {
  const records = parseCsvRecords(raw);
  if (records.length < 2) return [];
  const headers = records[0].map((value) => value.trim().toLowerCase());
  const index = (names: string[]) => names.map((name) => headers.indexOf(name)).find((i) => i >= 0) ?? -1;
  const nameIndex = index(['title', 'name']);
  const urlIndex = index(['link', 'url']);
  const addressIndex = index(['address']);
  if (nameIndex < 0 || urlIndex < 0) {
    throw new Error('Places CSV must contain title/name and link/url columns.');
  }

  return records.slice(1).map((record) => {
    const name = record[nameIndex]?.trim() ?? '';
    const url = record[urlIndex]?.trim() ?? '';
    if (!name || !url) return null;
    const address = addressIndex >= 0 ? record[addressIndex]?.trim() : undefined;
    return { name, url, address: address || undefined } satisfies Venue;
  }).filter((venue): venue is Venue => venue !== null);
}

function toVenue(value: unknown): Venue | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const name = String(row.title ?? row.name ?? '').trim();
  const url = String(row.link ?? row.url ?? '').trim();
  const address = String(row.address ?? '').trim();
  return name && url ? { name, url, address: address || undefined } : null;
}

function parseCsvRecords(raw: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    const next = raw[i + 1];
    if (char === '"' && quoted && next === '"') {
      field += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      record.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      record.push(field);
      field = '';
      if (record.some((cell) => cell.length > 0)) records.push(record);
      record = [];
    } else {
      field += char;
    }
  }

  record.push(field);
  if (record.some((cell) => cell.length > 0)) records.push(record);
  return records;
}
