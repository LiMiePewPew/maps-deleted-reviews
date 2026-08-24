import { describe, expect, it } from 'vitest';
import { mergeDiscoveredVenue, shouldBlockResourceType } from '../src/pipelineV2.js';

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
