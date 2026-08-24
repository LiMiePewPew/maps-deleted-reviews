import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parsePlacesText, seedScraperState } from '../src/placesInput.js';
import { loadOrCreateState, markVenueCompleted, saveState } from '../src/state.js';
import type { ScraperConfig, Venue } from '../src/types.js';

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe('parsePlacesText', () => {
  it('parses gosom CSV output and deduplicates normalized Maps URLs', () => {
    const csv = [
      'input_id,link,title,category,address,review_count,review_rating',
      '1,"https://www.google.com/maps/place/Test/@1,2?entry=ttu",Test,Restaurant,"Main St, Osnabrück",100,4.5',
      '2,"https://www.google.com/maps/place/Test/@1,2?hl=de",Test,Restaurant,"Main St, Osnabrück",100,4.5',
      '3,https://www.google.com/maps/place/Other,Other,Cafe,Side St,20,4.2',
    ].join('\n');

    expect(parsePlacesText(csv, '.csv')).toEqual([
      {
        name: 'Test',
        url: 'https://www.google.com/maps/place/Test/@1,2?hl=de',
        address: 'Main St, Osnabrück',
      },
      {
        name: 'Other',
        url: 'https://www.google.com/maps/place/Other',
        address: 'Side St',
      },
    ]);
  });

  it('handles quoted commas and embedded newlines in CSV fields', () => {
    const csv = 'link,title,address,description\n"https://maps.google.com/maps/place/A","A, Bistro","Street 1, Osnabrück","line 1\nline 2"';
    expect(parsePlacesText(csv, '.csv')).toEqual([
      {
        name: 'A, Bistro',
        url: 'https://maps.google.com/maps/place/A',
        address: 'Street 1, Osnabrück',
      },
    ]);
  });

  it('parses gosom JSONL output', () => {
    const jsonl = [
      JSON.stringify({ title: 'Alpha', link: 'https://google.com/maps/place/Alpha', address: 'A 1' }),
      JSON.stringify({ title: 'Beta', link: 'https://google.com/maps/place/Beta', address: 'B 2' }),
    ].join('\n');

    expect(parsePlacesText(jsonl, '.jsonl')).toHaveLength(2);
  });

  it('rejects CSV without a Maps URL column', () => {
    expect(() => parsePlacesText('title,address\nA,B', '.csv')).toThrow(/link\/url/);
  });
});

describe('seedScraperState', () => {
  it('keeps incomplete imported runs resumable but resets fully completed imports', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'maps-places-input-'));
    const config = makeConfig(join(tempDir, 'state.json'));
    const venues: Venue[] = [
      { name: 'Alpha', url: 'https://google.com/maps/place/Alpha' },
      { name: 'Beta', url: 'https://google.com/maps/place/Beta' },
    ];

    expect(await seedScraperState(config, venues)).toBe(false);

    const partial = await loadOrCreateState(config.statePath, 'osnabrück::germany::places');
    markVenueCompleted(partial, venues[0].url);
    await saveState(config.statePath, partial);

    expect(await seedScraperState(config, venues)).toBe(false);
    const resumed = await loadOrCreateState(config.statePath, 'osnabrück::germany::places');
    expect(resumed.completedUrls).toEqual([venues[0].url]);

    markVenueCompleted(resumed, venues[1].url);
    await saveState(config.statePath, resumed);

    expect(await seedScraperState(config, venues)).toBe(true);
    const refreshed = await loadOrCreateState(config.statePath, 'osnabrück::germany::places');
    expect(refreshed.completedUrls).toEqual([]);
    expect(refreshed.discoveredVenues).toEqual(venues);
  });
});

function makeConfig(statePath: string): ScraperConfig {
  return {
    city: 'Osnabrück',
    country: 'Germany',
    searchTerm: 'places',
    depth: 2,
    locale: 'de-DE',
    googleMapsUrl: 'https://www.google.de/maps',
    headed: true,
    resumeMode: 'pause',
    outputCsvPath: 'output/test.csv',
    summaryPath: 'output/test-summary.json',
    statePath,
    browserProfileDir: '.playwright-profile',
    navigationTimeoutMs: 60_000,
    actionDelay: { minMs: 0, maxMs: 0 },
    resultScrollDelayMs: 250,
    maxResultScrolls: 80,
    sortCsv: true,
  };
}
