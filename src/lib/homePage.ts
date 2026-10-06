import type { AppUser, HomePage } from '@/types';

const PATHS: Record<HomePage, string> = {
  dashboard: '/dashboard',
  projects: '/projects',
  pieces: '/pieces',
  calendar: '/calendar',
};

// The start pages an account can pick: the piece collection and the calendar
// only for those who may open them.
export const availableHomePages = (access: { hasFullPieceAccess: boolean; canEditCalendars: boolean }): HomePage[] => [
  'dashboard',
  'projects',
  ...(access.hasFullPieceAccess ? (['pieces'] as const) : []),
  ...(access.canEditCalendars ? (['calendar'] as const) : []),
];

// Where `/` and signing in lead; the dashboard when the chosen page isn't
// (or no longer is) open to the account.
export const homePath = (user: AppUser | null) => {
  const access = {
    hasFullPieceAccess: Boolean(user?.is_admin || user?.piece_access === 'all'),
    canEditCalendars: Boolean(user?.is_admin || user?.can_edit_calendars),
  };
  const page = user?.home_page ?? 'dashboard';
  return PATHS[availableHomePages(access).includes(page) ? page : 'dashboard'];
};
