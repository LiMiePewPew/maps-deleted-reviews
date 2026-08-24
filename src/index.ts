#!/usr/bin/env node

import { access, copyFile } from 'node:fs/promises';
import { browserDisplayName, installBrowserBackend } from './browserRuntime.js';
import { parseCliArgs } from './cli.js';
import { loadConfigs } from './config.js';
import { mergeCsvFiles, writePositiveCsvFile } from './csvSort.js';
import { resetBatchVenueCache, runScraper } from './mapsScraper.js';
import { formatRunSummary, writeRunSummary } from './summary.js';
import type { ScraperConfig } from './types.js';

const BETWEEN_BATCH_RUNS_DELAY_MS = 500;
const BROWSER_RECOVERY_DELAY_MS = 1_500;

async function main(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2));
  const configPath = cli.configPath;
  await ensureConfigExists(configPath);

  await installBrowserBackend(cli.browser);
  console.log(`Browser: ${browserDisplayName(cli.browser)}`);

  if (cli.fullGastroScan && cli.overrides.navigationTimeoutMs === undefined) {
    cli.overrides.navigationTimeoutMs = 60_000;
  }

  const configs = await loadConfigs(configPath, cli.overrides);
  const cities = [...new Set(configs.map((config) => config.city))];
  if (cli.fullGastroScan && cities.length !== 1) {
    throw new Error('--full-gastro-scan currently supports exactly one city per invocation.');
  }

  resetBatchVenueCache();

  const failures: Array<{ searchTerm: string; message: string }> = [];
  const candidateOutputPaths = new Set<string>();

  for (const config of configs) {
    console.log(
      `Scraping ${config.depth} "${config.searchTerm}" venues in ${config.city}, ${config.country}.`,
    );
    console.log(`Output: ${config.outputCsvPath}`);
    console.log(`State: ${config.statePath}`);

    try {
      const summary = await runScraperWithBrowserRecovery(config, cli.fullGastroScan);
      await writeRunSummary(summary);
      console.log(formatRunSummary(summary));
      candidateOutputPaths.add(config.outputCsvPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ searchTerm: config.searchTerm, message });
      console.error(`Scan failed for "${config.searchTerm}": ${message}`);
      console.error('Continuing with the remaining search terms.');

      if (await fileExists(config.outputCsvPath)) {
        candidateOutputPaths.add(config.outputCsvPath);
      }
    }

    if (cli.fullGastroScan) {
      await sleep(BETWEEN_BATCH_RUNS_DELAY_MS);
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

async function runScraperWithBrowserRecovery(
  config: ScraperConfig,
  enableRecovery: boolean,
): ReturnType<typeof runScraper> {
  try {
    return await runScraper(config);
  } catch (error) {
    if (!enableRecovery || !isBrowserClosedError(error)) {
      throw error;
    }

    console.warn(
      `Browser closed unexpectedly during "${config.searchTerm}"; waiting ${BROWSER_RECOVERY_DELAY_MS}ms and retrying this search term once.`,
    );
    await sleep(BROWSER_RECOVERY_DELAY_MS);
    return runScraper(config);
  }
}

function isBrowserClosedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Target page, context or browser has been closed|Browser page closed/i.test(message);
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
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
