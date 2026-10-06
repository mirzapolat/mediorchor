import { api } from '@/lib/api';
import { localToday } from '@/lib/eventTiming';
import type { AttendanceStatus, Event, Project } from '@/types';

export interface UpcomingRehearsal {
  event: Event;
  project: Project;
  // Recorded ahead of time (excused, or marked present); null = nothing yet.
  status: AttendanceStatus | null;
}

export interface DashboardData {
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
  if (members.length === 0) return { memberships: 0, projects: [], nextByProject: new Map(), upcoming: [] };

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

  const { data: attendanceRows } = events.length
    ? await api
        .from('attendance')
        .select('event_id, status')
        .in('member_id', members.map((m) => m.id))
        .in('event_id', events.map((e) => e.id))
    : { data: [] };
  const statusByEvent = new Map(
    ((attendanceRows as { event_id: string; status: AttendanceStatus }[] | null) ?? []).map((a) => [
      a.event_id,
      a.status,
    ]),
  );

  const nextByProject = new Map<string, Event>();
  for (const e of events) if (!nextByProject.has(e.project_id)) nextByProject.set(e.project_id, e);

  return {
    memberships: members.length,
    projects,
    nextByProject,
    upcoming: events.map((event) => ({
      event,
      project: byId.get(event.project_id)!,
      status: statusByEvent.get(event.id) ?? null,
    })),
  };
};
