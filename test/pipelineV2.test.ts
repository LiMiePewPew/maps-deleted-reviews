import { describe, expect, it } from 'vitest';
import {
  mergeDiscoveredVenue,
  shouldBlockResourceType,
  synchronizeImportedVenues,
} from '../src/pipelineV2.js';
import type { ScrapedVenue } from '../src/types.js';

describe('pipeline V2 discovery deduplication', () => {
  it('merges the same Maps place found by multiple search terms', () => {
    const state = { venues: [] as Array<{ name: string; url: string; searchTerms: string[] }> };

    mergeDiscoveredVenue(
      state,
      {
        name: 'Example Restaurant',
        url: 'https://www.google.de/maps/place/Example+Restaurant/@52.1,8.1,17z/data=!4m2!3m1!1sabc?entry=ttu',
      },
      'restaurant',
    );
    mergeDiscoveredVenue(
      state,
      {
        name: 'Example Restaurant',
        url: 'https://www.google.de/maps/place/Example+Restaurant/@52.1,8.1,17z/data=!4m2!3m1!1sabc?hl=de',
      },
      'italienisch',
    );

    expect(state.venues).toHaveLength(1);
    expect(state.venues[0]?.searchTerms).toEqual(['restaurant', 'italienisch']);
  });

  it('keeps distinct Maps places distinct', () => {
    const state = { venues: [] as Array<{ name: string; url: string; searchTerms: string[] }> };

    mergeDiscoveredVenue(
      state,
      { name: 'Alpha', url: 'https://www.google.de/maps/place/Alpha/@52.1,8.1,17z/data=!4m2!3m1!1sa' },
      'restaurant',
    );
    mergeDiscoveredVenue(
      state,
      { name: 'Beta', url: 'https://www.google.de/maps/place/Beta/@52.2,8.2,17z/data=!4m2!3m1!1sb' },
      'restaurant',
    );

    expect(state.venues).toHaveLength(2);
  });
});

describe('pipeline V2 imported discovery', () => {
  it('deduplicates the imported queue and preserves only matching resume data', () => {
    const alphaUrl = 'https://www.google.de/maps/place/Alpha/@52.1,8.1';
    const staleUrl = 'https://www.google.de/maps/place/Stale/@52.2,8.2';
    const alphaKey = 'url:maps:/maps/place/alpha/@52.1,8.1';
    const staleKey = 'url:maps:/maps/place/stale/@52.2,8.2';
    const alphaRow = row('Alpha', alphaUrl);
    const staleRow = row('Stale', staleUrl);
    const state = {
      venues: [],
      completedVenueKeys: [alphaKey, staleKey],
      rows: [alphaRow, staleRow],
      completedSearchTerms: ['restaurant'],
    };

    synchronizeImportedVenues(state, [
      { name: 'Alpha', url: `${alphaUrl}?entry=ttu`, address: 'Alpha St' },
      { name: 'Alpha duplicate', url: `${alphaUrl}?hl=de`, address: 'Alpha St' },
      { name: 'Beta', url: 'https://www.google.de/maps/place/Beta/@52.3,8.3', address: 'Beta St' },
    ]);

    expect(state.venues).toHaveLength(2);
    expect(state.venues.map((venue) => venue.name)).toEqual(['Alpha', 'Beta']);
    expect(state.completedVenueKeys).toEqual([alphaKey]);
    expect(state.rows).toEqual([alphaRow]);
    expect(state.completedSearchTerms).toEqual(['external']);
  });
});

describe('pipeline V2 resource blocking', () => {
  it('blocks heavy visual assets but keeps documents and scripts', () => {
    expect(shouldBlockResourceType('image')).toBe(true);
    expect(shouldBlockResourceType('media')).toBe(true);
    expect(shouldBlockResourceType('font')).toBe(true);
    expect(shouldBlockResourceType('document')).toBe(false);
    expect(shouldBlockResourceType('script')).toBe(false);
    expect(shouldBlockResourceType('xhr')).toBe(false);
  });
});

function row(name: string, url: string): ScrapedVenue {
  return {
    name,
    url,
    venueType: 'external',
    totalReviews: 10,
    deletedReviewsMin: 0,
    deletedReviewsMax: 0,
    deletedReviewsEstimate: 0,
    currentStarRating: 4.5,
    percentageDeleted: 0,
    realScoreIfDeletedAreOneStar: 4.5,
    deletedReviewNotice: null,
    scrapedAt: '2026-08-24T00:00:00.000Z',
    status: 'ok',
  };
}
