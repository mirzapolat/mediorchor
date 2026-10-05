// Subscribable iCal feed of a calendar (Kalender tab): its projects' rehearsals
// plus its own events, for Google Calendar, Apple Calendar and the like. Each
// of a calendar's links (calendar_links) has its own unguessable token, the
// credential; renewing it revokes the old link. The same data backs the
// public web view (rpc.ts, get_public_calendar).
//
// Times are stored as local wall-clock HH:MM in the instance's time zone (TZ,
// else Europe/Berlin). They are converted explicitly — not with the server
// clock, which is often UTC in a container — and sent as UTC, which every app
// shows correctly without a VTIMEZONE block.
import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { db } from './db.ts';
import { baseUrl } from './auth.ts';
import { branding } from './branding.ts';
import { rateLimit } from './ratelimit.ts';

// Without an end time an entry lasts an hour.
const DEFAULT_MINUTES = 60;
// "Last fetched" is written at most this often per link.
const FETCH_STAMP_MS = 10 * 60_000;

const TIME_ZONE = process.env.TZ?.trim() || 'Europe/Berlin';
const zoneParts = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

// How far the zone's wall clock is ahead of UTC at the instant `utcMs`.
const zoneOffset = (utcMs: number) => {
  const p = Object.fromEntries(zoneParts.formatToParts(new Date(utcMs)).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - utcMs;
};

// The instant a local date + HH:MM names in the zone (DST-aware).
const zonedInstant = (date: string, time: string) => {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, h, min);
  const first = wall - zoneOffset(wall);
  // A second pass settles times next to a daylight-saving switch.
  return new Date(wall - zoneOffset(first));
};

// --- shared data (feed and public web view) ------------------------------------

export type Repeat = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface FeedLink {
  id: string;
  name: string;
  show_details: number;
  last_fetched_at: string | null;
  calendar_id: string;
  calendar_name: string;
  calendar_color: string;
  reminder_minutes: number | null;
}

export interface FeedRehearsal {
  id: string;
  name: string;
  date: string;
  time: string | null;
  end_time: string | null;
  location: string | null;
  description: string | null;
  sequence: number;
  modified_at: string;
  project_id: string;
  project_name: string;
}

export interface FeedEvent {
  id: string;
  name: string;
  date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  notes: string | null;
  link: string | null;
  repeat: Repeat;
  repeat_interval: number;
  repeat_until: string | null;
  sequence: number;
  modified_at: string;
}

export interface FeedException {
  id: string;
  event_id: string;
  occurrence_date: string;
  cancelled: number;
  name: string;
  date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  notes: string | null;
  link: string | null;
  sequence: number;
  modified_at: string;
}

// A link by its token, with its calendar's rehearsals and own events. Without
// details, location, notes and links are left out. Notes when it was used.
export const loadCalendarByToken = (token: string) => {
  const link = db
    .prepare(
      `select l.id, l.name, l.show_details, l.last_fetched_at, c.id as calendar_id,
              c.name as calendar_name, c.color as calendar_color, c.reminder_minutes
       from calendar_links l join calendars c on c.id = l.calendar_id
       where l.token = ?`,
    )
    .get(token) as FeedLink | undefined;
  if (!link) return null;

  if (!link.last_fetched_at || Date.parse(link.last_fetched_at) < Date.now() - FETCH_STAMP_MS) {
    db.prepare('update calendar_links set last_fetched_at = now_iso() where id = ?').run(link.id);
  }

  const details = Boolean(link.show_details);
  const rehearsals = (
    db
      .prepare(
        `select e.id, e.name, e.date, e.time, e.end_time, e.location, e.description, e.sequence,
                coalesce(e.updated_at, e.created_at) as modified_at,
                p.id as project_id, p.name as project_name
         from calendar_projects cp
         join events e on e.project_id = cp.project_id
         join projects p on p.id = e.project_id
         where cp.calendar_id = ? and e.in_calendar and e.date is not null`,
      )
      .all(link.calendar_id) as FeedRehearsal[]
  ).map((r) => (details ? r : { ...r, location: null, description: null }));

  const events = (
    db
      .prepare(
        `select id, name, date, end_date, start_time, end_time, location, notes, link,
                repeat, repeat_interval, repeat_until, sequence,
                coalesce(updated_at, created_at) as modified_at
         from calendar_events where calendar_id = ?`,
      )
      .all(link.calendar_id) as FeedEvent[]
  ).map((e) => (details ? e : { ...e, location: null, notes: null, link: null }));

  const exceptions = (
    db
      .prepare(
        `select x.id, x.event_id, x.occurrence_date, x.cancelled, x.name, x.date, x.end_date,
                x.start_time, x.end_time, x.location, x.notes, x.link, x.sequence,
                coalesce(x.updated_at, x.created_at) as modified_at
         from calendar_event_exceptions x join calendar_events e on e.id = x.event_id
         where e.calendar_id = ? and e.repeat <> 'none'`,
      )
      .all(link.calendar_id) as FeedException[]
  ).map((x) => (details ? x : { ...x, location: null, notes: null, link: null }));

  return { link, rehearsals, events, exceptions };
};

