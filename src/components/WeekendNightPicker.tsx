import { useState } from 'react';
import { Moon } from 'lucide-react';
import type { NightRange } from '@shared/weekendNights';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { weekendDayLabels, type Weekend } from '@/lib/weekends';

// The days someone is there, as tiles: a tap sets the day of arrival, the
// next one the day of departure; the nights in between are theirs. Starts
// with the whole weekend.
export const WeekendNightPicker = ({
  weekend,
  value,
  onChange,
}: {
  weekend: Pick<Weekend, 'days' | 'starts_on' | 'ends_on'>;
  value: NightRange;
  onChange: (nights: NightRange) => void;
}) => {
  const { t, lang } = useI18n();
  const tiles = weekendDayLabels(weekend, lang, t('weekendDay'));
  const [picking, setPicking] = useState<'arrival' | 'departure'>('arrival');
  // Day of arrival and day of departure.
  const first = value[0];
  const last = value[1] + 1;

  const pick = (day: number) => {
    if (picking === 'arrival' || day <= first) {
      // A new arrival; departure at least the next day.
      const arrival = Math.min(day, tiles.length - 2);
      onChange([arrival, Math.max(last, arrival + 1) - 1]);
      setPicking('departure');
    } else {
      onChange([first, day - 1]);
      setPicking('arrival');
    }
  };

  return (
    <div>
      <p className="mb-2 text-sm text-text-secondary">{picking === 'arrival' ? t('weekendPickArrival') : t('weekendPickDeparture')}</p>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }}>
        {tiles.map((tile, day) => {
          const inside = day >= first && day <= last;
          const edge = day === first || day === last;
          return (
            <button
              key={day}
              type="button"
              aria-pressed={inside}
              onClick={() => pick(day)}
              className={cn(
                'rounded-xl border px-1 py-2 text-center transition-colors',
                edge ? 'border-accent bg-accent/15' : inside ? 'border-accent/50 bg-accent/10' : 'border-border bg-surface hover:bg-surface-subtle',
              )}
            >
              <span className="block truncate text-sm font-semibold">{tile.weekday}</span>
              {tile.date && <span className="block truncate text-xs text-text-tertiary">{tile.date}</span>}
            </button>
          );
        })}
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-sm font-medium">
        <Moon size={14} className="text-text-tertiary" />
        {t('weekendNightsCount').replace('{n}', String(value[1] - value[0] + 1))}
        <span className="font-normal text-text-tertiary">
          · {tiles[first]?.weekday} – {tiles[last]?.weekday}
        </span>
      </p>
    </div>
  );
};
