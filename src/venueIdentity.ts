import type { Venue } from './types.js';

export function venueIdentityKey(venue: Pick<Venue, 'name' | 'url' | 'address'>): string {
  const urlKey = normalizeMapsUrl(venue.url);
  if (urlKey) {
    return `url:${urlKey}`;
  }

  return `name:${normalizeText(venue.name)}|address:${normalizeText(venue.address ?? '')}`;
}

export function normalizeMapsUrl(rawUrl: string): string | null {
  if (!rawUrl) {
    return null;
  }

  try {
    const url = new URL(rawUrl, 'https://www.google.com');
    const pathname = decodeURIComponent(url.pathname)
      .replace(/\/+$/, '')
      .replace(/\/+/g, '/');

    if (!pathname.includes('/maps/place/')) {
      return null;
    }

    return pathname.normalize('NFKC').toLowerCase();
  } catch {
    return null;
  }
}

function normalizeText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}
