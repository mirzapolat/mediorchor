// The padding around a page's content. At the bottom it also keeps clear of
// the device's rounded corners and home indicator (installed app on phones,
// env() needs viewport-fit=cover in index.html). Bars docked to the bottom
// edge (the piece player) cancel it with the same values as a negative margin.
export const PAGE_PADDING =
  'p-4 sm:p-6 lg:p-8 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-[calc(1.5rem+env(safe-area-inset-bottom))] lg:pb-[calc(2rem+env(safe-area-inset-bottom))]';
