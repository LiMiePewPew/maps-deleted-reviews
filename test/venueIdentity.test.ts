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
