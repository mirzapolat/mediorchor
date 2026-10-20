import { api } from '@/lib/api';
import { localToday } from '@/lib/eventTiming';
import { loadEventPrograms, type ProgramItem } from '@/lib/eventProgram';
import type { AttendanceStatus, Event, Project } from '@/types';

export interface UpcomingRehearsal {
  event: Event;
  project: Project;
  // Recorded ahead of time (excused, or marked present); null = nothing yet.
  status: AttendanceStatus | null;
  // What to prepare (pieces), for the Proben the dashboard shows.
  program: ProgramItem[];
}

// Entries per dashboard widget; the rest is on the projects page.
export const PROJECTS_PREVIEW = 4;
export const REHEARSALS_PREVIEW = 3;

// An open, listed survey for the account (server/projectNav.ts my_tasks):
// metadata and its own state only.
export interface SurveyTask {
  form_id: string;
  token: string;
  title: string;
  closes_at: string | null;
  project: { id: string; name: string; image_url: string | null };
  my: 'none' | 'draft' | 'answered';
  answered_at: string | null;
}

export const SURVEYS_PREVIEW = 4;

// A published weekend where the account still has to choose a room.
export interface RoomTask {
  weekend_id: string;
  title: string;
  starts_on: string | null;
  project: { id: string; name: string; image_url: string | null };
}

export interface DashboardData {
  // Open surveys meant for the account, unfinished first.
  surveys: SurveyTask[];
  rooms: RoomTask[];
  // Active member rows of the account, in any project (archived ones too).
  memberships: number;
  // Active projects the account takes part in, newest first.
  projects: Project[];
  // Each of those projects' next Probe, by project id.
  nextByProject: Map<string, Event>;
  // Upcoming Proben across those projects, soonest first.
  upcoming: UpcomingRehearsal[];
}

export const loadDashboardData = async (userId: string): Promise<DashboardData> => {
  // Pick up member rows a manager added with this account's email.
  await api.rpc('claim_my_memberships');
  const { data: memberRows } = await api
    .from('members')
    .select('id, project_id')
    .eq('user_id', userId)
    .eq('status', 'active');
  const members = (memberRows as { id: string; project_id: string }[] | null) ?? [];
  if (members.length === 0) return { surveys: [], rooms: [], memberships: 0, projects: [], nextByProject: new Map(), upcoming: [] };

  const projectIds = members.map((m) => m.project_id);
  const [{ data: projectRows }, { data: eventRows }] = await Promise.all([
    api
      .from('projects')
      .select('*')
      .in('id', projectIds)
      .eq('status', 'active')
      .order('created_at', { ascending: false }),
    // Undated Proben count as held, so only dated ones from today on.
    api
      .from('events')
      .select('*')
      .in('project_id', projectIds)
      .gte('date', localToday())
      .order('date')
      .order('time', { nullsFirst: true }),
  ]);
  const projects = (projectRows as Project[] | null) ?? [];
  const byId = new Map(projects.map((p) => [p.id, p]));
  const events = ((eventRows as Event[] | null) ?? []).filter((e) => byId.has(e.project_id));

  const [{ data: attendanceRows }, programs, { data: tasks }] = await Promise.all([
    events.length
      ? api
          .from('attendance')
          .select('event_id, status')
          .in('member_id', members.map((m) => m.id))
          .in('event_id', events.map((e) => e.id))
      : Promise.resolve({ data: [] }),
    // Empty for projects that don't show their pieces to participants.
    loadEventPrograms(events.slice(0, REHEARSALS_PREVIEW).map((e) => e.id)),
    api.rpc('my_tasks'),
  ]);
  const statusByEvent = new Map(
    ((attendanceRows as { event_id: string; status: AttendanceStatus }[] | null) ?? []).map((a) => [
      a.event_id,
      a.status,
    ]),
  );

  const nextByProject = new Map<string, Event>();
  for (const e of events) if (!nextByProject.has(e.project_id)) nextByProject.set(e.project_id, e);

  const rank = (task: SurveyTask) => (task.my === 'answered' ? 1 : 0);
  const surveys = (((tasks as { surveys?: SurveyTask[] } | null)?.surveys ?? []) as SurveyTask[]).sort(
    (a, b) => rank(a) - rank(b) || (a.closes_at ?? '9999').localeCompare(b.closes_at ?? '9999'),
  );

  return {
    surveys,
    rooms: (tasks as { rooms?: RoomTask[] } | null)?.rooms ?? [],
    memberships: members.length,
    projects,
    nextByProject,
    upcoming: events.map((event) => ({
      event,
      project: byId.get(event.project_id)!,
      status: statusByEvent.get(event.id) ?? null,
      program: programs.filter((p) => p.event_id === event.id),
    })),
  };
};
