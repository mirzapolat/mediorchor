// The nights of a rehearsal weekend and who sleeps which of them — shared by
// the server (capacity checks) and the browser (slots, settings).
//
// A weekend of `days` days has days - 1 nights, numbered from 0. A booked
// period (the free text a participant's import had, e.g. "nur Samstag") is
// placed over a range of nights in the weekend's settings; a period without
// a place, or no period at all, means every night. Two people can share one
// place in a room when their nights don't overlap.

export interface BookingPeriod {
  label: string;
  // Nights, inclusive.
  from: number;
  to: number;
}

export type NightRange = [from: number, to: number];

export const MAX_DAYS = 14;
// Without days and dates: the usual Friday to Sunday.
const DEFAULT_DAYS = 3;

interface WeekendDays {
  days: number | null;
  starts_on: string | null;
  ends_on: string | null;
}

// The weekend's length in days: as set, else from its dates.
export const dayCount = (w: WeekendDays) => {
  if (w.days) return Math.min(MAX_DAYS, Math.max(1, w.days));
  if (w.starts_on && w.ends_on) {
    const diff = Math.round((Date.parse(`${w.ends_on}T00:00:00Z`) - Date.parse(`${w.starts_on}T00:00:00Z`)) / 86_400_000);
    if (diff >= 0) return Math.min(MAX_DAYS, diff + 1);
  }
  return DEFAULT_DAYS;
};

// At least one night, so a one-day weekend still has (one) place per bed.
export const nightCount = (w: WeekendDays) => Math.max(1, dayCount(w) - 1);

// "Fr–So", " fr–so " and "FR–SO" are one period.
export const periodKey = (label: string | null | undefined) => (label ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

// Nights someone chose themselves (on the shared link): they win over the
// imported period.
export interface ChosenNights {
  night_from?: number | null;
  night_to?: number | null;
}

// The nights a participant sleeps there: as chosen, else as their booked
// period stands for, else every night.
export const nightsOf = (
  periods: BookingPeriod[],
  nights: number,
  booking: string | null | undefined,
  chosen?: ChosenNights,
): NightRange => {
  if (chosen?.night_from != null && chosen.night_to != null) {
    const from = Math.min(nights - 1, Math.max(0, chosen.night_from));
    return [from, Math.max(from, Math.min(nights - 1, chosen.night_to))];
  }
  const key = periodKey(booking);
  const period = key ? periods.find((p) => periodKey(p.label) === key) : undefined;
  if (period) {
    const from = Math.max(0, period.from);
    const to = Math.min(nights - 1, period.to);
    if (from <= to) return [from, to];
  }
  return [0, nights - 1];
};

export const overlaps = (a: NightRange, b: NightRange) => a[0] <= b[1] && b[0] <= a[1];

// How many sleep in the room in its fullest night (of `within`, if given).
export const peakOccupancy = (ranges: NightRange[], within?: NightRange) => {
  let peak = 0;
  const [first, last] = within ?? [0, Math.max(0, ...ranges.map((r) => r[1]))];
  for (let night = first; night <= last; night++) {
    peak = Math.max(peak, ranges.filter((r) => r[0] <= night && night <= r[1]).length);
  }
  return peak;
};

// Places of a room with who sleeps in each: people whose nights don't overlap
// share one. Greedy by first night — for ranges this needs no more places
// than the fullest night has people, so `capacity` places suffice whenever
// no night is overbooked (more are returned when one is).
export const packSlots = <T extends { nights: NightRange }>(people: T[], capacity: number) => {
  const slots: T[][] = Array.from({ length: capacity }, () => []);
  const sorted = [...people].sort((a, b) => a.nights[0] - b.nights[0] || a.nights[1] - b.nights[1]);
  for (const person of sorted) {
    const slot = slots.find((s) => s.every((other) => !overlaps(other.nights, person.nights)));
    if (slot) slot.push(person);
    else slots.push([person]);
  }
  return slots;
};

// The periods as stored, cleaned: a label at most once, nights in order and
// within the weekend's longest possible length.
export const cleanPeriods = (value: unknown): BookingPeriod[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: BookingPeriod[] = [];
  for (const item of value.slice(0, 50)) {
    if (typeof item !== 'object' || item === null) continue;
    const { label, from, to } = item as Record<string, unknown>;
    const text = typeof label === 'string' ? label.trim().slice(0, 200) : '';
    const key = periodKey(text);
    if (!key || seen.has(key) || !Number.isInteger(from) || !Number.isInteger(to)) continue;
    const a = Math.max(0, Math.min(MAX_DAYS - 2, from as number));
    const b = Math.max(0, Math.min(MAX_DAYS - 2, to as number));
    seen.add(key);
    out.push({ label: text, from: Math.min(a, b), to: Math.max(a, b) });
  }
  return out;
};
