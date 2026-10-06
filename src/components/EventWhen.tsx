import { CalendarDays, Clock, MapPin } from 'lucide-react';

// Date, time and location on one line, e.g. "Mi., 07.10. · 19:00 · Aula";
// the year only appears when it is not the current one.
export const EventWhen = ({
  date,
  time,
  location,
  lang,
}: {
  date: string | null;
  time: string | null;
  location: string | null;
  lang: string;
}) => {
  if (!date && !time && !location) return null;
  const d = date ? new Date(`${date}T00:00:00`) : null;
  const label = d?.toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    ...(d.getFullYear() !== new Date().getFullYear() && { year: 'numeric' }),
  });
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-text-secondary">
      {label && (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <CalendarDays size={13} className="shrink-0" />
          {label}
        </span>
      )}
      {time && (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <Clock size={13} className="shrink-0" />
          {time}
        </span>
      )}
      {location && (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <MapPin size={13} className="shrink-0" />
          <span className="break-words">{location}</span>
        </span>
      )}
    </p>
  );
};
