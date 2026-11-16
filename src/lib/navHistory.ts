// Which page each entry of this tab's browser history shows, so a back button
// can return to the page the user actually came from (the absences list, say)
// instead of a fixed parent page. React Router numbers its entries
// (`history.state.idx`); we keep idx → path in sessionStorage, which survives
// reloads (the PWA reloads often) and stays per tab.
const KEY = 'anwesenheit.history';
const MAX = 200;

let entries: Record<number, string> = (() => {
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Record<number, string>) : {};
  } catch {
    return {};
  }
})();

const currentIndex = (): number | null => {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === 'number' ? idx : null;
};

const trimSlash = (path: string) => path.replace(/\/+$/, '') || '/';
const pathnameOf = (path: string) => trimSlash(path.split(/[?#]/)[0]);

export const samePage = (a: string, b: string) => pathnameOf(a) === pathnameOf(b);

// `path` is `scope` or a page below it.
export const isInside = (path: string, scope: string) => {
  const p = pathnameOf(path);
  const s = trimSlash(scope);
  return s === '/' ? true : p === s || p.startsWith(`${s}/`);
};

// Note the page now showing (called on every navigation).
export const recordLocation = () => {
  const idx = currentIndex();
  if (idx === null) return;
  const path = window.location.pathname + window.location.search;
  if (entries[idx] === path) return;
  entries[idx] = path;
  // Entries far behind are no longer reachable by a back button worth having.
  for (const k of Object.keys(entries)) if (Number(k) < idx - MAX) delete entries[Number(k)];
  try {
    sessionStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    /* storage blocked: back buttons use their fixed targets */
  }
};

// The latest earlier page outside `scope` (the current area or page), as a
// history step (negative) and its path; null when this tab has none we know.
export const historyBack = (scope: string): { delta: number; path: string } | null => {
  recordLocation();
  const idx = currentIndex();
  if (idx === null) return null;
  for (let j = idx - 1; j >= 0; j--) {
    const path = entries[j];
    // A gap (an entry from before this app was loaded): unknown, don't guess.
    if (path === undefined) return null;
    if (!isInside(path, scope)) return { delta: j - idx, path };
  }
  return null;
};