// --- iCal ----------------------------------------------------------------------

interface FeedEntry {
  uid: string;
  name: string;
  date: string; // YYYY-MM-DD
  endDate: string | null; // last day (multi-day); null = same day
  start: string | null; // HH:MM; null = all day
  end: string | null;
  location: string | null;
  description: string | null;
  url: string | null;
  sequence: number;
  modified: Date;
  repeat: Repeat;
  repeatInterval: number;
  repeatUntil: string | null;
  // Repeating series: occurrences left out (their original first days).
  excluded: string[];
  // A changed single occurrence: the first day it originally fell on, and
  // the series' start time (both name it, as RECURRENCE-ID).
  recurrenceOf: { date: string; seriesStart: string | null } | null;
}

const pad = (n: number) => String(n).padStart(2, '0');

const utcStamp = (d: Date) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
  `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

const dateValue = (date: string) => date.replaceAll('-', '');

const nextDay = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return `${next.getUTCFullYear()}${pad(next.getUTCMonth() + 1)}${pad(next.getUTCDate())}`;
};

const isTime = (value: string | null): value is string => typeof value === 'string' && /^\d{2}:\d{2}$/.test(value);
const isDate = (value: string | null): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

// Timestamps from the database; anything unreadable counts as "long ago".
const parseStamp = (value: string) => {
  const ms = Date.parse(value);
  return new Date(Number.isNaN(ms) ? 0 : ms);
};

// RFC 5545 text: escape backslash, semicolon, comma and newlines.
const text = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// Content lines are folded at 75 octets (continuation lines start with a
// space), never splitting a multi-byte character.
const fold = (line: string) => {
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char);
    if (bytes + size > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
};

const RRULE_FREQ: Record<Exclude<Repeat, 'none'>, string> = {
  daily: 'DAILY',
  weekly: 'WEEKLY',
  monthly: 'MONTHLY',
  yearly: 'YEARLY',
};

const eventLines = (entry: FeedEntry, reminderMinutes: number | null) => {
  const timed = isTime(entry.start);
  // DTSTAMP is the last change, so an unchanged feed stays byte-identical
  // (and its ETag stable) between fetches.
  const stamp = utcStamp(entry.modified);
  const lines = [
    'BEGIN:VEVENT',
    `UID:${entry.uid}`,
    `DTSTAMP:${stamp}`,
    `LAST-MODIFIED:${stamp}`,
    `SEQUENCE:${entry.sequence}`,
  ];
  const lastDay = isDate(entry.endDate) && entry.endDate > entry.date ? entry.endDate : entry.date;
  if (timed) {
    const start = zonedInstant(entry.date, entry.start!);
    let end: Date;
    if (isTime(entry.end)) {
      end = zonedInstant(lastDay, entry.end);
      // On a single day, an end at or before the start runs past midnight.
      if (end <= start) end = new Date(end.getTime() + 24 * 60 * 60_000);
    } else {
      end = new Date(zonedInstant(lastDay, entry.start!).getTime() + DEFAULT_MINUTES * 60_000);
    }
    lines.push(`DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(end)}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${dateValue(entry.date)}`, `DTEND;VALUE=DATE:${nextDay(lastDay)}`);
  }
  // An occurrence is named by its original start, in the series' own type.
  const occurrenceValue = (date: string, seriesStart: string | null) =>
    isTime(seriesStart) ? `:${utcStamp(zonedInstant(date, seriesStart))}` : `;VALUE=DATE:${dateValue(date)}`;
  if (entry.recurrenceOf) {
    lines.push(`RECURRENCE-ID${occurrenceValue(entry.recurrenceOf.date, entry.recurrenceOf.seriesStart)}`);
  }
  if (entry.repeat !== 'none') {
    let rule = `RRULE:FREQ=${RRULE_FREQ[entry.repeat]}`;
    if (entry.repeatInterval > 1) rule += `;INTERVAL=${entry.repeatInterval}`;
    if (isDate(entry.repeatUntil)) {
      // UNTIL matches DTSTART's type: a date, or the end of that day in UTC.
      rule += timed
        ? `;UNTIL=${utcStamp(zonedInstant(entry.repeatUntil, '23:59'))}`
        : `;UNTIL=${dateValue(entry.repeatUntil)}`;
    }
    lines.push(rule);
    for (const date of entry.excluded) lines.push(`EXDATE${occurrenceValue(date, entry.start)}`);
  }
  lines.push(`SUMMARY:${text(entry.name)}`);
  if (entry.location) lines.push(`LOCATION:${text(entry.location)}`);
  if (entry.description) lines.push(`DESCRIPTION:${text(entry.description)}`);
  if (entry.url) lines.push(`URL:${entry.url}`);
  if (reminderMinutes !== null) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${text(entry.name)}`,
      `TRIGGER:-PT${reminderMinutes}M`,
      'END:VALARM',
    );
  }
  lines.push('END:VEVENT');
  return lines;
};

