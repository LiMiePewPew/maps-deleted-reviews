import { describe, expect, it } from 'vitest';
import { mergeDiscoveredVenuesFast, shouldBlockResourceType } from '../src/pipelineV3.js';

describe('pipeline V3 discovery index', () => {
  it('deduplicates the same Maps place in O(1) index lookups', () => {
    const state = { venues: [] as Array<{ name: string; url: string; searchTerms: string[] }> };
    const index = new Map<string, (typeof state.venues)[number]>();

    mergeDiscoveredVenuesFast(
      state,
      index,
      [
        {
          name: 'Example Restaurant',
          url: 'https://www.google.de/maps/place/Example/data=!4m2!3m1!1sabc?entry=ttu',
        },
      ],
      'restaurant',
    );
    mergeDiscoveredVenuesFast(
      state,
      index,
      [
        {
          name: 'Example Restaurant',
          url: 'https://www.google.com/maps/place/Example/data=!4m2!3m1!1sabc?hl=de',
        },
      ],
      'italienisch',
    );

    expect(state.venues).toHaveLength(1);
    expect(state.venues[0]?.searchTerms).toEqual(['restaurant', 'italienisch']);
  });

  it('keeps distinct place tokens distinct', () => {
    const state = { venues: [] as Array<{ name: string; url: string; searchTerms: string[] }> };
    const index = new Map<string, (typeof state.venues)[number]>();

    mergeDiscoveredVenuesFast(
      state,
      index,
      [
        { name: 'Alpha', url: 'https://www.google.de/maps/place/Alpha/data=!4m2!3m1!1sa' },
        { name: 'Beta', url: 'https://www.google.de/maps/place/Beta/data=!4m2!3m1!1sb' },
      ],
      'restaurant',
    );

    expect(state.venues).toHaveLength(2);
  });
});

describe('pipeline V3 resource blocking', () => {
  it('blocks heavy visual assets but preserves executable/data requests', () => {
    expect(shouldBlockResourceType('image')).toBe(true);
    expect(shouldBlockResourceType('media')).toBe(true);
    expect(shouldBlockResourceType('font')).toBe(true);
    expect(shouldBlockResourceType('document')).toBe(false);
    expect(shouldBlockResourceType('stylesheet')).toBe(false);
    expect(shouldBlockResourceType('script')).toBe(false);
    expect(shouldBlockResourceType('xhr')).toBe(false);
    expect(shouldBlockResourceType('fetch')).toBe(false);
  });
});
