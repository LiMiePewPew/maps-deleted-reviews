export const FULL_GASTRO_PRESET = [
  { searchTerm: 'restaurant', depth: 200 },
  { searchTerm: 'Cafe', depth: 180 },
  { searchTerm: 'bar', depth: 140 },
  { searchTerm: 'Hotel', depth: 100 },
  { searchTerm: 'Imbiss', depth: 180 },
  { searchTerm: 'Pizza', depth: 160 },
  { searchTerm: 'Döner', depth: 120 },
  { searchTerm: 'Sushi', depth: 100 },
  { searchTerm: 'Burger', depth: 120 },
  { searchTerm: 'Frühstück', depth: 120 },
  { searchTerm: 'Bäckerei', depth: 160 },
  { searchTerm: 'Eiscafe', depth: 100 },
  { searchTerm: 'italienisch', depth: 140 },
  { searchTerm: 'griechisch', depth: 100 },
  { searchTerm: 'indisch', depth: 60 },
  { searchTerm: 'asiatisch', depth: 160 },
  { searchTerm: 'vegan', depth: 100 },
  { searchTerm: 'Steakhouse', depth: 80 },
  { searchTerm: 'Pub', depth: 100 },
  { searchTerm: 'Cocktailbar', depth: 80 },
] as const;

export const FULL_GASTRO_SEARCH_TERMS = FULL_GASTRO_PRESET.map(
  ({ searchTerm }) => searchTerm,
);

const FULL_GASTRO_DEPTHS = new Map<string, number>(
  FULL_GASTRO_PRESET.map(({ searchTerm, depth }) => [searchTerm.toLocaleLowerCase('de-DE'), depth]),
);

export function fullGastroDepthFor(searchTerm: string): number | undefined {
  return FULL_GASTRO_DEPTHS.get(searchTerm.trim().toLocaleLowerCase('de-DE'));
}
