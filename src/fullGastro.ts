export type GastroPreset = 'de' | 'es';

type GastroPresetEntry = { searchTerm: string; depth: number };

export const FULL_GASTRO_PRESETS: Record<GastroPreset, readonly GastroPresetEntry[]> = {
  de: [
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
  ],
  es: [
    { searchTerm: 'restaurante', depth: 220 },
    { searchTerm: 'bar', depth: 180 },
    { searchTerm: 'cafetería', depth: 180 },
    { searchTerm: 'tapas', depth: 160 },
    { searchTerm: 'pizzería', depth: 150 },
    { searchTerm: 'hamburguesería', depth: 120 },
    { searchTerm: 'sushi', depth: 100 },
    { searchTerm: 'desayuno', depth: 100 },
    { searchTerm: 'brunch', depth: 100 },
    { searchTerm: 'panadería', depth: 130 },
    { searchTerm: 'heladería', depth: 110 },
    { searchTerm: 'italiano', depth: 140 },
    { searchTerm: 'mediterráneo', depth: 180 },
    { searchTerm: 'arrocería', depth: 120 },
    { searchTerm: 'marisquería', depth: 120 },
    { searchTerm: 'paella', depth: 120 },
    { searchTerm: 'asiático', depth: 140 },
    { searchTerm: 'vegano', depth: 90 },
    { searchTerm: 'chiringuito', depth: 110 },
    { searchTerm: 'cocktail bar', depth: 90 },
  ],
} as const;

export const FULL_GASTRO_PRESET = FULL_GASTRO_PRESETS.de;
export const FULL_GASTRO_SEARCH_TERMS = FULL_GASTRO_PRESET.map(({ searchTerm }) => searchTerm);

export function fullGastroSearchTerms(preset: GastroPreset): string[] {
  return FULL_GASTRO_PRESETS[preset].map(({ searchTerm }) => searchTerm);
}

export function fullGastroDepthFor(
  searchTerm: string,
  preset: GastroPreset = 'de',
): number | undefined {
  const normalized = searchTerm.trim().toLocaleLowerCase(preset === 'es' ? 'es-ES' : 'de-DE');
  return FULL_GASTRO_PRESETS[preset].find(
    ({ searchTerm: candidate }) =>
      candidate.toLocaleLowerCase(preset === 'es' ? 'es-ES' : 'de-DE') === normalized,
  )?.depth;
}
