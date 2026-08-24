import { describe, expect, it } from 'vitest';
import { parsePlacesText } from '../src/placesInput.js';

describe('parsePlacesText', () => {
  it('parses gosom CSV output and deduplicates normalized Maps URLs', () => {
    const csv = [
      'input_id,link,title,category,address,review_count,review_rating',
      '1,"https://www.google.com/maps/place/Test/@1,2?entry=ttu",Test,Restaurant,"Main St, Osnabrück",100,4.5',
      '2,"https://www.google.com/maps/place/Test/@1,2?hl=de",Test,Restaurant,"Main St, Osnabrück",100,4.5',
      '3,https://www.google.com/maps/place/Other,Other,Cafe,Side St,20,4.2',
    ].join('\n');

    expect(parsePlacesText(csv, '.csv')).toEqual([
      { name: 'Test', url: 'https://www.google.com/maps/place/Test/@1,2?hl=de', address: 'Main St, Osnabrück' },
      { name: 'Other', url: 'https://www.google.com/maps/place/Other', address: 'Side St' },
    ]);
  });

  it('handles quoted commas and embedded newlines in CSV fields', () => {
    const csv = 'link,title,address,description\n"https://maps.google.com/maps/place/A","A, Bistro","Street 1, Osnabrück","line 1\nline 2"';
    expect(parsePlacesText(csv, '.csv')).toEqual([
      { name: 'A, Bistro', url: 'https://maps.google.com/maps/place/A', address: 'Street 1, Osnabrück' },
    ]);
  });

  it('parses gosom JSONL output', () => {
    const jsonl = [
      JSON.stringify({ title: 'Alpha', link: 'https://google.com/maps/place/Alpha', address: 'A 1' }),
      JSON.stringify({ title: 'Beta', link: 'https://google.com/maps/place/Beta', address: 'B 2' }),
    ].join('\n');
    expect(parsePlacesText(jsonl, '.jsonl')).toHaveLength(2);
  });

  it('rejects CSV without a Maps URL column', () => {
    expect(() => parsePlacesText('title,address\nA,B', '.csv')).toThrow(/link\/url/);
  });
});
