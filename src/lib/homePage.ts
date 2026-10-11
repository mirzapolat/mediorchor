import type { AppUser, HomePage } from '@/types';
import { permissionsFor } from '@/lib/roles';

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
// (or no longer is) open to the account. A participant of a single project
// always lands in that project.
export const homePath = (user: AppUser | null, soleProjectId: string | null) => {
  if (soleProjectId) return `/projects/${soleProjectId}`;
  const access = permissionsFor(user?.role);
  const page = user?.home_page ?? 'dashboard';
  return PATHS[availableHomePages(access).includes(page) ? page : 'dashboard'];
};
