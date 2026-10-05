// Subscribable iCal feed of a calendar (Kalender tab): its projects' rehearsals
// plus its own events, for Google Calendar, Apple Calendar and the like. The
// unguessable feed token in the URL is the credential; a new token revokes
// the old link.
//
// Times are stored as local wall-clock HH:MM in the instance's time zone (TZ,
// else Europe/Berlin). They are converted explicitly — not with the server
// clock, which is often UTC in a container — and sent as UTC, which every app
// shows correctly without a VTIMEZONE block.
import { Hono } from 'hono';
import { db } from './db.ts';
import { baseUrl } from './auth.ts';
import { branding } from './branding.ts';
import { rateLimit } from './ratelimit.ts';

// Without an end time an entry lasts an hour.
const DEFAULT_MINUTES = 60;

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

interface FeedEntry {
  uid: string;
  name: string;
  date: string; // YYYY-MM-DD
  start: string | null; // HH:MM; null = all day
  end: string | null;
  location: string | null;
  description: string | null;
  url: string | null;
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

const eventLines = (entry: FeedEntry, stamp: string) => {
  const lines = ['BEGIN:VEVENT', `UID:${entry.uid}`, `DTSTAMP:${stamp}`];
  if (isTime(entry.start)) {
    const start = zonedInstant(entry.date, entry.start);
    let end = isTime(entry.end) ? zonedInstant(entry.date, entry.end) : null;
    // An end at or before the start runs past midnight.
    if (end && end <= start) end = new Date(end.getTime() + 24 * 60 * 60_000);
    end ??= new Date(start.getTime() + DEFAULT_MINUTES * 60_000);
    lines.push(`DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(end)}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${dateValue(entry.date)}`, `DTEND;VALUE=DATE:${nextDay(entry.date)}`);
  }
  lines.push(`SUMMARY:${text(entry.name)}`);
  if (entry.location) lines.push(`LOCATION:${text(entry.location)}`);
  if (entry.description) lines.push(`DESCRIPTION:${text(entry.description)}`);
  if (entry.url) lines.push(`URL:${entry.url}`);
  lines.push('END:VEVENT');
  return lines;
};

export const calendarFeedRoutes = new Hono();

calendarFeedRoutes.get('/:file', (c) => {
  rateLimit(c, 'calendar-feed', 120, 60 * 1000);
  const token = c.req.param('file').replace(/\.ics$/i, '');
  const calendar = db.prepare('select id, name from calendars where feed_token = ?').get(token) as
    | { id: string; name: string }
    | undefined;
  if (!calendar) return c.text('Not found', 404);

  const base = baseUrl(c);
  const host = new URL(base).host;

  const rehearsals = db
    .prepare(
      `select e.id, e.name, e.date, e.time, e.end_time, e.location, e.description,
              p.id as project_id, p.name as project_name
       from calendar_projects cp
       join events e on e.project_id = cp.project_id
       join projects p on p.id = e.project_id
       where cp.calendar_id = ? and e.in_calendar and e.date is not null`,
    )
    .all(calendar.id) as {
    id: string;
    name: string;
    date: string;
    time: string | null;
    end_time: string | null;
    location: string | null;
    description: string | null;
    project_id: string;
    project_name: string;
  }[];

  const own = db
    .prepare(
      `select id, name, date, start_time, end_time, location, notes, link
       from calendar_events where calendar_id = ?`,
    )
    .all(calendar.id) as {
    id: string;
    name: string;
    date: string;
    start_time: string | null;
    end_time: string | null;
    location: string | null;
    notes: string | null;
    link: string | null;
  }[];

  const entries: FeedEntry[] = [
    ...rehearsals.map((r) => ({
      uid: `rehearsal-${r.id}@${host}`,
      // The project names the rehearsal: "Probe" alone says little in a feed.
      name: `${r.project_name}: ${r.name}`,
      date: r.date,
      start: r.time,
      end: r.end_time,
      location: r.location,
      description: r.description,
      url: `${base}/projects/${r.project_id}/participation`,
    })),
    ...own.map((e) => ({
      uid: `event-${e.id}@${host}`,
      name: e.name,
      date: e.date,
      start: e.start_time,
      end: e.end_time,
      location: e.location,
      description: e.notes,
      url: e.link && /^https?:\/\//i.test(e.link) ? e.link : null,
    })),
  ].filter((entry) => isDate(entry.date));

  const stamp = utcStamp(new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${text(branding().appName)}//Kalender//DE`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${text(calendar.name)}`,
    // Ask subscribing apps to refresh hourly (Google decides on its own).
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...entries.flatMap((entry) => eventLines(entry, stamp)),
    'END:VCALENDAR',
  ];

  c.header('Content-Type', 'text/calendar; charset=utf-8');
  c.header('Content-Disposition', 'inline; filename="calendar.ics"');
  c.header('Cache-Control', 'no-cache');
  return c.body(lines.map(fold).join('\r\n') + '\r\n');
});
