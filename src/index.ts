#!/usr/bin/env node

import { access, copyFile, rm } from 'node:fs/promises';
import { parseCliArgs } from './cli.js';
import { loadConfigs } from './config.js';
import { mergeCsvFiles, writePositiveCsvFile } from './csvSort.js';
import { resetBatchVenueCache, runScraper } from './mapsScraper.js';
import { loadVenuesFromFile, seedScraperState } from './placesInput.js';
import { formatRunSummary, writeRunSummary } from './summary.js';
import type { Venue } from './types.js';

async function main(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2));
  const configPath = cli.configPath;
  await ensureConfigExists(configPath);

  let importedVenues: Venue[] | undefined;
  if (cli.placesFile) {
    importedVenues = await loadVenuesFromFile(cli.placesFile);
    if (importedVenues.length === 0) {
      throw new Error(`No usable venues found in ${cli.placesFile}.`);
    }

    const requestedDepth = cli.overrides.depth;
    if (requestedDepth !== undefined) {
      importedVenues = importedVenues.slice(0, requestedDepth);
    }

    cli.overrides.searchTerm = 'places';
    cli.overrides.searchTerms = undefined;
    cli.overrides.depth = importedVenues.length;
    if (cli.overrides.navigationTimeoutMs === undefined) {
      cli.overrides.navigationTimeoutMs = 60_000;
    }
  }

  if (cli.fullGastroScan && cli.overrides.navigationTimeoutMs === undefined) {
    cli.overrides.navigationTimeoutMs = 60_000;
  }

  const configs = await loadConfigs(configPath, cli.overrides);
  const cities = [...new Set(configs.map((config) => config.city))];
  if (cli.fullGastroScan && cities.length !== 1) {
    throw new Error('--full-gastro-scan currently supports exactly one city per invocation.');
  }
  if (importedVenues && configs.length !== 1) {
    throw new Error('--places-file requires exactly one city/config per invocation.');
  }

  resetBatchVenueCache();

  const failures: Array<{ searchTerm: string; message: string }> = [];
  const candidateOutputPaths = new Set<string>();

  for (const config of configs) {
    if (importedVenues) {
      const freshRefresh = await seedScraperState(config, importedVenues);
      if (freshRefresh) {
        await rm(config.outputCsvPath, { force: true });
        await rm(config.outputCsvPath.replace(/\.csv$/i, '-positive.csv'), { force: true });
        console.log('Previous imported run was complete; starting a fresh notice refresh.');
      }
      console.log(`Checking ${importedVenues.length} imported Google Maps venues.`);
    } else {
      console.log(
        `Scraping ${config.depth} "${config.searchTerm}" venues in ${config.city}, ${config.country}.`,
      );
    }
    console.log(`Output: ${config.outputCsvPath}`);
    console.log(`State: ${config.statePath}`);

    try {
      const summary = await runScraper(config);
      await writeRunSummary(summary);
      console.log(formatRunSummary(summary));
      candidateOutputPaths.add(config.outputCsvPath);

      if (importedVenues) {
        const positivePath = config.outputCsvPath.replace(/\.csv$/i, '-positive.csv');
        const positiveVenues = await writePositiveCsvFile(config.outputCsvPath, positivePath);
        console.log(`Removal-notice CSV: ${positivePath}`);
        console.log(`Venues with notices: ${positiveVenues}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ searchTerm: config.searchTerm, message });
      console.error(`Scan failed for "${config.searchTerm}": ${message}`);
      console.error('Continuing with the remaining search terms.');

      if (await fileExists(config.outputCsvPath)) {
        candidateOutputPaths.add(config.outputCsvPath);
      }
    }
  }

  const configuredMergePath = configs.find((config) => config.mergeCsvPath)?.mergeCsvPath;
  const mergeCsvPath =
    configuredMergePath ??
    (cli.fullGastroScan && cities[0]
      ? `output/deleted-reviews-${slugify(cities[0])}-gastro-all.csv`
      : undefined);

  if (mergeCsvPath) {
    const inputPaths = (
      await Promise.all(
        [...candidateOutputPaths].map(async (path) => ((await fileExists(path)) ? path : null)),
      )
    ).filter((path): path is string => path !== null && path !== mergeCsvPath);

    if (inputPaths.length > 0) {
      const uniqueVenues = await mergeCsvFiles(mergeCsvPath, inputPaths);
      console.log(`Merged CSV: ${mergeCsvPath}`);
      console.log(`Unique venues: ${uniqueVenues}`);

      if (cli.fullGastroScan) {
        const positivePath = mergeCsvPath.replace(/\.csv$/i, '-positive.csv');
        const positiveVenues = await writePositiveCsvFile(mergeCsvPath, positivePath);
        console.log(`Removal-notice CSV: ${positivePath}`);
        console.log(`Venues with notices: ${positiveVenues}`);
      }
    } else {
      console.warn('No CSV outputs were available to merge.');
    }
  }

  if (failures.length > 0) {
    console.warn(`Completed with ${failures.length} failed search term(s):`);
    for (const failure of failures) {
      console.warn(`- ${failure.searchTerm}: ${failure.message}`);
    }
    process.exitCode = 1;
  }

  console.log('Done.');
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
      throw new Error(
        'Created config.json from config.example.json. Review it, then run the command again.',
      );
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
