import type { UserRole } from '@/types';

// Account roles, lowest to highest (mirrors server/policies.ts, which enforces
// them; the UI only hides what the server would refuse anyway):
//   participant  (Teilnehmer)  "Meine Teilnahme" and Stücke of their projects
//   section_lead (Stimmeltern) the content of every project, no project settings
//   manager      (Verwaltung)  everything except the admin configuration
//   music_director (Musikalische Leitung) the content of every project and
//                              every piece, but never a project member, no
//                              project settings and no dashboard
//   admin                      everything
export const ROLES: readonly UserRole[] = ['participant', 'section_lead', 'manager', 'music_director', 'admin'];

// The role is `min` or a higher one. No account means no role at all.
export const hasRole = (role: UserRole | null | undefined, min: UserRole) =>
  role != null && ROLES.indexOf(role) >= ROLES.indexOf(min);

export interface Permissions {
  isAdmin: boolean;
  // Every project's content: members, Proben, attendance, registrations, …
  canAccessAllProjects: boolean;
  // Creating projects, their settings, archiving and deleting them.
  canManageProjects: boolean;
  // The personal dashboard (not the music director, who has no projects of
  // their own).
  hasDashboard: boolean;
  canEditCalendars: boolean;
  // Edits every piece and opens the collection page.
  hasFullPieceAccess: boolean;
  // Edits the pieces of the projects one manages.
  canEditProjectPieces: boolean;
  // Takes part in projects: "Meine Teilnahme", joining, attendance.
  canParticipate: boolean;
}

export const permissionsFor = (role: UserRole | null | undefined): Permissions => ({
  isAdmin: hasRole(role, 'admin'),
  canAccessAllProjects: hasRole(role, 'section_lead'),
  canManageProjects: role === 'manager' || role === 'admin',
  hasDashboard: role !== 'music_director',
  canEditCalendars: hasRole(role, 'manager'),
  hasFullPieceAccess: hasRole(role, 'manager'),
  canEditProjectPieces: hasRole(role, 'section_lead'),
  canParticipate: role !== 'music_director',
});

// i18n keys for each role's name and its one-line description.
export const ROLE_LABEL = {
  participant: 'roleParticipant',
  section_lead: 'roleSectionLead',
  manager: 'roleManager',
  music_director: 'roleMusicDirector',
  admin: 'roleAdmin',
} as const satisfies Record<UserRole, string>;

export const ROLE_HINT = {
  participant: 'roleParticipantHint',
  section_lead: 'roleSectionLeadHint',
  manager: 'roleManagerHint',
  music_director: 'roleMusicDirectorHint',
  admin: 'roleAdminHint',
} as const satisfies Record<UserRole, string>;
