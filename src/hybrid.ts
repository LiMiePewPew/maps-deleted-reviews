#!/usr/bin/env node

import { access, copyFile, rm } from 'node:fs/promises';
import { FULL_GASTRO_SEARCH_TERMS } from './cli.js';
import { loadConfigs } from './config.js';
import { writePositiveCsvFile } from './csvSort.js';
import { runGosomDiscovery } from './hybridDiscovery.js';
import { resetBatchVenueCache, runScraper } from './mapsScraper.js';
import {
  createInitialState,
  loadOrCreateState,
  saveState,
  upsertDiscoveredVenue,
} from './state.js';
import { formatRunSummary, writeRunSummary } from './summary.js';
import type { ScraperConfig, ScraperState, Venue } from './types.js';

interface HybridArgs {
  configPath: string;
  city?: string;
  country?: string;
  terms: string[];
  gosomConcurrency: number;
  gosomDepth: number;
  headed: boolean;
  refreshNotices: boolean;
}

async function main(): Promise<void> {
  const args = parseHybridArgs(process.argv.slice(2));
  await ensureConfigExists(args.configPath);

  const configs = await loadConfigs(args.configPath, {
    city: args.city,
    country: args.country,
    searchTerm: 'hybrid',
    depth: 1,
    headed: args.headed,
  });
  if (configs.length !== 1) {
    throw new Error('Hybrid scan requires exactly one city. Pass --city explicitly.');
  }

  const baseConfig = configs[0];
  if (!baseConfig) {
    throw new Error('Could not resolve hybrid scraper configuration.');
  }

  const citySlug = slugify(baseConfig.city);
  const workDir = `output/hybrid-${citySlug}`;
  console.log(`Hybrid scan for ${baseConfig.city}, ${baseConfig.country}`);
  console.log(`Discovery terms: ${args.terms.length}`);

  const discovery = await runGosomDiscovery({
    city: baseConfig.city,
    country: baseConfig.country,
    terms: args.terms,
    workDir,
    concurrency: args.gosomConcurrency,
    depth: args.gosomDepth,
  });

  if (discovery.places.length === 0) {
    throw new Error('gosom discovery returned zero usable Google Maps places.');
  }

  console.log(`Raw discovery: ${discovery.rawCsvPath}`);
  console.log(`Normalized discovery: ${discovery.normalizedJsonPath}`);
  console.log(`Unique discovered places: ${discovery.places.length}`);

  const venues: Venue[] = discovery.places.map((place) => ({
    name: place.name,
    url: place.url,
    address: place.address,
  }));

  const outputCsvPath = `output/deleted-reviews-${citySlug}-hybrid.csv`;
  const positiveCsvPath = `output/deleted-reviews-${citySlug}-hybrid-positive.csv`;
  const statePath = `output/state-${citySlug}-hybrid.json`;
  const summaryPath = `output/summary-${citySlug}-hybrid.json`;

  if (args.refreshNotices) {
    await Promise.all([
      rm(outputCsvPath, { force: true }),
      rm(positiveCsvPath, { force: true }),
      rm(statePath, { force: true }),
      rm(summaryPath, { force: true }),
    ]);
  }

  const config: ScraperConfig = {
    ...baseConfig,
    searchTerm: 'hybrid',
    depth: venues.length,
    headed: args.headed,
    navigationTimeoutMs: Math.max(baseConfig.navigationTimeoutMs, 60_000),
    outputCsvPath,
    statePath,
    summaryPath,
    mergeCsvPath: undefined,
  };

  const state = await seedHybridState(config, venues, args.refreshNotices);
  const alreadyComplete =
    !args.refreshNotices &&
    (await fileExists(outputCsvPath)) &&
    state.discoveredVenues.length > 0 &&
    state.discoveredVenues.every((venue) => state.completedUrls.includes(venue.url));

  if (alreadyComplete) {
    console.log('Notice scan is already complete for the current discovered venue list.');
    console.log('Use --refresh-notices to force a new notice pass.');
  } else {
    resetBatchVenueCache();
    console.log(
      `Checking ${venues.length} unique places for Google removal notices (${args.headed ? 'headed' : 'headless'}).`,
    );
    const summary = await runScraper(config);
    await writeRunSummary(summary);
    console.log(formatRunSummary(summary));
  }

  if (await fileExists(outputCsvPath)) {
    const positives = await writePositiveCsvFile(outputCsvPath, positiveCsvPath);
    console.log(`Notice results: ${outputCsvPath}`);
    console.log(`Positive notices: ${positiveCsvPath}`);
    console.log(`Venues with notices: ${positives}`);
  }

  console.log('Hybrid scan done.');
}

async function seedHybridState(
  config: ScraperConfig,
  venues: Venue[],
  fresh: boolean,
): Promise<ScraperState> {
  const runKey = [config.city, config.country, config.searchTerm]
    .map((part) => part.trim().toLowerCase())
    .join('::');
  const state = fresh
    ? createInitialState(runKey)
    : await loadOrCreateState(config.statePath, runKey);

  const completedBefore = new Set(state.completedUrls);
  const failedBefore = new Set(state.failedUrls);
  state.discoveredVenues = [];
  for (const venue of venues) {
    upsertDiscoveredVenue(state, venue);
  }

  const currentUrls = new Set(state.discoveredVenues.map((venue) => venue.url));
  state.completedUrls = fresh
    ? []
    : [...completedBefore].filter((url) => currentUrls.has(url));
  state.failedUrls = fresh ? [] : [...failedBefore].filter((url) => currentUrls.has(url));
  state.cursor = 0;
  while (
    state.cursor < state.discoveredVenues.length &&
    state.completedUrls.includes(state.discoveredVenues[state.cursor]?.url ?? '')
  ) {
    state.cursor += 1;
  }

  await saveState(config.statePath, state);
  return state;
}

function parseHybridArgs(argv: string[]): HybridArgs {
  const args: HybridArgs = {
    configPath: 'config.json',
    terms: [...FULL_GASTRO_SEARCH_TERMS],
    gosomConcurrency: 4,
    gosomDepth: 10,
    headed: true,
    refreshNotices: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--config' || arg === '-c') {
      args.configPath = requireValue(arg, next);
      index += 1;
    } else if (arg === '--city') {
      args.city = requireValue(arg, next);
      index += 1;
    } else if (arg === '--country') {
      args.country = requireValue(arg, next);
      index += 1;
    } else if (arg === '--terms') {
      args.terms = requireValue(arg, next)
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      index += 1;
    } else if (arg === '--gosom-concurrency') {
      args.gosomConcurrency = positiveInteger(arg, requireValue(arg, next));
      index += 1;
    } else if (arg === '--gosom-depth') {
      args.gosomDepth = positiveInteger(arg, requireValue(arg, next));
      index += 1;
    } else if (arg === '--headless') {
      args.headed = false;
    } else if (arg === '--headed') {
      args.headed = true;
    } else if (arg === '--refresh-notices') {
      args.refreshNotices = true;
    }
  }

  if (args.terms.length === 0) {
    throw new Error('--terms must contain at least one search term.');
  }
  return args;
}

async function ensureConfigExists(configPath: string): Promise<void> {
  try {
    await access(configPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    if (configPath === 'config.json') {
      await copyFile('config.example.json', configPath);
      throw new Error('Created config.json from config.example.json. Review it, then rerun.');
    }
    throw error;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function positiveInteger(flag: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
