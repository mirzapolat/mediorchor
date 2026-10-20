// Who looks after a project's groups (Gruppen → "Zuständig"): reading them
// with the people's names and photos, and finding people to name. Only for
// those who manage the project; a responsibility grants no rights.
import { db, authUid, ApiError, forbidden } from './db.ts';
import { canAccessProject, canManageProjects } from './policies.ts';

type Args = Record<string, unknown>;

const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));

const requireUser = () => {
  const uid = authUid();
  if (!uid) throw new ApiError('Authentication required', 401, '42501');
  return uid;
};

// Named parameters: a predicate may not use them all (canAccessProject
// doesn't look at the project).
const holds = (sql: string, params: Record<string, unknown> = {}) =>
  Boolean((db.prepare(`select (${sql}) as v`).get(params) as { v: number }).v);

const requireProjectManager = (projectId: string) => {
  requireUser();
  if (!projectId || !holds(canAccessProject('@pid'), { pid: projectId })) throw forbidden('Project access denied');
};

// The account's member row in the project, if any: later imports and links
// show up here by themselves (it is looked up on every read).
const memberOf = `(select json_object('id', m.id, 'group_name', m.group_name, 'status', m.status)
  from members m where m.project_id = @project and m.user_id = u.id
  order by m.status = 'active' desc, m.created_at limit 1)`;

// Every responsibility and note of a project's groups.
const group_responsibilities = (args: Args) => {
  const projectId = text(args.p_project_id);
  requireProjectManager(projectId);
  const people = db
    .prepare(
      `select r.id, r.group_id, r.user_id, r.position, u.name, u.photo_url, u.email, ${memberOf} as member
       from group_responsibles r
       join project_groups g on g.id = r.group_id
       join app_users u on u.id = r.user_id
       where g.project_id = @project
       order by r.position, r.created_at`,
    )
    .all({ project: projectId }) as Array<Record<string, unknown>>;
  const notes = db
    .prepare(
      `select n.group_id, n.note from group_notes n join project_groups g on g.id = n.group_id
       where g.project_id = ? and n.note <> ''`,
    )
    .all(projectId);
  return {
    people: people.map((p) => ({ ...p, member: p.member ? JSON.parse(String(p.member)) : null })),
    notes,
  };
};

// Accounts to name as responsible: active members of the project first, then
// anyone else with an account (they needn't be a member, nor in the group).
// Without a project (a project being set up) any account; with an empty
// query, the project's members.
const search_people = (args: Args) => {
  requireUser();
  const projectId = text(args.p_project_id) || null;
  if (projectId) requireProjectManager(projectId);
  else if (!holds(canManageProjects())) throw forbidden('Access denied');
  const query = text(args.p_query).trim().slice(0, 100);
  if (!query && !projectId) return [];
  const activeMember = `exists (select 1 from members m where m.project_id = @project and m.user_id = u.id and m.status = 'active')`;
  const rows = db
    .prepare(
      `select u.id, u.name, u.email, u.photo_url, ${projectId ? memberOf : 'null'} as member
       from app_users u
       where (@q = '' or instr(ulower(u.name), ulower(@q)) > 0 or instr(ulower(u.email), ulower(@q)) > 0)
         ${query ? '' : `and ${activeMember}`}
       order by ${projectId ? `${activeMember} desc,` : ''} u.name collate nocase, u.email collate nocase
       limit 12`,
    )
    .all({ q: query, project: projectId }) as Array<Record<string, unknown>>;
  return rows.map((r) => ({ ...r, member: r.member ? JSON.parse(String(r.member)) : null }));
};

export const groupResponsibleFunctions = { group_responsibilities, search_people };
export const GROUP_READ_FUNCTIONS = ['group_responsibilities', 'search_people'];
