import { describe, expect, it } from 'vitest';
import { buildWebDataset, parseCsv } from '../src/exportWebData.js';

describe('web data export', () => {
  it('parses quoted CSV cells and embedded commas', () => {
    const rows = parseCsv(
      'venue_type,name,review_notice\nBurger,"The Mill, Osnabrück","21 bis 50 Bewertungen entfernt."\n',
    );

    expect(rows).toEqual([
      {
        venue_type: 'Burger',
        name: 'The Mill, Osnabrück',
        review_notice: '21 bis 50 Bewertungen entfernt.',
      },
    ]);
  });

  it('publishes notices as observed ranges and keeps missing notices separate', () => {
    const dataset = buildWebDataset(
      [
        'venue_type,name,total_reviews,deleted_reviews_min,deleted_reviews_max,percentage_deleted,current_star_rating,review_notice,url,address,status,error,scraped_at',
        'Burger,The Mill,640,21,50,5.27,4.5,"21 bis 50 Bewertungen aufgrund von Beschwerden wegen Diffamierung entfernt.",https://example.com,,ok,,2026-08-24T21:00:00.000Z',
        'Cafe,Example Cafe,100,0,0,0,4.3,,https://example.com/2,,ok,,2026-08-24T21:01:00.000Z',
      ].join('\n'),
      'Osnabrück',
      'input.csv',
    );

    expect(dataset.summary.observedVenues).toBe(2);
    expect(dataset.summary.noticesFound).toBe(1);
    expect(dataset.summary.noNoticeObserved).toBe(1);
    expect(dataset.summary.largestNoticeMax).toBe(50);
    expect(dataset.venues[0]?.hasNotice).toBe(true);
    expect(dataset.venues[1]?.hasNotice).toBe(false);
  });

  it('reports partial and failed rows as uncertain output quality', () => {
    const dataset = buildWebDataset(
      [
        'venue_type,name,total_reviews,deleted_reviews_min,deleted_reviews_max,percentage_deleted,current_star_rating,review_notice,url,address,status,error,scraped_at',
        'Cafe,Partial Cafe,,0,0,,,,https://example.com,,,partial,,2026-08-24T21:00:00.000Z',
        'Bar,Failed Bar,,0,0,,,,https://example.com/2,,,failed,Navigation failed,2026-08-24T21:01:00.000Z',
      ].join('\n'),
    );

    expect(dataset.summary.uncertain).toBe(1);
    expect(dataset.summary.failed).toBe(1);
    expect(dataset.summary.noNoticeObserved).toBe(0);
  });
});
