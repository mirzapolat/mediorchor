import type { Language } from './config';

// Registration deadlines are stored as ISO timestamps (UTC) and edited in the
// browser's local time through <input type="datetime-local">.

const pad = (n: number) => String(n).padStart(2, '0');

// ISO → "YYYY-MM-DDTHH:mm" in local time ('' for none).
export const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// "YYYY-MM-DDTHH:mm" (local) → ISO, null for empty/invalid.
export const fromLocalInput = (value: string) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

export const isPast = (iso: string | null) => Boolean(iso && !(Date.parse(iso) > Date.now()));

// What a registration page's status badge shows. The deadline only applies to
// the own form, not to webhook sources.
export type RegistrationState = 'active' | 'closed' | 'inactive';

export const registrationState = (page: {
  is_active: boolean;
  source: string;
  closes_at: string | null;
}): RegistrationState =>
  !page.is_active ? 'inactive' : page.source === 'form' && isPast(page.closes_at) ? 'closed' : 'active';

const locale = (lang: Language) => (lang === 'de' ? 'de-DE' : 'en-US');

// "Fr., 3. Okt. 2025, 23:59"
export const formatDeadline = (iso: string, lang: Language) =>
  new Intl.DateTimeFormat(locale(lang), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

// "Freitag, 3. Oktober" / "23:59"
export const formatDeadlineParts = (iso: string, lang: Language) => {
  const d = new Date(iso);
  return {
    month: new Intl.DateTimeFormat(locale(lang), { month: 'short' }).format(d).replace('.', ''),
    day: String(d.getDate()),
    date: new Intl.DateTimeFormat(locale(lang), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
    }).format(d),
    time: new Intl.DateTimeFormat(locale(lang), { hour: '2-digit', minute: '2-digit' }).format(d),
  };
};

// "in 3 Tagen" / "in 5 Stunden"; null when more than two weeks away or past.
export const timeLeft = (iso: string, lang: Language) => {
  const ms = Date.parse(iso) - Date.now();
  if (!(ms > 0) || ms > 14 * 86_400_000) return null;
  const rtf = new Intl.RelativeTimeFormat(locale(lang), { numeric: 'auto' });
  if (ms < 3_600_000) return rtf.format(Math.max(1, Math.round(ms / 60_000)), 'minute');
  if (ms < 2 * 86_400_000) return rtf.format(Math.round(ms / 3_600_000), 'hour');
  return rtf.format(Math.round(ms / 86_400_000), 'day');
};
