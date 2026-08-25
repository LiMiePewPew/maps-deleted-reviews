import { describe, expect, it } from 'vitest';
import {
  buildWebDataset,
  isClearlyNonGastroProfile,
  isClearlyOutsideTargetArea,
  parseCsv,
  parseGoogleMapsCoordinates,
} from '../src/exportWebData.js';

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

    expect(dataset.schemaVersion).toBe(2);
    expect(dataset.summary.candidateProfiles).toBe(2);
    expect(dataset.summary.observedVenues).toBe(2);
    expect(dataset.summary.noticesFound).toBe(1);
    expect(dataset.summary.noNoticeObserved).toBe(1);
    expect(dataset.summary.excludedOutsideArea).toBe(0);
    expect(dataset.summary.excludedClearlyNonGastro).toBe(0);
    expect(dataset.venues[0]).toMatchObject({
      hasNotice: true,
      noticeRangeKey: '21-50',
      noticeMin: 21,
      noticeMax: 50,
      noticeOpenEnded: false,
    });
    expect(dataset.venues[1]?.hasNotice).toBe(false);
    expect(dataset.venues[0]).not.toHaveProperty('currentStarRating');
    expect(dataset.venues[0]).not.toHaveProperty('percentageDeleted');
    expect(dataset.venues[0]).not.toHaveProperty('error');
  });

  it('migrates every legacy 250/250 observation to the open-ended over-250 bucket', () => {
    const dataset = buildWebDataset(
      [
        'venue_type,name,total_reviews,deleted_reviews_min,deleted_reviews_max,review_notice,url,address,status,scraped_at',
        'Döner,M&C Döner Osnabrück,1368,250,250,"250 Bewertungen aufgrund von Beschwerden wegen Diffamierung entfernt.",https://example.com/mc,,ok,2026-08-25T10:00:00.000Z',
      ].join('\n'),
    );

    expect(dataset.venues[0]).toMatchObject({
      noticeRangeKey: 'over-250',
      noticeMin: 251,
      noticeMax: null,
      noticeOpenEnded: true,
    });
  });

  it('keeps the literal Google Über-250 wording open-ended', () => {
    const dataset = buildWebDataset(
      [
        'venue_type,name,total_reviews,deleted_reviews_min,deleted_reviews_max,review_notice,url,address,status,scraped_at',
        'Cafe,Example,500,250,250,"Über 250 Bewertungen aufgrund von Beschwerden wegen Diffamierung entfernt.",https://example.com/cafe,,ok,2026-08-25T10:00:00.000Z',
      ].join('\n'),
    );

    expect(dataset.venues[0]).toMatchObject({
      noticeRangeKey: 'over-250',
      noticeMin: 251,
      noticeMax: null,
      noticeOpenEnded: true,
    });
  });

  it('reports partial and failed rows as uncertain output quality', () => {
    const dataset = buildWebDataset(
      [
        'venue_type,name,total_reviews,deleted_reviews_min,deleted_reviews_max,review_notice,url,address,status,error,scraped_at',
        'Cafe,Partial Cafe,,0,0,,https://example.com,,partial,,2026-08-24T21:00:00.000Z',
        'Bar,Failed Bar,,0,0,,https://example.com/2,,failed,Navigation failed,2026-08-24T21:01:00.000Z',
      ].join('\n'),
    );

    expect(dataset.summary.uncertain).toBe(1);
    expect(dataset.summary.failed).toBe(1);
    expect(dataset.summary.noNoticeObserved).toBe(0);
  });

  it('filters obvious out-of-area Google results from the Osnabrück web dataset', () => {
    const header =
      'venue_type,name,total_reviews,deleted_reviews_min,deleted_reviews_max,review_notice,url,address,status,scraped_at';
    const dataset = buildWebDataset(
      [
        header,
        'Pizza,Osnabrück Test,120,0,0,,"https://www.google.com/maps/place/Test/@52.2799,8.0472,17z",,ok,2026-08-25T10:00:00.000Z',
        'Pizza,BLOCK HOUSE Am Alexanderplatz,1000,21,50,"21 bis 50 Bewertungen aufgrund von Beschwerden wegen Diffamierung entfernt.","https://www.google.com/maps/place/Block/@52.5219,13.4132,17z",,ok,2026-08-25T10:01:00.000Z',
        'Döner,Istanbul Ocakbaşi Osnabrück /Belm,500,11,20,"11 bis 20 Bewertungen aufgrund von Beschwerden wegen Diffamierung entfernt.",https://example.com/belm,,ok,2026-08-25T10:02:00.000Z',
        'Cafe,Ort noch unklar,80,0,0,,https://example.com/unknown,,ok,2026-08-25T10:03:00.000Z',
      ].join('\n'),
      'Osnabrück',
      'input.csv',
    );

    expect(dataset.summary.excludedOutsideArea).toBe(2);
    expect(dataset.summary.observedVenues).toBe(2);
    expect(dataset.summary.noticesFound).toBe(0);
    expect(dataset.venues.map((venue) => venue.name)).toEqual([
      'Ort noch unklar',
      'Osnabrück Test',
    ]);
  });

  it('prefers actual !3d/!4d place coordinates over the Maps viewport', () => {
    expect(
      parseGoogleMapsCoordinates(
        'https://www.google.com/maps/place/Test/@52.5219,13.4132,12z/data=!3d52.2799!4d8.0472',
      ),
    ).toEqual({ lat: 52.2799, lon: 8.0472 });
  });

  it('parses the @lat,lon coordinate format as a fallback', () => {
    expect(
      parseGoogleMapsCoordinates('https://www.google.com/maps/place/Test/@52.2799,8.0472,17z'),
    ).toEqual({ lat: 52.2799, lon: 8.0472 });
  });

  it('keeps unknown locations but rejects explicit nearby municipalities', () => {
    expect(
      isClearlyOutsideTargetArea({ name: 'Unbekanntes Cafe', address: '', url: 'https://example.com' }),
    ).toBe(false);
    expect(
      isClearlyOutsideTargetArea({ name: 'Restaurant in Wallenhorst', address: '', url: 'https://example.com' }),
    ).toBe(true);
  });

  it('filters known obvious non-gastro false positives conservatively', () => {
    expect(
      isClearlyNonGastroProfile({
        name: 'MariJing Thai Massage & Asia Wellness',
        googleCategory: null,
      }),
    ).toBe(true);
    expect(
      isClearlyNonGastroProfile({
        name: 'Ha Beauty Nails, Lashes & More',
        googleCategory: 'Nail salon',
      }),
    ).toBe(true);
    expect(
      isClearlyNonGastroProfile({ name: 'Pans Kitchen', googleCategory: 'Restaurant' }),
    ).toBe(false);
  });

  it('counts non-gastro exclusions separately from area exclusions', () => {
    const dataset = buildWebDataset(
      [
        'venue_type,name,total_reviews,deleted_reviews_min,deleted_reviews_max,review_notice,url,address,google_category,status,scraped_at',
        'asiatisch,MariJing Thai Massage & Asia Wellness,57,2,5,"2 bis 5 Bewertungen aufgrund von Beschwerden wegen Diffamierung entfernt.",https://example.com/massage,49074 Osnabrück,Massage spa,ok,2026-08-25T10:00:00.000Z',
        'restaurant,Pans Kitchen,771,11,20,"11 bis 20 Bewertungen aufgrund von Beschwerden wegen Diffamierung entfernt.",https://example.com/pans,49074 Osnabrück,Restaurant,ok,2026-08-25T10:01:00.000Z',
      ].join('\n'),
    );

    expect(dataset.summary.candidateProfiles).toBe(2);
    expect(dataset.summary.excludedClearlyNonGastro).toBe(1);
    expect(dataset.summary.observedVenues).toBe(1);
    expect(dataset.summary.noticesFound).toBe(1);
    expect(dataset.venues[0]?.name).toBe('Pans Kitchen');
  });
});
