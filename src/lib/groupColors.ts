// Preset group colors, assigned in order to new groups (mirrored in the SQL
// migration and triggers that create groups server-side).
export const GROUP_PALETTE = [
  '#e11d48', // rose
  '#ea580c', // orange
  '#ca8a04', // amber
  '#16a34a', // green
  '#0d9488', // teal
  '#0284c7', // sky
  '#4f46e5', // indigo
  '#9333ea', // purple
  '#db2777', // pink
  '#64748b', // slate
];

export const FALLBACK_GROUP_COLOR = '#64748b';

export const isHexColor = (value: string) => /^#[0-9a-f]{6}$/i.test(value);

export const paletteColor = (index: number) => GROUP_PALETTE[index % GROUP_PALETTE.length];
