import type { Venue } from './types.js';

export function venueIdentityKey(venue: Pick<Venue, 'name' | 'url' | 'address'>): string {
  const mapsIdentity = extractMapsIdentity(venue.url, venue.name);
  if (mapsIdentity) {
    return mapsIdentity;
  }

  const urlKey = normalizeVenueUrl(venue.url);
  if (urlKey) {
    return `url:${urlKey}`;
  }

  return `name:${normalizeText(venue.name)}|address:${normalizeText(venue.address ?? '')}`;
}

export function normalizeVenueUrl(rawUrl: string): string | null {
  if (!rawUrl) {
    return null;
  }

  try {
    const url = new URL(rawUrl, 'https://www.google.com');
    const pathname = decodeURIComponent(url.pathname)
      .replace(/\/+$/, '')
      .replace(/\/+/g, '/');

    if (pathname.includes('/maps/place/')) {
      return `maps:${pathname.normalize('NFKC').toLowerCase()}`;
    }

    url.hash = '';
    return `url:${url.toString()}`;
  } catch {
    return null;
  }
}

function extractMapsIdentity(rawUrl: string, name: string): string | null {
  if (!rawUrl) {
    return null;
  }

  try {
    const url = new URL(rawUrl, 'https://www.google.com');
    const decoded = decodeURIComponent(`${url.pathname}${url.search}`);
    if (!decoded.includes('/maps/place/')) {
      return null;
    }

    const placeTokens = [...decoded.matchAll(/!1s([^!/?&]+)/g)]
      .map((match) => normalizeText(match[1] ?? ''))
      .filter(Boolean);
    const stableToken = placeTokens.at(-1);
    if (stableToken) {
      return `maps-place:${stableToken}`;
    }

    const coordinateMatch = decoded.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (coordinateMatch) {
      const latitude = roundCoordinate(coordinateMatch[1]);
      const longitude = roundCoordinate(coordinateMatch[2]);
      return `maps-name-coord:${normalizeText(name)}|${latitude},${longitude}`;
    }

    return null;
  } catch {
    return null;
  }
}

function roundCoordinate(value: string | undefined): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(5) : '';
}

function normalizeText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}