export const calendarFeedRoutes = new Hono();

calendarFeedRoutes.get('/:file', (c) => {
  rateLimit(c, 'calendar-feed', 120, 60 * 1000);
  const token = c.req.param('file').replace(/\.ics$/i, '');
  const loaded = loadCalendarByToken(token);
  if (!loaded) return c.text('Not found', 404);
  const { link, rehearsals, events, exceptions } = loaded;
  const seriesById = new Map(events.map((e) => [e.id, e]));
  // Occurrences outside the series' current range (it was shortened) are gone.
  const inSeries = (x: FeedException) => {
    const series = seriesById.get(x.event_id);
    return Boolean(series) && x.occurrence_date >= series!.date && !(series!.repeat_until && x.occurrence_date > series!.repeat_until);
  };

  const base = baseUrl(c);
  const host = new URL(base).host;

  const entries: FeedEntry[] = [
    ...rehearsals.map((r) => ({
      uid: `rehearsal-${r.id}@${host}`,
      // The project names the rehearsal: "Probe" alone says little in a feed.
      name: `${r.project_name}: ${r.name}`,
      date: r.date,
      endDate: null,
      start: r.time,
      end: r.end_time,
      location: r.location,
      description: r.description,
      url: link.show_details ? `${base}/projects/${r.project_id}/participation` : null,
      sequence: r.sequence,
      modified: parseStamp(r.modified_at),
      repeat: 'none' as const,
      repeatInterval: 1,
      repeatUntil: null,
      excluded: [],
      recurrenceOf: null,
    })),
    ...events.map((e) => ({
      uid: `event-${e.id}@${host}`,
      name: e.name,
      date: e.date,
      endDate: e.end_date,
      start: e.start_time,
      end: e.end_time,
      location: e.location,
      description: e.notes,
      url: e.link && /^https?:\/\//i.test(e.link) ? e.link : null,
      sequence: e.sequence,
      modified: parseStamp(e.modified_at),
      repeat: e.repeat,
      repeatInterval: e.repeat_interval,
      repeatUntil: e.repeat_until,
      // Cancelled occurrences leave the rule; changed ones are overridden
      // below by an entry of their own (same UID plus RECURRENCE-ID).
      excluded:
        e.repeat === 'none'
          ? []
          : exceptions.filter((x) => x.event_id === e.id && x.cancelled && inSeries(x)).map((x) => x.occurrence_date),
      recurrenceOf: null,
    })),
    ...exceptions
      .filter((x) => !x.cancelled && inSeries(x))
      .map((x) => {
        const series = seriesById.get(x.event_id)!;
        return {
          uid: `event-${x.event_id}@${host}`,
          name: x.name,
          date: x.date,
          endDate: x.end_date,
          start: x.start_time,
          end: x.end_time,
          location: x.location,
          description: x.notes,
          url: x.link && /^https?:\/\//i.test(x.link) ? x.link : null,
          // Never below the series': some apps ignore an older-looking override.
          sequence: Math.max(x.sequence, series.sequence),
          modified: parseStamp(x.modified_at),
          repeat: 'none' as const,
          repeatInterval: 1,
          repeatUntil: null,
          excluded: [],
          recurrenceOf: { date: x.occurrence_date, seriesStart: series.start_time },
        };
      }),
  ]
    .filter((entry) => isDate(entry.date))
    // A stable order keeps the body (and ETag) identical between fetches.
    .sort((a, b) => a.uid.localeCompare(b.uid) || (a.recurrenceOf?.date ?? '').localeCompare(b.recurrenceOf?.date ?? ''));

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${text(branding().appName)}//Kalender//DE`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${text(link.calendar_name)}`,
    `X-WR-TIMEZONE:${TIME_ZONE}`,
    // Ask subscribing apps to refresh hourly (Google decides on its own).
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...entries.flatMap((entry) => eventLines(entry, link.reminder_minutes)),
    'END:VCALENDAR',
  ];
  const body = lines.map(fold).join('\r\n') + '\r\n';

  // Apps that send the ETag back get a cheap "nothing changed".
  const etag = `"${createHash('sha256').update(body).digest('base64url').slice(0, 32)}"`;
  c.header('ETag', etag);
  const known = c.req.header('if-none-match');
  if (known && known.split(',').some((tag) => tag.trim().replace(/^W\//, '') === etag)) {
    return c.body(null, 304);
  }
  c.header('Content-Type', 'text/calendar; charset=utf-8');
  c.header('Content-Disposition', 'inline; filename="calendar.ics"');
  return c.body(body);
});
