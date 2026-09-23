// Preset group colors, assigned in this order to new groups (mirrored in the
// SQL triggers that create groups server-side). The order keeps neighbouring
// groups — which sit next to each other in the Groups donut — distinguishable,
// also for colour-blind readers; slate is a deliberate neutral and stays last.
export const GROUP_PALETTE = [
  '#0284c7', // sky
  '#ea580c', // orange
  '#16a34a', // green
  '#9333ea', // purple
  '#ca8a04', // amber
  '#e11d48', // rose
  '#0d9488', // teal
  '#4f46e5', // indigo
  '#db2777', // pink
  '#64748b', // slate
];

export const FALLBACK_GROUP_COLOR = '#64748b';

export const isHexColor = (value: string) => /^#[0-9a-f]{6}$/i.test(value);

export const paletteColor = (index: number) => GROUP_PALETTE[index % GROUP_PALETTE.length];
