import { describe, expect, it } from 'vitest';
import { mergeDiscoveredVenuesFast, shouldBlockResourceType } from '../src/pipelineV3.js';
import {
  isNegativeReviewPanelReady,
  isReviewPanelOpenEvidence,
} from '../src/reviewPanelEvidence.js';

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

describe('pipeline V3 review panel evidence', () => {
  it('accepts a selected review tab as evidence that the panel opened', () => {
    expect(
      isReviewPanelOpenEvidence({
        positiveNoticeVisible: false,
        sortControlVisible: false,
        selectedReviewTabVisible: true,
      }),
    ).toBe(true);
  });

  it('accepts the review sort control as panel-open evidence before cards hydrate', () => {
    expect(
      isReviewPanelOpenEvidence({
        positiveNoticeVisible: false,
        sortControlVisible: true,
        selectedReviewTabVisible: false,
      }),
    ).toBe(true);
  });

  it('does not claim the panel opened without review-specific evidence', () => {
    expect(
      isReviewPanelOpenEvidence({
        positiveNoticeVisible: false,
        sortControlVisible: false,
        selectedReviewTabVisible: false,
      }),
    ).toBe(false);
  });
});

describe('pipeline V3 negative notice certification', () => {
  it('does not accept a generic sort control as negative evidence', () => {
    expect(
      isNegativeReviewPanelReady({
        positiveNoticeVisible: false,
        sortControlVisible: true,
        reviewCardVisible: false,
      }),
    ).toBe(false);
  });

  it('requires both a review sort control and a hydrated review card', () => {
    expect(
      isNegativeReviewPanelReady({
        positiveNoticeVisible: false,
        sortControlVisible: true,
        reviewCardVisible: true,
      }),
    ).toBe(true);
  });

  it('never certifies negative while a positive removal notice is visible', () => {
    expect(
      isNegativeReviewPanelReady({
        positiveNoticeVisible: true,
        sortControlVisible: true,
        reviewCardVisible: true,
      }),
    ).toBe(false);
  });
});
