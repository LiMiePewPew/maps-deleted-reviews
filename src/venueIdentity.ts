import type { Venue } from './types.js';

export function venueIdentityKey(venue: Pick<Venue, 'name' | 'url' | 'address'>): string {
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

function normalizeText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}
