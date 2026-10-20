// Where the account and admin settings go back to: the page they were opened
// from through the header icons (mobile navigation). Kept per tab in
// sessionStorage, so moving between their own pages doesn't lose it; a direct
// visit has none and falls back to the start page.
export type ReturnSection = 'account' | 'admin';

const key = (section: ReturnSection) => `anwesenheit.return.${section}`;

export const rememberReturn = (section: ReturnSection, path: string) => {
  // Opening a section from within itself keeps the original way back.
  if (path === `/${section}` || path.startsWith(`/${section}/`)) return;
  try {
    sessionStorage.setItem(key(section), path);
  } catch {
    /* storage blocked: the fallback applies */
  }
};

export const returnPath = (section: ReturnSection): string => {
  try {
    const path = sessionStorage.getItem(key(section));
    // Only paths of this app (no "//host" or absolute URLs).
    if (path && path.startsWith('/') && !path.startsWith('//')) return path;
  } catch {
    /* storage blocked */
  }
  return '/';
};
