import { describe, expect, it } from 'vitest';
import {
  dedupeGosomPlaces,
  gosomIdentityKey,
  parseGosomCsv,
  type GosomPlace,
} from '../src/hybridDiscovery.js';

describe('parseGosomCsv', () => {
  it('parses quoted gosom rows and preserves Google identities', () => {
    const csv = [
      'input_id,link,title,category,address,review_count,review_rating,latitude,longitude,cid,data_id,place_id',
      '1,"https://www.google.com/maps/place/Test?entry=ttu","Test, Bistro",Restaurant,"Markt 1, Osnabrück",123,4.7,52.27,8.05,12345,0xabc:0xdef,ChIJ123',
      '',
    ].join('\n');

    expect(parseGosomCsv(csv)).toEqual([
      {
        name: 'Test, Bistro',
        url: 'https://www.google.com/maps/place/Test?entry=ttu',
        address: 'Markt 1, Osnabrück',
        category: 'Restaurant',
        placeId: 'ChIJ123',
        dataId: '0xabc:0xdef',
        cid: '12345',
        reviewCount: 123,
        reviewRating: 4.7,
        latitude: 52.27,
        longitude: 8.05,
      },
    ]);
  });

  it('supports embedded newlines inside quoted CSV cells', () => {
    const csv = [
      'link,title,address,place_id',
      '"https://www.google.com/maps/place/A","Cafe A","Line 1\nLine 2",ChIJ-A',
      '',
    ].join('\n');

    expect(parseGosomCsv(csv)[0]?.address).toBe('Line 1\nLine 2');
  });
});

describe('dedupeGosomPlaces', () => {
  it('uses place id before URL differences and keeps the richer row', () => {
    const sparse: GosomPlace = {
      name: 'Cafe A',
      url: 'https://www.google.com/maps/place/Cafe+A?entry=ttu',
      placeId: 'ChIJ-A',
    };
    const rich: GosomPlace = {
      ...sparse,
      url: 'https://www.google.de/maps/place/Cafe+A?hl=de',
      address: 'Markt 1, Osnabrück',
      reviewCount: 200,
    };

    expect(dedupeGosomPlaces([sparse, rich])).toEqual([rich]);
  });

  it('falls back to canonicalized URL when Google ids are unavailable', () => {
    expect(
      gosomIdentityKey({
        name: 'A',
        url: 'https://www.google.com/maps/place/A?entry=ttu',
      }),
    ).toBe('url:/maps/place/a');
  });
});
