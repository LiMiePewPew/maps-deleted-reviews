import type { RawScraperConfig } from './types.js';

export const FULL_GASTRO_SEARCH_TERMS = [
  'restaurant',
  'Cafe',
  'bar',
  'Hotel',
  'Imbiss',
  'Pizza',
  'Döner',
  'Sushi',
  'Burger',
  'Frühstück',
  'Bäckerei',
  'Eiscafe',
  'italienisch',
  'griechisch',
  'indisch',
  'asiatisch',
  'vegan',
  'Steakhouse',
  'Pub',
  'Cocktailbar',
] as const;

export interface CliArgs {
  configPath: string;
  overrides: RawScraperConfig;
  fullGastroScan: boolean;
  workers: number;
  discoveryWorkers: number;
  turbo: boolean;
}

export function parseCliArgs(args: string[]): CliArgs {
  const overrides: RawScraperConfig = {};
  let configPath = 'config.json';
  let fullGastroScan = false;
  let workers = 1;
  let discoveryWorkers = 1;
  let workersExplicit = false;
  let discoveryWorkersExplicit = false;
  let turbo = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === '--config' || arg === '-c') {
      configPath = requireValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === '--city') {
      overrides.city = requireValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === '--cities') {
      overrides.cities = parseCommaSeparated(requireValue(arg, next));
      index += 1;
      continue;
    }
    if (arg === '--country') {
      overrides.country = requireValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === '--searchTerm' || arg === '--search-term') {
      overrides.searchTerm = requireValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === '--searchTerms' || arg === '--search-terms') {
      overrides.searchTerms = parseCommaSeparated(requireValue(arg, next));
      index += 1;
      continue;
    }
    if (arg === '--full-gastro-scan' || arg === '--large-list') {
      fullGastroScan = true;
      overrides.searchTerms = [...FULL_GASTRO_SEARCH_TERMS];
      continue;
    }
    if (arg === '--turbo') {
      turbo = true;
      continue;
    }
    if (arg === '--workers') {
      workers = parseWorkerCount(arg, requireValue(arg, next));
      workersExplicit = true;
      index += 1;
      continue;
    }
    if (arg === '--discovery-workers') {
      discoveryWorkers = parseWorkerCount(arg, requireValue(arg, next));
      discoveryWorkersExplicit = true;
      index += 1;
      continue;
    }
    if (arg === '--depth') {
      overrides.depth = Number(requireValue(arg, next));
      index += 1;
      continue;
    }
    if (arg === '--navigation-timeout-ms') {
      overrides.navigationTimeoutMs = Number(requireValue(arg, next));
      index += 1;
      continue;
    }
    if (arg === '--max-result-scrolls') {
      overrides.maxResultScrolls = Number(requireValue(arg, next));
      index += 1;
      continue;
    }
    if (arg === '--resumeMode' || arg === '--resume-mode') {
      overrides.resumeMode = requireValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === '--outputCsvPath' || arg === '--output-csv-path') {
      overrides.outputCsvPath = requireValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === '--statePath' || arg === '--state-path') {
      overrides.statePath = requireValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === '--summaryPath' || arg === '--summary-path') {
      overrides.summaryPath = requireValue(arg, next);
      index += 1;
      continue;
    }
    if (
      arg === '--mergeCsvPath' ||
      arg === '--merge-csv-path' ||
      arg === '--merged-output-csv'
    ) {
      overrides.mergeCsvPath = requireValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === '--sortCsv' || arg === '--sort-csv') {
      overrides.sortCsv = true;
      continue;
    }
    if (arg === '--no-sortCsv' || arg === '--no-sort-csv') {
      overrides.sortCsv = false;
      continue;
    }
    if (arg === '--headed') {
      overrides.headed = true;
      continue;
    }
    if (arg === '--headless') {
      overrides.headed = false;
      continue;
    }
    if (!arg.startsWith('-') && configPath === 'config.json') {
      configPath = arg;
    }
  }

  if (turbo) {
    if (!workersExplicit) {
      workers = 3;
    }
    if (!discoveryWorkersExplicit) {
      discoveryWorkers = 4;
    }
  }

  return { configPath, overrides, fullGastroScan, workers, discoveryWorkers, turbo };
}

function parseCommaSeparated(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseWorkerCount(flag: string, value: string): number {
  const workers = Number(value);
  if (!Number.isInteger(workers) || workers < 1 || workers > 8) {
    throw new Error(`${flag} must be an integer between 1 and 8`);
  }
  return workers;
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}
