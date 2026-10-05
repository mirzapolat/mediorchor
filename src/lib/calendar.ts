// Kalender (dashboard tab): date helpers for the month grid and date picker,
// and the merged list of entries — the rehearsals of each calendar's projects
// plus the calendars' own events.
import { api } from '@/lib/api';
import type { Calendar, CalendarEvent, CalendarEventException, CalendarProject, Event, Project } from '@/types';

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

// Whole days from `a` to `b` (both YYYY-MM-DD).
export const daysBetween = (a: string, b: string) =>
  Math.round((fromISODate(b).getTime() - fromISODate(a).getTime()) / 86_400_000);

// --- repeating events ----------------------------------------------------------

// An open-ended repeat is shown this far ahead; the iCal feed sends the rule
// itself, so subscribed apps go on forever.
const REPEAT_HORIZON_YEARS = 3;
const MAX_OCCURRENCES = 1500;

// The first days of a manual event's occurrences, like RFC 5545 counts them:
// a monthly or yearly repeat skips months that lack the day (31st, 29 Feb).
export const occurrences = (
  ev: Pick<CalendarEvent, 'date' | 'repeat' | 'repeat_interval' | 'repeat_until'>,
  horizon: string,
): string[] => {
  if (ev.repeat === 'none' || !ev.repeat) return [ev.date];
  const last = ev.repeat_until && ev.repeat_until < horizon ? ev.repeat_until : horizon;
  const step = Math.max(1, ev.repeat_interval || 1);
  const [y, m, d] = ev.date.split('-').map(Number);
  const result: string[] = [];
  for (let i = 0; result.length < MAX_OCCURRENCES && i < MAX_OCCURRENCES * 4; i++) {
    let iso: string;
    if (ev.repeat === 'daily') iso = addDays(ev.date, i * step);
    else if (ev.repeat === 'weekly') iso = addDays(ev.date, 7 * i * step);
    else {
      const next =
        ev.repeat === 'monthly' ? new Date(y, m - 1 + i * step, d, 12) : new Date(y + i * step, m - 1, d, 12);
      if (next.getDate() !== d) continue;
      iso = toISODate(next);
    }
    if (iso > last) break;
    result.push(iso);
  }
  return result;
};

// A multi-day event's last day, moved along with one of its occurrences.
export const shiftedEnd = (ev: Pick<CalendarEvent, 'date' | 'end_date'>, occurrence: string) =>
  ev.end_date && ev.end_date > ev.date ? addDays(occurrence, daysBetween(ev.date, ev.end_date)) : null;

export const repeatHorizon = () => {
  const now = new Date();
  return toISODate(new Date(now.getFullYear() + REPEAT_HORIZON_YEARS, now.getMonth(), now.getDate(), 12));
};

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
  // Multi-day events appear on every day: this is day `day` of `days`.
  span: { day: number; days: number } | null;
}

export type CalendarEntry =
  | (EntryBase & { kind: 'rehearsal'; event: Event; project: { id: string; name: string }; link: null })
  | (EntryBase & {
      kind: 'event';
      event: CalendarEvent;
      link: string | null;
      // The first day this occurrence originally falls on, and its single
      // change (if any) — what "only this one" edits.
      occurrence: string;
      exception: CalendarEventException | null;
    });

export interface CalendarData {
  calendars: Calendar[];
  calendarProjects: CalendarProject[];
  calendarEvents: CalendarEvent[];
  calendarEventExceptions: CalendarEventException[];
  projects: Pick<Project, 'id' | 'name' | 'status' | 'image_url'>[];
  rehearsals: Event[];
}

export const loadCalendarData = async (): Promise<CalendarData> => {
  const [calendarsResult, linksResult, eventsResult, projectsResult, exceptionsResult] = await Promise.all([
    api.from('calendars').select('*').order('position').order('created_at'),
    api.from('calendar_projects').select('*'),
    api.from('calendar_events').select('*').order('date').order('start_time', { nullsFirst: true }),
    api.from('projects').select('id, name, status, image_url').order('name'),
    api.from('calendar_event_exceptions').select('*'),
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
    calendarEventExceptions: (exceptionsResult.data as CalendarEventException[] | null) ?? [],
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
      span: null,
    });
  }
  const horizon = repeatHorizon();
  const exceptionOf = new Map(data.calendarEventExceptions.map((x) => [`${x.event_id}|${x.occurrence_date}`, x]));
  for (const ev of data.calendarEvents) {
    if (!shown.has(ev.calendar_id)) continue;
    for (const occurrence of occurrences(ev, horizon)) {
      const exception = ev.repeat === 'none' ? null : (exceptionOf.get(`${ev.id}|${occurrence}`) ?? null);
      if (exception?.cancelled) continue;
      // A changed occurrence brings its own day(s), times and details.
      const shape = exception ?? { ...ev, date: occurrence, end_date: shiftedEnd(ev, occurrence) };
      const first = shape.date;
      const days = shape.end_date && shape.end_date > first ? daysBetween(first, shape.end_date) + 1 : 1;
      for (let day = 0; day < days; day++) {
        // The start shows on the first day, the end on the last.
        const isFirst = day === 0;
        const isLast = day === days - 1;
        entries.push({
          kind: 'event',
          key: `e-${ev.id}-${occurrence}-${day}`,
          event: ev,
          occurrence,
          exception,
          calendarIds: [ev.calendar_id],
          date: addDays(first, day),
          start: isFirst ? shape.start_time : null,
          end: isLast && shape.start_time ? shape.end_time : null,
          name: shape.name,
          location: shape.location,
          notes: shape.notes,
          link: shape.link,
          span: days > 1 ? { day: day + 1, days } : null,
        });
      }
    }
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

// A calendar link's iCal feed, app-specific ways to subscribe, and its public
// web view with embed code.
export const feedUrls = (token: string) => {
  const https = `${window.location.origin}/api/calendar-feed/${token}.ics`;
  const webcal = https.replace(/^https?:/, 'webcal:');
  const web = `${window.location.origin}/cal/${token}`;
  return {
    https,
    webcal,
    google: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`,
    web,
    embed: `<iframe src="${web}?embed=1" style="border:0;width:100%;height:720px" loading="lazy" title="Kalender"></iframe>`,
  };
};
