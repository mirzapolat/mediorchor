import { api } from './api';
import { isHeld, localToday } from './eventTiming';
import type { AttendanceStatus, Member } from '@/types';

export interface AttendanceCounts {
  attended: number;
  excused: number;
  absent: number;
}

export interface ProjectMemberAttendance {
  members: Member[];
  countsByMember: Record<string, AttendanceCounts>;
  eventCount: number;
}

export const loadProjectMemberAttendance = async (
  projectId: string,
): Promise<ProjectMemberAttendance> => {
  const [membersResult, eventsResult, attendanceResult] = await Promise.all([
    api
      .from('members')
      .select('*')
      .eq('project_id', projectId)
      .in('status', ['active', 'archived'])
      .order('last_name'),
    api.from('events').select('id, date').eq('project_id', projectId),
    api
      .from('attendance')
      .select('member_id, event_id, status, events!inner(project_id)')
      .eq('events.project_id', projectId),
  ]);

  // Only Proben that have taken place count; upcoming ones can't be missed yet
  // (an advance "excused" or "present" only counts once the Probe is held).
  const today = localToday();
  const heldIds = new Set(
    ((eventsResult.data as Array<{ id: string; date: string | null }> | null) ?? [])
      .filter((e) => isHeld(e.date, today))
      .map((e) => e.id),
  );
  const eventCount = heldIds.size;
  const explicitCounts: Record<string, Pick<AttendanceCounts, 'attended' | 'excused'>> = {};
  for (const row of
    (attendanceResult.data as Array<{ member_id: string; event_id: string; status: AttendanceStatus }> | null) ??
    []) {
    if (!heldIds.has(row.event_id)) continue;
    const counts = explicitCounts[row.member_id] ?? { attended: 0, excused: 0 };
    if (row.status === 'attended') counts.attended += 1;
    if (row.status === 'excused') counts.excused += 1;
    explicitCounts[row.member_id] = counts;
  }

  const members = (membersResult.data as Member[] | null) ?? [];
  const countsByMember = Object.fromEntries(
    members.map((member) => {
      const counts = explicitCounts[member.id] ?? { attended: 0, excused: 0 };
      return [
        member.id,
        {
          ...counts,
          absent: Math.max(0, eventCount - counts.attended - counts.excused),
        },
      ];
    }),
  );

  return { members, countsByMember, eventCount };
};
