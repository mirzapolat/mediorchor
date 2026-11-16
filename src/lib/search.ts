// Search text the way the files page does: case and accents don't matter
// ("Faure" finds "Fauré"), and every word of the query has to appear
// somewhere ("bach kantate" finds "Kantate BWV 140 · Bach").
export const foldText = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export const queryWords = (query: string) => foldText(query).split(/\s+/).filter(Boolean);

export const matchesQuery = (text: string | null | undefined, query: string) => {
  const words = queryWords(query);
  if (words.length === 0) return true;
  const hay = foldText(text ?? '');
  return words.every((w) => hay.includes(w));
};
