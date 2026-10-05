// Kalender (dashboard tab): date helpers for the month grid and date picker,
// and the merged list of entries — the rehearsals of each calendar's projects
// plus the calendars' own events.
import { api } from '@/lib/api';
import type { Calendar, CalendarEvent, CalendarProject, Event, Project } from '@/types';

// Dates are local YYYY-MM-DD strings throughout, like the rehearsals'.
export const toISODate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Noon avoids any daylight-saving edge turning a date into the day before.
export const fromISODate = (iso: string) => new Date(`${iso}T12:00:00`);

export const isISODate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(fromISODate(value).getTime());

// First day of the month `offset` months after `iso`'s month.
export const addMonths = (iso: string, offset: number) => {
  const d = fromISODate(iso);
  return toISODate(new Date(d.getFullYear(), d.getMonth() + offset, 1, 12));
};

export const addDays = (iso: string, offset: number) => {
  const d = fromISODate(iso);
  d.setDate(d.getDate() + offset);
  return toISODate(d);
};

export const monthKey = (iso: string) => iso.slice(0, 7);

// Six Monday-first weeks covering `iso`'s month (always 42 days, so the grid
// keeps its height while paging through months).
export const monthGrid = (iso: string) => {
  const first = fromISODate(`${monthKey(iso)}-01`);
  const lead = (first.getDay() + 6) % 7; // Monday = 0
  const start = toISODate(new Date(first.getFullYear(), first.getMonth(), 1 - lead, 12));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
};

const locale = (lang: string) => (lang === 'de' ? 'de-DE' : 'en-GB');

// "Mo", "Di", … starting Monday.
export const weekdayNames = (lang: string, width: 'short' | 'narrow' = 'short') =>
  Array.from({ length: 7 }, (_, i) =>
    // 1 January 2024 was a Monday.
    new Date(2024, 0, 1 + i, 12).toLocaleDateString(locale(lang), { weekday: width }),
  );

export const formatMonth = (iso: string, lang: string) =>
  fromISODate(iso).toLocaleDateString(locale(lang), { month: 'long', year: 'numeric' });

export const formatDay = (iso: string, lang: string, withWeekday = true) =>
  fromISODate(iso).toLocaleDateString(locale(lang), {
    ...(withWeekday && { weekday: 'long' }),
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

export const monthNames = (lang: string) =>
  Array.from({ length: 12 }, (_, i) => new Date(2024, i, 1, 12).toLocaleDateString(locale(lang), { month: 'short' }));

// "19:00–21:00"; an entry without an end shows just its start.
export const timeRange = (start: string | null, end: string | null) =>
  start ? (end ? `${start}–${end}` : start) : null;

// --- entries -----------------------------------------------------------------

interface EntryBase {
  key: string;
  // Every shown calendar the entry is in (a project can be in several).
  calendarIds: string[];
  date: string;
  start: string | null;
  end: string | null;
  name: string;
  location: string | null;
  notes: string | null;
}

export type CalendarEntry =
  | (EntryBase & { kind: 'rehearsal'; event: Event; project: { id: string; name: string }; link: null })
  | (EntryBase & { kind: 'event'; event: CalendarEvent; link: string | null });

export interface CalendarData {
  calendars: Calendar[];
  calendarProjects: CalendarProject[];
  calendarEvents: CalendarEvent[];
  projects: Pick<Project, 'id' | 'name' | 'status' | 'image_url'>[];
  rehearsals: Event[];
}

export const loadCalendarData = async (): Promise<CalendarData> => {
  const [calendarsResult, linksResult, eventsResult, projectsResult] = await Promise.all([
    api.from('calendars').select('*').order('position').order('created_at'),
    api.from('calendar_projects').select('*'),
    api.from('calendar_events').select('*').order('date').order('start_time', { nullsFirst: true }),
    api.from('projects').select('id, name, status, image_url').order('name'),
  ]);
  const calendarProjects = (linksResult.data as CalendarProject[] | null) ?? [];
  const projectIds = [...new Set(calendarProjects.map((cp) => cp.project_id))];
  const rehearsals = projectIds.length
    ? ((
        await api
          .from('events')
          .select('*')
          .in('project_id', projectIds)
          .eq('in_calendar', true)
      ).data as Event[] | null) ?? []
    : [];
  return {
    calendars: (calendarsResult.data as Calendar[] | null) ?? [],
    calendarProjects,
    calendarEvents: (eventsResult.data as CalendarEvent[] | null) ?? [],
    projects: (projectsResult.data as CalendarData['projects'] | null) ?? [],
    rehearsals,
  };
};

// The entries of the shown calendars, by date and start (all-day first). A
// rehearsal in several shown calendars appears once.
export const buildEntries = (data: CalendarData, shown: Set<string>): CalendarEntry[] => {
  const projectName = new Map(data.projects.map((p) => [p.id, p.name]));
  const order = new Map(data.calendars.map((c, i) => [c.id, i]));
  const calendarsOf = new Map<string, string[]>();
  for (const cp of data.calendarProjects) {
    if (!shown.has(cp.calendar_id)) continue;
    calendarsOf.set(cp.project_id, [...(calendarsOf.get(cp.project_id) ?? []), cp.calendar_id]);
  }

  const entries: CalendarEntry[] = [];
  for (const ev of data.rehearsals) {
    const calendarIds = calendarsOf.get(ev.project_id);
    if (!calendarIds || !ev.date) continue;
    entries.push({
      kind: 'rehearsal',
      key: `r-${ev.id}`,
      event: ev,
      project: { id: ev.project_id, name: projectName.get(ev.project_id) ?? '' },
      calendarIds: [...calendarIds].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)),
      date: ev.date,
      start: ev.time,
      end: ev.time ? ev.end_time : null,
      name: ev.name,
      location: ev.location,
      notes: ev.description,
      link: null,
    });
  }
  for (const ev of data.calendarEvents) {
    if (!shown.has(ev.calendar_id)) continue;
    entries.push({
      kind: 'event',
      key: `e-${ev.id}`,
      event: ev,
      calendarIds: [ev.calendar_id],
      date: ev.date,
      start: ev.start_time,
      end: ev.start_time ? ev.end_time : null,
      name: ev.name,
      location: ev.location,
      notes: ev.notes,
      link: ev.link,
    });
  }
  return entries.sort(
    (a, b) =>
      a.date.localeCompare(b.date) || (a.start ?? '').localeCompare(b.start ?? '') || a.name.localeCompare(b.name),
  );
};

export const groupByDate = (entries: CalendarEntry[]) => {
  const map = new Map<string, CalendarEntry[]>();
  for (const entry of entries) map.set(entry.date, [...(map.get(entry.date) ?? []), entry]);
  return map;
};

// The public iCal link of a calendar, and app-specific ways to subscribe.
export const feedUrls = (token: string) => {
  const https = `${window.location.origin}/api/calendar-feed/${token}.ics`;
  const webcal = https.replace(/^https?:/, 'webcal:');
  return {
    https,
    webcal,
    google: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`,
  };
};
