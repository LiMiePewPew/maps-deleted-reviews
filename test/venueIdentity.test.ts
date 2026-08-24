import { describe, expect, it } from 'vitest';
import { normalizeVenueUrl, venueIdentityKey } from '../src/venueIdentity.js';

describe('venueIdentityKey', () => {
  it('ignores Google Maps query parameters for the same place path', () => {
    const first = venueIdentityKey({
      name: 'Alpha',
      url: 'https://www.google.de/maps/place/Alpha/data=!1m1?entry=ttu',
    });
    const second = venueIdentityKey({
      name: 'Alpha Restaurant',
      url: 'https://www.google.com/maps/place/Alpha/data=!1m1?hl=de',
    });

    expect(first).toBe(second);
  });

  it('uses the stable !1s place token across different Maps URL layouts', () => {
    const first = venueIdentityKey({
      name: 'Hotel Example',
      url: 'https://www.google.de/maps/place/Hotel+Example/@52.2701,8.0472,17z/data=!4m8!3m7!1sChIJstable123!8m2!3d52.27!4d8.04?entry=ttu',
    });
    const second = venueIdentityKey({
      name: 'Hotel Example',
      url: 'https://www.google.de/maps/place/Hotel+Example/@52.2702,8.0473,16z/data=!3m1!5s0x0!4m2!3m1!1sChIJstable123?hl=de',
    });

    expect(first).toBe(second);
  });

  it('falls back to normalized name plus rounded coordinates for Maps places without a place token', () => {
    const first = venueIdentityKey({
      name: 'Alpha Cafe',
      url: 'https://www.google.de/maps/place/Alpha+Cafe/@52.270123,8.047234,17z',
    });
    const second = venueIdentityKey({
      name: 'Alpha Cafe',
      url: 'https://www.google.de/maps/place/Alpha+Cafe/@52.270124,8.047233,18z?entry=ttu',
    });

    expect(first).toBe(second);
  });

  it('keeps exact non-Maps URLs as identity', () => {
    expect(
      venueIdentityKey({ name: 'A', url: 'https://maps.example/a' }),
    ).toBe(venueIdentityKey({ name: 'A later', url: 'https://maps.example/a' }));
  });

  it('falls back to normalized name and address without a URL', () => {
    expect(
      venueIdentityKey({ name: ' Café Alpha ', url: '', address: ' Main 1 ' }),
    ).toBe(venueIdentityKey({ name: 'café alpha', url: '', address: 'Main 1' }));
  });
});

describe('normalizeVenueUrl', () => {
  it('returns null for an empty URL', () => {
    expect(normalizeVenueUrl('')).toBeNull();
  });
});
