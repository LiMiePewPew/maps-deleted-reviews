import { describe, expect, it } from 'vitest';
import { formatVenueProgress, formatVenuesDetected } from '../src/progress.js';
import type { ScrapedVenue } from '../src/types.js';

const row: ScrapedVenue = {
  venueType: 'Döner',
  name: 'Rüyam Gemüse Kebab 2',
  url: 'https://maps.example/rueyam',
  totalReviews: 42_291,
  deletedReviewsMin: 11,
  deletedReviewsMax: 20,
  deletedReviewsEstimate: 15.5,
  currentStarRating: 4.9,
  percentageDeleted: 0.0004,
  realScoreIfDeletedAreOneStar: 4.8986,
  deletedReviewNotice: '11 bis 20 Bewertungen aufgrund von Beschwerden wegen Diffamierung entfernt.',
  scrapedAt: '2026-04-30T09:00:00.000Z',
  status: 'ok',
};

describe('progress formatting', () => {
  it('formats detected venue counts', () => {
    expect(formatVenuesDetected(17)).toBe('Venues detected: 17');
  });

  it('formats positive venue rows as aligned terminal output', () => {
    expect(formatVenueProgress(row)).toContain('Venue Rüyam Gemüse Kebab 2');
    expect(formatVenueProgress(row)).toContain('⎸ 11 to 20 removed reviews');
    expect(formatVenueProgress(row)).toContain('⎸ 42291 total reviews');
  });

  it('formats legacy 250/250 observations as the open-ended Google bucket', () => {
    expect(
      formatVenueProgress({
        ...row,
        deletedReviewsMin: 250,
        deletedReviewsMax: 250,
        deletedReviewsEstimate: 250,
        deletedReviewNotice: 'Über 250 Bewertungen aufgrund von Beschwerden wegen Diffamierung entfernt.',
      }),
    ).toContain('⎸ over 250 removed reviews');
  });

  it('does not present a missing notice as proven zero deletions', () => {
    expect(
      formatVenueProgress({
        ...row,
        deletedReviewsMin: 0,
        deletedReviewsMax: 0,
        deletedReviewsEstimate: 0,
        deletedReviewNotice: null,
      }),
    ).toContain('⎸ no notice observed');
  });

  it('labels incomplete checks explicitly', () => {
    expect(
      formatVenueProgress({
        ...row,
        deletedReviewsMin: 0,
        deletedReviewsMax: 0,
        deletedReviewsEstimate: 0,
        deletedReviewNotice: null,
        status: 'partial',
      }),
    ).toContain('⎸ notice check incomplete');
  });
});
