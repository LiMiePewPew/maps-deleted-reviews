import type { ScrapedVenue } from './types.js';

export function formatVenuesDetected(count: number): string {
  return `Venues detected: ${count}`;
}

export function formatVenueProgress(row: ScrapedVenue): string {
  const name = row.name.padEnd(36, ' ');
  const notice = formatNoticeStatus(row).padEnd(24, ' ');
  return [
    `Venue ${name}`,
    notice,
    `${formatTotalReviews(row.totalReviews)} total reviews`,
  ].join(' ⎸ ');
}

function formatNoticeStatus(row: ScrapedVenue): string {
  if (row.deletedReviewNotice && row.deletedReviewsMax > 0) {
    if (isOver250Notice(row.deletedReviewNotice, row.deletedReviewsMin, row.deletedReviewsMax)) {
      return 'over 250 removed reviews';
    }
    return `${row.deletedReviewsMin} to ${row.deletedReviewsMax} removed reviews`;
  }
  if (row.status === 'partial' || row.status === 'failed') {
    return 'notice check incomplete';
  }
  return 'no notice observed';
}

function isOver250Notice(rawNotice: string, min: number, max: number): boolean {
  return /(?:über|ueber)\s+250/i.test(rawNotice) || (min === 250 && max === 250);
}

function formatTotalReviews(totalReviews: number | null): string {
  return totalReviews === null ? 'unknown' : String(totalReviews);
}
